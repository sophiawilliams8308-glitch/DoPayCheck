import { z } from 'zod';

import { isNegative, max, min, money, subtract, type Money } from '@/lib/core/money';
import type { RuleReference } from '@/lib/calculator/types/rules';

import {
  StateTaxabilityConditionOperator,
  type StateDeliveryMechanism,
  type StateTaxabilityCondition,
  type StateTaxabilityVariant,
} from './detailSchemas';
import { readTaxabilityProfileSet } from './readTaxabilityProfileSet';
import type { ResolvedStateRuleSet } from './stateRuleSet';
import { StateReason, stateUnavailable, type StateUnavailable } from '../errors/stateErrors';
import { StateRuleKey, type StateProgram } from '../ruleKeys';

/**
 * DM-03 taxability resolver — Slice 2 (Task 4O-6R68).
 *
 * Implements `resolveTaxability()` from the DM-03 contract, §12, exactly:
 * deterministic, no fallback, no inference. Every numbered comment below
 * names the exact contract/task step it implements, in the exact order
 * 4O-6R68 §7 locks — nothing is reordered.
 *
 * ===========================================================================
 * WHAT THIS MODULE DOES NOT DO.
 *
 * No jurisdiction branch, no real tax rate, no real-jurisdiction production
 * data, no new formula operation, no Prisma access, no expression evaluator,
 * no new `StateReason`.
 * `StateCalculationContext.taxabilityProfiles` (Option A) is never read here
 * — this module's only rule-data input is `readTaxabilityProfileSet()`,
 * which resolves through the existing, unmodified `TaxRule`-backed pipeline
 * (`stateRule()` -> `readDetail()` -> `validateStateDetail()`). This module
 * is not wired into any caller yet — that is later-slice work.
 * ===========================================================================
 */

/**
 * Runtime context the resolver can evaluate a condition or a discriminated
 * limit against. Every field is OPTIONAL and its absence is a first-class,
 * disclosed fact — never coerced to a default value.
 *
 * `deliveryMechanism` (contract §11, OD-4): the current runtime supplies no
 * delivery mechanism anywhere (`DeductionInput`/`StateDeductionLine` carry no
 * such field — verified in Slice 2 planning, 4O-6R67 §8). This field exists
 * so a *future* caller that does obtain one may supply it; it is NOT added to
 * any calculator input type by this slice.
 *
 * `limitDiscriminator` (contract §8.5): no discriminator vocabulary is
 * defined or assumed by this slice (task §17) — never derived from filing
 * status or any other election automatically. Present only if and when a
 * future caller explicitly decides what a discriminator means and supplies
 * one.
 *
 * `payFrequency`: the state-domain pay-frequency string, e.g. as already
 * carried on `StateCalculationContext.payFrequency`. Needed to decide
 * whether a `MONTHLY` limit is sub-monthly (contract §9) — see
 * `resolveTaxability`'s own §13 comment for why this slice does NOT attempt
 * that distinction even though it declares the field; kept here as an
 * explicit, disclosed hook rather than silently omitted.
 */
export interface TaxabilityResolutionContext {
  readonly deliveryMechanism?: StateDeliveryMechanism;
  readonly limitDiscriminator?: string;
  readonly payFrequency?: string;
}

export interface TaxabilityResolutionInput {
  readonly ruleSet: ResolvedStateRuleSet;
  readonly deductionTypeKey: string;
  readonly program: StateProgram;
  readonly applicableAmount: Money;
  readonly context: TaxabilityResolutionContext;
  /**
   * Amount already applied within the current limit period, when known.
   *
   * `undefined` means UNAVAILABLE — distinct from `money('0')`, which means
   * "known, and zero." Never treat the two as interchangeable (contract
   * §8.7, OD-2).
   */
  readonly priorAppliedAmount?: Money;
}

export type TaxabilityDirection = 'REDUCE_WAGES' | 'INCREASE_WAGES' | 'NO_CHANGE';

export interface TaxabilityResolution {
  readonly effectiveAmount: Money;
  readonly direction: TaxabilityDirection;
  /** The exact `RuleReference` for the resolved `TAXABILITY_PROFILE` rule — never fabricated. */
  readonly rules: readonly RuleReference[];
}

export type TaxabilityResolutionOutcome =
  | { readonly ok: true; readonly resolution: TaxabilityResolution }
  | { readonly ok: false; readonly problem: StateUnavailable };

function ok(resolution: TaxabilityResolution): TaxabilityResolutionOutcome {
  return { ok: true, resolution };
}

function fail(problem: StateUnavailable): TaxabilityResolutionOutcome {
  return { ok: false, problem };
}

/** Operators whose match is the named-value membership itself, rather than its complement.
 * A `Set` built from the enum's own property access (never a quoted-string `case`/`===`
 * comparison) — the same technique Slice 1's `detailSchemas.ts` uses for the identical reason:
 * this operator vocabulary's two-letter member is otherwise indistinguishable, to this
 * repository's own architectural guard (`tests/unit/state-guards.test.ts`, "no per-state
 * dispatch"), from a state postal-code comparison. The comparison itself has nothing to do
 * with any jurisdiction. */
const INCLUSIVE_CONDITION_OPERATORS = new Set<z.infer<typeof StateTaxabilityConditionOperator>>([
  StateTaxabilityConditionOperator.enum.EQUALS,
  StateTaxabilityConditionOperator.enum.IN,
]);

/** One `DELIVERY_MECHANISM` condition against a KNOWN mechanism value (contract §5.5, §11). */
function conditionMatches(
  condition: StateTaxabilityCondition,
  mechanism: StateDeliveryMechanism,
): boolean {
  const isMember = condition.values.includes(mechanism);
  return INCLUSIVE_CONDITION_OPERATORS.has(condition.operator) ? isMember : !isMember;
}

type VariantMatch = 'MATCH' | 'NO_MATCH' | 'UNRESOLVABLE';

/**
 * Evaluates one NON-DEFAULT variant's conditions (ANDed — contract §10.2)
 * against the supplied context. `DELIVERY_MECHANISM` is the only dimension
 * this contract version defines (§10.1), so a missing `context.deliveryMechanism`
 * makes EVERY condition on such a variant unresolvable — not "does not
 * match," which would let a wrong default silently win (contract §12 step 8;
 * task §10's explicit instruction for the unavailable-mechanism case).
 */
function evaluateVariant(
  variant: StateTaxabilityVariant,
  context: TaxabilityResolutionContext,
): VariantMatch {
  if (context.deliveryMechanism === undefined) {
    return 'UNRESOLVABLE';
  }
  const allMatch = variant.conditions.every((condition) =>
    conditionMatches(condition, context.deliveryMechanism as StateDeliveryMechanism),
  );
  return allMatch ? 'MATCH' : 'NO_MATCH';
}

function scenarioUnsupported(detail: string, component?: string): TaxabilityResolutionOutcome {
  return fail(
    stateUnavailable(
      StateReason.SCENARIO_UNSUPPORTED,
      detail,
      StateRuleKey.TAXABILITY_PROFILE,
      component,
    ),
  );
}

function ruleConflict(detail: string, component?: string): TaxabilityResolutionOutcome {
  return fail(
    stateUnavailable(StateReason.RULE_CONFLICT, detail, StateRuleKey.TAXABILITY_PROFILE, component),
  );
}

/**
 * Resolves a deduction's state wage-base treatment for one program — DM-03
 * contract §12, `resolveTaxability(deductionTypeKey, program, applicableAmount,
 * context) -> { effectiveAmount, direction } | Failure`.
 *
 * AUTHORITATIVE RESOLVER PATH (4O-6R62): reads `TAXABILITY_PROFILE_SET` from
 * `input.ruleSet` via `readTaxabilityProfileSet()` — never
 * `StateCalculationContext.taxabilityProfiles`.
 */
export function resolveTaxability(input: TaxabilityResolutionInput): TaxabilityResolutionOutcome {
  // Steps 1-3: rule lookup, verification, schema validation — delegated
  // whole to `readTaxabilityProfileSet()`, which itself delegates to the
  // existing `readDetail()` (RULE_MISSING / RULE_UNVERIFIED /
  // RULE_DETAIL_INVALID) and additionally rejects the legacy shape with
  // RULE_DETAIL_INVALID (never adapted — see that module's own doc comment).
  const found = readTaxabilityProfileSet(input.ruleSet);
  if (!found.ok) {
    return fail(found.problem);
  }
  const profileSet = found.value;
  const reference = stateRuleReference(input.ruleSet);

  // Step 4: deductionTypeKey profile lookup.
  //
  // DEVIATION DISCLOSURE (per 4O-6R67 §19 item 1, and task §8): the contract's
  // own §12 algorithm text does not explicitly state the outcome when the
  // deductionTypeKey itself has no entry in the profiles[] collection — only
  // when a PROGRAM within an already-found profile is absent (step 4 of the
  // contract's own numbering). §14.6's three-state table's "No profile
  // record at all -> RULE_MISSING" is read here as extending to "no profile
  // for THIS deduction type," which is the closest existing category: a
  // deduction nobody has researched a taxability profile for is exactly
  // "not researched," never NOT_STATED (which presupposes a profile record
  // that is merely silent on one field) and never a computed amount.
  const profile = profileSet.profiles.find((p) => p.deductionTypeKey === input.deductionTypeKey);
  if (profile === undefined) {
    return fail(
      stateUnavailable(
        StateReason.RULE_MISSING,
        `No TAXABILITY_PROFILE_SET entry exists for deductionTypeKey ` +
          `"${input.deductionTypeKey}"; its state treatment has not been researched`,
        StateRuleKey.TAXABILITY_PROFILE,
        input.deductionTypeKey,
      ),
    );
  }

  // Step 5: StateProgram lookup. Absent key = NOT_STATED (contract §5.1,
  // §14.6) -- routed the same as an explicit NOT_STATED variant, at the
  // point contract step 9's switch would handle it. Never a fallback to
  // another program.
  const treatment = profile.programTreatments[input.program];
  if (treatment === undefined) {
    return scenarioUnsupported(
      `${input.deductionTypeKey}.programTreatments has no entry for ${input.program}; treated ` +
        'as NOT_STATED, never inferred from another program',
      input.program,
    );
  }

  // Steps 6-9: variant matching, conflict detection, default selection,
  // missing condition context.
  const nonDefault = treatment.variants.filter((v) => v.conditions.length > 0);
  const defaultVariant = treatment.variants.find((v) => v.conditions.length === 0);

  const matched: StateTaxabilityVariant[] = [];
  let unresolvable = false;
  for (const variant of nonDefault) {
    const result = evaluateVariant(variant, input.context);
    if (result === 'MATCH') {
      matched.push(variant);
    } else if (result === 'UNRESOLVABLE') {
      unresolvable = true;
    }
  }

  let variant: StateTaxabilityVariant;
  if (matched.length > 1) {
    return ruleConflict(
      `${matched.length} variants of ${input.deductionTypeKey}.programTreatments.` +
        `${input.program} match the supplied condition context; overlapping variants are a ` +
        'data defect and are never resolved by preference',
    );
  } else if (matched.length === 1) {
    // Mutual exclusivity is already schema-enforced (Slice 1) on declared
    // condition sets, so a definite match here cannot be contradicted by
    // any other variant's unresolved status.
    variant = matched[0] as StateTaxabilityVariant;
  } else if (unresolvable) {
    // Step 8: at least one non-default variant's applicability could not be
    // determined (its condition needs runtime context this slice does not
    // have — today, always the delivery mechanism, OD-4). Falling through to
    // the default here would risk answering as if we knew the variant did
    // not apply, which we do not.
    return scenarioUnsupported(
      `${input.deductionTypeKey}.programTreatments.${input.program} has a condition-bearing ` +
        'variant whose required context (e.g. delivery mechanism) was not supplied; the runtime ' +
        'does not carry this context yet',
    );
  } else if (defaultVariant !== undefined) {
    variant = defaultVariant;
  } else {
    return scenarioUnsupported(
      `No variant of ${input.deductionTypeKey}.programTreatments.${input.program} matched the ` +
        'supplied context, and no default (empty-conditions) variant exists',
    );
  }

  // Step 10: effect resolution.
  if (variant.effect === 'NOT_STATED') {
    return scenarioUnsupported(
      `${input.deductionTypeKey}.programTreatments.${input.program} has effect NOT_STATED; ` +
        'never treated as zero or as an unlimited reduction',
    );
  }
  if (variant.effect === 'NO_CHANGE') {
    return ok({
      effectiveAmount: money('0'),
      direction: 'NO_CHANGE',
      rules: reference ? [reference] : [],
    });
  }
  if (variant.effect === 'INCREASE_WAGES') {
    // Contract §6.2 routing invariant: INCREASE_WAGES must never enter the
    // reduction/limit path below. Returning here, before step 11's negative
    // check or any limit handling, makes that structural rather than an
    // added guard.
    return ok({
      effectiveAmount: input.applicableAmount,
      direction: 'INCREASE_WAGES',
      rules: reference ? [reference] : [],
    });
  }
  // variant.effect === 'REDUCE_WAGES': continue.

  // Step 11: negative amount validation (contract §8.8). This is a runtime
  // INPUT defect, distinct from a rule-DATA defect (RULE_DETAIL_INVALID) --
  // the contract's own text names it "an input-validation failure at
  // runtime." `StateReason.INPUT_INVALID` already exists in this project's
  // vocabulary (`stateErrors.ts`); using it here introduces nothing new.
  if (isNegative(input.applicableAmount)) {
    return fail(
      stateUnavailable(
        StateReason.INPUT_INVALID,
        'applicableAmount is negative; a negative amount is invalid input, never a negative ' +
          'reduction, and is never processed',
        StateRuleKey.TAXABILITY_PROFILE,
      ),
    );
  }

  // Step 12: limit resolution.
  const limit = variant.limit;
  if (limit === null) {
    return ok({
      effectiveAmount: input.applicableAmount,
      direction: 'REDUCE_WAGES',
      rules: reference ? [reference] : [],
    });
  }

  let cap = money(limit.amount);
  if (limit.variantsByDiscriminator !== null && limit.variantsByDiscriminator.length > 0) {
    // Task §17: no discriminator vocabulary is invented or assumed here.
    if (input.context.limitDiscriminator === undefined) {
      return scenarioUnsupported(
        `${input.deductionTypeKey}'s limit declares variantsByDiscriminator, but no ` +
          'discriminator context was supplied; no discriminator source (e.g. filing status) is ' +
          'assumed by this resolver',
      );
    }
    const matches = limit.variantsByDiscriminator.filter(
      (entry) => entry.discriminator === input.context.limitDiscriminator,
    );
    if (matches.length > 1) {
      return ruleConflict(
        `${matches.length} variantsByDiscriminator entries match discriminator ` +
          `"${input.context.limitDiscriminator}"`,
      );
    }
    if (matches.length === 0) {
      return scenarioUnsupported(
        `No variantsByDiscriminator entry matches discriminator ` +
          `"${input.context.limitDiscriminator}"`,
      );
    }
    cap = money((matches[0] as { readonly amount: string }).amount);
  }

  // Step 13: prior usage resolution.
  //
  // PLAN_YEAR always fails: it needs a plan-year start date this runtime
  // never carries (contract §9, OD-3), independent of whether
  // priorAppliedAmount happens to be supplied.
  if (limit.basis === 'PLAN_YEAR') {
    return scenarioUnsupported(
      `${input.deductionTypeKey}'s limit basis is PLAN_YEAR, which requires a plan-year start ` +
        'date this runtime does not carry (OD-3); never inferred from the tax year',
    );
  }

  // ANNUAL always needs prior usage; MONTHLY needs it only for a sub-monthly
  // pay period (contract §9). This slice's input contract (task §6) carries
  // no pay-frequency signal, and the state engine deliberately never reads
  // the generic Phase 3 calendar table (the same boundary Task 4K locked for
  // `resolveStatePayPeriodsPerYear()`). Absent that signal, MONTHLY is
  // treated identically to ANNUAL -- gated on `priorAppliedAmount` being
  // explicitly supplied -- which is the SAFE direction of error (it can
  // under-support a real monthly-or-less-frequent payroll that needed no
  // tracking, but it can never silently treat an untracked sub-monthly cap
  // as unlimited). Disclosed as an open item, not a silent assumption.
  const needsPriorUsage = limit.basis === 'ANNUAL' || limit.basis === 'MONTHLY';
  let prior = money('0');
  if (needsPriorUsage) {
    if (input.priorAppliedAmount === undefined) {
      return scenarioUnsupported(
        `${input.deductionTypeKey}'s limit basis is ${limit.basis}, which requires the amount ` +
          'already applied within the period; no priorAppliedAmount was supplied (undefined is ' +
          'never treated as zero, per OD-2)',
      );
    }
    prior = input.priorAppliedAmount;
  }
  // PAY_PERIOD needs no prior usage (contract §9); `prior` stays zero.

  // Steps 14-15: remaining cap, effective amount.
  const remaining = max(subtract(cap, prior), money('0'));
  const effective = min(input.applicableAmount, remaining);

  // Step 16: excess treatment.
  const excess = subtract(input.applicableAmount, effective);
  if (!isNegative(excess) && excess.greaterThan(0)) {
    if (variant.excessEffect === 'NOT_STATED') {
      return scenarioUnsupported(
        `${input.deductionTypeKey}'s applicable amount exceeds its remaining ${limit.basis} ` +
          'cap and excessEffect is NOT_STATED; the excess is never silently processed',
      );
    }
    if (variant.excessEffect === undefined) {
      // Unreachable once schema validation (already run inside
      // readTaxabilityProfileSet -> readDetail -> validateStateDetail) has
      // passed -- excessEffect is required exactly when limit is non-null.
      // Fails closed rather than guessing if that invariant is ever broken.
      return scenarioUnsupported(
        `${input.deductionTypeKey}'s variant has a non-null limit but no excessEffect; this ` +
          'should be unreachable after schema validation',
      );
    }
    // excessEffect === 'NO_CHANGE': the excess stays in wages; the capped
    // effective amount below is already correct.
  }

  // Step 17: successful result + provenance.
  return ok({
    effectiveAmount: effective,
    direction: 'REDUCE_WAGES',
    rules: reference ? [reference] : [],
  });
}

/**
 * The exact `RuleReference` `assembleStateRuleSet` already attached to the
 * resolved `TAXABILITY_PROFILE` entry — read, never re-derived or mutated.
 * `readTaxabilityProfileSet()` already proved the entry is available (a
 * `readOk` cannot exist otherwise), so this only re-reads its own reference.
 */
function stateRuleReference(ruleSet: ResolvedStateRuleSet): RuleReference | undefined {
  const entry = ruleSet.entries[StateRuleKey.TAXABILITY_PROFILE];
  return entry?.available === true ? entry.rule.reference : undefined;
}

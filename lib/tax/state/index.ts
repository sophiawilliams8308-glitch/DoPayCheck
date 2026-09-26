import { money, round, toStorageString, RoundingMode } from '@/lib/core/money';
import { combineStatuses } from '@/lib/calculator/types/status';
import type { RuleReference } from '@/lib/calculator/types/rules';

import { resolveWorkJurisdictionElections, type StateCalculationContext } from './context';
import { StateReason, statusForStateReason, stateUnavailable } from './errors/stateErrors';
import { PROGRAM_BUCKET, StateRuleKey, type StateBucket, type StateProgram } from './ruleKeys';
import type { TaxabilityResolutionContext } from './rules/resolveTaxability';
import { stateRule, type ResolvedStateRuleSet } from './rules/stateRuleSet';
import { readWithholdingMethod } from './rules/withholdingMethod';
import { resolveWithholdingMethodology } from './rules/withholdingMethodology';
import { readWithholdingFormula } from './rules/withholdingFormula';
import { runStateWithholdingFormula } from './rules/withholdingFormulaInterpreter';
import {
  readWithholdingRoundingPolicy,
  type StateRoundingPolicy,
} from './rules/withholdingRoundingPolicy';
import { calculatePfmlEmployee, calculatePfmlEmployer } from './pfml/calculatePfml';
import { calculateSdiEmployee, calculateSdiEmployer } from './sdi/calculateSdi';
import { calculateSutaEmployee, calculateSutaEmployer } from './suta/calculateSuta';
import type {
  StateAmount,
  StateComponentResult,
  StateDisclosure,
  StateEmployeeResult,
  StateEmployerResult,
  StateTaxResult,
  StateWageBuckets,
} from './types';
import { deriveResolvedStateWageBuckets } from './wages/deriveResolvedStateWageBuckets';

/**
 * State calculation engine — top-level entry point. DM-03 Slice 8; SDI wired
 * in at Slice 10; PFML wired in at Slice 11; SUTA employee side wired in at
 * Slice 12; SUTA employer side wired in at Slice 15; state income-tax
 * withholding's FORMULA path wired in at Slice 24.
 *
 * ===========================================================================
 * SDI, PFML, SUTA (BOTH SIDES), AND INCOME-TAX WITHHOLDING'S FORMULA PATH ARE
 * REAL CALCULATIONS. SUPPLEMENTAL WITHHOLDING REMAINS A SHELL.
 *
 * `calculateStateTaxes()` proves the `StateCalculationContext -> StateTaxResult`
 * shape end to end using resolver-driven state wage buckets
 * (`deriveResolvedStateWageBuckets()`, Slice 7). SDI (`sdi/calculateSdi.ts`,
 * Slice 10), PFML (`pfml/calculatePfml.ts`, Slice 11) and SUTA
 * (`suta/calculateSuta.ts`, Slices 12 + 15) are real, resolver-driven
 * calculations on both sides — `sdiAmount()`/`pfmlAmount()`/
 * (`sutaEmployeeAmount()` + `sutaEmployerAmount()`) below wire them in for
 * exactly their own employee/employer components. SUTA's employer side
 * reads its rate from `context.employer.sutaRate` (the locked Slice 14
 * contract), never from `SUTA_EMPLOYER_RATE`/`SUTA_NEW_EMPLOYER_RATE`.
 *
 * State income-tax withholding (`incomeTaxWithheldAmount()` below, Slice 24)
 * dispatches through the existing `resolveWithholdingMethodology()` (Slice
 * 17): the `FORMULA` path runs the existing `runStateWithholdingFormula()`
 * (Slice 23) against the `stateIncomeTaxWages` bucket; `TABLE_SELECTION_ONLY`
 * still reports `METHOD_NOT_IMPLEMENTED` (no approved post-selection
 * arithmetic contract exists — Slice 20/21); `NONE`/`FLAT`/`PROGRESSIVE`/
 * `HYBRID` still report the dispatcher's own `SCENARIO_UNSUPPORTED`, never
 * bypassed. `supplementalWithheld` is deliberately UNCHANGED — still
 * `programAmount()`'s fabricated-`METHOD_NOT_IMPLEMENTED` shell, since
 * supplemental withholding was not part of this slice's scope.
 *
 * State income-tax withholding ROUNDING (Slice 28, per the Slice 26/27
 * locked contract) is applied at the same `incomeTaxWithheldAmount()`
 * boundary, strictly AFTER the formula succeeds: `WITHHOLDING_ROUNDING_POLICY`
 * is read once in `calculateStateTaxes()` (alongside the existing
 * `WITHHOLDING_METHOD` read) via the existing, unmodified
 * `readWithholdingRoundingPolicy()`; `appliedAt === 'TAX_LEVEL'` rounds the
 * formula's final amount via the canonical `round()` (`lib/core/money.ts`,
 * `policy.currencyScale`/`policy.currencyMode` — never `intermediateScale`);
 * `appliedAt === 'STEP_LEVEL'` reports `METHOD_NOT_IMPLEMENTED` (this engine
 * build has no step-level rounding mechanism), mirroring
 * `TABLE_SELECTION_ONLY`'s own identical situation. The formula interpreter
 * itself is untouched — `ROUND` remains excluded from it (Task 4O-6R31).
 * `methodology.roundingPolicyId` and `StateTaxResult.disclosures` reflect
 * ONLY whether the policy itself was successfully read — independent of
 * whether the income-tax withholding calculation as a whole succeeds — and
 * the policy's own `RuleReference` is never merged into `StateAmount.rules`.
 *
 * This module does not resolve rules, does not resolve taxability, and does
 * not derive wage buckets itself — those stay exactly where they already
 * live (`resolveTaxability()`, `deriveResolvedStateWageBuckets()`). It only
 * composes their already-correct outputs (and, for SDI/PFML/SUTA/income-tax
 * withholding, their own calculation modules' output) into the committed
 * `StateTaxResult` shape, and is not called from `calculatePaycheck()` or
 * wired into `options.state` anywhere — that remains a later, separate
 * integration slice.
 * ===========================================================================
 */

export const STATE_ENGINE_VERSION = '5.0.0-phase5';

/** Reuses the exact `ruleId@version` dedup key `deriveResolvedStateWageBuckets.ts`
 * and `lib/calculator/index.ts`'s `collectReferences()` already established. */
function mergeReferences(groups: readonly (readonly RuleReference[])[]): RuleReference[] {
  const seen = new Map<string, RuleReference>();
  for (const group of groups) {
    for (const reference of group) {
      seen.set(`${reference.ruleId}@${String(reference.version)}`, reference);
    }
  }
  return [...seen.values()];
}

const PROGRAM_LABEL: Readonly<Record<StateProgram, string>> = {
  INCOME_TAX_WITHHOLDING: 'state income tax withholding',
  SDI: 'SDI',
  PFML: 'PFML',
  SUTA: 'SUTA',
};

/**
 * Builds one program's tax-amount `StateAmount`, from the wage bucket that
 * program is mapped to (`PROGRAM_BUCKET`, unchanged).
 *
 * If the bucket itself is unavailable, its `status`/`problem` are propagated
 * VERBATIM — never replaced by a fabricated `METHOD_NOT_IMPLEMENTED`
 * problem, per the explicit task requirement. Only when the bucket is
 * genuinely available does this report the calculation itself as not yet
 * implemented.
 */
function programAmount(
  code: string,
  label: string,
  program: StateProgram,
  buckets: Readonly<Record<StateBucket, StateAmount>>,
): StateAmount {
  const bucket = buckets[PROGRAM_BUCKET[program]];

  if (bucket.amount === null) {
    return {
      code,
      label,
      amount: null,
      status: bucket.status,
      ...(bucket.problem === undefined ? {} : { problem: bucket.problem }),
      rules: [],
    };
  }

  const problem = stateUnavailable(
    StateReason.METHOD_NOT_IMPLEMENTED,
    `${label} is not yet implemented for ${PROGRAM_LABEL[program]}`,
  );
  return {
    code,
    label,
    amount: null,
    status: statusForStateReason(problem.reason),
    problem,
    rules: [],
  };
}

/**
 * SDI-specific counterpart to `programAmount()` — the SDI wage bucket that
 * program is mapped to (`PROGRAM_BUCKET.SDI`, unchanged) feeds a real
 * calculation (`calculateSdi.ts`, Slice 10) instead of a fabricated
 * `METHOD_NOT_IMPLEMENTED`.
 *
 * If the bucket itself is unavailable, its `status`/`problem` propagate
 * VERBATIM — identical to `programAmount()`'s own bucket-failure branch,
 * never overwritten. Only when the bucket is genuinely available does this
 * attempt the real SDI calculation; if THAT fails (missing/unverified rate,
 * a wage base this engine cannot yet enforce, and so on), the calculation's
 * own `StateUnavailable` is used as-is — never replaced or reinterpreted.
 */
function sdiAmount(
  code: string,
  label: string,
  ruleSet: ResolvedStateRuleSet,
  buckets: Readonly<Record<StateBucket, StateAmount>>,
  side: 'EMPLOYEE' | 'EMPLOYER',
): StateAmount {
  const bucket = buckets[PROGRAM_BUCKET.SDI];

  if (bucket.amount === null) {
    return {
      code,
      label,
      amount: null,
      status: bucket.status,
      ...(bucket.problem === undefined ? {} : { problem: bucket.problem }),
      rules: [],
    };
  }

  const result =
    side === 'EMPLOYEE'
      ? calculateSdiEmployee(ruleSet, money(bucket.amount))
      : calculateSdiEmployer(ruleSet, money(bucket.amount));

  if (!result.ok) {
    return {
      code,
      label,
      amount: null,
      status: statusForStateReason(result.problem.reason),
      problem: result.problem,
      rules: [],
    };
  }

  return {
    code,
    label,
    amount: toStorageString(result.value.amount),
    status: 'COMPLETE',
    rules: mergeReferences([bucket.rules, result.value.rules]),
  };
}

/**
 * PFML-specific counterpart to `programAmount()` — the PFML wage bucket that
 * program is mapped to (`PROGRAM_BUCKET.PFML`, unchanged) feeds a real
 * calculation (`calculatePfml.ts`, Slice 11) instead of a fabricated
 * `METHOD_NOT_IMPLEMENTED`. Structurally mirrors `sdiAmount()` above — not
 * shared with it (DM-03 Slice 11's own instruction: do not invent a generic
 * abstraction merely because the two programmes look similar) — but its own
 * bucket-failure-propagation and calculation-failure handling are identical
 * in shape because both wrap the same established `Read<T>` -> `StateAmount`
 * boundary every other reader in this engine already uses.
 *
 * If the bucket itself is unavailable, its `status`/`problem` propagate
 * VERBATIM. Only when the bucket is genuinely available does this attempt
 * the real PFML calculation; if THAT fails, the calculation's own
 * `StateUnavailable` is used as-is — never replaced or reinterpreted.
 */
function pfmlAmount(
  code: string,
  label: string,
  ruleSet: ResolvedStateRuleSet,
  buckets: Readonly<Record<StateBucket, StateAmount>>,
  side: 'EMPLOYEE' | 'EMPLOYER',
): StateAmount {
  const bucket = buckets[PROGRAM_BUCKET.PFML];

  if (bucket.amount === null) {
    return {
      code,
      label,
      amount: null,
      status: bucket.status,
      ...(bucket.problem === undefined ? {} : { problem: bucket.problem }),
      rules: [],
    };
  }

  const result =
    side === 'EMPLOYEE'
      ? calculatePfmlEmployee(ruleSet, money(bucket.amount))
      : calculatePfmlEmployer(ruleSet, money(bucket.amount));

  if (!result.ok) {
    return {
      code,
      label,
      amount: null,
      status: statusForStateReason(result.problem.reason),
      problem: result.problem,
      rules: [],
    };
  }

  return {
    code,
    label,
    amount: toStorageString(result.value.amount),
    status: 'COMPLETE',
    rules: mergeReferences([bucket.rules, result.value.rules]),
  };
}

/**
 * SUTA-EMPLOYEE-specific counterpart to `programAmount()` — the SUTA wage
 * bucket (`PROGRAM_BUCKET.SUTA`, unchanged) feeds a real calculation
 * (`calculateSuta.ts`, Slice 12) instead of a fabricated
 * `METHOD_NOT_IMPLEMENTED`, for the employee side only. There is no
 * `sutaAmount(..., side)` — the employer side (`sutaEmployerAmount()`,
 * below) needs an extra input (`employerSutaRate`) this function has no use
 * for, so the two stay separate rather than sharing one signature.
 *
 * If the bucket itself is unavailable, its `status`/`problem` propagate
 * VERBATIM. Only when the bucket is genuinely available does this attempt
 * the real SUTA employee calculation; if THAT fails, the calculation's own
 * `StateUnavailable` is used as-is — never replaced or reinterpreted.
 */
function sutaEmployeeAmount(
  code: string,
  label: string,
  ruleSet: ResolvedStateRuleSet,
  buckets: Readonly<Record<StateBucket, StateAmount>>,
): StateAmount {
  const bucket = buckets[PROGRAM_BUCKET.SUTA];

  if (bucket.amount === null) {
    return {
      code,
      label,
      amount: null,
      status: bucket.status,
      ...(bucket.problem === undefined ? {} : { problem: bucket.problem }),
      rules: [],
    };
  }

  const result = calculateSutaEmployee(ruleSet, money(bucket.amount));

  if (!result.ok) {
    return {
      code,
      label,
      amount: null,
      status: statusForStateReason(result.problem.reason),
      problem: result.problem,
      rules: [],
    };
  }

  return {
    code,
    label,
    amount: toStorageString(result.value.amount),
    status: 'COMPLETE',
    rules: mergeReferences([bucket.rules, result.value.rules]),
  };
}

/**
 * SUTA-EMPLOYER-specific counterpart to `programAmount()` — the SUTA wage
 * bucket feeds a real calculation (`calculateSuta.ts`, Slice 15) instead of
 * a fabricated `METHOD_NOT_IMPLEMENTED`. Takes `employerSutaRate`
 * (`context.employer.sutaRate`) as an explicit parameter — the sole
 * established employer-rate input (Slice 14's locked contract) —
 * rather than reading `context` itself, keeping this function's inputs
 * exactly as narrow as `sdiAmount()`/`pfmlAmount()`/`sutaEmployeeAmount()`
 * already are.
 *
 * If the bucket itself is unavailable, its `status`/`problem` propagate
 * VERBATIM. Only when the bucket is genuinely available does this attempt
 * the real SUTA employer calculation; if THAT fails (most commonly
 * `employerSutaRate` absent, per the locked contract), the calculation's
 * own `StateUnavailable` is used as-is — never replaced or reinterpreted.
 */
function sutaEmployerAmount(
  code: string,
  label: string,
  ruleSet: ResolvedStateRuleSet,
  buckets: Readonly<Record<StateBucket, StateAmount>>,
  employerSutaRate: string | undefined,
): StateAmount {
  const bucket = buckets[PROGRAM_BUCKET.SUTA];

  if (bucket.amount === null) {
    return {
      code,
      label,
      amount: null,
      status: bucket.status,
      ...(bucket.problem === undefined ? {} : { problem: bucket.problem }),
      rules: [],
    };
  }

  const result = calculateSutaEmployer(ruleSet, money(bucket.amount), employerSutaRate);

  if (!result.ok) {
    return {
      code,
      label,
      amount: null,
      status: statusForStateReason(result.problem.reason),
      problem: result.problem,
      rules: [],
    };
  }

  return {
    code,
    label,
    amount: toStorageString(result.value.amount),
    status: 'COMPLETE',
    rules: mergeReferences([bucket.rules, result.value.rules]),
  };
}

/**
 * Fetches a rule's `RuleReference` via a second, independent, in-memory
 * `stateRule()` call — never via `readDetail()`, whose own `ResolvedDetail`
 * return type carries no reference (DM-03 Slice 23/24). The exact,
 * already-established pattern `calculateSuta.ts`/`calculateSdi.ts`'s own
 * `ruleReference()` helper and `withholdingFormulaInterpreter.ts`'s own
 * identically-named helper already use, reused here rather than reinvented
 * — `readDetail()`/`stateRule()` are never modified.
 */
function ruleReference(
  ruleSet: ResolvedStateRuleSet,
  key: StateRuleKey,
): RuleReference | undefined {
  const entry = stateRule(ruleSet, key);
  return entry.available ? entry.rule.reference : undefined;
}

/**
 * Human-readable label for a `RoundingMode` value — display formatting only,
 * never a rounding decision itself. `StateRoundingPolicy.currencyMode` is
 * already converted from the schema's own string enum to this generic,
 * numeric `RoundingMode` (`withholdingRoundingPolicy.ts`'s own `MODE_MAP`),
 * so the disclosure message reverses that conversion for a person to read —
 * it does not invent a value the policy itself does not carry.
 */
function currencyModeLabel(mode: RoundingMode): string {
  switch (mode) {
    case RoundingMode.HALF_UP:
      return 'HALF_UP';
    case RoundingMode.HALF_EVEN:
      return 'HALF_EVEN';
    case RoundingMode.DOWN:
      return 'DOWN';
    case RoundingMode.UP:
      return 'UP';
    default:
      return String(mode);
  }
}

/**
 * State-local disclosure message for a successfully-resolved rounding
 * policy — deliberately NOT `lib/tax/federal/rounding/federal-rounding.ts`'s
 * `roundingDisclosure()` (state code does not import federal modules), and
 * deliberately narrower: it states only the facts `StateRoundingPolicy`
 * itself carries (policy id, currency scale, currency mode, `appliedAt`),
 * never a jurisdiction-specific claim this repository has no source for.
 */
function roundingDisclosureMessage(policy: StateRoundingPolicy): string {
  return (
    `Rounding policy ${policy.policyId}: currency scale ${String(policy.currencyScale)}, ` +
    `mode ${currencyModeLabel(policy.currencyMode)}, applied at ${policy.appliedAt}.`
  );
}

/**
 * State income-tax withholding — DM-03 Slice 24. The `stateIncomeTaxWages`
 * bucket feeds the existing methodology dispatcher (`resolveWithholdingMethodology()`,
 * Slice 17) and, for the `FORMULA` path only, the existing formula
 * interpreter (`runStateWithholdingFormula()`, Slice 23) instead of the
 * fabricated `METHOD_NOT_IMPLEMENTED` `programAmount()` still reports.
 *
 * ===========================================================================
 * WHAT THIS FUNCTION DOES NOT DO.
 *
 * It does not resolve `WITHHOLDING_METHOD` itself beyond the one, already-read
 * `methodResult` the caller supplies (read once, in `calculateStateTaxes()`,
 * so `methodology.withholdingMethod` and this function's own dispatch share
 * the identical read rather than reading the rule twice). It does not
 * duplicate `resolveWithholdingMethodology()`'s own classification logic —
 * every `structure` value is handled exactly as that resolver already
 * decides, never re-decided here via a second switch on `.structure`. It
 * does not implement `TABLE` post-selection arithmetic (`TABLE_SELECTION_ONLY`
 * remains `METHOD_NOT_IMPLEMENTED` — no approved arithmetic contract exists
 * anywhere in this repository, per DM-03 Slice 20/21's own discovery). It
 * does not implement `ROUND`, rounding-policy application, reciprocity, or
 * supplemental withholding. It does not modify `readDetail()`,
 * `resolveStatePayPeriodsPerYear()`, or `runStateWithholdingFormula()` itself
 * — Slice 23 already established the interpreter's own provenance contract.
 * ===========================================================================
 *
 * FORMULA CONTAINER PROVENANCE (DM-03 Slice 22 Question A, Slice 23): the
 * interpreter never reads `WITHHOLDING_FORMULA` itself — it receives the
 * already-resolved detail as a parameter — so that rule's own `RuleReference`
 * is captured HERE, at this orchestrator layer, via the same `ruleReference()`
 * pattern every other rule reference in this file already uses, and merged
 * in alongside the bucket's and the formula's own operand references. It is
 * never added back into the interpreter.
 *
 * If the bucket itself is unavailable, its `status`/`problem` propagate
 * VERBATIM, identical to every other `xAmount()` function in this file. If
 * `WITHHOLDING_METHOD` failed to read, or `resolveWithholdingMethodology()`
 * reports `SCENARIO_UNSUPPORTED` (`NONE`/`FLAT`/`PROGRESSIVE`/`HYBRID`), or
 * `WITHHOLDING_FORMULA` fails to read, or formula execution itself fails
 * (missing/invalid/unverified rule, `null` filing status, an unsupported
 * operation such as `ROUND`, pay-period resolution failure, or any other
 * existing `Read` failure), that failure's own `StateUnavailable` is used
 * as-is — never replaced, never reinterpreted, and never carrying partial
 * provenance (`rules: []` on every failure branch, exactly like every other
 * `xAmount()` function; `Read<T>`'s failure branch itself carries no value
 * to leak from in the first place).
 */
function incomeTaxWithheldAmount(
  code: string,
  label: string,
  context: StateCalculationContext,
  buckets: Readonly<Record<StateBucket, StateAmount>>,
  methodResult: ReturnType<typeof readWithholdingMethod>,
  policyResult: ReturnType<typeof readWithholdingRoundingPolicy>,
): StateAmount {
  const bucket = buckets[PROGRAM_BUCKET.INCOME_TAX_WITHHOLDING];
  const ruleSet = context.workRuleSet;

  if (bucket.amount === null) {
    return {
      code,
      label,
      amount: null,
      status: bucket.status,
      ...(bucket.problem === undefined ? {} : { problem: bucket.problem }),
      rules: [],
    };
  }

  if (!methodResult.ok) {
    return {
      code,
      label,
      amount: null,
      status: statusForStateReason(methodResult.problem.reason),
      problem: methodResult.problem,
      rules: [],
    };
  }

  const methodology = resolveWithholdingMethodology(methodResult.value);
  if (!methodology.ok) {
    return {
      code,
      label,
      amount: null,
      status: statusForStateReason(methodology.problem.reason),
      problem: methodology.problem,
      rules: [],
    };
  }

  if (methodology.value.kind === 'TABLE_SELECTION_ONLY') {
    const problem = stateUnavailable(
      StateReason.METHOD_NOT_IMPLEMENTED,
      `${label} is not yet implemented for the TABLE withholding methodology — row selection ` +
        'exists, but no approved post-selection arithmetic contract exists in this repository',
    );
    return {
      code,
      label,
      amount: null,
      status: statusForStateReason(problem.reason),
      problem,
      rules: [],
    };
  }

  const formulaDetail = readWithholdingFormula(ruleSet);
  if (!formulaDetail.ok) {
    return {
      code,
      label,
      amount: null,
      status: statusForStateReason(formulaDetail.problem.reason),
      problem: formulaDetail.problem,
      rules: [],
    };
  }

  const filingStatus = context.elections[ruleSet.jurisdictionCode]?.filingStatus ?? null;
  const resolvedElections = resolveWorkJurisdictionElections(context);

  const formulaResult = runStateWithholdingFormula(
    formulaDetail.value,
    ruleSet,
    money(bucket.amount),
    filingStatus,
    context.allowanceCounts,
    resolvedElections,
    context.payFrequency,
  );

  if (!formulaResult.ok) {
    return {
      code,
      label,
      amount: null,
      status: statusForStateReason(formulaResult.problem.reason),
      problem: formulaResult.problem,
      rules: [],
    };
  }

  // Rounding (Slice 28, per the Slice 26/27 locked contract) is applied
  // here, strictly after the formula's own arithmetic has already succeeded.
  // `policyResult` is read once, in `calculateStateTaxes()`, and shared with
  // `methodology.roundingPolicyId`/`StateTaxResult.disclosures` exactly as
  // `methodResult` already is for `methodology.withholdingMethod` — a policy
  // failure here never carries partial rule provenance, and never returns
  // the unrounded amount.
  if (!policyResult.ok) {
    return {
      code,
      label,
      amount: null,
      status: statusForStateReason(policyResult.problem.reason),
      problem: policyResult.problem,
      rules: [],
    };
  }

  if (policyResult.value.appliedAt === 'STEP_LEVEL') {
    const problem = stateUnavailable(
      StateReason.METHOD_NOT_IMPLEMENTED,
      `${label} cannot be rounded — this engine build has no STEP_LEVEL rounding mechanism; ` +
        'only TAX_LEVEL rounding is implemented',
    );
    return {
      code,
      label,
      amount: null,
      status: statusForStateReason(problem.reason),
      problem,
      rules: [],
    };
  }

  const roundedAmount = round(
    formulaResult.value.amount,
    policyResult.value.currencyScale,
    policyResult.value.currencyMode,
  );

  const formulaContainerReference = ruleReference(ruleSet, StateRuleKey.WITHHOLDING_FORMULA);

  return {
    code,
    label,
    amount: toStorageString(roundedAmount),
    status: 'COMPLETE',
    rules: mergeReferences([
      bucket.rules,
      formulaContainerReference === undefined ? [] : [formulaContainerReference],
      formulaResult.value.rules,
    ]),
  };
}

/** A total across several `StateAmount`s that are all unavailable in this
 * shell — folds status via the existing `combineStatuses()`, and carries the
 * first defined component problem forward (mirroring the "first problem
 * wins" convention `deriveResolvedStateWageBuckets()` already established),
 * never a second, distinct problem invented for the total itself. */
function totalAmount(code: string, label: string, amounts: readonly StateAmount[]): StateAmount {
  const status = combineStatuses(amounts.map((amount) => amount.status));
  const firstProblem = amounts.find((amount) => amount.problem !== undefined)?.problem;
  return {
    code,
    label,
    amount: null,
    status,
    ...(firstProblem === undefined ? {} : { problem: firstProblem }),
    rules: [],
  };
}

function toWageBuckets(buckets: Readonly<Record<StateBucket, StateAmount>>): StateWageBuckets {
  return {
    stateIncomeTaxWages: buckets.stateIncomeTaxWages.amount,
    sdiWages: buckets.sdiWages.amount,
    pfmlWages: buckets.pfmlWages.amount,
    sutaWages: buckets.sutaWages.amount,
  };
}

function bucketReferences(buckets: Readonly<Record<StateBucket, StateAmount>>): RuleReference[] {
  return mergeReferences([
    buckets.stateIncomeTaxWages.rules,
    buckets.sdiWages.rules,
    buckets.pfmlWages.rules,
    buckets.sutaWages.rules,
  ]);
}

function bucketProblems(
  buckets: Readonly<Record<StateBucket, StateAmount>>,
): readonly (StateAmount['problem'] & object)[] {
  return Object.values(buckets)
    .map((bucket) => bucket.problem)
    .filter((problem): problem is NonNullable<typeof problem> => problem !== undefined);
}

/**
 * Calculates state taxes for one pay period from an already-assembled
 * `StateCalculationContext` and a separately-supplied
 * `TaxabilityResolutionContext` (delivery mechanism / limit discriminator /
 * sub-monthly classification — none of which `StateCalculationContext`
 * itself carries, exactly the same disclosed gap `deriveResolvedStateWageBuckets()`
 * already has at its own boundary, Slice 7).
 *
 * Pure, synchronous. Calls `deriveResolvedStateWageBuckets()` exactly once.
 */
export function calculateStateTaxes(
  context: StateCalculationContext,
  taxabilityContext: TaxabilityResolutionContext,
): StateTaxResult {
  const buckets = deriveResolvedStateWageBuckets({
    ruleSet: context.workRuleSet,
    wages: {
      regular: money(context.wages.regular),
      supplemental: money(context.wages.supplemental),
    },
    deductions: context.deductions,
    context: taxabilityContext,
  });

  const workJurisdictionCode = context.workRuleSet.jurisdictionCode;

  // Read once — shared by `methodology.withholdingMethod` below and by
  // `incomeTaxWithheldAmount()`'s own dispatch, per DM-03 Slice 24's
  // "do not call the resolver multiple times unnecessarily" instruction.
  const methodResult = readWithholdingMethod(context.workRuleSet);

  // Read once — shared by `methodology.roundingPolicyId`/`disclosures` below
  // and by `incomeTaxWithheldAmount()`'s own rounding step, mirroring
  // `methodResult`'s identical pattern (DM-03 Slice 28, per Slice 27's
  // architectural placement finding). `roundingPolicyId`/the disclosure
  // reflect only whether this read succeeded — independent of whether
  // income-tax withholding itself goes on to succeed (Slice 26/27 §4/§5/§11).
  const policyResult = readWithholdingRoundingPolicy(context.workRuleSet);

  const incomeTaxWithheld = incomeTaxWithheldAmount(
    'STATE_INCOME_TAX_WITHHELD',
    'State income tax withheld',
    context,
    buckets,
    methodResult,
    policyResult,
  );
  const supplementalWithheld = programAmount(
    'STATE_SUPPLEMENTAL_WITHHELD',
    'State supplemental withholding',
    'INCOME_TAX_WITHHOLDING',
    buckets,
  );
  const sdiEmployee = sdiAmount(
    'SDI_EMPLOYEE',
    'SDI employee contribution',
    context.workRuleSet,
    buckets,
    'EMPLOYEE',
  );
  const pfmlEmployee = pfmlAmount(
    'PFML_EMPLOYEE',
    'PFML employee contribution',
    context.workRuleSet,
    buckets,
    'EMPLOYEE',
  );
  const sutaEmployee = sutaEmployeeAmount(
    'SUTA_EMPLOYEE',
    'SUTA employee contribution',
    context.workRuleSet,
    buckets,
  );

  const employeeComponents: StateComponentResult[] = [
    {
      program: 'INCOME_TAX_WITHHOLDING',
      jurisdictionCode: workJurisdictionCode,
      role: 'WORK',
      amount: incomeTaxWithheld,
      bucket: 'stateIncomeTaxWages',
    },
    {
      program: 'SDI',
      jurisdictionCode: workJurisdictionCode,
      role: 'WORK',
      amount: sdiEmployee,
      bucket: 'sdiWages',
    },
    {
      program: 'PFML',
      jurisdictionCode: workJurisdictionCode,
      role: 'WORK',
      amount: pfmlEmployee,
      bucket: 'pfmlWages',
    },
    {
      program: 'SUTA',
      jurisdictionCode: workJurisdictionCode,
      role: 'WORK',
      amount: sutaEmployee,
      bucket: 'sutaWages',
    },
  ];

  const employee: StateEmployeeResult = {
    incomeTaxWithheld,
    supplementalWithheld,
    sdiEmployee,
    pfmlEmployee,
    sutaEmployee,
    totalEmployeeStateTaxes: totalAmount(
      'TOTAL_EMPLOYEE_STATE_TAXES',
      'Total employee state taxes',
      [incomeTaxWithheld, supplementalWithheld, sdiEmployee, pfmlEmployee, sutaEmployee],
    ),
    components: employeeComponents,
  };

  let employer: StateEmployerResult | null = null;
  if (context.includeEmployerTaxes) {
    const sdiEmployer = sdiAmount(
      'SDI_EMPLOYER',
      'SDI employer contribution',
      context.workRuleSet,
      buckets,
      'EMPLOYER',
    );
    const pfmlEmployer = pfmlAmount(
      'PFML_EMPLOYER',
      'PFML employer contribution',
      context.workRuleSet,
      buckets,
      'EMPLOYER',
    );
    const sutaEmployer = sutaEmployerAmount(
      'SUTA_EMPLOYER',
      'SUTA employer contribution',
      context.workRuleSet,
      buckets,
      context.employer.sutaRate,
    );

    const employerComponents: StateComponentResult[] = [
      {
        program: 'SDI',
        jurisdictionCode: workJurisdictionCode,
        role: 'WORK',
        amount: sdiEmployer,
        bucket: 'sdiWages',
      },
      {
        program: 'PFML',
        jurisdictionCode: workJurisdictionCode,
        role: 'WORK',
        amount: pfmlEmployer,
        bucket: 'pfmlWages',
      },
      {
        program: 'SUTA',
        jurisdictionCode: workJurisdictionCode,
        role: 'WORK',
        amount: sutaEmployer,
        bucket: 'sutaWages',
      },
    ];

    employer = {
      sdiEmployer,
      pfmlEmployer,
      sutaEmployer,
      totalEmployerStateTaxes: totalAmount(
        'TOTAL_EMPLOYER_STATE_TAXES',
        'Total employer state taxes',
        [sdiEmployer, pfmlEmployer, sutaEmployer],
      ),
      components: employerComponents,
      disclosures: [],
    };
  }

  const allAmounts: StateAmount[] = [
    incomeTaxWithheld,
    supplementalWithheld,
    sdiEmployee,
    pfmlEmployee,
    sutaEmployee,
    ...(employer === null
      ? []
      : [employer.sdiEmployer, employer.pfmlEmployer, employer.sutaEmployer]),
  ];
  const status = combineStatuses(allAmounts.map((amount) => amount.status));

  const issues = [...new Set(bucketProblems(buckets))];

  const disclosures: readonly StateDisclosure[] = policyResult.ok
    ? [{ code: 'ROUNDING_POLICY', message: roundingDisclosureMessage(policyResult.value) }]
    : [];

  return {
    status,
    engineVersion: STATE_ENGINE_VERSION,
    taxYear: context.taxYear,
    effectiveDate: context.effectiveDate,
    workJurisdictionCode,
    residenceJurisdictionCode: context.residenceJurisdictionCode,
    residencyStatus: context.residencyStatus,
    methodology: {
      // The jurisdiction's own declared method name (WITHHOLDING_METHOD.methodName)
      // — a descriptive disclosure fact, independent of whether the
      // methodology dispatcher or formula execution themselves succeed.
      // `null` only when WITHHOLDING_METHOD itself could not be read.
      withholdingMethod: methodResult.ok ? methodResult.value.methodName : null,
      // Supplemental withholding remains untouched by any slice — left null
      // rather than guessed. `roundingPolicyId` reflects the DM-03 Slice 28
      // rounding-policy read below: populated on successful resolution,
      // independent of whether income-tax withholding itself succeeds
      // (Slice 26/27 §4/§11).
      supplementalTreatment: null,
      roundingPolicyId: policyResult.ok ? policyResult.value.policyId : null,
    },
    buckets: toWageBuckets(buckets),
    employee,
    employer,
    disclosures,
    ruleReferences: bucketReferences(buckets),
    sourceIds: [...new Set(bucketReferences(buckets).flatMap((reference) => reference.sourceIds))],
    issues,
    missingRules: context.workRuleSet.missing,
  };
}

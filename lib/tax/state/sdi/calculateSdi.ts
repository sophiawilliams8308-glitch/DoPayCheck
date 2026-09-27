import { type Money, multiply } from '@/lib/core/money';
import type { RuleReference } from '@/lib/calculator/types/rules';

import { StateReason, stateUnavailable } from '../errors/stateErrors';
import { readDetail, readFail, readOk, readRate, type Read } from '../rules/read-detail';
import type { StateRateDetail } from '../rules/detailSchemas';
import { applyStateContributionMaximum } from '../rules/contributionMaximum';
import { applyStateWageBase } from '../rules/wageBase';
import { stateRule, type ResolvedStateRuleSet } from '../rules/stateRuleSet';
import { StateRuleKey } from '../ruleKeys';

/**
 * SDI (State Disability Insurance) calculation — DM-03 Slice 10.
 *
 * ===========================================================================
 * THE ESTABLISHED CONTRACT: taxable SDI wages x resolved SDI rate.
 *
 * `SDI_EMPLOYEE_RATE`/`SDI_EMPLOYER_RATE` are `RATE`-shaped rule keys
 * (`stateRateDetailSchema`, Step 1) with no dedicated calculation module
 * anywhere in the repository before this slice — only `readRate()`,
 * `multiply()` and `applyStateWageBase()` already existed as reusable,
 * program-agnostic primitives (Slice 9 discovery; Task 3). This module wires
 * them together for SDI specifically, exactly the way
 * `lib/tax/federal/fica/social-security.ts`/`medicare.ts` already do for
 * federal FICA — reusing `readDetail`/`readRate`/`multiply`, never
 * duplicating them.
 * ===========================================================================
 *
 * ===========================================================================
 * WAGE BASE: YTD-AWARE (DM-03 wage-base YTD wiring).
 *
 * `applyStateWageBase()` (`wageBase.ts`) now consumes the caller-supplied
 * `StateCalculationContext.ytd.sdiWages` — wages from this employer,
 * EXCLUDING the current pay period, per `StateYtd`'s own established
 * convention — to compute `remaining = max(base - ytdWages, 0)` before
 * clamping the current period's wages against it:
 *
 *   SDI_WAGE_BASE resolves NOT_APPLICABLE -> no cap exists; proceed uncapped.
 *   SDI_WAGE_BASE resolves APPLIES        -> capped correctly against the
 *                                             remaining annual base, using
 *                                             the supplied YTD figure.
 *   SDI_WAGE_BASE rule missing/unverified/invalid -> that failure, verbatim
 *                                             (the SAME failure
 *                                             applyStateWageBase() already
 *                                             produces; not reinterpreted).
 *
 * `SDI_MAX_CONTRIBUTION` (a separate rule key, separate schema,
 * `stateThresholdDetailSchema`) IS NOW APPLIED (SDI/PFML contribution
 * maximum wiring), via the shared `applyStateContributionMaximum()`
 * primitive (`contributionMaximum.ts`) — a different mechanic from the wage
 * base above: it caps the already-computed CONTRIBUTION DOLLAR AMOUNT
 * (wages x rate), not the wages themselves. It consumes
 * `StateCalculationContext.ytd.sdiContributions` (this employer's SDI
 * contributions, EXCLUDING the current pay period) to compute
 * `remaining = max(maximum - ytdContribution, 0)` before clamping this
 * period's computed contribution against it:
 *
 *   SDI_MAX_CONTRIBUTION resolves NOT_APPLICABLE -> no ceiling; proceed
 *                                             uncapped.
 *   SDI_MAX_CONTRIBUTION resolves APPLIES        -> capped correctly
 *                                             against the remaining annual
 *                                             ceiling, using the supplied
 *                                             YTD contribution figure.
 *   SDI_MAX_CONTRIBUTION rule missing/unverified/invalid -> that failure,
 *                                             verbatim (the SAME failure
 *                                             applyStateContributionMaximum()
 *                                             already produces; not
 *                                             reinterpreted) — this key is
 *                                             already required alongside the
 *                                             wage base for the
 *                                             `DISABILITY_SDI` capability
 *                                             (`capabilityRuleKeys.ts`), so
 *                                             requiring it to resolve here
 *                                             is not a new expectation.
 *
 * OWNER-LOCKED: the resolved rule's `inclusive: boolean | null` field is
 * preserved verbatim by `applyStateContributionMaximum()` and never
 * interpreted here or anywhere else — `null` is never converted to `true` or
 * `false`, and no strict/inclusive comparison behavior exists in this module.
 * See `contributionMaximum.ts`'s own doc comment for the full reasoning.
 * ===========================================================================
 *
 * ===========================================================================
 * APPLICABILITY: READ FROM THE RATE ITSELF, NOT INVENTED SEPARATELY.
 *
 * `stateRateDetailSchema` already carries its own `applicability`/
 * `appliesTo` fields. `withholdingFormulaInterpreter.ts`'s `applyFlatRate()`
 * already consults exactly these two fields for a different RATE-shaped key
 * (`PIT_FLAT_RATE` and others) — `NOT_APPLICABLE` and an `appliesTo`
 * mismatch both report `SCENARIO_UNSUPPORTED` there. This module follows
 * that same, already-established idiom for `SDI_EMPLOYEE_RATE`/
 * `SDI_EMPLOYER_RATE`, rather than reading `SDI_PROGRAM` or
 * `CAPABILITY_DECLARATION` — neither of which has any existing reader or
 * consumer anywhere in the repository to establish how they should gate a
 * calculation. Using the RATE's own fields is the smaller, precedented
 * choice.
 * ===========================================================================
 *
 * ===========================================================================
 * ROUNDING: NONE. NO SDI-SPECIFIC ROUNDING RULE EXISTS.
 *
 * `STATE.WITHHOLDING.ROUNDING_POLICY` is withholding-scoped by its own key
 * and its own reader's doc comment — reusing it for SDI would be an
 * unestablished cross-program borrowing. No `STATE.SDI.ROUNDING_POLICY` (or
 * equivalent) key exists. `multiply()` never rounds; this module returns its
 * result at full Decimal precision, exactly as the state withholding-formula
 * interpreter already leaves its own running value unrounded pending a
 * still-unimplemented, separate `ROUND` step.
 * ===========================================================================
 *
 * PURE. No database access, no filesystem, no global state, no rule lookup
 * beyond the frozen `ResolvedStateRuleSet` it is handed, no taxability
 * resolution (the caller supplies already-resolved `sdiWages`).
 */

export interface SdiContribution {
  readonly amount: Money;
  readonly rules: readonly RuleReference[];
}

function ruleReference(
  ruleSet: ResolvedStateRuleSet,
  key: StateRuleKey,
): RuleReference | undefined {
  // Mirrors resolveTaxability.ts's own stateRuleReference() helper,
  // generalized to a parameter instead of one hardcoded key.
  const entry = stateRule(ruleSet, key);
  return entry.available ? entry.rule.reference : undefined;
}

/** Resolves this pay period's SDI-taxable wages against the wage base, or
 * explains why that cannot be done yet. Shared by both contribution sides —
 * the wage base is one fact, not a per-side one. */
function resolveSdiTaxableWages(
  ruleSet: ResolvedStateRuleSet,
  sdiWages: Money,
  ytdWages: Money,
): Read<{ readonly applicableWages: Money; readonly reference: RuleReference | undefined }> {
  const wageBase = applyStateWageBase(ruleSet, StateRuleKey.SDI_WAGE_BASE, sdiWages, ytdWages);
  if (!wageBase.ok) {
    return readFail(wageBase.problem);
  }

  return readOk({
    applicableWages: wageBase.value.applicableWages,
    reference: ruleReference(ruleSet, StateRuleKey.SDI_WAGE_BASE),
  });
}

function calculateSdiSide(
  ruleSet: ResolvedStateRuleSet,
  sdiWages: Money,
  ytdWages: Money,
  ytdContribution: Money,
  rateRuleKey: typeof StateRuleKey.SDI_EMPLOYEE_RATE | typeof StateRuleKey.SDI_EMPLOYER_RATE,
  expectedSide: 'EMPLOYEE' | 'EMPLOYER',
): Read<SdiContribution> {
  const taxable = resolveSdiTaxableWages(ruleSet, sdiWages, ytdWages);
  if (!taxable.ok) {
    return readFail(taxable.problem);
  }

  const found = readDetail(ruleSet, rateRuleKey);
  if (!found.ok) {
    return readFail(found.problem);
  }
  const rateDetail = found.value.detail as StateRateDetail;

  if (rateDetail.applicability === 'NOT_APPLICABLE') {
    return readFail(
      stateUnavailable(
        StateReason.SCENARIO_UNSUPPORTED,
        `${rateRuleKey} is NOT_APPLICABLE in this jurisdiction; no rate is assumed`,
        rateRuleKey,
      ),
    );
  }

  if (rateDetail.appliesTo !== expectedSide) {
    return readFail(
      stateUnavailable(
        StateReason.SCENARIO_UNSUPPORTED,
        `${rateRuleKey} applies to ${rateDetail.appliesTo}, not ${expectedSide}; this is a data ` +
          'inconsistency, not assumed away',
        rateRuleKey,
      ),
    );
  }

  const rate = readRate(rateDetail.rate, rateDetail.unit, rateRuleKey, 'rate');
  if (!rate.ok) {
    return readFail(rate.problem);
  }

  const periodContribution = multiply(taxable.value.applicableWages, rate.value);

  const maxApplication = applyStateContributionMaximum(
    ruleSet,
    StateRuleKey.SDI_MAX_CONTRIBUTION,
    periodContribution,
    ytdContribution,
  );
  if (!maxApplication.ok) {
    return readFail(maxApplication.problem);
  }

  const rateReference = ruleReference(ruleSet, rateRuleKey);
  const maxReference = ruleReference(ruleSet, StateRuleKey.SDI_MAX_CONTRIBUTION);
  const references = [taxable.value.reference, rateReference, maxReference].filter(
    (reference): reference is RuleReference => reference !== undefined,
  );

  return readOk({
    amount: maxApplication.value.cappedContribution,
    rules: references,
  });
}

/** SDI employee contribution for this pay period, from already-resolved SDI
 * wages, this employer's YTD SDI wages (`StateYtd.sdiWages`, excluding the
 * current period), and this employer's YTD SDI contributions
 * (`StateYtd.sdiContributions`, excluding the current period). */
export function calculateSdiEmployee(
  ruleSet: ResolvedStateRuleSet,
  sdiWages: Money,
  ytdWages: Money,
  ytdContribution: Money,
): Read<SdiContribution> {
  return calculateSdiSide(
    ruleSet,
    sdiWages,
    ytdWages,
    ytdContribution,
    StateRuleKey.SDI_EMPLOYEE_RATE,
    'EMPLOYEE',
  );
}

/** SDI employer contribution for this pay period, from already-resolved SDI
 * wages, this employer's YTD SDI wages (`StateYtd.sdiWages`, excluding the
 * current period), and this employer's YTD SDI contributions
 * (`StateYtd.sdiContributions`, excluding the current period). */
export function calculateSdiEmployer(
  ruleSet: ResolvedStateRuleSet,
  sdiWages: Money,
  ytdWages: Money,
  ytdContribution: Money,
): Read<SdiContribution> {
  return calculateSdiSide(
    ruleSet,
    sdiWages,
    ytdWages,
    ytdContribution,
    StateRuleKey.SDI_EMPLOYER_RATE,
    'EMPLOYER',
  );
}

import { type Money, multiply } from '@/lib/core/money';
import type { RuleReference } from '@/lib/calculator/types/rules';

import { StateReason, stateUnavailable } from '../errors/stateErrors';
import { readDetail, readFail, readOk, readRate, type Read } from '../rules/read-detail';
import type { StateRateDetail } from '../rules/detailSchemas';
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
 * WAGE BASE: APPLIED ONLY WHEN THE DATA SAYS THERE ISN'T ONE.
 *
 * `applyStateWageBase()` (`wageBase.ts`) is explicitly documented as "a
 * simple CURRENT-INPUT clamp, not a YTD wage-base tracker" — it clamps
 * whatever single wage figure it is given against the ANNUAL base, with no
 * year-to-date accumulation. `StateCalculationContext` carries no YTD wages
 * field (unlike federal's `calculateSocialSecurity(ruleSet, periodWages,
 * ytdWages, policy)`, which requires one explicitly) — so a real, resolved
 * `SDI_WAGE_BASE` (`applicability: 'APPLIES'`) cannot be CORRECTLY enforced
 * from this repository's current inputs: clamping only this one pay period
 * against the full annual base would silently under-collect early in the
 * year and, without any account of prior periods, still risk misrepresenting
 * a genuinely capped programme as fully computed.
 *
 * This is exactly the trap DM-03 Slice 10's own instructions name: "Do not
 * implement a cap merely because a wageBase field exists." So:
 *
 *   SDI_WAGE_BASE resolves NOT_APPLICABLE -> no cap exists; proceed uncapped.
 *   SDI_WAGE_BASE resolves APPLIES        -> a real cap exists that this
 *                                             engine cannot yet enforce ->
 *                                             SCENARIO_UNSUPPORTED (an
 *                                             EXISTING StateReason, not
 *                                             invented for this case),
 *                                             mirroring exactly how
 *                                             resolveTaxability() already
 *                                             reports a MONTHLY limit
 *                                             without priorAppliedAmount.
 *   SDI_WAGE_BASE rule missing/unverified/invalid -> that failure, verbatim
 *                                             (the SAME failure
 *                                             applyStateWageBase() already
 *                                             produces; not reinterpreted).
 *
 * `SDI_MAX_CONTRIBUTION` (a separate rule key, separate schema,
 * `stateThresholdDetailSchema`) has the identical YTD problem and NO
 * existing reader/primitive anywhere in the repository — it is left
 * entirely unread here, a deferred item, not a half-built one.
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
): Read<{ readonly applicableWages: Money; readonly reference: RuleReference | undefined }> {
  const wageBase = applyStateWageBase(ruleSet, StateRuleKey.SDI_WAGE_BASE, sdiWages);
  if (!wageBase.ok) {
    return readFail(wageBase.problem);
  }

  if (wageBase.value.wageBase !== null) {
    return readFail(
      stateUnavailable(
        StateReason.SCENARIO_UNSUPPORTED,
        'STATE.SDI.WAGE_BASE resolves APPLIES with a real cap, but this engine has no ' +
          'year-to-date wage tracking to enforce an annual cap correctly across pay periods; ' +
          'a single-period clamp against the full annual base would misrepresent the ' +
          'calculation, so this scenario is not yet supported',
        StateRuleKey.SDI_WAGE_BASE,
      ),
    );
  }

  return readOk({
    applicableWages: wageBase.value.applicableWages,
    reference: ruleReference(ruleSet, StateRuleKey.SDI_WAGE_BASE),
  });
}

function calculateSdiSide(
  ruleSet: ResolvedStateRuleSet,
  sdiWages: Money,
  rateRuleKey: typeof StateRuleKey.SDI_EMPLOYEE_RATE | typeof StateRuleKey.SDI_EMPLOYER_RATE,
  expectedSide: 'EMPLOYEE' | 'EMPLOYER',
): Read<SdiContribution> {
  const taxable = resolveSdiTaxableWages(ruleSet, sdiWages);
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

  const rateReference = ruleReference(ruleSet, rateRuleKey);
  const references = [taxable.value.reference, rateReference].filter(
    (reference): reference is RuleReference => reference !== undefined,
  );

  return readOk({
    amount: multiply(taxable.value.applicableWages, rate.value),
    rules: references,
  });
}

/** SDI employee contribution for this pay period, from already-resolved SDI wages. */
export function calculateSdiEmployee(
  ruleSet: ResolvedStateRuleSet,
  sdiWages: Money,
): Read<SdiContribution> {
  return calculateSdiSide(ruleSet, sdiWages, StateRuleKey.SDI_EMPLOYEE_RATE, 'EMPLOYEE');
}

/** SDI employer contribution for this pay period, from already-resolved SDI wages. */
export function calculateSdiEmployer(
  ruleSet: ResolvedStateRuleSet,
  sdiWages: Money,
): Read<SdiContribution> {
  return calculateSdiSide(ruleSet, sdiWages, StateRuleKey.SDI_EMPLOYER_RATE, 'EMPLOYER');
}

import { type Money, multiply } from '@/lib/core/money';
import type { RuleReference } from '@/lib/calculator/types/rules';

import { StateReason, stateUnavailable } from '../errors/stateErrors';
import { readDetail, readFail, readOk, readRate, type Read } from '../rules/read-detail';
import type { StateRateDetail } from '../rules/detailSchemas';
import { applyStateWageBase } from '../rules/wageBase';
import { stateRule, type ResolvedStateRuleSet } from '../rules/stateRuleSet';
import { StateRuleKey } from '../ruleKeys';

/**
 * SUTA (State Unemployment Tax Act) calculation — DM-03 Slice 12; employer
 * gap partially resolved (documentation only) at Slice 13.
 *
 * ===========================================================================
 * EMPLOYEE SIDE ONLY. THE EMPLOYER SIDE IS STILL A DISCLOSED CONTRACT GAP —
 * ONE HALF NOW RESOLVED, ONE HALF STILL OPEN.
 *
 * SUTA has FOUR rule keys (`ruleKeys.ts`), not the two SDI/PFML have:
 * `SUTA_EMPLOYEE_RATE` (single, unambiguous — the same `RATE`-shaped key
 * SDI/PFML's employee sides already use), plus TWO employer-side candidates,
 * `SUTA_EMPLOYER_RATE` and `SUTA_NEW_EMPLOYER_RATE` — `ruleKeys.ts`'s own
 * comment: "A handful of jurisdictions impose an employee share. Data,
 * never assumed absent" (for the employee rate), distinct from the
 * employer-side split.
 *
 * `StateEmployerProfile.sutaRate?: DecimalString` (`context.ts`) is "the
 * employer's experience-rated SUTA rate, which is employer-specific data" —
 * an already-resolved override that, when supplied, bypasses choosing
 * between `SUTA_EMPLOYER_RATE`/`SUTA_NEW_EMPLOYER_RATE` entirely.
 *
 * RESOLVED (Slice 13): its UNIT — unlike every rate in
 * `stateRateDetailSchema`, this field has no companion `unit` field, but it
 * is not undocumented: it follows the one other established convention in
 * this repository for a bare rate `DecimalString` with no companion unit
 * field, `DeductionInput.percent`, whose consumer
 * (`calculateDeductions()`) documents directly: "Percentages are fractions
 * of gross (e.g. '0.05' = 5%)." No conflicting convention exists anywhere
 * for this shape. See `StateEmployerProfile.sutaRate`'s own doc comment for
 * the full evidence. `sutaRate` is therefore a DECIMAL FRACTION.
 *
 * STILL OPEN (Slice 13 did not resolve this): when `sutaRate` is absent,
 * `StateEmployerProfile` carries no discriminator (no "is this employer
 * new" flag, no employer-type field) to choose between
 * `SUTA_EMPLOYER_RATE` and `SUTA_NEW_EMPLOYER_RATE`. Confirmed at Slice 13:
 * no `Employer` model exists in `prisma/schema.prisma`, and no such field
 * exists anywhere in `StateEmployerProfile`/`StateInput`. Inventing a
 * selection heuristic (first/lowest/highest/"new"/"experienced"/default) is
 * explicitly forbidden absent repository evidence, and adding a new
 * discriminator field would require a broader product decision (how
 * employer classification is captured at all) that is out of scope for a
 * calculation-engine slice.
 *
 * So the employer-side amount is STILL genuinely blocked whenever
 * `sutaRate` is absent (no selector), even though it would now be safely
 * usable, unit-wise, when present. This module still does not implement an
 * employer-side calculation function — doing so remains a separate,
 * explicitly-scoped future slice. The employer side of `PROGRAM_BUCKET.SUTA`
 * stays wired to `programAmount()`'s existing `METHOD_NOT_IMPLEMENTED` path
 * in `lib/tax/state/index.ts`, unchanged.
 * ===========================================================================
 *
 * ===========================================================================
 * WAGE BASE: APPLIED ONLY WHEN THE DATA SAYS THERE ISN'T ONE.
 *
 * Identical reasoning to `calculateSdi.ts`/`calculatePfml.ts`, re-verified
 * for SUTA: `StateCalculationContext` carries no YTD wages field, and
 * `applyStateWageBase()` is a documented current-input-only clamp, not a
 * YTD tracker. So:
 *
 *   SUTA_WAGE_BASE resolves NOT_APPLICABLE -> no cap exists; proceed uncapped.
 *   SUTA_WAGE_BASE resolves APPLIES        -> a real cap exists that this
 *                                              engine cannot yet enforce ->
 *                                              SCENARIO_UNSUPPORTED (an
 *                                              EXISTING StateReason).
 *   SUTA_WAGE_BASE rule missing/unverified/invalid -> that failure, verbatim.
 *
 * There is no `SUTA_MAX_CONTRIBUTION` key at all (confirmed directly against
 * `StateRuleKey`, unlike SDI/PFML which both have one) — nothing to defer,
 * because nothing was ever declared.
 * ===========================================================================
 *
 * APPLICABILITY: READ FROM `SUTA_EMPLOYEE_RATE` ITSELF (`applicability`/
 * `appliesTo`), the same already-established idiom `calculateSdi.ts`/
 * `calculatePfml.ts` use. No `SUTA_PROGRAM`/`CAPABILITY_DECLARATION` reader
 * exists anywhere in the repository.
 *
 * ROUNDING: NONE. No `STATE.SUTA.ROUNDING_POLICY` (or equivalent) key
 * exists anywhere in `StateRuleKey`. `multiply()` never rounds; full
 * Decimal precision is returned.
 *
 * PURE. No database access, no filesystem, no global state, no rule lookup
 * beyond the frozen `ResolvedStateRuleSet` it is handed, no taxability
 * resolution (the caller supplies already-resolved `sutaWages`).
 */

export interface SutaContribution {
  readonly amount: Money;
  readonly rules: readonly RuleReference[];
}

function ruleReference(
  ruleSet: ResolvedStateRuleSet,
  key: StateRuleKey,
): RuleReference | undefined {
  const entry = stateRule(ruleSet, key);
  return entry.available ? entry.rule.reference : undefined;
}

/** Resolves this pay period's SUTA-taxable wages against the wage base, or
 * explains why that cannot be done yet. */
function resolveSutaTaxableWages(
  ruleSet: ResolvedStateRuleSet,
  sutaWages: Money,
): Read<{ readonly applicableWages: Money; readonly reference: RuleReference | undefined }> {
  const wageBase = applyStateWageBase(ruleSet, StateRuleKey.SUTA_WAGE_BASE, sutaWages);
  if (!wageBase.ok) {
    return readFail(wageBase.problem);
  }

  if (wageBase.value.wageBase !== null) {
    return readFail(
      stateUnavailable(
        StateReason.SCENARIO_UNSUPPORTED,
        'STATE.SUTA.WAGE_BASE resolves APPLIES with a real cap, but this engine has no ' +
          'year-to-date wage tracking to enforce an annual cap correctly across pay periods; ' +
          'a single-period clamp against the full annual base would misrepresent the ' +
          'calculation, so this scenario is not yet supported',
        StateRuleKey.SUTA_WAGE_BASE,
      ),
    );
  }

  return readOk({
    applicableWages: wageBase.value.applicableWages,
    reference: ruleReference(ruleSet, StateRuleKey.SUTA_WAGE_BASE),
  });
}

/** SUTA employee contribution for this pay period, from already-resolved
 * SUTA wages. The employer side is a disclosed, unimplemented contract gap
 * — see this module's own doc comment — and has no counterpart function
 * here. */
export function calculateSutaEmployee(
  ruleSet: ResolvedStateRuleSet,
  sutaWages: Money,
): Read<SutaContribution> {
  const taxable = resolveSutaTaxableWages(ruleSet, sutaWages);
  if (!taxable.ok) {
    return readFail(taxable.problem);
  }

  const found = readDetail(ruleSet, StateRuleKey.SUTA_EMPLOYEE_RATE);
  if (!found.ok) {
    return readFail(found.problem);
  }
  const rateDetail = found.value.detail as StateRateDetail;

  if (rateDetail.applicability === 'NOT_APPLICABLE') {
    return readFail(
      stateUnavailable(
        StateReason.SCENARIO_UNSUPPORTED,
        `${StateRuleKey.SUTA_EMPLOYEE_RATE} is NOT_APPLICABLE in this jurisdiction; no rate is ` +
          'assumed',
        StateRuleKey.SUTA_EMPLOYEE_RATE,
      ),
    );
  }

  if (rateDetail.appliesTo !== 'EMPLOYEE') {
    return readFail(
      stateUnavailable(
        StateReason.SCENARIO_UNSUPPORTED,
        `${StateRuleKey.SUTA_EMPLOYEE_RATE} applies to ${rateDetail.appliesTo}, not EMPLOYEE; ` +
          'this is a data inconsistency, not assumed away',
        StateRuleKey.SUTA_EMPLOYEE_RATE,
      ),
    );
  }

  const rate = readRate(rateDetail.rate, rateDetail.unit, StateRuleKey.SUTA_EMPLOYEE_RATE, 'rate');
  if (!rate.ok) {
    return readFail(rate.problem);
  }

  const rateReference = ruleReference(ruleSet, StateRuleKey.SUTA_EMPLOYEE_RATE);
  const references = [taxable.value.reference, rateReference].filter(
    (reference): reference is RuleReference => reference !== undefined,
  );

  return readOk({
    amount: multiply(taxable.value.applicableWages, rate.value),
    rules: references,
  });
}

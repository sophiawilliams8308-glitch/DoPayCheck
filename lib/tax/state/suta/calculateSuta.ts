import { type Money, money, multiply } from '@/lib/core/money';
import type { RuleReference } from '@/lib/calculator/types/rules';

import { StateReason, stateUnavailable } from '../errors/stateErrors';
import { readDetail, readFail, readOk, readRate, type Read } from '../rules/read-detail';
import type { StateRateDetail } from '../rules/detailSchemas';
import { applyStateWageBase } from '../rules/wageBase';
import { stateRule, type ResolvedStateRuleSet } from '../rules/stateRuleSet';
import { StateRuleKey } from '../ruleKeys';
import type { DecimalString } from '../types';

/**
 * SUTA (State Unemployment Tax Act) calculation — DM-03 Slice 12 (employee);
 * employer contract resolved at Slices 13-14 and implemented at Slice 15.
 *
 * ===========================================================================
 * BOTH SIDES NOW IMPLEMENTED — ON GENUINELY DIFFERENT RATE SOURCES.
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
 * for this shape. `sutaRate` is therefore a DECIMAL FRACTION.
 *
 * RESOLVED (Slice 14): the SELECTION CONTRACT — `sutaRate` is the SOLE,
 * REQUIRED input for a computable employer SUTA amount. Its ABSENCE means
 * employer SUTA is UNAVAILABLE, never a silent fallback to
 * `SUTA_EMPLOYER_RATE`/`SUTA_NEW_EMPLOYER_RATE`. Repository evidence for
 * this: no employer-type/experience-rating discriminator exists anywhere
 * (confirmed by two independent, exhaustive searches — no `Employer`
 * model in `prisma/schema.prisma`, no such field on
 * `StateEmployerProfile`/`StateInput`); `docs/SPECIFICATION.md`'s own SUTA
 * field list describes what a jurisdiction's RULE ROW should capture, never
 * how one EMPLOYER's rate is selected from it; and this mirrors the SAME
 * "no established selector -> SCENARIO_UNSUPPORTED" convention this engine
 * already applies uniformly elsewhere (every SDI/PFML/SUTA wage-base
 * APPLIES-without-YTD case). See `StateEmployerProfile.sutaRate`'s own doc
 * comment for the full evidence trail.
 *
 * IMPLEMENTED (Slice 15): `calculateSutaEmployer()` follows exactly the
 * contract the two prior slices established — `employerSutaRate` (the
 * caller-supplied `context.employer.sutaRate`, already a decimal fraction)
 * is required; `undefined` reports `SCENARIO_UNSUPPORTED` immediately,
 * never reading `SUTA_EMPLOYER_RATE`/`SUTA_NEW_EMPLOYER_RATE`, never
 * defaulting, never marking the result `COMPLETE`. Wage-base handling is
 * identical to the employee side (same `resolveSutaTaxableWages()`
 * helper, reused rather than duplicated). A malformed `employerSutaRate`
 * string (this field is `DecimalString = string` — a plain alias, not
 * runtime-validated by the type system itself) reports `INPUT_INVALID` via
 * the existing `money()` boundary, never silently coerced.
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

/**
 * SUTA employer contribution for this pay period, from already-resolved
 * SUTA wages and `context.employer.sutaRate` — the sole established
 * employer-side rate input (DM-03 Slice 14). Never reads
 * `SUTA_EMPLOYER_RATE`/`SUTA_NEW_EMPLOYER_RATE`; no employer-type/
 * experience-rating discriminator is consulted or invented.
 *
 * `employerSutaRate` is the caller-supplied value directly (not the whole
 * `StateEmployerProfile`), mirroring how `calculateSutaEmployee()` takes
 * `sutaWages` directly rather than a whole context object.
 */
export function calculateSutaEmployer(
  ruleSet: ResolvedStateRuleSet,
  sutaWages: Money,
  employerSutaRate: DecimalString | undefined,
): Read<SutaContribution> {
  const taxable = resolveSutaTaxableWages(ruleSet, sutaWages);
  if (!taxable.ok) {
    return readFail(taxable.problem);
  }

  if (employerSutaRate === undefined) {
    return readFail(
      stateUnavailable(
        StateReason.SCENARIO_UNSUPPORTED,
        'context.employer.sutaRate is not supplied; it is the sole established employer-side ' +
          'SUTA rate input (DM-03 Slice 14) and its absence is never filled by ' +
          'STATE.SUTA.EMPLOYER_RATE or STATE.SUTA.NEW_EMPLOYER_RATE',
      ),
    );
  }

  let rate: Money;
  try {
    rate = money(employerSutaRate);
  } catch {
    return readFail(
      stateUnavailable(
        StateReason.INPUT_INVALID,
        `context.employer.sutaRate "${employerSutaRate}" is not a valid decimal string`,
      ),
    );
  }

  return readOk({
    amount: multiply(taxable.value.applicableWages, rate),
    rules: taxable.value.reference === undefined ? [] : [taxable.value.reference],
  });
}

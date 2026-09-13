import { type Money, min, multiply } from '@/lib/core/money';

import { FederalRuleKey } from '../rule-keys';
import { roundTax, type FederalRoundingPolicy } from '../rounding/federal-rounding';
import {
  readDetail,
  readRate,
  requireComponent,
  type Read,
  readFail,
  readOk,
} from '../rules/read-detail';
import type { ResolvedFederalRuleSet } from '../rules/resolved-rule-set';
import type { RateDetail, WageBaseDetail } from '../rules/detail-schemas';

/**
 * Medicare — spec §14. Tracks C and D.
 *
 * ===========================================================================
 * THE `NOT_APPLICABLE` RECORD (§14.3).
 *
 * `FED.MEDICARE.WAGE_BASE` must EXIST as a rule record whose verification
 * status is NOT_APPLICABLE, with a source confirming no Medicare wage base
 * applies. The engine then:
 *
 *   NOT_APPLICABLE record present → no cap, proceed
 *   record ABSENT                 → INCOMPLETE, refuse to calculate
 *
 * An absent record is indistinguishable from missing data. An explicit
 * NOT_APPLICABLE record is a positive, source-backed statement that the concept
 * does not apply. This is the central application of the project rule that
 * NOT_STATED is not NOT_APPLICABLE is not zero — and the reason "uncapped" is
 * data-driven here rather than hardcoded.
 * ===========================================================================
 */

export interface MedicareComputation {
  readonly taxableThisPeriod: Money;
  readonly employee: Money;
  readonly employer: Money;
  readonly capApplied: boolean;
  /** How "no cap" was established — an audit fact, not an assumption. */
  readonly wageBaseBasis: 'NOT_APPLICABLE' | 'CAPPED';
  readonly ruleKeys: readonly string[];
}

export function calculateMedicare(
  ruleSet: ResolvedFederalRuleSet,
  periodWages: Money,
  policy: FederalRoundingPolicy,
): Read<MedicareComputation> {
  // The wage-base RECORD is required even though Medicare has no cap.
  const baseRule = readDetail(ruleSet, FederalRuleKey.MEDICARE_WAGE_BASE);
  if (!baseRule.ok) {
    return readFail(baseRule.problem);
  }
  const baseDetail = baseRule.value.detail as WageBaseDetail;

  const employeeRule = readDetail(ruleSet, FederalRuleKey.MEDICARE_EMPLOYEE_RATE);
  if (!employeeRule.ok) {
    return readFail(employeeRule.problem);
  }
  const employeeDetail = employeeRule.value.detail as RateDetail;
  const employeeRate = readRate(
    employeeDetail.rate,
    employeeDetail.unit,
    FederalRuleKey.MEDICARE_EMPLOYEE_RATE,
  );
  if (!employeeRate.ok) {
    return readFail(employeeRate.problem);
  }

  const employerRule = readDetail(ruleSet, FederalRuleKey.MEDICARE_EMPLOYER_RATE);
  if (!employerRule.ok) {
    return readFail(employerRule.problem);
  }
  const employerDetail = employerRule.value.detail as RateDetail;
  const employerRate = readRate(
    employerDetail.rate,
    employerDetail.unit,
    FederalRuleKey.MEDICARE_EMPLOYER_RATE,
  );
  if (!employerRate.ok) {
    return readFail(employerRate.problem);
  }

  let taxable = periodWages;
  let capApplied = false;

  if (baseDetail.applicability === 'APPLIES') {
    // A base that APPLIES must also state its amount; a stated cap with no
    // value is incomplete data, never an absent cap.
    const limit = requireComponent(baseDetail.amount, FederalRuleKey.MEDICARE_WAGE_BASE, 'amount');
    if (!limit.ok) {
      return readFail(limit.problem);
    }
    taxable = min(periodWages, limit.value);
    capApplied = true;
  }

  return readOk({
    taxableThisPeriod: taxable,
    employee: roundTax(multiply(taxable, employeeRate.value), policy),
    employer: roundTax(multiply(taxable, employerRate.value), policy),
    capApplied,
    wageBaseBasis: capApplied ? 'CAPPED' : 'NOT_APPLICABLE',
    ruleKeys: [
      FederalRuleKey.MEDICARE_WAGE_BASE,
      FederalRuleKey.MEDICARE_EMPLOYEE_RATE,
      FederalRuleKey.MEDICARE_EMPLOYER_RATE,
    ],
  });
}

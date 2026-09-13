import { type Money, max, min, multiply, subtract, zero } from '@/lib/core/money';

import { FederalReason, unavailable } from '../errors/federal-errors';
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
 * Social Security / OASDI — spec §13. Tracks C and D.
 *
 * ===========================================================================
 * THE WAGE BASE IS THE WHOLE PROBLEM.
 *
 *   remainingBase = max(wageBase − ytd, 0)
 *   taxable       = min(periodWages, remainingBase)
 *
 * Applying the rate without asking how much base the year has used overstates
 * the tax for anyone crossing it mid-year — and the error is invisible on a
 * single payslip. This is correct only because YTD EXCLUDES the current period
 * (§13.4, D-SS-1); including it would double-count this cheque.
 * ===========================================================================
 *
 * Employee and employer read SEPARATE rule records even when the rates are
 * numerically equal, because the law imposes them separately: the 2011-2012
 * employee-side reduction must be expressible as data, never as a code change.
 */

export interface SocialSecurityComputation {
  readonly taxableThisPeriod: Money;
  readonly wageBaseRemaining: Money;
  readonly employee: Money;
  readonly employer: Money;
  readonly ruleKeys: readonly string[];
}

/** Wages under the base this period, given what the year has already used. */
export function applyWageBaseCap(
  periodWages: Money,
  ytdWages: Money,
  wageBase: Money,
): { taxable: Money; remaining: Money } {
  const remaining = max(subtract(wageBase, ytdWages), zero());
  return { taxable: min(periodWages, remaining), remaining };
}

export function calculateSocialSecurity(
  ruleSet: ResolvedFederalRuleSet,
  periodWages: Money,
  ytdWages: Money,
  policy: FederalRoundingPolicy,
): Read<SocialSecurityComputation> {
  const baseRule = readDetail(ruleSet, FederalRuleKey.SS_WAGE_BASE);
  if (!baseRule.ok) {
    return readFail(baseRule.problem);
  }
  const baseDetail = baseRule.value.detail as WageBaseDetail;

  // Social Security HAS a base. A NOT_APPLICABLE record here is a data error,
  // not a licence to tax without limit (§13.1).
  if (baseDetail.applicability === 'NOT_APPLICABLE') {
    return readFail(
      unavailable(
        FederalReason.RULE_CONFLICT,
        'The Social Security wage base is recorded NOT_APPLICABLE, but Social Security has a ' +
          'wage base; this is a data defect',
        FederalRuleKey.SS_WAGE_BASE,
        'applicability',
      ),
    );
  }

  const wageBase = requireComponent(baseDetail.amount, FederalRuleKey.SS_WAGE_BASE, 'amount');
  if (!wageBase.ok) {
    return readFail(wageBase.problem);
  }

  const employeeRule = readDetail(ruleSet, FederalRuleKey.SS_EMPLOYEE_RATE);
  if (!employeeRule.ok) {
    return readFail(employeeRule.problem);
  }
  const employeeDetail = employeeRule.value.detail as RateDetail;
  const employeeRate = readRate(
    employeeDetail.rate,
    employeeDetail.unit,
    FederalRuleKey.SS_EMPLOYEE_RATE,
  );
  if (!employeeRate.ok) {
    return readFail(employeeRate.problem);
  }

  const employerRule = readDetail(ruleSet, FederalRuleKey.SS_EMPLOYER_RATE);
  if (!employerRule.ok) {
    return readFail(employerRule.problem);
  }
  const employerDetail = employerRule.value.detail as RateDetail;
  const employerRate = readRate(
    employerDetail.rate,
    employerDetail.unit,
    FederalRuleKey.SS_EMPLOYER_RATE,
  );
  if (!employerRate.ok) {
    return readFail(employerRate.problem);
  }

  const { taxable, remaining } = applyWageBaseCap(periodWages, ytdWages, wageBase.value);

  return readOk({
    taxableThisPeriod: taxable,
    wageBaseRemaining: remaining,
    employee: roundTax(multiply(taxable, employeeRate.value), policy),
    employer: roundTax(multiply(taxable, employerRate.value), policy),
    ruleKeys: [
      FederalRuleKey.SS_WAGE_BASE,
      FederalRuleKey.SS_EMPLOYEE_RATE,
      FederalRuleKey.SS_EMPLOYER_RATE,
    ],
  });
}

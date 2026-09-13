import { type Money, max, min, money, multiply, subtract, zero } from '@/lib/core/money';

import { FederalRuleKey } from '../rule-keys';
import {
  FEDERAL_ROUNDING_V1,
  roundTax,
  type FederalRoundingPolicy,
} from '../rounding/federal-rounding';
import { readDetail, requireComponent, type Read, readFail, readOk } from '../rules/read-detail';
import type { ResolvedFederalRuleSet } from '../rules/resolved-rule-set';
import type { SocialSecurityDetail } from '../rules/detail-schemas';

/**
 * Social Security / OASDI (Phase 4, Tracks C and D).
 *
 * ===========================================================================
 * THE WAGE BASE IS THE WHOLE PROBLEM.
 *
 * Social Security stops at an annual wage base. Applying the rate to this period's wages
 * without asking how much of the base is already used overstates the tax for anyone who
 * crosses it mid-year — and the error is invisible on a single payslip.
 *
 * Room remaining = wageBase − ytdSocialSecurityWages, floored at zero.
 * Taxable now     = min(room, thisPeriodWages)
 *
 * This is correct only because YTD EXCLUDES the current pay period (D-SS-1). If YTD included
 * it, this would double-count the current cheque.
 * ===========================================================================
 *
 * Employee and employer are computed from SEPARATE rates. They are usually equal, but that is
 * a fact about current law, not a property of the tax, and the engine never assumes it.
 */

export interface SocialSecurityComputation {
  readonly taxableThisPeriod: Money;
  readonly wageBaseRemaining: Money;
  readonly employee: Money;
  readonly employer: Money;
  readonly ruleKey: string;
}

/** Wages that fall under the base this period, given what the year has already used. */
export function socialSecurityTaxableWages(
  periodWages: Money,
  ytdWages: Money,
  wageBase: Money,
): { taxable: Money; remaining: Money } {
  const remaining = max(subtract(wageBase, ytdWages), zero());
  return { taxable: min(remaining, periodWages), remaining };
}

export function calculateSocialSecurity(
  ruleSet: ResolvedFederalRuleSet,
  periodWages: Money,
  ytdWages: Money,
  policy: FederalRoundingPolicy = FEDERAL_ROUNDING_V1,
): Read<SocialSecurityComputation> {
  const found = readDetail(ruleSet, FederalRuleKey.FICA_SOCIAL_SECURITY);
  if (!found.ok) {
    return readFail(found.problem);
  }

  const detail = found.value.detail as SocialSecurityDetail;
  const ruleKey = found.value.ruleKey;

  const wageBase = requireComponent(detail.wageBase, ruleKey, 'wageBase');
  if (!wageBase.ok) {
    return readFail(wageBase.problem);
  }
  const employeeRate = requireComponent(detail.employeeRate, ruleKey, 'employeeRate');
  if (!employeeRate.ok) {
    return readFail(employeeRate.problem);
  }
  const employerRate = requireComponent(detail.employerRate, ruleKey, 'employerRate');
  if (!employerRate.ok) {
    return readFail(employerRate.problem);
  }

  const { taxable, remaining } = socialSecurityTaxableWages(periodWages, ytdWages, wageBase.value);

  return readOk({
    taxableThisPeriod: taxable,
    wageBaseRemaining: remaining,
    employee: roundTax(multiply(taxable, employeeRate.value), policy),
    employer: roundTax(multiply(taxable, employerRate.value), policy),
    ruleKey,
  });
}

/** Exposed for tests that need the zero baseline without a rule set. */
export function noSocialSecurityWages(): Money {
  return money('0');
}

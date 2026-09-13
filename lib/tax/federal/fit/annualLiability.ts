import { type Money, add, compare, max, money, multiply, subtract, zero } from '@/lib/core/money';

import { FederalReason, unavailable } from '../errors/federal-errors';
import { FederalRuleKey } from '../rule-keys';
import { roundTax, type FederalRoundingPolicy } from '../rounding/federal-rounding';
import {
  readDetail,
  requireForFilingStatus,
  type Read,
  readFail,
  readOk,
  requireComponent,
} from '../rules/read-detail';
import type { ResolvedFederalRuleSet } from '../rules/resolved-rule-set';
import type {
  AnnualRateScheduleDetail,
  AnnualStandardDeductionDetail,
} from '../rules/detail-schemas';

/**
 * Annual federal income tax liability (Phase 4, Track A).
 *
 * ===========================================================================
 * DISPLAY ONLY. THIS IS NEVER A WITHHOLDING AMOUNT.
 *
 * Track A answers "roughly what will I owe for the year?". Track B answers "what must my
 * employer withhold from this cheque?". They use different published data for different
 * purposes, and the whole point of separating them is that this number can never leak into a
 * payslip.
 *
 * It reads only FED.ANNUAL.* keys. It cannot reach FED.FIT.* data, and if annual data is
 * missing it returns an incomplete result rather than borrowing Track B's tables.
 * ===========================================================================
 */

export interface AnnualLiabilityResult {
  readonly displayOnly: true;
  readonly taxableIncome: Money;
  readonly liability: Money;
  readonly ruleKeys: readonly string[];
}

export function calculateAnnualLiability(
  ruleSet: ResolvedFederalRuleSet,
  annualGrossIncome: Money,
  filingStatus: string,
  policy: FederalRoundingPolicy,
): Read<AnnualLiabilityResult> {
  const deductionRule = readDetail(ruleSet, FederalRuleKey.ANNUAL_STANDARD_DEDUCTION);
  if (!deductionRule.ok) {
    return readFail(deductionRule.problem);
  }
  const deductionDetail = deductionRule.value.detail as AnnualStandardDeductionDetail;

  const standardDeduction = requireForFilingStatus(
    deductionDetail.amounts,
    filingStatus,
    deductionRule.value.ruleKey,
    'amounts',
  );
  if (!standardDeduction.ok) {
    return readFail(standardDeduction.problem);
  }

  const scheduleRule = readDetail(ruleSet, FederalRuleKey.ANNUAL_RATE_SCHEDULE);
  if (!scheduleRule.ok) {
    return readFail(scheduleRule.problem);
  }
  const scheduleDetail = scheduleRule.value.detail as AnnualRateScheduleDetail;
  const scheduleKey = scheduleRule.value.ruleKey;

  const bracketSet = scheduleDetail.bracketSets.find(
    (candidate) => candidate.filingStatus === filingStatus,
  );
  if (bracketSet === undefined || bracketSet.brackets.length === 0) {
    return readFail(
      unavailable(
        FederalReason.COMPONENT_NOT_STATED,
        `No annual bracket set for filing status ${filingStatus}`,
        scheduleKey,
        `bracketSets[${filingStatus}]`,
      ),
    );
  }

  const taxableIncome = max(subtract(annualGrossIncome, standardDeduction.value), zero());

  const ordered = [...bracketSet.brackets].sort((a, b) => a.ordinal - b.ordinal);
  for (const bracket of ordered) {
    const aboveLower =
      bracket.lowerBound === null || compare(taxableIncome, money(bracket.lowerBound)) >= 0;
    const belowUpper =
      bracket.upperBound === null || compare(taxableIncome, money(bracket.upperBound)) < 0;

    if (!aboveLower || !belowUpper) {
      continue;
    }

    const rate = requireComponent(bracket.rate, scheduleKey, `brackets[${bracket.ordinal}].rate`);
    if (!rate.ok) {
      return readFail(rate.problem);
    }

    const lower = bracket.lowerBound === null ? zero() : money(bracket.lowerBound);
    const baseTax =
      bracket.baseTax === undefined || bracket.baseTax === null ? zero() : money(bracket.baseTax);
    const excess = max(subtract(taxableIncome, lower), zero());
    const liability = roundTax(add(baseTax, multiply(excess, rate.value)), policy);

    return readOk({
      displayOnly: true,
      taxableIncome,
      liability,
      ruleKeys: [deductionRule.value.ruleKey, scheduleKey],
    });
  }

  return readFail(
    unavailable(
      FederalReason.COMPONENT_NOT_STATED,
      'No annual bracket covers the taxable income; the schedule is incomplete',
      scheduleKey,
      'bracketSets',
    ),
  );
}

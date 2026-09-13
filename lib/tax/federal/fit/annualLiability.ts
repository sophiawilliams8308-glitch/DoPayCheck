import {
  type Money,
  add,
  compare,
  max,
  money,
  multiply,
  subtract,
  sum,
  zero,
} from '@/lib/core/money';

import { FederalReason, unavailable } from '../errors/federal-errors';
import { FederalRuleKey } from '../rule-keys';
import { roundTax, type FederalRoundingPolicy } from '../rounding/federal-rounding';
import {
  readDetail,
  readRate,
  requireComponent,
  requireForFilingStatus,
  type Read,
  readFail,
  readOk,
} from '../rules/read-detail';
import type { ResolvedFederalRuleSet } from '../rules/resolved-rule-set';
import type {
  AmountByFilingStatusDetail,
  BracketTableDetail,
  ScalarAmountDetail,
} from '../rules/detail-schemas';

/**
 * Annual federal income tax liability — spec §4. TRACK A, DISPLAY ONLY.
 *
 * ===========================================================================
 * THIS IS NEVER A WITHHOLDING AMOUNT.
 *
 * Track A answers "roughly what will I owe for the year?". Track B answers
 * "what must my employer withhold from this cheque?". Different published data,
 * different purpose — and the whole point of the separation is that this number
 * can never reach a payslip (§4.1).
 *
 * It reads only FED.ANNUAL.* keys. It cannot reach FED.FIT.* data, and if
 * annual data is missing it returns NOT_AVAILABLE rather than borrowing Track
 * B's tables. Track A is never allowed to fail the paycheck (§4.2).
 * ===========================================================================
 *
 * A wages-only projection: it ignores credits, other income, itemized
 * deductions, other household income, QBI and the OBBBA deductions. Those
 * limitations are produced here so the frontend cannot overstate the figure.
 */

export const TRACK_A_LIMITATIONS: readonly string[] = [
  'Projects from wages only — other income is not included.',
  'Ignores tax credits.',
  'Ignores itemized deductions and the OBBBA qualified tips and overtime deductions.',
  'Ignores other household income and any spouse’s earnings.',
  'Ignores qualified business income.',
];

export interface AnnualLiabilityResult {
  readonly isEstimate: true;
  readonly taxableIncome: Money;
  readonly liability: Money;
  readonly limitations: readonly string[];
  readonly ruleKeys: readonly string[];
}

/** Track A is unavailable — distinct from a failure, and never fatal (§4.2). */
export interface AnnualLiabilityUnavailable {
  readonly isEstimate: true;
  readonly available: false;
  readonly reason: string;
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
  const deductionDetail = deductionRule.value.detail as AmountByFilingStatusDetail;

  // §4.3 — a filing status with no published thresholds returns unavailable.
  // Borrowing the Single table for Head of Household would be invention.
  const standardDeduction = requireForFilingStatus(
    deductionDetail.amounts,
    filingStatus,
    FederalRuleKey.ANNUAL_STANDARD_DEDUCTION,
    'amounts',
  );
  if (!standardDeduction.ok) {
    return readFail(standardDeduction.problem);
  }

  const exemptionRule = readDetail(ruleSet, FederalRuleKey.ANNUAL_PERSONAL_EXEMPTION);
  if (!exemptionRule.ok) {
    return readFail(exemptionRule.problem);
  }
  const exemptionDetail = exemptionRule.value.detail as ScalarAmountDetail;
  const personalExemption = requireComponent(
    exemptionDetail.amount,
    FederalRuleKey.ANNUAL_PERSONAL_EXEMPTION,
    'amount',
  );
  if (!personalExemption.ok) {
    return readFail(personalExemption.problem);
  }

  const bracketRule = readDetail(ruleSet, FederalRuleKey.ANNUAL_RATE_BRACKETS);
  if (!bracketRule.ok) {
    return readFail(bracketRule.problem);
  }
  const bracketDetail = bracketRule.value.detail as BracketTableDetail;
  const bracketSet = bracketDetail.bracketSets.find(
    (candidate) => candidate.filingStatus === filingStatus,
  );

  if (bracketSet === undefined || bracketSet.brackets.length === 0) {
    return readFail(
      unavailable(
        FederalReason.COMPONENT_NOT_STATED,
        `No annual bracket set for filing status ${filingStatus}; the estimate is unavailable ` +
          'rather than borrowing another status’s table',
        FederalRuleKey.ANNUAL_RATE_BRACKETS,
        `bracketSets[${filingStatus}]`,
      ),
    );
  }

  const taxableIncome = max(
    subtract(subtract(annualGrossIncome, standardDeduction.value), personalExemption.value),
    zero(),
  );

  // Progressive application: each bracket taxes only the slice inside it.
  // Track A brackets carry no base-amount column (§6.3), so the tax is summed
  // across slices rather than read off a "tax on the first X" figure.
  const ordered = [...bracketSet.brackets].sort((a, b) => a.rowOrder - b.rowOrder);
  const slices: Money[] = [];

  for (const bracket of ordered) {
    const lower = bracket.atLeast === null ? zero() : money(bracket.atLeast);
    if (compare(taxableIncome, lower) <= 0) {
      continue;
    }
    const upper = bracket.lessThan === null ? taxableIncome : money(bracket.lessThan);
    const ceiling = compare(taxableIncome, upper) < 0 ? taxableIncome : upper;
    const slice = max(subtract(ceiling, lower), zero());
    if (slice.isZero()) {
      continue;
    }

    const rate = readRate(
      bracket.rate,
      bracket.unit,
      FederalRuleKey.ANNUAL_RATE_BRACKETS,
      `brackets[${String(bracket.rowOrder)}].rate`,
    );
    if (!rate.ok) {
      return readFail(rate.problem);
    }
    slices.push(multiply(slice, rate.value));
  }

  return readOk({
    isEstimate: true,
    taxableIncome,
    liability: roundTax(slices.length === 0 ? zero() : sum(slices), policy),
    limitations: TRACK_A_LIMITATIONS,
    ruleKeys: [
      FederalRuleKey.ANNUAL_STANDARD_DEDUCTION,
      FederalRuleKey.ANNUAL_PERSONAL_EXEMPTION,
      FederalRuleKey.ANNUAL_RATE_BRACKETS,
    ],
  });
}

/** Effective rate on the projection. Null when gross is zero — never divide by it. */
export function effectiveAnnualRate(
  liability: Money,
  annualGrossIncome: Money,
  scale: number,
): Money | null {
  if (annualGrossIncome.isZero()) {
    return null;
  }
  return liability.dividedBy(annualGrossIncome).toDecimalPlaces(scale);
}

/** Sums annual figures. Exported so the caller can compose without re-deriving. */
export function addAnnual(a: Money, b: Money): Money {
  return add(a, b);
}

import {
  type Money,
  add,
  max,
  money,
  multiply,
  subtract,
  toStorageString,
  zero,
} from '@/lib/core/money';

import { FederalReason, unavailable } from '../errors/federal-errors';
import { FederalRuleKey } from '../rule-keys';
import { roundTax, type FederalRoundingPolicy } from '../rounding/federal-rounding';
import {
  readDetail,
  requireComponent,
  requireForFilingStatus,
  type Read,
  readFail,
  readOk,
} from '../rules/read-detail';
import type { ResolvedFederalRuleSet } from '../rules/resolved-rule-set';
import type { Pre2020AllowanceDetail, Worksheet1ADetail } from '../rules/detail-schemas';
import { W4Revision, type FederalW4, type WorksheetLines } from '../types';
import { annualize, deannualize } from './pay-periods';
import { findRow, selectSchedule } from './rate-schedule';

/**
 * IRS Publication 15-T, Worksheet 1A — percentage method (Phase 4, Track B).
 *
 * ===========================================================================
 * THE ONLY PATH TO A PAYCHECK WITHHOLDING FIGURE.
 *
 * Annual 1040 brackets are never substituted here. The worksheet annualizes the period's
 * wages, adjusts them by the W-4 steps, applies a WITHHOLDING rate schedule, then divides
 * back down to the period. Skipping to annual brackets would produce a plausible number that
 * is not what the employer is required to withhold.
 * ===========================================================================
 *
 * EVERY LINE IS RETAINED. The worksheet's intermediate lines are the explanation an employee
 * is owed, so each is recorded rather than collapsed into one arithmetic expression.
 *
 * A BLANK W-4 LINE IS ZERO — AND THAT IS NOT AN INVENTED TAX VALUE. When an employee leaves
 * Step 4(a) empty they have stated "no other income". That is caller-supplied fact, entirely
 * unlike a missing rate, which stays PENDING and blocks the calculation.
 */

/** Reads an optional W-4 money line. Absent means the employee left the line blank. */
function w4Line(value: string | null): Money {
  return value === null ? zero() : money(value);
}

export interface Worksheet1AResult {
  /** Withholding for this pay period, before Step 4(c) is added. */
  readonly beforeExtra: Money;
  /** Step 4(c) extra, kept separate so it is visible and never silently absorbed. */
  readonly extraPerPeriod: Money;
  readonly total: Money;
  readonly lines: WorksheetLines;
  readonly ruleKeys: readonly string[];
}

/**
 * Runs Worksheet 1A for one pay period.
 *
 * `taxableWages` is the period's FEDERAL INCOME TAX bucket — already reduced by whichever
 * pre-tax deductions reduce that specific bucket (Phase 3 decides that, per deduction).
 */
export function runWorksheet1A(
  ruleSet: ResolvedFederalRuleSet,
  w4: FederalW4,
  taxableWages: Money,
  periodsPerYear: number,
  policy: FederalRoundingPolicy,
): Read<Worksheet1AResult> {
  const found = readDetail(ruleSet, FederalRuleKey.FIT_WORKSHEET_1A);
  if (!found.ok) {
    return readFail(found.problem);
  }
  const detail = found.value.detail as Worksheet1ADetail;
  const ruleKey = found.value.ruleKey;
  const ruleKeys: string[] = [ruleKey];

  const lines: Record<string, string | null> = {};
  const put = (line: string, value: Money): void => {
    lines[line] = toStorageString(value);
  };

  // --- Step 1: adjusted annual wage amount -------------------------------------------
  const line1a = taxableWages;
  put('1a', line1a);
  lines['1b'] = String(periodsPerYear);

  const line1c = annualize(line1a, periodsPerYear);
  put('1c', line1c);

  const line1d = w4Line(w4.step4aOtherIncomeAnnual);
  put('1d', line1d);

  const line1e = add(line1c, line1d);
  put('1e', line1e);

  const line1f = w4Line(w4.step4bDeductionsAnnual);
  put('1f', line1f);

  // Line 1g: zero when the Step 2 box is checked; otherwise the worksheet's own standard
  // amount for the filing status. This is a Pub. 15-T figure, NOT the annual 1040 standard
  // deduction, and it comes from rule data.
  let line1g: Money;
  if (w4.step2MultipleJobsChecked) {
    line1g = zero();
  } else {
    const standard = requireForFilingStatus(
      detail.standardDeductionAmounts,
      w4.filingStatus,
      ruleKey,
      'standardDeductionAmounts',
    );
    if (!standard.ok) {
      return readFail(standard.problem);
    }
    line1g = standard.value;
  }
  put('1g', line1g);

  const line1h = add(line1f, line1g);
  put('1h', line1h);

  // Never negative: deductions exceeding wages cannot create a negative wage base.
  const line1i = max(subtract(line1e, line1h), zero());
  put('1i', line1i);

  // --- Pre-2020 W-4: lines 1j–1l ------------------------------------------------------
  // A historical form is NEVER reinterpreted as a current one. It takes its own allowance
  // path, and without the allowance rule the calculation is INCOMPLETE, not approximated.
  let adjustedAnnualWage = line1i;

  if (w4.revision === W4Revision.PRE_2020) {
    const allowanceRule = readDetail(ruleSet, FederalRuleKey.FIT_PRE2020_ALLOWANCE);
    if (!allowanceRule.ok) {
      return readFail(allowanceRule.problem);
    }
    const allowanceDetail = allowanceRule.value.detail as Pre2020AllowanceDetail;
    ruleKeys.push(allowanceRule.value.ruleKey);

    if (w4.pre2020Allowances === null) {
      return readFail(
        unavailable(
          FederalReason.INPUT_INVALID,
          'A pre-2020 W-4 requires the number of allowances claimed; it is not assumed',
          allowanceRule.value.ruleKey,
          'pre2020Allowances',
        ),
      );
    }

    const perAllowance = requireComponent(
      allowanceDetail.allowanceAmount,
      allowanceRule.value.ruleKey,
      'allowanceAmount',
    );
    if (!perAllowance.ok) {
      return readFail(perAllowance.problem);
    }

    const line1j = money(String(w4.pre2020Allowances));
    lines['1j'] = String(w4.pre2020Allowances);

    const line1k = multiply(line1j, perAllowance.value);
    put('1k', line1k);

    const line1l = max(subtract(line1i, line1k), zero());
    put('1l', line1l);

    adjustedAnnualWage = line1l;
  }

  // --- Step 2: tentative withholding from the rate schedule ---------------------------
  const schedule = selectSchedule(detail, w4.filingStatus, w4.step2MultipleJobsChecked, ruleKey);
  if (!schedule.ok) {
    return readFail(schedule.problem);
  }

  const match = findRow(schedule.value.rows, adjustedAnnualWage, ruleKey);
  if (!match.ok) {
    return readFail(match.problem);
  }

  put('2a', adjustedAnnualWage);
  put('2b', match.value.excessOver);
  put('2c', match.value.baseAmount);
  lines['2d'] = toStorageString(match.value.marginalRate);

  const line2e = max(subtract(adjustedAnnualWage, match.value.excessOver), zero());
  put('2e', line2e);

  const line2f = multiply(line2e, match.value.marginalRate);
  put('2f', line2f);

  const line2g = add(match.value.baseAmount, line2f);
  put('2g', line2g);

  const line2h = deannualize(line2g, periodsPerYear, policy);
  put('2h', line2h);

  // --- Step 3: tax credits -------------------------------------------------------------
  const line3a = w4Line(w4.step3CreditsAnnual);
  put('3a', line3a);

  const line3b = deannualize(line3a, periodsPerYear, policy);
  put('3b', line3b);

  const line3c = max(subtract(line2h, line3b), zero());
  put('3c', line3c);

  // --- Step 4: extra withholding -------------------------------------------------------
  // Rounded here — this is the tax-level rounding point for Track B.
  const beforeExtra = roundTax(line3c, policy);
  const line4a = w4Line(w4.step4cExtraPerPeriod);
  put('4a', line4a);

  const total = roundTax(add(beforeExtra, line4a), policy);
  put('4b', total);

  return readOk({
    beforeExtra,
    extraPerPeriod: line4a,
    total,
    lines: Object.freeze(lines),
    ruleKeys,
  });
}

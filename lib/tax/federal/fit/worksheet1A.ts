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
import type {
  AmountByFilingStatusDetail,
  ScalarAmountDetail,
  WithholdingScheduleDetail,
} from '../rules/detail-schemas';
import { W4Revision, type FederalW4, type WorksheetLines } from '../types';
import { annualize, deannualize } from './pay-periods';
import { findRow, selectSchedule, validateScheduleRows } from './rate-schedule';

/**
 * IRS Publication 15-T, Worksheet 1A — spec §5.3. Track B, THE PAYCHECK NUMBER.
 *
 * ===========================================================================
 * A LINE-FOR-LINE TRANSCRIPTION, DELIBERATELY NOT SIMPLIFIED.
 *
 * Each worksheet line is a named intermediate that appears in the trace. The
 * algebra could be collapsed, and must not be: the line correspondence is what
 * makes output auditable against the published IRS worksheet, and what makes a
 * future-year change safe to review (§5.3).
 *
 * Annual 1040 brackets are never substituted here (§5.7).
 * ===========================================================================
 *
 * A BLANK W-4 LINE IS ZERO — AND THAT IS NOT AN INVENTED TAX VALUE. An employee
 * leaving Step 4(a) empty has stated "no other income". That is caller-supplied
 * fact, wholly unlike a missing rate, which stays PENDING and blocks.
 */

/** Reads an optional W-4 money line. Absent means the employee left it blank. */
function w4Line(value: string | null): Money {
  return value === null ? zero() : money(value);
}

export interface Worksheet1AResult {
  /** Line 3c — withholding for the period before Step 4(c). */
  readonly beforeExtra: Money;
  /** Line 4a — Step 4(c) extra, kept separate so it is never absorbed silently. */
  readonly extraPerPeriod: Money;
  /** Line 4b — the amount to withhold. */
  readonly total: Money;
  readonly lines: WorksheetLines;
  readonly scheduleType: 'STANDARD' | 'STEP2_CHECKBOX';
  readonly selectedRowOrder: number;
  readonly ruleKeys: readonly string[];
}

/**
 * Runs Worksheet 1A for one pay period.
 *
 * `taxableWages` is the period's federalIncomeTaxWages bucket — already reduced
 * by whichever pre-tax deductions reduce that specific bucket (§19).
 */
export function runWorksheet1A(
  ruleSet: ResolvedFederalRuleSet,
  w4: FederalW4,
  taxableWages: Money,
  periodsPerYear: number,
  policy: FederalRoundingPolicy,
): Read<Worksheet1AResult> {
  const ruleKeys: string[] = [];
  const lines: Record<string, string | null> = {};
  const put = (line: string, value: Money): void => {
    lines[line] = toStorageString(value);
  };

  // ===================== STEP 1 — adjust the payment amount =====================
  const line1a = taxableWages;
  put('1a', line1a);
  lines['1b'] = String(periodsPerYear);

  const line1c = annualize(line1a, periodsPerYear);
  put('1c', line1c);

  let adjustedAnnualWage: Money;

  if (w4.revision === W4Revision.REVISION_2020_PLUS) {
    const line1d = w4Line(w4.step4aOtherIncomeAnnual);
    put('1d', line1d);

    const line1e = add(line1c, line1d);
    put('1e', line1e);

    const line1f = w4Line(w4.step4bDeductionsAnnual);
    put('1f', line1f);

    // Line 1g: zero when the Step 2 box is checked, else the filing-status
    // amount from rule data. This is a Pub. 15-T figure, NOT the annual 1040
    // standard deduction.
    let line1g: Money;
    if (w4.step2MultipleJobsChecked) {
      line1g = zero();
    } else {
      const adjustmentRule = readDetail(ruleSet, FederalRuleKey.FIT_STEP2_UNCHECKED_ADJUSTMENT);
      if (!adjustmentRule.ok) {
        return readFail(adjustmentRule.problem);
      }
      ruleKeys.push(FederalRuleKey.FIT_STEP2_UNCHECKED_ADJUSTMENT);
      const adjustmentDetail = adjustmentRule.value.detail as AmountByFilingStatusDetail;
      const amount = requireForFilingStatus(
        adjustmentDetail.amounts,
        w4.filingStatus,
        FederalRuleKey.FIT_STEP2_UNCHECKED_ADJUSTMENT,
        'amounts',
      );
      if (!amount.ok) {
        return readFail(amount.problem);
      }
      line1g = amount.value;
    }
    put('1g', line1g);

    const line1h = add(line1f, line1g);
    put('1h', line1h);

    // FIT-INV-1: floors at zero.
    const line1i = max(subtract(line1e, line1h), zero());
    put('1i', line1i);
    adjustedAnnualWage = line1i;
  } else {
    // ---- 2019-or-earlier Form W-4: lines 1j-1l --------------------------------
    // A historical form is NEVER reinterpreted as a current one (§7.2).
    const allowanceRule = readDetail(ruleSet, FederalRuleKey.FIT_ALLOWANCE_VALUE);
    if (!allowanceRule.ok) {
      return readFail(allowanceRule.problem);
    }
    ruleKeys.push(FederalRuleKey.FIT_ALLOWANCE_VALUE);
    const allowanceDetail = allowanceRule.value.detail as ScalarAmountDetail;

    if (w4.pre2020Allowances === null) {
      return readFail(
        unavailable(
          FederalReason.INPUT_INVALID,
          'A 2019-or-earlier Form W-4 requires the number of allowances claimed; it is not assumed',
          FederalRuleKey.FIT_ALLOWANCE_VALUE,
          'pre2020Allowances',
        ),
      );
    }

    const perAllowance = requireComponent(
      allowanceDetail.amount,
      FederalRuleKey.FIT_ALLOWANCE_VALUE,
      'amount',
    );
    if (!perAllowance.ok) {
      return readFail(perAllowance.problem);
    }

    lines['1j'] = String(w4.pre2020Allowances);
    const line1k = multiply(money(String(w4.pre2020Allowances)), perAllowance.value);
    put('1k', line1k);

    // FIT-INV-1: floors at zero.
    const line1l = max(subtract(line1c, line1k), zero());
    put('1l', line1l);
    adjustedAnnualWage = line1l;
  }

  // ===================== STEP 2 — tentative withholding =========================
  const scheduleKey = w4.step2MultipleJobsChecked
    ? FederalRuleKey.FIT_RATE_SCHEDULE_STEP2
    : FederalRuleKey.FIT_RATE_SCHEDULE_STANDARD;

  const scheduleRule = readDetail(ruleSet, scheduleKey);
  if (!scheduleRule.ok) {
    return readFail(scheduleRule.problem);
  }
  ruleKeys.push(scheduleKey);
  const scheduleDetail = scheduleRule.value.detail as WithholdingScheduleDetail;

  const schedule = selectSchedule(scheduleDetail, w4.filingStatus, scheduleKey);
  if (!schedule.ok) {
    return readFail(schedule.problem);
  }

  // FIT-INV-5 / FIT-INV-6, re-asserted at resolution rather than trusted.
  const structure = validateScheduleRows(schedule.value.rows, scheduleKey, w4.filingStatus);
  if (!structure.ok) {
    return readFail(structure.problem);
  }

  // FIT-INV-4 / FIT-INV-7: exactly one row, never interpolated.
  const match = findRow(schedule.value.rows, adjustedAnnualWage, scheduleKey);
  if (!match.ok) {
    return readFail(match.problem);
  }

  const line2a = adjustedAnnualWage;
  put('2a', line2a);
  put('2b', match.value.atLeast);
  put('2c', match.value.baseAmount);
  lines['2d'] = toStorageString(match.value.rate);

  const line2e = max(subtract(line2a, match.value.atLeast), zero());
  put('2e', line2e);

  const line2f = multiply(line2e, match.value.rate);
  put('2f', line2f);

  const line2g = add(match.value.baseAmount, line2f);
  put('2g', line2g);

  const line2h = deannualize(line2g, periodsPerYear, policy);
  put('2h', line2h);

  // ===================== STEP 3 — tax credits ===================================
  // Step 3 is forced to zero for a 2019-or-earlier form (§10.1).
  const line3a =
    w4.revision === W4Revision.REVISION_2020_PLUS ? w4Line(w4.step3CreditsAnnual) : zero();
  put('3a', line3a);

  const line3b = deannualize(line3a, periodsPerYear, policy);
  put('3b', line3b);

  // FIT-INV-2: credits can zero withholding, never make it negative.
  const line3c = max(subtract(line2h, line3b), zero());
  put('3c', line3c);

  // ===================== STEP 4 — final amount ==================================
  // Tax-level rounding happens here, once (§22).
  const beforeExtra = roundTax(line3c, policy);

  // Step 4(c) is PER PAY PERIOD and must not be divided by periods (§11.2).
  const line4a = w4Line(w4.step4cExtraPerPeriod);
  put('4a', line4a);

  // FIT-INV-3: 4(c) only ever increases withholding.
  const total = roundTax(add(beforeExtra, line4a), policy);
  put('4b', total);

  return readOk({
    beforeExtra,
    extraPerPeriod: line4a,
    total,
    lines: Object.freeze(lines),
    scheduleType: scheduleDetail.scheduleType,
    selectedRowOrder: match.value.row.rowOrder,
    ruleKeys,
  });
}

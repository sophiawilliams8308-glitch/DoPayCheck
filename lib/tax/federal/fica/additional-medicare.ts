import { type Money, add, max, multiply, subtract, zero } from '@/lib/core/money';

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
import type { RateDetail, ThresholdDetail } from '../rules/detail-schemas';

/**
 * Additional Medicare Tax — spec §15. Track C, EMPLOYEE ONLY.
 *
 * ===========================================================================
 * THREE RULES THIS MODULE EXISTS TO ENFORCE (§15.1).
 *
 * 1. EMPLOYEE-SIDE ONLY. No employer match exists, so no employer field exists
 *    here — not even one that happens to be zero.
 *
 * 2. THE EMPLOYER'S WITHHOLDING THRESHOLD IS A FIXED WAGE AMOUNT, applied per
 *    employer, independent of filing status and of a spouse's wages.
 *
 * 3. THEREFORE THIS FUNCTION DOES NOT TAKE `filingStatus` AT ALL. The
 *    employee's actual liability IS filing-status dependent, but that is
 *    reconciled on Form 8959 with the individual return — it is not a payroll
 *    calculation, and treating it as one under-withholds for married employees.
 *    The absence of the parameter is the enforcement; a test asserts the
 *    invariance.
 * ===========================================================================
 *
 * PENDING VERIFICATION V-02 — whether the comparison is strict or inclusive at
 * exactly the threshold. The branch-free form below is the spec's required
 * implementation (§15.3); the residual ambiguity is DISCLOSED rather than
 * guessed, and it can only bite at an exact-threshold wage.
 */

export interface AdditionalMedicareComputation {
  readonly priorYtd: Money;
  readonly newYtd: Money;
  readonly threshold: Money;
  readonly taxableThisPeriod: Money;
  readonly employee: Money;
  /** `null` while V-02 is unresolved — surfaced, never silently chosen. */
  readonly thresholdInclusive: boolean | null;
  readonly ruleKeys: readonly string[];
}

/**
 * Wages above the threshold falling in THIS period — spec §15.3, required form.
 *
 * Branch-free by design: it handles the crossing period correctly without an
 * `if`, which is where a hand-rolled version usually goes wrong.
 */
export function applyThresholdFloor(
  periodWages: Money,
  ytdWages: Money,
  threshold: Money,
): { taxable: Money; newYtd: Money } {
  const newYtd = add(ytdWages, periodWages);
  const amountOver = max(subtract(newYtd, threshold), zero());
  const alreadyOver = max(subtract(ytdWages, threshold), zero());
  // >= 0 by construction: alreadyOver can never exceed amountOver.
  return { taxable: subtract(amountOver, alreadyOver), newYtd };
}

export function calculateAdditionalMedicare(
  ruleSet: ResolvedFederalRuleSet,
  periodWages: Money,
  ytdWages: Money,
  policy: FederalRoundingPolicy,
): Read<AdditionalMedicareComputation> {
  const rateRule = readDetail(ruleSet, FederalRuleKey.ADDL_MEDICARE_EMPLOYEE_RATE);
  if (!rateRule.ok) {
    return readFail(rateRule.problem);
  }
  const rateDetail = rateRule.value.detail as RateDetail;
  const rate = readRate(
    rateDetail.rate,
    rateDetail.unit,
    FederalRuleKey.ADDL_MEDICARE_EMPLOYEE_RATE,
  );
  if (!rate.ok) {
    return readFail(rate.problem);
  }

  const thresholdRule = readDetail(ruleSet, FederalRuleKey.ADDL_MEDICARE_WITHHOLDING_THRESHOLD);
  if (!thresholdRule.ok) {
    return readFail(thresholdRule.problem);
  }
  const thresholdDetail = thresholdRule.value.detail as ThresholdDetail;
  const threshold = requireComponent(
    thresholdDetail.amount,
    FederalRuleKey.ADDL_MEDICARE_WITHHOLDING_THRESHOLD,
    'amount',
  );
  if (!threshold.ok) {
    return readFail(threshold.problem);
  }

  const { taxable, newYtd } = applyThresholdFloor(periodWages, ytdWages, threshold.value);

  return readOk({
    priorYtd: ytdWages,
    newYtd,
    threshold: threshold.value,
    taxableThisPeriod: taxable,
    employee: roundTax(multiply(taxable, rate.value), policy),
    thresholdInclusive: thresholdDetail.inclusive,
    ruleKeys: [
      FederalRuleKey.ADDL_MEDICARE_EMPLOYEE_RATE,
      FederalRuleKey.ADDL_MEDICARE_WITHHOLDING_THRESHOLD,
    ],
  });
}

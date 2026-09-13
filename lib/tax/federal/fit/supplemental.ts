import { type Money, add, compare, max, min, multiply, subtract, zero } from '@/lib/core/money';

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
import type { RateDetail, ThresholdDetail } from '../rules/detail-schemas';

/**
 * Supplemental wages — spec §5.6 (Pub. 15 section 7, not Worksheet 1A).
 *
 * ===========================================================================
 * SUPPLEMENTAL RULES NEVER TOUCH REGULAR WAGES, AND VICE VERSA.
 *
 * Applying a flat supplemental rate to salary, or the regular worksheet to a
 * bonus, both misstate withholding. The paths are separate and never call into
 * one another.
 * ===========================================================================
 *
 * THE METHOD IS AN EXPLICIT DECISION, NEVER INFERRED (§5.6 rule 1). It is
 * recorded in the trace.
 *
 * OPTIONAL FLAT IS CONDITIONAL, NOT ELECTIVE-BY-DEFAULT (§5.6 rule 2). It may
 * be used only where income tax was withheld from the employee's regular wages
 * in the current or preceding year and the payment is identified separately.
 * The engine models that as a required boolean and refuses the method when it
 * is false — this is what most consumer calculators get wrong.
 *
 * MANDATORY FLAT OVERRIDES EVERYTHING once cumulative YTD supplemental wages
 * cross the statutory threshold — including for an employee who claims
 * exemption from withholding (§5.5).
 */

export const SupplementalMethod = {
  AGGREGATE: 'AGGREGATE',
  OPTIONAL_FLAT: 'OPTIONAL_FLAT',
  MANDATORY_FLAT: 'MANDATORY_FLAT',
} as const;

export type SupplementalMethod = (typeof SupplementalMethod)[keyof typeof SupplementalMethod];

export interface SupplementalInput {
  /** This period's supplemental wages. */
  readonly wages: Money;
  /** Cumulative YTD supplemental wages EXCLUDING this period (§5.6 rule 3). */
  readonly ytdWages: Money;
  /** The employer's elected method. Explicit — never inferred (§5.6 rule 1). */
  readonly requestedMethod: SupplementalMethod;
  /** §5.6 rule 2 eligibility condition for the optional flat method. */
  readonly federalIncomeTaxWithheldFromRegularWagesCurrentOrPriorYear: boolean;
  /**
   * AGGREGATE only: withholding on (regular + supplemental) minus withholding
   * on regular alone. The caller runs Worksheet 1A twice and supplies the
   * difference, so this module never depends on the worksheet.
   */
  readonly aggregateIncrement: Money | null;
}

export interface SupplementalResult {
  readonly methodApplied: SupplementalMethod;
  readonly withholding: Money;
  /** Portion taxed at the mandatory rate when the threshold is crossed. */
  readonly mandatoryPortion: Money;
  /** Portion handled by the elected method below the threshold. */
  readonly electedPortion: Money;
  readonly thresholdCrossed: boolean;
  readonly ruleKeys: readonly string[];
}

export function calculateSupplemental(
  ruleSet: ResolvedFederalRuleSet,
  input: SupplementalInput,
  policy: FederalRoundingPolicy,
): Read<SupplementalResult> {
  const thresholdRule = readDetail(ruleSet, FederalRuleKey.SUPP_MANDATORY_THRESHOLD);
  if (!thresholdRule.ok) {
    return readFail(thresholdRule.problem);
  }
  const thresholdDetail = thresholdRule.value.detail as ThresholdDetail;
  const threshold = requireComponent(
    thresholdDetail.amount,
    FederalRuleKey.SUPP_MANDATORY_THRESHOLD,
    'amount',
  );
  if (!threshold.ok) {
    return readFail(threshold.problem);
  }

  const ruleKeys: string[] = [FederalRuleKey.SUPP_MANDATORY_THRESHOLD];

  // Split the payment at the threshold (§5.6 rule 4). The portion at or below
  // uses the elected method; the excess is compulsory at the mandatory rate.
  const cumulative = add(input.ytdWages, input.wages);
  const excess = max(subtract(cumulative, threshold.value), zero());
  const mandatoryPortion = min(excess, input.wages);
  const electedPortion = subtract(input.wages, mandatoryPortion);
  const thresholdCrossed = compare(mandatoryPortion, zero()) > 0;

  let mandatoryTax = zero();
  if (thresholdCrossed) {
    const rateRule = readDetail(ruleSet, FederalRuleKey.SUPP_MANDATORY_FLAT_RATE);
    if (!rateRule.ok) {
      return readFail(rateRule.problem);
    }
    ruleKeys.push(FederalRuleKey.SUPP_MANDATORY_FLAT_RATE);
    const rateDetail = rateRule.value.detail as RateDetail;
    const rate = readRate(
      rateDetail.rate,
      rateDetail.unit,
      FederalRuleKey.SUPP_MANDATORY_FLAT_RATE,
    );
    if (!rate.ok) {
      return readFail(rate.problem);
    }
    mandatoryTax = multiply(mandatoryPortion, rate.value);
  }

  // The elected method applies only to what is left below the threshold.
  let electedTax = zero();
  let methodApplied: SupplementalMethod = SupplementalMethod.MANDATORY_FLAT;

  if (compare(electedPortion, zero()) > 0) {
    if (input.requestedMethod === SupplementalMethod.OPTIONAL_FLAT) {
      if (!input.federalIncomeTaxWithheldFromRegularWagesCurrentOrPriorYear) {
        return readFail(
          unavailable(
            FederalReason.SCENARIO_UNSUPPORTED,
            'The optional flat method requires that income tax was withheld from the employee’s ' +
              'regular wages in the current or preceding year. That condition is not met, so the ' +
              'method is refused rather than applied.',
            FederalRuleKey.SUPP_OPTIONAL_FLAT_RATE,
            'eligibility',
          ),
        );
      }
      const rateRule = readDetail(ruleSet, FederalRuleKey.SUPP_OPTIONAL_FLAT_RATE);
      if (!rateRule.ok) {
        return readFail(rateRule.problem);
      }
      ruleKeys.push(FederalRuleKey.SUPP_OPTIONAL_FLAT_RATE);
      const rateDetail = rateRule.value.detail as RateDetail;
      const rate = readRate(
        rateDetail.rate,
        rateDetail.unit,
        FederalRuleKey.SUPP_OPTIONAL_FLAT_RATE,
      );
      if (!rate.ok) {
        return readFail(rate.problem);
      }
      electedTax = multiply(electedPortion, rate.value);
      methodApplied = SupplementalMethod.OPTIONAL_FLAT;
    } else {
      // AGGREGATE — always permitted, no eligibility conditions, the default.
      if (input.aggregateIncrement === null) {
        return readFail(
          unavailable(
            FederalReason.INPUT_INVALID,
            'The aggregate method needs the withholding increment from running Worksheet 1A on ' +
              'combined wages; it was not supplied',
          ),
        );
      }
      // Scale the increment to the portion below the threshold, so a split
      // payment does not charge the aggregate increment twice.
      electedTax = input.wages.isZero()
        ? zero()
        : multiply(input.aggregateIncrement, electedPortion.dividedBy(input.wages));
      methodApplied = SupplementalMethod.AGGREGATE;
    }
  }

  return readOk({
    methodApplied:
      thresholdCrossed && electedPortion.isZero()
        ? SupplementalMethod.MANDATORY_FLAT
        : methodApplied,
    withholding: roundTax(add(mandatoryTax, electedTax), policy),
    mandatoryPortion,
    electedPortion,
    thresholdCrossed,
    ruleKeys,
  });
}

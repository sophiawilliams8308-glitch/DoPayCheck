import { type Money, add, compare, multiply, subtract } from '@/lib/core/money';

import { FederalReason, unavailable } from '../errors/federal-errors';
import { FederalRuleKey } from '../rule-keys';
import { roundTax, type FederalRoundingPolicy } from '../rounding/federal-rounding';
import { readDetail, requireComponent, type Read, readFail, readOk } from '../rules/read-detail';
import type { ResolvedFederalRuleSet } from '../rules/resolved-rule-set';
import type { SupplementalDetail } from '../rules/detail-schemas';
import type { FederalFeatureFlags } from '../flags';

/**
 * Supplemental wages (Phase 4, Track B).
 *
 * ===========================================================================
 * SUPPLEMENTAL RULES NEVER TOUCH REGULAR WAGES.
 *
 * Bonuses and commissions may be withheld on differently from salary. Applying a supplemental
 * flat rate to regular wages — or the regular worksheet to a bonus — both misstate
 * withholding, so the two paths are structurally separate and never call into each other.
 * ===========================================================================
 *
 * Three methods:
 *   AGGREGATE       — combine with regular wages and run Worksheet 1A once. The default,
 *                     because it needs no rate the engine has not verified.
 *   OPTIONAL_FLAT   — a flat rate the employer MAY elect. Gated behind a feature flag AND an
 *                     eligibility fact stated by the source: an unverified election right is
 *                     not a right.
 *   MANDATORY_FLAT  — a higher flat rate required above a statutory threshold. Represented
 *                     separately because it is compulsory, not elective.
 */

export const SupplementalMethod = {
  AGGREGATE: 'AGGREGATE',
  OPTIONAL_FLAT: 'OPTIONAL_FLAT',
  MANDATORY_FLAT: 'MANDATORY_FLAT',
} as const;

export type SupplementalMethod = (typeof SupplementalMethod)[keyof typeof SupplementalMethod];

export interface SupplementalResult {
  readonly method: SupplementalMethod;
  readonly withholding: Money;
  /** Portion taxed at the mandatory rate, when the threshold is crossed. */
  readonly mandatoryPortion: Money | null;
  readonly ruleKey: string;
}

/**
 * Withholding on supplemental wages using an explicitly requested method.
 *
 * AGGREGATE is not computed here: it has no separate arithmetic, because the wages join the
 * regular Worksheet 1A run. The caller combines them.
 */
export function calculateSupplemental(
  ruleSet: ResolvedFederalRuleSet,
  supplementalWages: Money,
  ytdSupplementalWages: Money,
  requested: SupplementalMethod,
  flags: FederalFeatureFlags,
  policy: FederalRoundingPolicy,
): Read<SupplementalResult> {
  const found = readDetail(ruleSet, FederalRuleKey.FIT_SUPPLEMENTAL);
  if (!found.ok) {
    return readFail(found.problem);
  }
  const detail = found.value.detail as SupplementalDetail;
  const ruleKey = found.value.ruleKey;

  // The mandatory rate applies above a statutory threshold regardless of the method the
  // employer prefers, so the threshold is checked first.
  const thresholdStated = detail.mandatoryFlatThreshold !== null;
  const cumulative = add(ytdSupplementalWages, supplementalWages);

  if (thresholdStated) {
    const threshold = requireComponent(
      detail.mandatoryFlatThreshold,
      ruleKey,
      'mandatoryFlatThreshold',
    );
    if (!threshold.ok) {
      return readFail(threshold.problem);
    }

    if (compare(cumulative, threshold.value) > 0) {
      const rate = requireComponent(detail.mandatoryFlatRate, ruleKey, 'mandatoryFlatRate');
      if (!rate.ok) {
        return readFail(rate.problem);
      }
      const overThreshold = subtract(cumulative, threshold.value);
      const portion =
        compare(overThreshold, supplementalWages) > 0 ? supplementalWages : overThreshold;
      return readOk({
        method: SupplementalMethod.MANDATORY_FLAT,
        withholding: roundTax(multiply(portion, rate.value), policy),
        mandatoryPortion: portion,
        ruleKey,
      });
    }
  }

  if (requested === SupplementalMethod.OPTIONAL_FLAT) {
    if (!flags.FEDERAL_SUPPLEMENTAL_OPTIONAL_FLAT) {
      return readFail(
        unavailable(
          FederalReason.FEATURE_DISABLED,
          'The optional flat supplemental method is disabled: its eligibility conditions and ' +
            'rate are not yet verified against an official source',
          ruleKey,
          'optionalFlatRate',
        ),
      );
    }
    if (detail.optionalFlatPermitted !== true) {
      return readFail(
        unavailable(
          FederalReason.PENDING_VERIFICATION,
          'The official source does not confirm that the optional flat method is permitted',
          ruleKey,
          'optionalFlatPermitted',
        ),
      );
    }
    const rate = requireComponent(detail.optionalFlatRate, ruleKey, 'optionalFlatRate');
    if (!rate.ok) {
      return readFail(rate.problem);
    }
    return readOk({
      method: SupplementalMethod.OPTIONAL_FLAT,
      withholding: roundTax(multiply(supplementalWages, rate.value), policy),
      mandatoryPortion: null,
      ruleKey,
    });
  }

  return readFail(
    unavailable(
      FederalReason.SCENARIO_UNSUPPORTED,
      'AGGREGATE supplemental wages are withheld through the regular Worksheet 1A run, not ' +
        'through a separate supplemental calculation',
      ruleKey,
    ),
  );
}

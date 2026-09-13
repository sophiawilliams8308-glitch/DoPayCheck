import { type Money, add, max, min, multiply, subtract, zero } from '@/lib/core/money';

import { FederalReason, unavailable } from '../errors/federal-errors';
import { FederalRuleKey } from '../rule-keys';
import {
  FEDERAL_ROUNDING_V1,
  roundTax,
  type FederalRoundingPolicy,
} from '../rounding/federal-rounding';
import {
  readDetail,
  requireComponent,
  requireForFilingStatus,
  type Read,
  readFail,
  readOk,
} from '../rules/read-detail';
import type { ResolvedFederalRuleSet } from '../rules/resolved-rule-set';
import type { AdditionalMedicareDetail } from '../rules/detail-schemas';

/**
 * Additional Medicare Tax (Phase 4, Track C — EMPLOYEE ONLY).
 *
 * ===========================================================================
 * NO EMPLOYER SHARE. EVER.
 *
 * Unlike every other FICA component, Additional Medicare has no matching employer liability.
 * A symmetric implementation would silently invent an employer cost, so this module exposes
 * no employer figure at all rather than one that happens to be zero.
 * ===========================================================================
 *
 * The tax applies only to wages above a filing-status threshold, measured on YEAR-TO-DATE
 * wages plus this period (D-SS-1: incoming YTD excludes the current period).
 *
 * PENDING_VERIFICATION — threshold comparison semantics. Whether the threshold is inclusive
 * (`>=`) or exclusive (`>`) is an authoritative detail the engine will not guess: when
 * `thresholdInclusive` is null it reports PENDING_VERIFICATION rather than picking one. The
 * difference only bites at exact-threshold wages, which is precisely where a silent guess
 * would be hardest to notice.
 */

export interface AdditionalMedicareComputation {
  readonly taxableThisPeriod: Money;
  readonly thresholdRemaining: Money;
  readonly employee: Money;
  readonly ruleKey: string;
}

/**
 * Wages above the threshold that fall in THIS period.
 *
 * Mirrors the Social Security wage-base shape, inverted: there the base is a ceiling, here it
 * is a floor already partly consumed by the year to date.
 */
export function additionalMedicareTaxableWages(
  periodWages: Money,
  ytdWages: Money,
  threshold: Money,
): { taxable: Money; remaining: Money } {
  // Room still below the threshold before this cheque.
  const remaining = max(subtract(threshold, ytdWages), zero());
  const cumulative = add(ytdWages, periodWages);
  const over = max(subtract(cumulative, threshold), zero());
  return { taxable: min(over, periodWages), remaining };
}

export function calculateAdditionalMedicare(
  ruleSet: ResolvedFederalRuleSet,
  periodWages: Money,
  ytdWages: Money,
  filingStatus: string,
  policy: FederalRoundingPolicy = FEDERAL_ROUNDING_V1,
): Read<AdditionalMedicareComputation> {
  const found = readDetail(ruleSet, FederalRuleKey.FICA_ADDITIONAL_MEDICARE);
  if (!found.ok) {
    return readFail(found.problem);
  }

  const detail = found.value.detail as AdditionalMedicareDetail;
  const ruleKey = found.value.ruleKey;

  if (detail.thresholdInclusive === null) {
    return readFail(
      unavailable(
        FederalReason.PENDING_VERIFICATION,
        'Additional Medicare threshold comparison semantics (inclusive vs exclusive) are not ' +
          'yet verified against an official source; no behaviour is applied',
        ruleKey,
        'thresholdInclusive',
      ),
    );
  }

  const rate = requireComponent(detail.employeeRate, ruleKey, 'employeeRate');
  if (!rate.ok) {
    return readFail(rate.problem);
  }

  const threshold = requireForFilingStatus(detail.thresholds, filingStatus, ruleKey, 'thresholds');
  if (!threshold.ok) {
    return readFail(threshold.problem);
  }

  const { taxable, remaining } = additionalMedicareTaxableWages(
    periodWages,
    ytdWages,
    threshold.value,
  );

  return readOk({
    taxableThisPeriod: taxable,
    thresholdRemaining: remaining,
    employee: roundTax(multiply(taxable, rate.value), policy),
    ruleKey,
  });
}

import { type Money, RoundingMode, divide, money, multiply } from '@/lib/core/money';

import { FederalReason, unavailable } from '../errors/federal-errors';
import { FederalRuleKey } from '../rule-keys';
import { readDetail, type Read, readFail, readOk } from '../rules/read-detail';
import type { ResolvedFederalRuleSet } from '../rules/resolved-rule-set';
import type { CountByPayPeriodDetail } from '../rules/detail-schemas';
import type { FederalRoundingPolicy } from '../rounding/federal-rounding';

/**
 * Pay-period conversion — spec §20, §21.
 *
 * ===========================================================================
 * TABLE 3 IS RULE DATA (§20.1).
 *
 * Worksheet 1A's periods-per-year factor is published by the IRS in Table 3 and
 * used at lines 1b, 2h and 3b. It is resolved from
 * `FED.FIT.PAY_PERIODS_PER_YEAR`, not read from a constant, so a future change
 * — and the ANNUAL frequency question (V-05, D-FREQ-1) — is a data matter.
 *
 * A frequency whose count is `null` is UNSUPPORTED: no official factor is
 * published, and inventing one would silently misstate every annualization.
 * ===========================================================================
 */

/** Resolves the periods-per-year factor for a frequency from Table 3. */
export function resolvePayPeriodsPerYear(
  ruleSet: ResolvedFederalRuleSet,
  payFrequency: string,
): Read<number> {
  const found = readDetail(ruleSet, FederalRuleKey.FIT_PAY_PERIODS_PER_YEAR);
  if (!found.ok) {
    return readFail(found.problem);
  }
  const detail = found.value.detail as CountByPayPeriodDetail;
  const row = detail.counts.find((candidate) => candidate.payFrequency === payFrequency);

  if (row === undefined) {
    return readFail(
      unavailable(
        FederalReason.COMPONENT_NOT_STATED,
        `Table 3 states no periods-per-year factor for ${payFrequency}`,
        FederalRuleKey.FIT_PAY_PERIODS_PER_YEAR,
        `counts[${payFrequency}]`,
      ),
    );
  }

  if (row.count === null) {
    return readFail(
      unavailable(
        FederalReason.SCENARIO_UNSUPPORTED,
        `No official periods-per-year factor is published for ${payFrequency}, so annualization ` +
          'is not supported for it. No factor is assumed.',
        FederalRuleKey.FIT_PAY_PERIODS_PER_YEAR,
        `counts[${payFrequency}]`,
      ),
    );
  }

  return readOk(row.count);
}

/** Annualizes a per-period amount: amount x periods (§21.1). */
export function annualize(perPeriod: Money, periodsPerYear: number): Money {
  return multiply(perPeriod, money(String(periodsPerYear)));
}

/**
 * De-annualizes an annual amount back to one pay period (§21.2).
 *
 * Carried at the policy's intermediate precision — the single tax-level
 * rounding happens later, so a repeating decimal here cannot compound.
 */
export function deannualize(
  annual: Money,
  periodsPerYear: number,
  policy: FederalRoundingPolicy,
): Money {
  return divide(
    annual,
    money(String(periodsPerYear)),
    policy.intermediateScale,
    RoundingMode.HALF_UP,
  );
}

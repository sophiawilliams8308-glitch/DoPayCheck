import { type Money, RoundingMode, divide, money, multiply } from '@/lib/core/money';

import type { FederalRoundingPolicy } from '../rounding/federal-rounding';

/**
 * Annualization and de-annualization (Phase 4, Worksheet 1A steps 1b and 2).
 *
 * Pub. 15-T's percentage method works on an ANNUALIZED wage, applies an annual rate schedule,
 * then divides the result back down to the pay period. Both conversions must use the same
 * periods-per-year figure, or the withholding drifts.
 *
 * Periods per year is supplied by the caller — Phase 3 owns that policy decision (including
 * its explicit refusal to assume a figure for DAILY pay).
 */

/** Annualizes a per-period amount: amount x periods. */
export function annualize(perPeriod: Money, periodsPerYear: number): Money {
  return multiply(perPeriod, money(String(periodsPerYear)));
}

/**
 * De-annualizes an annual amount back to one pay period.
 *
 * Carried at intermediate precision; the single tax-level rounding happens later.
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

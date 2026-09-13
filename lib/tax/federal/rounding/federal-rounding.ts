import { type Money, RoundingMode, round } from '@/lib/core/money';

/**
 * Federal rounding policy (Phase 4), versioned.
 *
 * ===========================================================================
 * TAX-LEVEL ROUNDING.
 *
 * Intermediates are carried at high precision and rounded ONCE, when a tax amount is
 * finalised. Rounding at every step compounds error; rounding only at the end of the whole
 * calculation loses the per-tax figures an employee's payslip must show.
 * ===========================================================================
 *
 * The policy is VERSIONED because rounding is part of calculation methodology: a historical
 * snapshot must be reproducible under the policy that produced it, not under a later one.
 */

export interface FederalRoundingPolicy {
  readonly version: string;
  /** Decimal places for a finalised tax amount. */
  readonly currencyScale: number;
  readonly currencyMode: RoundingMode;
  /** Precision carried through worksheet intermediates before the single tax-level rounding. */
  readonly intermediateScale: number;
  readonly intermediateMode: RoundingMode;
}

/** Cents precision, HALF_UP, applied at tax level. */
export const FEDERAL_ROUNDING_V1: FederalRoundingPolicy = {
  version: 'federal-rounding-v1',
  currencyScale: 2,
  currencyMode: RoundingMode.HALF_UP,
  intermediateScale: 12,
  intermediateMode: RoundingMode.HALF_UP,
};

/** Rounds a finalised tax amount. Call once per tax, never per intermediate. */
export function roundTax(value: Money, policy: FederalRoundingPolicy): Money {
  return round(value, policy.currencyScale, policy.currencyMode);
}

/** Rounds a worksheet intermediate to the policy's carrying precision. */
export function roundIntermediate(value: Money, policy: FederalRoundingPolicy): Money {
  return round(value, policy.intermediateScale, policy.intermediateMode);
}

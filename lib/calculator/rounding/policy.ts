import { type Money, RoundingMode, round } from '@/lib/core/money';

/**
 * Rounding policy (spec §4).
 *
 * ===========================================================================
 * PENDING DECISION — per-tax rounding methodology.
 *
 * The correct rounding direction and precision differ by tax, jurisdiction and official
 * method (IRS wage-bracket vs percentage method, state-specific rules). No such methodology
 * has been sourced, so the engine does NOT choose one: the policy is injected, and any
 * tax-specific rule must arrive from official documentation in Phases 4–6.
 *
 * What is safe to decide now is the ARITHMETIC contract — that rounding is explicit, applied
 * at declared boundaries, and never implicit.
 * ===========================================================================
 */

export interface RoundingPolicy {
  /** Decimal places for presented monetary amounts. */
  readonly currencyScale: number;
  readonly currencyMode: RoundingMode;
  /** Decimal places retained through intermediate steps, before a final rounding. */
  readonly intermediateScale: number;
  readonly intermediateMode: RoundingMode;
}

/**
 * Generic currency arithmetic: two decimal places, half-up, with 12 digits carried through
 * intermediate steps.
 *
 * THIS IS NOT A TAX RULE. It is the ordinary arithmetic convention for presenting money, used
 * where no official methodology has been sourced. It must not be mistaken for, or relied on
 * as, an official rounding rule — see PENDING DECISION above.
 */
export const GENERIC_CURRENCY_POLICY: RoundingPolicy = {
  currencyScale: 2,
  currencyMode: RoundingMode.HALF_UP,
  intermediateScale: 12,
  intermediateMode: RoundingMode.HALF_UP,
};

/** Rounds to the policy's presented-currency precision. */
export function roundCurrency(value: Money, policy: RoundingPolicy): Money {
  return round(value, policy.currencyScale, policy.currencyMode);
}

/** Rounds to the policy's intermediate precision, used between pipeline stages. */
export function roundIntermediate(value: Money, policy: RoundingPolicy): Money {
  return round(value, policy.intermediateScale, policy.intermediateMode);
}

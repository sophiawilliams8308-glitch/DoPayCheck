import { type Money, money, multiply, sum, zero } from '@/lib/core/money';

import { type RoundingPolicy, roundCurrency } from '../rounding/policy';
import type { DeductionInput } from '../types/input';

/**
 * Deduction calculation (pipeline stages 6 and 12; spec §13).
 *
 * The same engine serves pre-tax and post-tax deductions — they differ only in WHEN they are
 * applied and whether they carry taxability metadata that reduces a wage bucket.
 *
 * Taxability is never inferred here. A deduction states which buckets it reduces, because
 * "pre-tax" is not a single global property: a deduction may reduce federal income tax wages
 * without reducing Social Security wages (spec §13).
 */

export interface DeductionResult {
  readonly id: string;
  readonly label: string;
  readonly amount: Money;
  readonly input: DeductionInput;
}

export interface DeductionTotals {
  readonly items: readonly DeductionResult[];
  readonly total: Money;
}

/**
 * Computes each enabled deduction against `grossPay`, in ordinal order.
 *
 * Percentages are fractions of gross (e.g. "0.05" = 5%). A deduction with `enabled: false` is
 * skipped entirely rather than contributing zero, so it never appears in the breakdown.
 */
export function calculateDeductions(
  deductions: readonly DeductionInput[] | undefined,
  grossPay: Money,
  policy: RoundingPolicy,
): DeductionTotals {
  if (deductions === undefined || deductions.length === 0) {
    return { items: [], total: zero() };
  }

  const enabled = deductions
    .filter((deduction) => deduction.enabled !== false)
    .map((deduction, index) => ({ deduction, index }))
    .sort((a, b) => {
      const ordinalA = a.deduction.ordinal ?? a.index;
      const ordinalB = b.deduction.ordinal ?? b.index;
      return ordinalA === ordinalB ? a.index - b.index : ordinalA - ordinalB;
    });

  const items: DeductionResult[] = enabled.map(({ deduction }) => {
    const amount =
      deduction.basis === 'FIXED_AMOUNT'
        ? money(deduction.amount ?? '0')
        : multiply(grossPay, money(deduction.percent ?? '0'));

    return {
      id: deduction.id,
      label: deduction.label ?? deduction.id,
      amount: roundCurrency(amount, policy),
      input: deduction,
    };
  });

  return { items, total: roundCurrency(sum(items.map((item) => item.amount)), policy) };
}

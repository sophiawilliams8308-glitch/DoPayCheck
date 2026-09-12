import { type Money, max, subtract, sum, zero } from '@/lib/core/money';

import { type RoundingPolicy, roundCurrency } from '../rounding/policy';
import type { DeductionTaxability } from '../types/input';
import type { DeductionResult } from './deductions';

/**
 * Taxable wage buckets (pipeline stage 7; spec §5).
 *
 * ===========================================================================
 * THE RULE THIS STAGE EXISTS TO ENFORCE
 *
 *   Each bucket is computed INDEPENDENTLY. The engine never assumes that one taxable-wage
 *   figure applies to every tax, and never assumes a deduction reduces every bucket.
 *
 * A 401(k) contribution typically reduces federal income tax wages but NOT Social Security or
 * Medicare wages. Collapsing the buckets would silently produce the wrong FICA figure.
 * ===========================================================================
 *
 * Each bucket is derived as: gross wages − deductions flagged for THAT bucket.
 * The per-bucket arithmetic is returned so the trace can show it (spec §17).
 */

export const WAGE_BUCKETS = [
  'federalIncomeTax',
  'socialSecurity',
  'medicare',
  'stateIncomeTax',
  'localIncomeTax',
  'futa',
  'suta',
] as const;

export type WageBucket = (typeof WAGE_BUCKETS)[number];

export interface BucketDerivation {
  readonly bucket: WageBucket;
  readonly grossWages: Money;
  readonly deductionsApplied: readonly { readonly id: string; readonly amount: Money }[];
  readonly totalDeductions: Money;
  readonly taxableWages: Money;
}

export type TaxableWageResult = Readonly<Record<WageBucket, BucketDerivation>>;

function reducesBucket(taxability: DeductionTaxability, bucket: WageBucket): boolean {
  // Absent means "does not reduce" — never inferred as true.
  return taxability[bucket] === true;
}

/**
 * Derives all seven buckets from gross pay and the pre-tax deductions.
 *
 * A bucket is floored at zero: deductions exceeding gross cannot create negative taxable
 * wages. That is an arithmetic floor, not a tax rule.
 */
export function determineTaxableWages(
  grossPay: Money,
  preTaxDeductions: readonly DeductionResult[],
  policy: RoundingPolicy,
): TaxableWageResult {
  const derivations = {} as Record<WageBucket, BucketDerivation>;

  for (const bucket of WAGE_BUCKETS) {
    const applied = preTaxDeductions
      .filter((item) => reducesBucket(item.input.taxability, bucket))
      .map((item) => ({ id: item.id, amount: item.amount }));

    const totalDeductions = sum(applied.map((item) => item.amount));
    const taxableWages = roundCurrency(max(subtract(grossPay, totalDeductions), zero()), policy);

    derivations[bucket] = {
      bucket,
      grossWages: grossPay,
      deductionsApplied: applied,
      totalDeductions: roundCurrency(totalDeductions, policy),
      taxableWages,
    };
  }

  return derivations;
}

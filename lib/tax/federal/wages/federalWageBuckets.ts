import { type Money, add, max, subtract, sum, toStorageString, zero } from '@/lib/core/money';

import type { DeductionTaxability } from '@/lib/calculator/types/input';

import type { FederalPeriodWages, FederalWageBuckets } from '../types';

/**
 * Federal taxable wage buckets (Phase 4).
 *
 * ===========================================================================
 * EACH BUCKET IS DERIVED INDEPENDENTLY.
 *
 * A 401(k) contribution reduces federal income tax wages but NOT Social Security or Medicare
 * wages. One "taxable wages" figure applied to every tax silently produces the wrong FICA.
 * This mirrors the Phase 3 bucket architecture rather than replacing it: Phase 3 owns the
 * seven-bucket model, and Phase 4 reads the four federal ones.
 * ===========================================================================
 *
 * OBBBA QUALIFIED TIPS AND OVERTIME — NO BUCKET REDUCTION.
 *
 * Their relief is delivered through the employee's Step 4(b) deduction on the W-4, which
 * affects INCOME TAX withholding only. They remain fully subject to Social Security and
 * Medicare. Reducing a FICA bucket for them would understate FICA and misstate the employee's
 * earnings record, so this module deliberately offers no such reduction.
 */

/** A pre-tax deduction and the buckets it reduces, as Phase 3 models it. */
export interface FederalDeduction {
  readonly id: string;
  readonly amount: Money;
  readonly taxability: DeductionTaxability;
}

type FederalBucket = 'federalIncomeTax' | 'socialSecurity' | 'medicare' | 'futa';

/** Absent means "does not reduce". Never inferred as true. */
function reduces(taxability: DeductionTaxability, bucket: FederalBucket): boolean {
  return taxability[bucket] === true;
}

function bucketWages(
  grossFor: Money,
  deductions: readonly FederalDeduction[],
  bucket: FederalBucket,
): Money {
  const applied = deductions.filter((item) => reduces(item.taxability, bucket));
  const total = sum(applied.map((item) => item.amount));
  // Arithmetic floor, not a tax rule: deductions above gross cannot make wages negative.
  return max(subtract(grossFor, total), zero());
}

/**
 * Derives the four federal buckets for one pay period.
 *
 * Tips and qualified overtime are added to EVERY federal wage base, including FICA — see the
 * OBBBA note above.
 */
export function deriveFederalWageBuckets(
  wages: FederalPeriodWages,
  deductions: readonly FederalDeduction[],
  toMoney: (value: string) => Money,
): FederalWageBuckets {
  const regular = toMoney(wages.regular);
  const supplemental = toMoney(wages.supplemental);
  const tips = toMoney(wages.tips);
  const qualifiedOvertime = toMoney(wages.qualifiedOvertime);

  const grossFederalWages = add(add(regular, supplemental), add(tips, qualifiedOvertime));

  return {
    federalIncomeTaxWages: toStorageString(
      bucketWages(grossFederalWages, deductions, 'federalIncomeTax'),
    ),
    socialSecurityWages: toStorageString(
      bucketWages(grossFederalWages, deductions, 'socialSecurity'),
    ),
    medicareWages: toStorageString(bucketWages(grossFederalWages, deductions, 'medicare')),
    futaWages: toStorageString(bucketWages(grossFederalWages, deductions, 'futa')),
  };
}

/** Zero buckets, for scenarios with no federal wages at all. */
export function emptyFederalBuckets(): FederalWageBuckets {
  const z = toStorageString(zero());
  return {
    federalIncomeTaxWages: z,
    socialSecurityWages: z,
    medicareWages: z,
    futaWages: z,
  };
}

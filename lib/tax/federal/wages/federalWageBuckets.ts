import { type Money, max, money, subtract, sum, toStorageString, zero } from '@/lib/core/money';

import { FederalReason, type FederalUnavailable, unavailable } from '../errors/federal-errors';
import type { FederalWageBuckets } from '../types';

/**
 * Federal taxable wage buckets — spec §12, §19.
 *
 * ===========================================================================
 * TAXABILITY IS DATA, NOT CODE (§12.4).
 *
 * "Pre-tax" is never a single global property. A traditional 401(k) deferral
 * reduces federal income tax wages but NOT Social Security or Medicare wages;
 * a section 125 health premium reduces all three; treatments differ again for
 * FUTA. Each deduction type therefore carries a versioned, sourced profile, and
 * no deduction-type literal may appear in this file.
 * ===========================================================================
 *
 * THE FLAGS ARE TRI-STATE (§12.2). `NOT_STATED` is never coerced to `FALSE`: a
 * deduction whose profile does not state a bucket the calculation needs makes
 * the federal result INCOMPLETE, naming the deduction and the bucket. Coercing
 * it would silently produce the wrong FICA with no visible symptom.
 *
 * OBBBA QUALIFIED TIPS AND OVERTIME reduce NO bucket (§7.9, §19.5). Their
 * relief reaches payroll solely through the employee's W-4 Step 4(b) amount,
 * which affects income-tax withholding only. They remain fully subject to both
 * shares of Social Security and Medicare.
 */

export const Taxability = {
  TRUE: 'TRUE',
  FALSE: 'FALSE',
  /** The source does not state a treatment. Never the same as FALSE. */
  NOT_STATED: 'NOT_STATED',
} as const;

export type Taxability = (typeof Taxability)[keyof typeof Taxability];

export const FEDERAL_BUCKETS = [
  'federalIncomeTaxWages',
  'socialSecurityWages',
  'medicareWages',
  'futaWages',
] as const;

export type FederalBucket = (typeof FEDERAL_BUCKETS)[number];

/** A versioned, sourced taxability profile for one deduction type (§12.2). */
export interface DeductionTaxabilityProfile {
  readonly deductionTypeKey: string;
  readonly reducesFederalIncomeTaxWages: Taxability;
  readonly reducesSocialSecurityWages: Taxability;
  readonly reducesMedicareWages: Taxability;
  readonly reducesFutaWages: Taxability;
  /** Provenance for the trace and the snapshot. */
  readonly ruleId?: string;
  readonly sourceIds?: readonly string[];
}

/** One pre-tax deduction line from the Phase 3 pipeline. */
export interface FederalDeductionLine {
  readonly id: string;
  readonly deductionTypeKey: string;
  readonly amount: Money;
}

function flagFor(profile: DeductionTaxabilityProfile, bucket: FederalBucket): Taxability {
  switch (bucket) {
    case 'federalIncomeTaxWages':
      return profile.reducesFederalIncomeTaxWages;
    case 'socialSecurityWages':
      return profile.reducesSocialSecurityWages;
    case 'medicareWages':
      return profile.reducesMedicareWages;
    case 'futaWages':
      return profile.reducesFutaWages;
  }
}

export interface BucketDerivation {
  readonly bucket: FederalBucket;
  readonly grossWages: string;
  readonly applied: readonly { readonly id: string; readonly amount: string }[];
  /** `null` when the bucket could not be determined. Never zero as a stand-in. */
  readonly taxableWages: string | null;
}

export interface WageBucketOutcome {
  /** A bucket is `null` exactly when `problemsByBucket` names a reason for it. */
  readonly buckets: FederalWageBuckets;
  readonly derivations: readonly BucketDerivation[];
  /** Non-empty when a needed treatment is NOT_STATED or a type is unknown. */
  readonly problems: readonly FederalUnavailable[];
  /**
   * Why a bucket could not be derived, per bucket.
   *
   * PER BUCKET, not global: an unknown treatment for Medicare wages must not
   * block income-tax withholding, and vice versa. Independence is the whole
   * point of §12 — one unusable profile fails only the taxes that need it.
   */
  readonly problemsByBucket: Readonly<Record<FederalBucket, FederalUnavailable | null>>;
}

/**
 * Derives the four federal buckets, each independently from its own flags.
 *
 * @param grossFederalWages Wages subject to federal tax before pre-tax deductions —
 *                          including tips and qualified overtime in full.
 */
export function deriveFederalWageBuckets(
  grossFederalWages: Money,
  deductions: readonly FederalDeductionLine[],
  profiles: Readonly<Record<string, DeductionTaxabilityProfile>>,
): WageBucketOutcome {
  const problems: FederalUnavailable[] = [];
  const derivations: BucketDerivation[] = [];
  const values: Record<FederalBucket, string | null> = {
    federalIncomeTaxWages: null,
    socialSecurityWages: null,
    medicareWages: null,
    futaWages: null,
  };
  const problemsByBucket: Record<FederalBucket, FederalUnavailable | null> = {
    federalIncomeTaxWages: null,
    socialSecurityWages: null,
    medicareWages: null,
    futaWages: null,
  };

  for (const bucket of FEDERAL_BUCKETS) {
    const applied: { id: string; amount: string }[] = [];
    const amounts: Money[] = [];

    for (const deduction of deductions) {
      const profile = profiles[deduction.deductionTypeKey];

      if (profile === undefined) {
        const problem = unavailable(
          FederalReason.SCENARIO_UNSUPPORTED,
          `No taxability profile for deduction type ${deduction.deductionTypeKey}; its federal ` +
            'treatment is unknown and is not guessed',
          undefined,
          deduction.deductionTypeKey,
        );
        problems.push(problem);
        problemsByBucket[bucket] ??= problem;
        continue;
      }

      const flag = flagFor(profile, bucket);

      if (flag === Taxability.NOT_STATED) {
        const problem = unavailable(
          FederalReason.TAXABILITY_NOT_STATED,
          `The taxability profile for ${deduction.deductionTypeKey} does not state whether it ` +
            `reduces ${bucket}; NOT_STATED is never treated as "does not reduce"`,
          profile.ruleId,
          `${deduction.deductionTypeKey}.${bucket}`,
        );
        problems.push(problem);
        problemsByBucket[bucket] ??= problem;
        continue;
      }

      if (flag === Taxability.TRUE) {
        applied.push({ id: deduction.id, amount: toStorageString(deduction.amount) });
        amounts.push(deduction.amount);
      }
    }

    const total = amounts.length === 0 ? zero() : sum(amounts);
    // Arithmetic floor, not a tax rule: deductions above gross cannot make
    // taxable wages negative.
    const taxable = max(subtract(grossFederalWages, total), zero());
    // A bucket with an unresolved deduction stays null. Publishing the partial
    // figure would be worse than publishing nothing: it looks authoritative.
    values[bucket] = problemsByBucket[bucket] === null ? toStorageString(taxable) : null;

    derivations.push({
      bucket,
      grossWages: toStorageString(grossFederalWages),
      applied,
      taxableWages: values[bucket],
    });
  }

  return {
    buckets: {
      federalIncomeTaxWages: values.federalIncomeTaxWages,
      socialSecurityWages: values.socialSecurityWages,
      medicareWages: values.medicareWages,
      futaWages: values.futaWages,
    },
    derivations,
    problems,
    problemsByBucket,
  };
}

/** Zero buckets, for scenarios with no federal wages at all. */
export function emptyFederalBuckets(): FederalWageBuckets {
  const z = toStorageString(money('0'));
  return {
    federalIncomeTaxWages: z,
    socialSecurityWages: z,
    medicareWages: z,
    futaWages: z,
  };
}

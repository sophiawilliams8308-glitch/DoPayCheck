import { PayFrequency } from '@/lib/db/generated/client';

/**
 * Pay-frequency conversion (spec §11).
 *
 * These counts are unambiguous CALENDAR facts, not tax values: 52 weeks, 26 biweekly periods,
 * 24 semimonthly periods, 12 months, 4 quarters, 1 year.
 *
 * ===========================================================================
 * PENDING DECISION — DAILY.
 *
 * The number of PAID days in a year is a payroll-policy choice (260 working days, 261, 365
 * calendar days …) with no single correct answer. The engine therefore refuses to assume one:
 * a DAILY calculation must supply `periodsPerYear` explicitly, and without it annualization
 * is reported as unavailable rather than guessed.
 * ===========================================================================
 */

const FIXED_PERIODS_PER_YEAR: Partial<Record<PayFrequency, number>> = {
  [PayFrequency.WEEKLY]: 52,
  [PayFrequency.BIWEEKLY]: 26,
  [PayFrequency.SEMIMONTHLY]: 24,
  [PayFrequency.MONTHLY]: 12,
  [PayFrequency.QUARTERLY]: 4,
  [PayFrequency.ANNUAL]: 1,
};

export type PeriodsPerYearResult =
  | { readonly known: true; readonly periods: number }
  | { readonly known: false; readonly reason: string };

/**
 * Resolves periods per year for a frequency.
 *
 * @param explicit Caller-supplied override, required for DAILY.
 */
export function periodsPerYear(frequency: PayFrequency, explicit?: number): PeriodsPerYearResult {
  if (explicit !== undefined) {
    if (!Number.isInteger(explicit) || explicit < 1) {
      return { known: false, reason: 'periodsPerYear must be a positive integer' };
    }
    return { known: true, periods: explicit };
  }

  const fixed = FIXED_PERIODS_PER_YEAR[frequency];
  if (fixed !== undefined) {
    return { known: true, periods: fixed };
  }

  return {
    known: false,
    reason:
      'DAILY pay requires an explicit periodsPerYear: the number of paid days per year is a ' +
      'payroll policy decision, not a calendar fact, and is not assumed (PENDING DECISION).',
  };
}

/** True when the frequency's periods-per-year is fixed without caller input. */
export function hasFixedPeriods(frequency: PayFrequency): boolean {
  return FIXED_PERIODS_PER_YEAR[frequency] !== undefined;
}

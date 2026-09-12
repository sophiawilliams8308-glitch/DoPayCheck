import type { PayFrequency } from '@/lib/db/generated/client';

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
 *
 * ===========================================================================
 * RUNTIME INDEPENDENCE.
 *
 * `PayFrequency` is imported as a TYPE ONLY. The Prisma schema enum remains the single
 * authoritative definition, but the pure engine must not depend on the generated client's
 * RUNTIME value: that value reaches the engine through CommonJS/ESM interop, which is not
 * guaranteed to expose named exports identically on every toolchain, and an `undefined` enum
 * object turns into a module-load crash rather than a calculation status.
 *
 * The table below therefore uses plain string keys. It is declared as a TOTAL
 * `Record<PayFrequency, …>`, so if the schema ever adds, removes or renames a member this
 * file stops compiling — the names cannot silently drift from the schema.
 * ===========================================================================
 */

/**
 * Periods per year for every pay frequency, or `null` when the count is not decided by the
 * calendar. `null` is "undecided", never zero.
 */
const PERIODS_PER_YEAR: Record<PayFrequency, number | null> = {
  WEEKLY: 52,
  BIWEEKLY: 26,
  SEMIMONTHLY: 24,
  MONTHLY: 12,
  QUARTERLY: 4,
  ANNUAL: 1,
  // PENDING DECISION — see above. Never assumed.
  DAILY: null,
};

/** Every pay frequency the engine supports, derived from the table above. */
export const PAY_FREQUENCIES: readonly PayFrequency[] = Object.keys(
  PERIODS_PER_YEAR,
) as PayFrequency[];

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

  const fixed = PERIODS_PER_YEAR[frequency];
  if (typeof fixed === 'number') {
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
  return typeof PERIODS_PER_YEAR[frequency] === 'number';
}

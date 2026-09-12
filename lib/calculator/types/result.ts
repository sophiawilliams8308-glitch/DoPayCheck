import type { PayFrequency } from '@/lib/db/generated/client';

import type { TraceEntry } from '../trace/trace';
import type { RuleReference } from './rules';
import type { CalculationStatus, IncompleteReason } from './status';

/**
 * Calculation result (spec §34).
 *
 * ===========================================================================
 * MONETARY VALUES ARE EXACT DECIMAL STRINGS.
 *
 * The result is serializable to JSON, stored in a snapshot and eventually returned by an API.
 * Emitting JS numbers would reintroduce IEEE-754 at the boundary and silently corrupt values
 * (spec §4), so every amount leaves the engine as a string.
 * ===========================================================================
 *
 * A component that could not be calculated carries `amount: null` plus a reason — never 0.
 */

export type DecimalString = string;

/** One computed or uncomputable tax component. */
export interface TaxComponent {
  readonly code: string;
  readonly label: string;
  /** Exact amount, or null when it could not be determined. NEVER defaulted to "0". */
  readonly amount: DecimalString | null;
  readonly status: CalculationStatus;
  readonly reason?: IncompleteReason;
  readonly detail?: string;
  /** Rules that produced this amount, with version and source provenance. */
  readonly rules: readonly RuleReference[];
}

export interface GrossPayBreakdown {
  readonly regular: DecimalString;
  readonly overtime: DecimalString;
  readonly bonus: DecimalString;
  readonly commission: DecimalString;
  readonly tips: DecimalString;
  readonly other: DecimalString;
  readonly total: DecimalString;
}

export interface DeductionLine {
  readonly id: string;
  readonly label: string;
  readonly amount: DecimalString;
}

export interface DeductionBreakdown {
  readonly items: readonly DeductionLine[];
  readonly total: DecimalString;
}

/**
 * Independent taxable wage buckets (spec §5).
 *
 * These are deliberately separate values. Nothing in the engine assumes any two are equal.
 */
export interface TaxableWages {
  readonly federalIncomeTaxWages: DecimalString;
  readonly socialSecurityWages: DecimalString;
  readonly medicareWages: DecimalString;
  readonly stateIncomeTaxWages: DecimalString;
  readonly localIncomeTaxWages: DecimalString;
  readonly futaWages: DecimalString;
  readonly sutaWages: DecimalString;
}

export interface JurisdictionSummary {
  readonly federalCode: string;
  readonly stateCode: string | null;
  readonly localCodes: readonly string[];
  readonly resolved: boolean;
}

export interface CalculationResult {
  readonly status: CalculationStatus;
  readonly engineVersion: string;
  readonly taxYear: number;
  readonly effectiveDate: string;
  readonly payFrequency: PayFrequency;
  readonly jurisdiction: JurisdictionSummary;

  readonly grossPay: GrossPayBreakdown;
  readonly preTaxDeductions: DeductionBreakdown;
  readonly taxableWages: TaxableWages;

  readonly federal: readonly TaxComponent[];
  readonly fica: readonly TaxComponent[];
  readonly state: readonly TaxComponent[];
  readonly local: readonly TaxComponent[];
  /** Employer liabilities. NEVER deducted from employee net pay (spec §48). */
  readonly employerTaxes: readonly TaxComponent[];

  readonly postTaxDeductions: DeductionBreakdown;

  /** Sum of employee-side taxes actually determined. Null when any component is unknown. */
  readonly totalEmployeeTaxes: DecimalString | null;
  readonly totalDeductions: DecimalString;
  /** Null when any employee tax could not be determined — never a partial figure. */
  readonly netPay: DecimalString | null;
  /** Null when net pay is unknown or gross is zero. */
  readonly effectiveTaxRate: DecimalString | null;

  /** Annualized figures, omitted when the frequency's periods-per-year is undecided. */
  readonly annualized: { readonly grossPay: DecimalString } | null;

  readonly ruleReferences: readonly RuleReference[];
  readonly sourceIds: readonly string[];
  readonly trace: readonly TraceEntry[];
  readonly issues: readonly { readonly path: string; readonly message: string }[];
}

import type { PayFrequency } from '@/lib/db/generated/client';

/**
 * Calculation input (spec §33).
 *
 * ===========================================================================
 * EVERY MONETARY FIELD IS A DECIMAL STRING, NEVER A `number`.
 *
 * A JS number may already have lost precision before the engine sees it, so the type system
 * refuses one at the boundary (spec §4). Strings are converted with `money()` during
 * normalization.
 * ===========================================================================
 *
 * Hours and multipliers are strings for the same reason — they are multiplied into money.
 */

/** A decimal value carried exactly as a string, e.g. "1234.56". */
export type DecimalString = string;

/**
 * Filing status key. A string, not an enum: filing statuses differ by jurisdiction and are
 * jurisdiction DATA, not application constants (spec §2).
 */
export type FilingStatusKey = string;

/** Where the employee works and lives. Both matter for state and local taxation. */
export interface LocationInput {
  /** Jurisdiction code, e.g. "US-CA". Resolution happens in the pipeline. */
  readonly stateCode?: string;
  readonly countyCode?: string;
  readonly cityCode?: string;
  readonly localityCode?: string;
  /**
   * ZIP is accepted only as an INPUT AID. It is never treated as the taxing jurisdiction
   * (spec §9); full locality resolution is Phase 6.
   */
  readonly zipCode?: string;
}

export interface EmployeeInput {
  /** Opaque caller-supplied identifier. Never logged (spec §58). */
  readonly employeeId?: string;
  readonly workLocation: LocationInput;
  /** Defaults to the work location when absent. */
  readonly residenceLocation?: LocationInput;
}

export type PayBasis = 'SALARY' | 'HOURLY';

export interface PayInput {
  readonly basis: PayBasis;
  readonly payFrequency: PayFrequency;

  /** Required when basis is SALARY. */
  readonly annualSalary?: DecimalString;

  /** Required when basis is HOURLY. */
  readonly hourlyRate?: DecimalString;
  readonly regularHours?: DecimalString;
  readonly overtimeHours?: DecimalString;
  /**
   * Overtime pay, expressed EITHER as an explicit per-hour rate OR as a multiplier on the
   * regular hourly rate. Exactly one must be supplied when `overtimeHours` is present.
   *
   * Both are caller-supplied in Phase 3. Jurisdiction overtime LAW (thresholds, daily vs
   * weekly, double time) is rule-driven and belongs to Phases 4–6 — this phase performs the
   * arithmetic only and invents no legal threshold or multiplier.
   */
  readonly overtimeRate?: DecimalString;
  readonly overtimeMultiplier?: DecimalString;

  readonly bonus?: DecimalString;
  readonly commission?: DecimalString;
  readonly tips?: DecimalString;
  readonly otherCompensation?: DecimalString;

  /**
   * Periods per year, required only for DAILY.
   *
   * PENDING DECISION: the number of paid days in a year is a payroll-policy choice (260, 261,
   * 365 …) with no single correct answer, so the engine will not assume one. For every other
   * frequency the count is an unambiguous calendar fact.
   */
  readonly periodsPerYear?: number;
}

/** W-4 foundation (spec §14). Shapes only — no methodology is implemented in Phase 3. */
export interface W4Input {
  readonly filingStatus: FilingStatusKey;
  readonly multipleJobs?: boolean;
  readonly dependentsAmount?: DecimalString;
  readonly otherIncome?: DecimalString;
  readonly deductionsAmount?: DecimalString;
  readonly additionalWithholding?: DecimalString;
}

/** Which taxable-wage buckets a deduction reduces. Absent means "not reduced". */
export interface DeductionTaxability {
  readonly federalIncomeTax?: boolean;
  readonly socialSecurity?: boolean;
  readonly medicare?: boolean;
  readonly stateIncomeTax?: boolean;
  readonly localIncomeTax?: boolean;
  readonly futa?: boolean;
  readonly suta?: boolean;
}

export type DeductionBasis = 'FIXED_AMOUNT' | 'PERCENT_OF_GROSS';

export interface DeductionInput {
  /** Stable identifier, e.g. "401k", "health-insurance". */
  readonly id: string;
  readonly label?: string;
  readonly basis: DeductionBasis;
  /** Fixed amount, when basis is FIXED_AMOUNT. */
  readonly amount?: DecimalString;
  /** Percentage expressed as a fraction, e.g. "0.05" for 5%, when PERCENT_OF_GROSS. */
  readonly percent?: DecimalString;
  readonly enabled?: boolean;
  /** Application order, ascending. Ties fall back to array order. */
  readonly ordinal?: number;
  /**
   * Which buckets this deduction reduces.
   *
   * REQUIRED and never inferred: a deduction is not automatically pre-tax for every tax
   * (spec §13). The caller states it because it is a plan/jurisdiction fact.
   */
  readonly taxability: DeductionTaxability;
}

/** Year-to-date figures (spec §15). Needed for wage bases and thresholds. */
export interface YtdInput {
  readonly grossWages?: DecimalString;
  readonly socialSecurityWages?: DecimalString;
  readonly medicareWages?: DecimalString;
  readonly federalWithholding?: DecimalString;
  readonly stateWithholding?: DecimalString;
  readonly localWithholding?: DecimalString;
}

export interface CalculationInput {
  readonly taxYear: number;
  /** The instant the calculation applies to. Decides which rule versions apply (spec §23). */
  readonly effectiveDate: Date;
  readonly employee: EmployeeInput;
  readonly pay: PayInput;
  readonly w4: W4Input;
  readonly preTaxDeductions?: readonly DeductionInput[];
  readonly postTaxDeductions?: readonly DeductionInput[];
  readonly ytd?: YtdInput;
}

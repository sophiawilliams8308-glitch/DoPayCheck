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

/**
 * W-4 revision the employee's form belongs to (spec §14).
 *
 * The two revisions use DIFFERENT withholding methodologies and are never blended: a pre-2020
 * form claims allowances, a 2020+ form uses Steps 2-4. Absent, the 2020+ revision applies,
 * which is the form in use for every new hire.
 */
export type W4RevisionKey = 'PRE_2020' | 'REVISION_2020_PLUS';

/**
 * W-4 foundation (spec §14).
 *
 * Phase 3 established the shapes; Phase 4 added the four fields the federal withholding
 * methodology needs. The Phase 3 names are deliberately KEPT: the federal engine maps them to
 * IRS worksheet vocabulary internally (`multipleJobs` is Step 2, `dependentsAmount` Step 3,
 * `otherIncome` Step 4(a), `deductionsAmount` Step 4(b), `additionalWithholding` Step 4(c)),
 * so callers are not forced to adopt form line numbers and there is only ever one W-4 type.
 */
export interface W4Input {
  readonly filingStatus: FilingStatusKey;
  /** Step 2 checkbox — the employee has two jobs total, or a working spouse. */
  readonly multipleJobs?: boolean;
  /** Step 3 — annual credits for dependants. */
  readonly dependentsAmount?: DecimalString;
  /** Step 4(a) — annual other income not from jobs. */
  readonly otherIncome?: DecimalString;
  /**
   * Step 4(b) — annual deductions beyond the standard deduction.
   *
   * Under OBBBA this line also carries qualified tips and qualified overtime, which is why no
   * separate field exists for them. It reduces INCOME TAX withholding only: those wages stay
   * fully subject to Social Security and Medicare.
   */
  readonly deductionsAmount?: DecimalString;
  /** Step 4(c) — extra withholding PER PAY PERIOD, not annual. */
  readonly additionalWithholding?: DecimalString;

  /** Which W-4 revision this form is. Defaults to the 2020+ redesign. */
  readonly w4Revision?: W4RevisionKey;
  /** The employee claims exemption from federal income tax withholding. */
  readonly claimsExemption?: boolean;
  /** The employee is a nonresident alien for withholding purposes. */
  readonly isNonresidentAlien?: boolean;
  /** Pre-2020 forms only: the number of allowances claimed. Never assumed. */
  readonly pre2020Allowances?: number;
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
   * Deduction TYPE, e.g. TRADITIONAL_401K or SECTION125_HEALTH (Phase 4 §12.2).
   *
   * Selects the versioned, sourced taxability profile that decides which wage
   * buckets this deduction reduces. Optional so every Phase 3 caller stays
   * valid; when absent the federal engine has no profile and reports the
   * scenario unsupported rather than guessing a treatment.
   */
  readonly deductionTypeKey?: string;
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

/**
 * State-specific inputs (Phase 5).
 *
 * ===========================================================================
 * ADDITIVE, AND DELIBERATELY NOT A SECOND W-4.
 *
 * `W4Input` is untouched. A state withholding certificate (DE 4, IT-2104, …)
 * is a DIFFERENT form with different fields, so it arrives as its own
 * `elections` map keyed by jurisdiction rather than as extra W-4 fields. One
 * federal W-4 type in the project, as D-W4-1 requires; fifty-one state forms
 * described as data.
 * ===========================================================================
 *
 * Every field is optional. Omit the whole block and Phase 1-4 behaviour is
 * unchanged.
 */
export interface StateElectionValueInput {
  readonly fieldKey: string;
  readonly value: DecimalString | number | boolean;
  /** MANDATORY on an amount; never defaulted. Absent on counts and booleans. */
  readonly unit?: 'ANNUAL' | 'PER_PERIOD';
}

export interface StateElectionsInput {
  /** The jurisdiction's own form code, as its ELECTION_FORM_SCHEMA declares it. */
  readonly formCode: string;
  /** The state's own filing status, which need not match the federal one. */
  readonly filingStatus?: string;
  readonly values?: readonly StateElectionValueInput[];
}

export type ResidencyStatusKey = 'RESIDENT' | 'NONRESIDENT' | 'PART_YEAR_RESIDENT';

export interface StateInput {
  /** Where the work was performed. Defaults to `employee.workLocation.stateCode`. */
  readonly workState?: string;
  /** Where the employee lives. Defaults to the work state. */
  readonly residenceState?: string;
  /** Stated, never inferred by comparing two jurisdiction codes. */
  readonly residencyStatus?: ResidencyStatusKey;
  /** Per-jurisdiction elections, keyed by jurisdiction code. */
  readonly stateElections?: Readonly<Record<string, StateElectionsInput>>;
  /** Drives employer-size thresholds in a state programme descriptor. */
  readonly employerEmployeeCount?: number;
  /** The employer's experience-rated SUTA rate — employer-specific, never assumed. */
  readonly employerSutaRate?: DecimalString;
  /** True when an approved private plan substitutes for a state programme. */
  readonly employerPlanElection?: boolean;
  /** True when the employee filed the certificate a reciprocity agreement requires. */
  readonly reciprocityCertificateFiled?: boolean;
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
  /** Phase 5, optional. Absent means no state-specific input was supplied. */
  readonly state?: StateInput;
}

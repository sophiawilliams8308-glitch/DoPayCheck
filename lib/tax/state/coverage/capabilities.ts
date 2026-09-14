import { StateProgram } from '../ruleKeys';

/**
 * The canonical state capability vocabulary — Phase 5 Step 2.
 *
 * ===========================================================================
 * THIRTEEN CAPABILITIES, FIFTY-ONE JURISDICTIONS, 663 CELLS.
 *
 * A capability is a QUESTION asked of one jurisdiction: "can we do this here,
 * and on what evidence?" It is not a rule, not a value, and not code. The
 * matrix exists so that "does DoPayCheck support paid leave in this state?"
 * has one answer with one provenance, rather than being inferred from whether
 * some code path happens to run without throwing.
 * ===========================================================================
 *
 * These are the PRODUCTION capabilities. Adding one changes the size of the
 * matrix and the meaning of every coverage report, so the list is closed and a
 * test asserts its length.
 */

export const StateCapability = {
  /** Annual liability structure: brackets, flat rate, deductions, exemptions. */
  INCOME_TAX: 'INCOME_TAX',
  /** The paycheck number: the jurisdiction's published withholding method. */
  WITHHOLDING: 'WITHHOLDING',
  /** Bonuses, commissions and other supplemental wages. */
  SUPPLEMENTAL_WAGES: 'SUPPLEMENTAL_WAGES',
  DISABILITY_SDI: 'DISABILITY_SDI',
  PAID_LEAVE: 'PAID_LEAVE',
  SUTA: 'SUTA',
  RECIPROCITY: 'RECIPROCITY',
  /** Which deductions reduce which state wage bucket. */
  TAXABILITY: 'TAXABILITY',
  /** Wage bases, contribution ceilings and other statutory limits. */
  WAGE_BASES: 'WAGE_BASES',
  /** The jurisdiction's own filing statuses and their federal mapping. */
  FILING_STATUSES: 'FILING_STATUSES',
  /** The jurisdiction's withholding certificate and the fields it carries. */
  ELECTIONS: 'ELECTIONS',
  ROUNDING: 'ROUNDING',
  /** Employer-side obligations: programme descriptors, size thresholds, private plans. */
  EMPLOYER_PROGRAMS: 'EMPLOYER_PROGRAMS',
} as const;

export type StateCapability = (typeof StateCapability)[keyof typeof StateCapability];

export const ALL_STATE_CAPABILITIES: readonly StateCapability[] = Object.values(StateCapability);

/** The size of the capability axis. Changing it changes every coverage report. */
export const STATE_CAPABILITY_COUNT = ALL_STATE_CAPABILITIES.length;

export function isStateCapability(value: string): value is StateCapability {
  return (ALL_STATE_CAPABILITIES as readonly string[]).includes(value);
}

/**
 * Which Step 1 programme a capability belongs to, where one does.
 *
 * REUSES `StateProgram` rather than redefining it: a programme is the unit a
 * jurisdiction switches on or off, and several capabilities (taxability,
 * rounding, filing statuses) cut across all of them, which is why this map is
 * partial rather than total.
 */
export const CAPABILITY_PROGRAM: Readonly<Partial<Record<StateCapability, StateProgram>>> = {
  [StateCapability.INCOME_TAX]: StateProgram.INCOME_TAX_WITHHOLDING,
  [StateCapability.WITHHOLDING]: StateProgram.INCOME_TAX_WITHHOLDING,
  [StateCapability.SUPPLEMENTAL_WAGES]: StateProgram.INCOME_TAX_WITHHOLDING,
  [StateCapability.DISABILITY_SDI]: StateProgram.SDI,
  [StateCapability.PAID_LEAVE]: StateProgram.PFML,
  [StateCapability.SUTA]: StateProgram.SUTA,
};

/**
 * Capabilities that decide whether an EMPLOYEE amount may be claimed.
 *
 * Kept apart from the employer set so that an employer-side gap can never
 * silently gate — or ungate — something that reaches take-home pay.
 */
export const EMPLOYEE_SIDE_CAPABILITIES: readonly StateCapability[] = [
  StateCapability.INCOME_TAX,
  StateCapability.WITHHOLDING,
  StateCapability.SUPPLEMENTAL_WAGES,
  StateCapability.DISABILITY_SDI,
  StateCapability.PAID_LEAVE,
  StateCapability.TAXABILITY,
  StateCapability.WAGE_BASES,
  StateCapability.FILING_STATUSES,
  StateCapability.ELECTIONS,
  StateCapability.ROUNDING,
  StateCapability.RECIPROCITY,
];

export const EMPLOYER_SIDE_CAPABILITIES: readonly StateCapability[] = [
  StateCapability.SUTA,
  StateCapability.EMPLOYER_PROGRAMS,
  StateCapability.DISABILITY_SDI,
  StateCapability.PAID_LEAVE,
  StateCapability.WAGE_BASES,
  StateCapability.ROUNDING,
];

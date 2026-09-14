/**
 * Canonical state rule keys — Phase 5 Step 1. THE ONLY PLACE ONE IS WRITTEN.
 *
 * ===========================================================================
 * NO KEY NAMES A STATE.
 *
 * There is no `STATE.CA.*`. The jurisdiction is a SEPARATE axis, carried by the
 * rule row and the resolution query — exactly as Phase 4 keys never say "US".
 *
 * This is what keeps fifty-one jurisdictions on ONE engine. The moment a key
 * embeds a state code, the engine needs a branch per state, and a "50-state
 * engine" becomes fifty engines that drift apart. Every difference between
 * states must live in RULE DATA reached through these same keys.
 * ===========================================================================
 *
 * DISJOINT FROM FEDERAL. Every key here begins `STATE.`; every Phase 4 key
 * begins `FED.`. Neither engine may read the other's namespace, and a guard
 * test enforces it in both directions. Withholding a state paycheck from a
 * federal table — or the reverse — would be wrong all year and plausible-
 * looking on any single payslip.
 *
 * NO VALUES. Not one rate, bracket, threshold or wage base appears in this
 * file or anywhere under `lib/tax/state/`.
 */

export const StateRuleKey = {
  // --- Coverage and methodology declaration ---------------------------------
  /** What this jurisdiction's rule data claims to support. Read before anything else. */
  CAPABILITY_DECLARATION: 'STATE.CAPABILITY.DECLARATION',

  // --- Personal income tax: annual liability structure ----------------------
  /** Annual liability structure. NOT a withholding table — see WITHHOLDING.* below. */
  PIT_RATE_BRACKETS: 'STATE.PIT.RATE_BRACKETS',
  PIT_STANDARD_DEDUCTION: 'STATE.PIT.STANDARD_DEDUCTION',
  PIT_PERSONAL_EXEMPTION: 'STATE.PIT.PERSONAL_EXEMPTION',
  PIT_DEPENDENT_EXEMPTION: 'STATE.PIT.DEPENDENT_EXEMPTION',
  PIT_FLAT_RATE: 'STATE.PIT.FLAT_RATE',

  // --- Withholding: the paycheck number ------------------------------------
  /** Which published method this jurisdiction uses. Selects the shape below. */
  WITHHOLDING_METHOD: 'STATE.WITHHOLDING.METHOD',
  WITHHOLDING_TABLE: 'STATE.WITHHOLDING.TABLE',
  WITHHOLDING_FORMULA: 'STATE.WITHHOLDING.FORMULA',
  WITHHOLDING_ALLOWANCE_VALUE: 'STATE.WITHHOLDING.ALLOWANCE_VALUE',
  WITHHOLDING_STANDARD_DEDUCTION: 'STATE.WITHHOLDING.STANDARD_DEDUCTION',
  WITHHOLDING_PAY_PERIODS_PER_YEAR: 'STATE.WITHHOLDING.PAY_PERIODS_PER_YEAR',
  WITHHOLDING_ROUNDING_POLICY: 'STATE.WITHHOLDING.ROUNDING_POLICY',
  WITHHOLDING_SUPPLEMENTAL: 'STATE.WITHHOLDING.SUPPLEMENTAL',
  WITHHOLDING_FILING_STATUS_MAP: 'STATE.WITHHOLDING.FILING_STATUS_MAP',
  /** The jurisdiction's own withholding certificate and the fields it carries. */
  WITHHOLDING_ELECTION_FORM: 'STATE.WITHHOLDING.ELECTION_FORM',

  // --- Taxability of wages and deductions ----------------------------------
  TAXABILITY_PROFILE: 'STATE.TAXABILITY.PROFILE',

  // --- Employee/employer contribution programmes ---------------------------
  /** Disability insurance. Programme descriptor plus its own rate and base. */
  SDI_PROGRAM: 'STATE.SDI.PROGRAM',
  SDI_EMPLOYEE_RATE: 'STATE.SDI.EMPLOYEE_RATE',
  SDI_EMPLOYER_RATE: 'STATE.SDI.EMPLOYER_RATE',
  SDI_WAGE_BASE: 'STATE.SDI.WAGE_BASE',
  /** A statutory per-year contribution ceiling, where the programme states one. */
  SDI_MAX_CONTRIBUTION: 'STATE.SDI.MAX_CONTRIBUTION',

  PFML_PROGRAM: 'STATE.PFML.PROGRAM',
  PFML_EMPLOYEE_RATE: 'STATE.PFML.EMPLOYEE_RATE',
  PFML_EMPLOYER_RATE: 'STATE.PFML.EMPLOYER_RATE',
  PFML_WAGE_BASE: 'STATE.PFML.WAGE_BASE',
  PFML_MAX_CONTRIBUTION: 'STATE.PFML.MAX_CONTRIBUTION',

  // --- Unemployment (employer side, with employee-side exceptions) ---------
  SUTA_PROGRAM: 'STATE.SUTA.PROGRAM',
  SUTA_EMPLOYER_RATE: 'STATE.SUTA.EMPLOYER_RATE',
  SUTA_NEW_EMPLOYER_RATE: 'STATE.SUTA.NEW_EMPLOYER_RATE',
  /** A handful of jurisdictions impose an employee share. Data, never assumed absent. */
  SUTA_EMPLOYEE_RATE: 'STATE.SUTA.EMPLOYEE_RATE',
  SUTA_WAGE_BASE: 'STATE.SUTA.WAGE_BASE',

  // --- Cross-jurisdiction --------------------------------------------------
  RECIPROCITY_AGREEMENT: 'STATE.RECIPROCITY.AGREEMENT',
} as const;

export type StateRuleKey = (typeof StateRuleKey)[keyof typeof StateRuleKey];

export const ALL_STATE_RULE_KEYS: readonly StateRuleKey[] = Object.values(StateRuleKey);

/** The namespace prefix every state key carries. */
export const STATE_KEY_PREFIX = 'STATE.';

/** The federal prefix, named here ONLY so guards can assert it never appears. */
export const FEDERAL_KEY_PREFIX = 'FED.';

export function isStateRuleKey(value: string): value is StateRuleKey {
  return (ALL_STATE_RULE_KEYS as readonly string[]).includes(value);
}

/**
 * State programmes, as the result and the coverage model name them.
 *
 * A programme is the unit a jurisdiction switches on or off; a rule key is the
 * unit a value is stored under. Keeping them separate means adding a value to
 * an existing programme never changes the result's shape.
 */
export const StateProgram = {
  INCOME_TAX_WITHHOLDING: 'INCOME_TAX_WITHHOLDING',
  SDI: 'SDI',
  PFML: 'PFML',
  SUTA: 'SUTA',
} as const;

export type StateProgram = (typeof StateProgram)[keyof typeof StateProgram];

export const ALL_STATE_PROGRAMS: readonly StateProgram[] = Object.values(StateProgram);

/**
 * The independent state taxable-wage buckets.
 *
 * SEPARATE BUCKETS, as federally: a deduction that reduces state income tax
 * wages does not necessarily reduce SDI or PFML wages, and assuming one
 * taxable figure serves every programme is the error this shape prevents.
 */
export const STATE_BUCKETS = ['stateIncomeTaxWages', 'sdiWages', 'pfmlWages', 'sutaWages'] as const;

export type StateBucket = (typeof STATE_BUCKETS)[number];

/** Which bucket each programme is computed on. */
export const PROGRAM_BUCKET: Readonly<Record<StateProgram, StateBucket>> = {
  INCOME_TAX_WITHHOLDING: 'stateIncomeTaxWages',
  SDI: 'sdiWages',
  PFML: 'pfmlWages',
  SUTA: 'sutaWages',
};

/**
 * Canonical federal rule keys — spec §2.5.
 *
 * ===========================================================================
 * THE ONLY PLACE A FEDERAL RULE KEY IS WRITTEN.
 *
 * Two namespaces that must never merge:
 *   FED.FIT.*     — paycheck WITHHOLDING (Pub. 15-T). Track B.
 *   FED.ANNUAL.*  — annual 1040 liability structure. Track A.
 *
 * They are namespaced precisely so a mis-wiring is visible in review and
 * detectable by test (§2.5). Annual brackets are not withholding schedules:
 * different tables, different column semantics, different purpose.
 * ===========================================================================
 *
 * Every key here has a row in the specification's Appendix A (PENDING DATA) or
 * Appendix B (PENDING_VERIFICATION). No key carries a value in code.
 */

export const FederalRuleKey = {
  // --- Track B: withholding (Pub. 15-T) ------------------------------------
  FIT_RATE_SCHEDULE_STANDARD: 'FED.FIT.RATE_SCHEDULE.ANNUAL.STANDARD',
  FIT_RATE_SCHEDULE_STEP2: 'FED.FIT.RATE_SCHEDULE.ANNUAL.STEP2_CHECKBOX',
  /** Worksheet 1A line 1g. */
  FIT_STEP2_UNCHECKED_ADJUSTMENT: 'FED.FIT.W4.STEP2_UNCHECKED_ADJUSTMENT',
  /** Worksheet 1A line 1k. */
  FIT_ALLOWANCE_VALUE: 'FED.FIT.W4.ALLOWANCE_VALUE',
  /** Worksheet 1A Table 3. */
  FIT_PAY_PERIODS_PER_YEAR: 'FED.FIT.PAY_PERIODS_PER_YEAR',
  FIT_ROUNDING_POLICY: 'FED.FIT.ROUNDING_POLICY',
  /** Pub. 15-T Table 1. */
  FIT_NRA_WAGE_ADDITION_PRE2020: 'FED.FIT.NRA_WAGE_ADDITION.PRE2020',
  /** Pub. 15-T Table 2. */
  FIT_NRA_WAGE_ADDITION_POST2019: 'FED.FIT.NRA_WAGE_ADDITION.POST2019',
  /** Stored, never applied in Phase 4 (§7.10). */
  FIT_COMPUTATIONAL_BRIDGE: 'FED.FIT.COMPUTATIONAL_BRIDGE',

  // --- Track B: supplemental wages (Pub. 15 §7) ----------------------------
  SUPP_OPTIONAL_FLAT_RATE: 'FED.SUPP.OPTIONAL_FLAT_RATE',
  SUPP_MANDATORY_FLAT_RATE: 'FED.SUPP.MANDATORY_FLAT_RATE',
  SUPP_MANDATORY_THRESHOLD: 'FED.SUPP.MANDATORY_THRESHOLD',

  // --- Track C/D: FICA ------------------------------------------------------
  SS_EMPLOYEE_RATE: 'FED.SS.EMPLOYEE_RATE',
  SS_EMPLOYER_RATE: 'FED.SS.EMPLOYER_RATE',
  SS_WAGE_BASE: 'FED.SS.WAGE_BASE',
  MEDICARE_EMPLOYEE_RATE: 'FED.MEDICARE.EMPLOYEE_RATE',
  MEDICARE_EMPLOYER_RATE: 'FED.MEDICARE.EMPLOYER_RATE',
  /** Exists as an explicit NOT_APPLICABLE record (§14.3). */
  MEDICARE_WAGE_BASE: 'FED.MEDICARE.WAGE_BASE',
  ADDL_MEDICARE_EMPLOYEE_RATE: 'FED.ADDL_MEDICARE.EMPLOYEE_RATE',
  ADDL_MEDICARE_WITHHOLDING_THRESHOLD: 'FED.ADDL_MEDICARE.WITHHOLDING_THRESHOLD',

  // --- Track D: FUTA --------------------------------------------------------
  FUTA_GROSS_RATE: 'FED.FUTA.GROSS_RATE',
  FUTA_STANDARD_CREDIT: 'FED.FUTA.STANDARD_CREDIT',
  FUTA_WAGE_BASE: 'FED.FUTA.WAGE_BASE',

  // --- Track A: annual liability estimate. DISPLAY ONLY. --------------------
  ANNUAL_STANDARD_DEDUCTION: 'FED.ANNUAL.STANDARD_DEDUCTION',
  ANNUAL_PERSONAL_EXEMPTION: 'FED.ANNUAL.PERSONAL_EXEMPTION',
  ANNUAL_RATE_BRACKETS: 'FED.ANNUAL.RATE_BRACKETS',
} as const;

export type FederalRuleKey = (typeof FederalRuleKey)[keyof typeof FederalRuleKey];

/** Per-state FUTA credit reduction — modelled, flagged OFF (§18.6). */
export function futaCreditReductionKey(stateCode: string): string {
  return `FED.FUTA.CREDIT_REDUCTION.${stateCode}`;
}

/** Canonical filing statuses (§8.1). */
export const FilingStatus = {
  SINGLE_OR_MFS: 'SINGLE_OR_MFS',
  MARRIED_FILING_JOINTLY: 'MARRIED_FILING_JOINTLY',
  HEAD_OF_HOUSEHOLD: 'HEAD_OF_HOUSEHOLD',
} as const;

export type FilingStatus = (typeof FilingStatus)[keyof typeof FilingStatus];

export const FILING_STATUSES: readonly FilingStatus[] = Object.values(FilingStatus);

export function isFilingStatus(value: string): value is FilingStatus {
  return (FILING_STATUSES as readonly string[]).includes(value);
}

/** Legacy 2019-or-earlier marital status mapping (§8.2). */
export const LEGACY_MARITAL_STATUS_MAP = {
  SINGLE: FilingStatus.SINGLE_OR_MFS,
  MARRIED_HIGHER_SINGLE_RATE: FilingStatus.SINGLE_OR_MFS,
  MARRIED: FilingStatus.MARRIED_FILING_JOINTLY,
} as const;

export type LegacyMaritalStatus = keyof typeof LEGACY_MARITAL_STATUS_MAP;

/** What the caller is asking for, which decides the required keys (§3.2). */
export interface FederalScenario {
  readonly wantsFitWithholding: boolean;
  readonly claimsExemption: boolean;
  readonly step2MultipleJobsChecked: boolean;
  readonly isPre2020W4: boolean;
  readonly hasSupplementalWages: boolean;
  readonly isNonresidentAlien: boolean;
  readonly nraFlagEnabled: boolean;
  readonly wantsAnnualEstimate: boolean;
  readonly wantsEmployerTaxes: boolean;
}

/**
 * The keys a scenario genuinely needs (§3.2).
 *
 * Deliberately minimal: an unused rule's absence must never block a valid
 * calculation.
 */
export function requiredRuleKeys(scenario: FederalScenario): readonly FederalRuleKey[] {
  const keys: FederalRuleKey[] = [
    // Always required.
    FederalRuleKey.SS_EMPLOYEE_RATE,
    FederalRuleKey.SS_EMPLOYER_RATE,
    FederalRuleKey.SS_WAGE_BASE,
    FederalRuleKey.MEDICARE_EMPLOYEE_RATE,
    FederalRuleKey.MEDICARE_EMPLOYER_RATE,
    FederalRuleKey.MEDICARE_WAGE_BASE,
    FederalRuleKey.ADDL_MEDICARE_EMPLOYEE_RATE,
    FederalRuleKey.ADDL_MEDICARE_WITHHOLDING_THRESHOLD,
    FederalRuleKey.FIT_PAY_PERIODS_PER_YEAR,
    FederalRuleKey.FIT_ROUNDING_POLICY,
  ];

  if (scenario.wantsFitWithholding && !scenario.claimsExemption) {
    keys.push(
      scenario.step2MultipleJobsChecked
        ? FederalRuleKey.FIT_RATE_SCHEDULE_STEP2
        : FederalRuleKey.FIT_RATE_SCHEDULE_STANDARD,
    );
    // Line 1g is zero when the Step 2 box is checked, so the rule is not needed.
    if (!scenario.step2MultipleJobsChecked) {
      keys.push(FederalRuleKey.FIT_STEP2_UNCHECKED_ADJUSTMENT);
    }
  }

  if (scenario.isPre2020W4) {
    keys.push(FederalRuleKey.FIT_ALLOWANCE_VALUE);
  }

  if (scenario.hasSupplementalWages) {
    keys.push(
      FederalRuleKey.SUPP_OPTIONAL_FLAT_RATE,
      FederalRuleKey.SUPP_MANDATORY_FLAT_RATE,
      FederalRuleKey.SUPP_MANDATORY_THRESHOLD,
    );
  }

  if (scenario.wantsEmployerTaxes) {
    keys.push(
      FederalRuleKey.FUTA_GROSS_RATE,
      FederalRuleKey.FUTA_STANDARD_CREDIT,
      FederalRuleKey.FUTA_WAGE_BASE,
    );
  }

  if (scenario.wantsAnnualEstimate) {
    keys.push(
      FederalRuleKey.ANNUAL_STANDARD_DEDUCTION,
      FederalRuleKey.ANNUAL_PERSONAL_EXEMPTION,
      FederalRuleKey.ANNUAL_RATE_BRACKETS,
    );
  }

  // Only when the flag is on: with it off the scenario is UNSUPPORTED and the
  // table is never read, so requiring it would block for data never used.
  if (scenario.isNonresidentAlien && scenario.nraFlagEnabled) {
    keys.push(
      scenario.isPre2020W4
        ? FederalRuleKey.FIT_NRA_WAGE_ADDITION_PRE2020
        : FederalRuleKey.FIT_NRA_WAGE_ADDITION_POST2019,
    );
  }

  return keys;
}

export function isWithholdingKey(key: string): boolean {
  return key.startsWith('FED.FIT.') || key.startsWith('FED.SUPP.');
}

export function isAnnualKey(key: string): boolean {
  return key.startsWith('FED.ANNUAL.');
}

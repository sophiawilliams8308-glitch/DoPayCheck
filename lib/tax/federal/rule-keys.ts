/**
 * Federal rule keys (Phase 4).
 *
 * ===========================================================================
 * TWO NAMESPACES THAT MUST NEVER MERGE.
 *
 *   FED.FIT.*     — paycheck WITHHOLDING methodology (Pub. 15-T). Track B.
 *   FED.ANNUAL.*  — annual income-tax liability structure (1040 brackets). Track A.
 *
 * Annual brackets are not a withholding table. Substituting one for the other produces a
 * number that looks right and is wrong, which is why they are separate keys resolved through
 * separate categories and never share a code path.
 * ===========================================================================
 *
 * Required keys are SCENARIO-DEPENDENT: a calculation asks only for what it will actually
 * use, so an employee with no supplemental wages is never blocked by a missing supplemental
 * rule.
 */

export const FederalRuleKey = {
  /** Track B — Worksheet 1A percentage-method rate schedules. */
  FIT_WORKSHEET_1A: 'FED.FIT.WORKSHEET_1A',
  /** Track B — supplemental wage methodology and flat rates. */
  FIT_SUPPLEMENTAL: 'FED.FIT.SUPPLEMENTAL',
  /** Track B — nonresident-alien additional-wage adjustment table. */
  FIT_NRA_ADJUSTMENT: 'FED.FIT.NRA_ADJUSTMENT',
  /** Track B — pre-2020 W-4 allowance amount (Worksheet 1A lines 1j–1l). */
  FIT_PRE2020_ALLOWANCE: 'FED.FIT.PRE2020_ALLOWANCE',

  /** Track A — annual income-tax rate schedules and standard deductions. DISPLAY ONLY. */
  ANNUAL_RATE_SCHEDULE: 'FED.ANNUAL.RATE_SCHEDULE',
  ANNUAL_STANDARD_DEDUCTION: 'FED.ANNUAL.STANDARD_DEDUCTION',

  /** Track C/D — FICA. */
  FICA_SOCIAL_SECURITY: 'FED.FICA.SOCIAL_SECURITY',
  FICA_MEDICARE: 'FED.FICA.MEDICARE',
  FICA_ADDITIONAL_MEDICARE: 'FED.FICA.ADDITIONAL_MEDICARE',

  /** Track D — employer only. */
  FUTA: 'FED.FUTA.STANDARD',
} as const;

export type FederalRuleKey = (typeof FederalRuleKey)[keyof typeof FederalRuleKey];

/** What the caller is asking the engine to do, which decides the required keys. */
export interface FederalScenario {
  /** True when the period contains regular wages needing Worksheet 1A. */
  readonly hasRegularWages: boolean;
  /** True when the period contains supplemental wages. */
  readonly hasSupplementalWages: boolean;
  /** True when the employee is a nonresident alien for withholding purposes. */
  readonly isNonresidentAlien: boolean;
  /** True when the W-4 on file predates the 2020 redesign. */
  readonly isPre2020W4: boolean;
  /** True when the caller asked for the Track A annual estimate. */
  readonly wantsAnnualEstimate: boolean;
  /** True when employer-side liabilities are requested. */
  readonly wantsEmployerTaxes: boolean;
}

/**
 * The rule keys a scenario genuinely needs.
 *
 * Deliberately minimal: requiring a rule the calculation will not read would report a
 * scenario as INCOMPLETE for data it never needed.
 */
export function requiredRuleKeys(scenario: FederalScenario): readonly FederalRuleKey[] {
  const keys: FederalRuleKey[] = [
    // FICA applies to wages in every scenario this engine serves.
    FederalRuleKey.FICA_SOCIAL_SECURITY,
    FederalRuleKey.FICA_MEDICARE,
    FederalRuleKey.FICA_ADDITIONAL_MEDICARE,
  ];

  if (scenario.hasRegularWages) {
    keys.push(FederalRuleKey.FIT_WORKSHEET_1A);
  }
  if (scenario.hasSupplementalWages) {
    keys.push(FederalRuleKey.FIT_SUPPLEMENTAL);
  }
  if (scenario.isNonresidentAlien) {
    keys.push(FederalRuleKey.FIT_NRA_ADJUSTMENT);
  }
  if (scenario.isPre2020W4) {
    keys.push(FederalRuleKey.FIT_PRE2020_ALLOWANCE);
  }
  if (scenario.wantsAnnualEstimate) {
    keys.push(FederalRuleKey.ANNUAL_RATE_SCHEDULE, FederalRuleKey.ANNUAL_STANDARD_DEDUCTION);
  }
  if (scenario.wantsEmployerTaxes) {
    keys.push(FederalRuleKey.FUTA);
  }

  return keys;
}

/** True for keys in the withholding namespace. Used by the anti-substitution guard. */
export function isWithholdingKey(key: string): boolean {
  return key.startsWith('FED.FIT.');
}

/** True for keys in the annual-liability namespace. */
export function isAnnualKey(key: string): boolean {
  return key.startsWith('FED.ANNUAL.');
}

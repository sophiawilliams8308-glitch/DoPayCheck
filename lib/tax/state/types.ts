import type { CalculationStatus } from '@/lib/calculator/types/status';
import type { RuleReference } from '@/lib/calculator/types/rules';

import type { StateMissingRuleIssue, StateUnavailable } from './errors/stateErrors';
import type { StateBucket, StateProgram } from './ruleKeys';

/**
 * State engine types — Phase 5 Step 1 result contract.
 *
 * Money crosses every boundary as an exact decimal STRING: a JS `number` may
 * already have lost precision before the engine sees it.
 */

export type DecimalString = string;

/**
 * UNITS DISCIPLINE.
 *
 * ===========================================================================
 * A STATE FORM'S "ADDITIONAL AMOUNT" IS ANNUAL ON SOME FORMS AND PER PERIOD ON
 * OTHERS.
 *
 * There is no convention to rely on across fifty-one jurisdictions, which is
 * exactly why the unit is a TYPE rather than a naming habit: passing an annual
 * amount where a per-period one is expected is a COMPILE ERROR. The mistake it
 * prevents — an extra withholding amount multiplied or divided by 26 — is
 * invisible on a single payslip and wrong on every one of them.
 * ===========================================================================
 *
 * Deliberately NOT shared with the federal engine's identically-shaped brands.
 * The two engines stay independent: neither imports the other, so neither can
 * be refactored into breaking the other. The duplication is the price of that
 * isolation, and it is a few lines.
 */
declare const stateAnnualBrand: unique symbol;
declare const statePerPeriodBrand: unique symbol;

export type AnnualAmount = DecimalString & { readonly [stateAnnualBrand]: 'ANNUAL' };
export type PerPeriodAmount = DecimalString & { readonly [statePerPeriodBrand]: 'PER_PERIOD' };

export function asAnnual(value: DecimalString): AnnualAmount {
  return value as AnnualAmount;
}

export function asPerPeriod(value: DecimalString): PerPeriodAmount {
  return value as PerPeriodAmount;
}

/** The unit an election amount is expressed in, when it must travel as data. */
export const StateAmountUnitValue = {
  ANNUAL: 'ANNUAL',
  PER_PERIOD: 'PER_PERIOD',
} as const;

export type StateAmountUnitValue = (typeof StateAmountUnitValue)[keyof typeof StateAmountUnitValue];

/**
 * Where the employee lives relative to where they work.
 *
 * Stated by the caller, never inferred by comparing two jurisdiction codes:
 * part-year and non-resident status turn on facts about the year that a code
 * comparison cannot see.
 */
export const ResidencyStatus = {
  RESIDENT: 'RESIDENT',
  NONRESIDENT: 'NONRESIDENT',
  PART_YEAR_RESIDENT: 'PART_YEAR_RESIDENT',
} as const;

export type ResidencyStatus = (typeof ResidencyStatus)[keyof typeof ResidencyStatus];

/** Which side of the residence/work relationship a rule set speaks for. */
export const StateRole = {
  WORK: 'WORK',
  RESIDENCE: 'RESIDENCE',
} as const;

export type StateRole = (typeof StateRole)[keyof typeof StateRole];

/**
 * One work jurisdiction and the share of wages attributed to it.
 *
 * A LIST BY DESIGN, LENGTH 1 BY RULE (D5-04). Multi-state allocation is real
 * and out of Phase 5 scope, so the shape admits it while the engine refuses
 * it: a second entry becomes UNSUPPORTED_SCENARIO rather than being silently
 * ignored or averaged. Modelling it as a scalar now would force a breaking
 * change later; accepting more than one now would mean answering a question
 * nobody has specified.
 */
export interface StateWorkJurisdiction {
  readonly jurisdictionCode: string;
  /** Share of wages attributed here, as a decimal fraction string. */
  readonly allocation: DecimalString;
}

/** The single supported work-jurisdiction count for Phase 5 (D5-04). */
export const SUPPORTED_WORK_JURISDICTION_COUNT = 1;

/**
 * YTD figures from THIS employer, EXCLUDING the current pay period.
 *
 * ===========================================================================
 * THE CONVENTION IS THE SAME ONE PHASE 4 ESTABLISHED (D-SS-1), AND IT IS NOT
 * REINTERPRETED HERE.
 *
 * Wage-base arithmetic reads `remaining = max(base − ytd, 0)` and then
 * `taxable = min(periodWages, remaining)`. That is correct ONLY on the
 * excluding convention; on the including convention it would double-count the
 * current cheque and under-tax every employee crossing a base mid-year.
 * ===========================================================================
 */
export interface StateYtd {
  readonly stateIncomeTaxWages: DecimalString;
  readonly stateIncomeTaxWithheld: DecimalString;
  readonly sdiWages: DecimalString;
  readonly sdiContributions: DecimalString;
  readonly pfmlWages: DecimalString;
  readonly pfmlContributions: DecimalString;
  readonly sutaWages: DecimalString;
  /** True when the caller supplied nothing and zero was assumed. Must be disclosed. */
  readonly assumedZero: boolean;
}

/**
 * The four independent state taxable-wage buckets.
 *
 * `null` means the bucket COULD NOT BE DETERMINED — a deduction's treatment for
 * it is unknown or NOT_STATED. It is never zero and never a fallback: every
 * programme that reads a null bucket reports INCOMPLETE instead of producing a
 * figure. Zeroing one would understate wages and silently under-withhold.
 */
export type StateWageBuckets = Readonly<Record<StateBucket, DecimalString | null>>;

/**
 * One pre-tax deduction/benefit line for a pay period, under the
 * context-driven taxability architecture (Task 4B, Option A).
 *
 * Kept to exactly the two fields the wage-bucket derivation needs.
 * `amount` stays a `DecimalString` at this boundary, matching every other
 * amount field on `StateCalculationContext` (`wages`, `StateYtd`) — never
 * `Money` here; a pure calculation module converts it once, at its own
 * boundary, exactly as `applyStateWageBase` already does for wages.
 */
export interface StateDeductionLine {
  /** Matches a key in `StateCalculationContext.taxabilityProfiles`. */
  readonly deductionTypeKey: string;
  readonly amount: DecimalString;
}

/** One state amount, or an explained absence. NEVER defaulted to "0". */
export interface StateAmount {
  readonly code: string;
  readonly label: string;
  readonly amount: DecimalString | null;
  readonly status: CalculationStatus;
  readonly problem?: StateUnavailable;
  readonly rules: readonly RuleReference[];
}

/** One programme's outcome, on one side of the payroll. */
export interface StateComponentResult {
  readonly program: StateProgram;
  readonly jurisdictionCode: string;
  readonly role: StateRole;
  readonly amount: StateAmount;
  /** The bucket this component was computed on, for the trace. */
  readonly bucket: StateBucket;
}

/**
 * EMPLOYEE BRANCH. Net pay is computed from this and nothing else.
 *
 * Structurally separate from the employer branch so that an employer cost
 * cannot reach take-home pay by accident. The separation is a TYPE boundary,
 * not a naming convention: there is no field here an employer figure could be
 * assigned to, and a guard test asserts no employer-coded amount appears.
 */
export interface StateEmployeeResult {
  readonly incomeTaxWithheld: StateAmount;
  readonly supplementalWithheld: StateAmount;
  readonly sdiEmployee: StateAmount;
  readonly pfmlEmployee: StateAmount;
  readonly sutaEmployee: StateAmount;
  readonly totalEmployeeStateTaxes: StateAmount;
  readonly components: readonly StateComponentResult[];
}

/** EMPLOYER BRANCH. Never reaches net pay. */
export interface StateEmployerResult {
  readonly sdiEmployer: StateAmount;
  readonly pfmlEmployer: StateAmount;
  readonly sutaEmployer: StateAmount;
  readonly totalEmployerStateTaxes: StateAmount;
  readonly components: readonly StateComponentResult[];
  readonly disclosures: readonly string[];
}

export interface StateDisclosure {
  readonly code: string;
  readonly message: string;
}

/** What the engine did, and under which declared methodology. */
export interface StateMethodology {
  readonly withholdingMethod: string | null;
  readonly supplementalTreatment: string | null;
  readonly roundingPolicyId: string | null;
}

export interface StateTaxResult {
  readonly status: CalculationStatus;
  readonly engineVersion: string;
  readonly taxYear: number;
  readonly effectiveDate: string;
  readonly workJurisdictionCode: string;
  readonly residenceJurisdictionCode: string;
  readonly residencyStatus: ResidencyStatus;
  readonly methodology: StateMethodology;
  readonly buckets: StateWageBuckets;
  readonly employee: StateEmployeeResult;
  /** `null` when employer taxes were not requested. */
  readonly employer: StateEmployerResult | null;
  readonly disclosures: readonly StateDisclosure[];
  readonly ruleReferences: readonly RuleReference[];
  readonly sourceIds: readonly string[];
  readonly issues: readonly StateUnavailable[];
  /** Machine-readable gaps for admin tooling and the coverage model. */
  readonly missingRules: readonly StateMissingRuleIssue[];
}

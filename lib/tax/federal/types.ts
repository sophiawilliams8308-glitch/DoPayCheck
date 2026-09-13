import type { PayFrequency } from '@/lib/db/generated/client';
import type { CalculationStatus } from '@/lib/calculator/types/status';
import type { RuleReference } from '@/lib/calculator/types/rules';

import type { FederalTraceEntry } from './trace/federal-trace';

import type { FederalUnavailable } from './errors/federal-errors';
import type { FederalFeatureFlags } from './flags';
import type { FederalRoundingPolicy } from './rounding/federal-rounding';
import type { ResolvedFederalRuleSet } from './rules/resolved-rule-set';

/**
 * Federal engine types (Phase 4).
 *
 * Money crosses every boundary as an exact decimal STRING, matching Phase 3. A JS `number`
 * may already have lost precision before the engine sees it.
 */

export type DecimalString = string;

/** W-4 revision the employee's form belongs to. Methodologies differ, and never blend. */
export const W4Revision = {
  /** Pre-2020 form: allowances, Worksheet 1A lines 1j–1l. */
  PRE_2020: 'PRE_2020',
  /** 2020 redesign onward: Steps 2–4. */
  REVISION_2020_PLUS: 'REVISION_2020_PLUS',
} as const;

export type W4Revision = (typeof W4Revision)[keyof typeof W4Revision];

/**
 * The federal view of the W-4, derived from the Phase 3 `W4Input`.
 *
 * This is an ADAPTER, not a second W-4 model. Phase 3 owns the input contract; the federal
 * engine renames its fields to worksheet vocabulary internally so the code reads like the
 * published form, without forcing Phase 3 to adopt IRS line numbers.
 */
export interface FederalW4 {
  readonly revision: W4Revision;
  readonly filingStatus: string;
  /** Step 2 checkbox — "two jobs total". Phase 3 field: `multipleJobs`. */
  readonly step2MultipleJobsChecked: boolean;
  /** Step 3 annual credits. Phase 3 field: `dependentsAmount`. */
  readonly step3CreditsAnnual: DecimalString | null;
  /** Step 4(a) annual other income. Phase 3 field: `otherIncome`. */
  readonly step4aOtherIncomeAnnual: DecimalString | null;
  /** Step 4(b) annual deductions. Phase 3 field: `deductionsAmount`. */
  readonly step4bDeductionsAnnual: DecimalString | null;
  /** Step 4(c) extra withholding PER PAY PERIOD. Phase 3 field: `additionalWithholding`. */
  readonly step4cExtraPerPeriod: DecimalString | null;
  /** Employee claims exemption from withholding. */
  readonly claimsExemption: boolean;
  readonly isNonresidentAlien: boolean;
  /** Pre-2020 only: number of allowances claimed. */
  readonly pre2020Allowances: number | null;
}

/** Wages for the current pay period, split by federal treatment. */
export interface FederalPeriodWages {
  /** Regular wages subject to Worksheet 1A. */
  readonly regular: DecimalString;
  /** Supplemental wages (bonus, commission) handled by the supplemental path. */
  readonly supplemental: DecimalString;
  /** Reported tips. Subject to FICA; never a wage-bucket reduction. */
  readonly tips: DecimalString;
  /** Qualified overtime under OBBBA. Subject to FICA; never a wage-bucket reduction. */
  readonly qualifiedOvertime: DecimalString;
}

/**
 * Year-to-date figures.
 *
 * CONVENTION (D-SS-1): these EXCLUDE the current pay period. Wage-base and threshold logic
 * therefore reads "how much room is left before this cheque", which is what makes
 * `min(base − ytd, currentPeriod)` correct.
 */
export interface FederalYtd {
  readonly socialSecurityWages: DecimalString;
  readonly medicareWages: DecimalString;
  readonly futaWages: DecimalString;
  readonly federalWithholding: DecimalString;
}

/** Federal-relevant taxable wage buckets for this period. */
export interface FederalWageBuckets {
  readonly federalIncomeTaxWages: DecimalString;
  readonly socialSecurityWages: DecimalString;
  readonly medicareWages: DecimalString;
  readonly futaWages: DecimalString;
}

/** Everything Stage B needs. Pure input — no client, no clock, no environment. */
export interface FederalCalculationContext {
  readonly taxYear: number;
  /** ISO instant. Supplied by the caller; the engine never reads a clock. */
  readonly effectiveDate: string;
  readonly payFrequency: PayFrequency;
  /** Resolved by the caller so Stage B performs no frequency policy decisions. */
  readonly periodsPerYear: number;
  readonly w4: FederalW4;
  readonly wages: FederalPeriodWages;
  readonly buckets: FederalWageBuckets;
  readonly ytd: FederalYtd;
  readonly ruleSet: ResolvedFederalRuleSet;
  readonly rounding: FederalRoundingPolicy;
  readonly flags: FederalFeatureFlags;
  /** Whether the caller wants the Track A display-only estimate. */
  readonly includeAnnualEstimate: boolean;
  /** Whether the caller wants Track D employer liabilities. */
  readonly includeEmployerTaxes: boolean;
}

/** One federal amount, or an explained absence. NEVER defaulted to "0". */
export interface FederalAmount {
  readonly code: string;
  readonly label: string;
  readonly amount: DecimalString | null;
  readonly status: CalculationStatus;
  readonly problem?: FederalUnavailable;
  readonly rules: readonly RuleReference[];
}

/** Worksheet 1A line-level intermediates, retained for traceability. */
export type WorksheetLines = Readonly<Record<string, DecimalString | null>>;

export interface FederalWithholdingResult {
  readonly method: 'PUB15T_WORKSHEET_1A' | 'SUPPLEMENTAL' | 'NONE';
  readonly regular: FederalAmount;
  readonly supplemental: FederalAmount;
  /** Step 4(c) extra, preserved separately so it is never silently absorbed or discarded. */
  readonly extraPerPeriod: FederalAmount;
  readonly total: FederalAmount;
  readonly worksheetLines: WorksheetLines;
}

export interface FederalFicaResult {
  readonly socialSecurityEmployee: FederalAmount;
  readonly medicareEmployee: FederalAmount;
  readonly additionalMedicareEmployee: FederalAmount;
}

export interface FederalEmployerResult {
  readonly socialSecurityEmployer: FederalAmount;
  readonly medicareEmployer: FederalAmount;
  readonly futa: FederalAmount;
  readonly total: FederalAmount;
}

export interface FederalAnnualEstimate {
  /** DISPLAY ONLY. This must never be used as a withholding amount. */
  readonly displayOnly: true;
  readonly liability: FederalAmount;
  readonly taxableIncome: FederalAmount;
}

/** A statement the UI must show alongside a result, e.g. "estimate only". */
export interface FederalDisclosure {
  readonly code: string;
  readonly message: string;
}

export interface FederalCalculationResult {
  readonly status: CalculationStatus;
  readonly engineVersion: string;
  readonly taxYear: number;
  readonly effectiveDate: string;
  readonly methodology: string;
  readonly buckets: FederalWageBuckets;
  /** Track B. */
  readonly withholding: FederalWithholdingResult;
  /** Track C. */
  readonly fica: FederalFicaResult;
  /** Track D. Null when the caller did not request employer taxes. */
  readonly employer: FederalEmployerResult | null;
  /** Track A. Null when the caller did not request the estimate. */
  readonly annualEstimate: FederalAnnualEstimate | null;
  readonly disclosures: readonly FederalDisclosure[];
  readonly flags: FederalFeatureFlags;
  readonly ruleReferences: readonly RuleReference[];
  readonly sourceIds: readonly string[];
  readonly trace: readonly FederalTraceEntry[];
  readonly issues: readonly FederalUnavailable[];
}

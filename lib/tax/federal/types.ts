import type { CalculationStatus } from '@/lib/calculator/types/status';
import type { RuleReference } from '@/lib/calculator/types/rules';

import type { FederalUnavailable, MissingRuleIssue } from './errors/federal-errors';
import type { FederalFeatureFlags } from './flags';
import type { FederalRoundingPolicy } from './rounding/federal-rounding';
import type { ResolvedFederalRuleSet } from './rules/resolved-rule-set';
import type { FederalTraceEntry } from './trace/federal-trace';
import type { SupplementalMethod } from './fit/supplemental';
import type { DeductionTaxabilityProfile, FederalDeductionLine } from './wages/federalWageBuckets';

/**
 * Federal engine types — spec §17.1 result contract.
 *
 * Money crosses every boundary as an exact decimal STRING: a JS `number` may
 * already have lost precision before the engine sees it.
 */

export type DecimalString = string;

/** W-4 revision. The two use DIFFERENT methodologies and never blend (§7.1). */
export const W4Revision = {
  PRE_2020: 'PRE_2020',
  REVISION_2020_PLUS: 'REVISION_2020_PLUS',
} as const;

export type W4RevisionValue = (typeof W4Revision)[keyof typeof W4Revision];

/**
 * UNITS DISCIPLINE (§7.3).
 *
 * Steps 3, 4(a), 4(b), line 1g and the allowance value are ANNUAL. Step 4(c) is
 * PER PAY PERIOD. Mixing them is the most common bug in this area, so the two
 * are branded types: passing one where the other is expected is a COMPILE
 * ERROR, not a naming convention.
 */
declare const annualBrand: unique symbol;
declare const perPeriodBrand: unique symbol;

export type AnnualAmount = DecimalString & { readonly [annualBrand]: 'ANNUAL' };
export type PerPeriodAmount = DecimalString & { readonly [perPeriodBrand]: 'PER_PERIOD' };

export function asAnnual(value: DecimalString): AnnualAmount {
  return value as AnnualAmount;
}

export function asPerPeriod(value: DecimalString): PerPeriodAmount {
  return value as PerPeriodAmount;
}

/**
 * The federal view of the W-4 (§7.1, §7.2).
 *
 * An ADAPTER over Phase 3's `W4Input`, not a second model: Phase 3 owns the
 * input contract, and this renames its fields to worksheet vocabulary so the
 * withholding code reads like the published form (D-W4-1).
 */
export interface FederalW4 {
  readonly revision: W4RevisionValue;
  readonly filingStatus: string;
  /** Step 2(c) checkbox: selects the STEP2_CHECKBOX schedule and zeroes line 1g. */
  readonly step2MultipleJobsChecked: boolean;
  readonly step3CreditsAnnual: AnnualAmount | null;
  readonly step4aOtherIncomeAnnual: AnnualAmount | null;
  readonly step4bDeductionsAnnual: AnnualAmount | null;
  /** PER PAY PERIOD — must never be divided by pay periods (§11.2). */
  readonly step4cExtraPerPeriod: PerPeriodAmount | null;
  /** New 2026 checkbox below Step 4(c) (§5.5). */
  readonly claimsExemption: boolean;
  readonly isNonresidentAlien: boolean;
  /** 2019-or-earlier forms only. */
  readonly pre2020Allowances: number | null;
}

export interface FederalPeriodWages {
  readonly regular: DecimalString;
  readonly supplemental: DecimalString;
  /** Ordinary wages for all four buckets (§19.5). */
  readonly tips: DecimalString;
  /** Ordinary wages for all four buckets. OBBBA relief runs via Step 4(b). */
  readonly qualifiedOvertime: DecimalString;
}

/**
 * YTD figures — from THIS employer, EXCLUDING the current period (§13.4/§16.2).
 *
 * Defaulting to zero is permitted but must be DISCLOSED in the trace: a silent
 * zero would misstate mid-year and high-earner paychecks.
 */
export interface FederalYtd {
  readonly socialSecurityWages: DecimalString;
  readonly medicareWages: DecimalString;
  readonly futaWages: DecimalString;
  readonly supplementalWages: DecimalString;
  /** True when the caller supplied nothing and zero was assumed. */
  readonly assumedZero: boolean;
}

/**
 * The four independent federal wage buckets (§12).
 *
 * `null` means the bucket COULD NOT BE DETERMINED — a deduction's treatment for
 * it is unknown or NOT_STATED. It is never zero and never a fallback: every tax
 * that reads a null bucket reports INCOMPLETE instead of producing a figure
 * (§12.2). Zeroing a bucket here would understate wages and silently under-
 * withhold, with no visible symptom.
 */
export interface FederalWageBuckets {
  readonly federalIncomeTaxWages: DecimalString | null;
  readonly socialSecurityWages: DecimalString | null;
  readonly medicareWages: DecimalString | null;
  readonly futaWages: DecimalString | null;
}

/** Everything Stage B needs. Pure input — no client, no clock, no environment. */
export interface FederalCalculationContext {
  readonly taxYear: number;
  /** ISO instant, supplied by the caller. The engine never reads a clock. */
  readonly effectiveDate: string;
  readonly payFrequency: string;
  readonly w4: FederalW4;
  readonly wages: FederalPeriodWages;
  readonly deductions: readonly FederalDeductionLine[];
  readonly taxabilityProfiles: Readonly<Record<string, DeductionTaxabilityProfile>>;
  readonly ytd: FederalYtd;
  readonly ruleSet: ResolvedFederalRuleSet;
  readonly flags: FederalFeatureFlags;
  /** Explicit employer election — never inferred (§5.6). */
  readonly supplementalMethod: SupplementalMethod;
  /** §5.6 rule 2 eligibility condition for the optional flat method. */
  readonly federalIncomeTaxWithheldFromRegularWagesCurrentOrPriorYear: boolean;
  /** §18.7 — the statutory employer tests cannot be evaluated here. */
  readonly employerSubjectToFuta: boolean;
  readonly includeAnnualEstimate: boolean;
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

export type WorksheetLines = Readonly<Record<string, DecimalString | null>>;

/** §17.1 — employee branch. Net pay is computed from this and nothing else. */
export interface FederalEmployeeResult {
  readonly federalIncomeTaxWithheld: FederalAmount;
  readonly supplementalWithheld: FederalAmount;
  readonly socialSecurityEmployee: FederalAmount;
  readonly medicareEmployee: FederalAmount;
  readonly additionalMedicareEmployee: FederalAmount;
  readonly totalEmployeeFederalTaxes: FederalAmount;
}

/** §17.1 — employer branch. Never reaches net pay. */
export interface FederalEmployerResult {
  readonly socialSecurityEmployer: FederalAmount;
  readonly medicareEmployer: FederalAmount;
  readonly futaEmployer: FederalAmount;
  readonly totalEmployerFederalTaxes: FederalAmount;
  readonly disclosures: readonly string[];
}

/** §17.1 — Track A. Display only; `available: false` never fails the paycheck. */
export interface FederalEstimates {
  readonly isEstimate: true;
  readonly available: boolean;
  readonly annualFederalIncomeTaxEstimate: DecimalString | null;
  readonly effectiveFederalRateEstimate: DecimalString | null;
  readonly taxableIncome: DecimalString | null;
  readonly limitations: readonly string[];
  readonly unavailableReason: string | null;
}

export interface FederalDisclosure {
  readonly code: string;
  readonly message: string;
}

export interface FederalCalculationResult {
  readonly status: CalculationStatus;
  readonly engineVersion: string;
  readonly taxYear: number;
  readonly effectiveDate: string;
  readonly methodology: {
    readonly fitMethod: string;
    readonly supplementalMethod: SupplementalMethod | null;
    readonly roundingPolicy: FederalRoundingPolicy | null;
  };
  readonly buckets: FederalWageBuckets;
  readonly worksheetLines: WorksheetLines;
  readonly employee: FederalEmployeeResult;
  readonly employer: FederalEmployerResult | null;
  readonly estimates: FederalEstimates | null;
  readonly disclosures: readonly FederalDisclosure[];
  readonly flags: FederalFeatureFlags;
  readonly ruleReferences: readonly RuleReference[];
  readonly sourceIds: readonly string[];
  readonly trace: readonly FederalTraceEntry[];
  readonly issues: readonly FederalUnavailable[];
  /** Machine-readable gaps for admin tooling and the coverage gate (§28.2). */
  readonly missingRules: readonly MissingRuleIssue[];
}

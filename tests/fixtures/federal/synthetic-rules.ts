import type { RuleReference } from '@/lib/calculator/types/rules';
import { FederalRuleKey } from '@/lib/tax/federal/rule-keys';
import type {
  FederalRuleEntry,
  ResolvedFederalRuleSet,
} from '@/lib/tax/federal/rules/resolved-rule-set';
import {
  Taxability,
  type DeductionTaxabilityProfile,
} from '@/lib/tax/federal/wages/federalWageBuckets';

/**
 * SYNTHETIC — NOT TAX DATA.
 *
 * ===========================================================================
 * READ THIS BEFORE USING ANY NUMBER BELOW (spec §33.5).
 *
 * Every value here is INVENTED to exercise arithmetic and control flow. None is
 * an IRS figure, none is verified, and none may reach production, a seed, a
 * migration, or a fixture presented as authoritative.
 *
 * The numbers are chosen to be obviously fake — round rates like ten percent, a
 * wage base of 1000, tax year 2099 — precisely so a real figure can never be
 * mistaken for one of these, and so a test that accidentally asserted a
 * real-world amount would stand out.
 *
 * Official IRS worked examples remain PENDING DATA (Appendix A-40). When they
 * arrive they go in the golden registry, not here.
 * ===========================================================================
 */

export const SYNTHETIC = true;
export const SYNTHETIC_TAX_YEAR = 2099;
export const SYNTHETIC_EFFECTIVE_DATE = '2099-06-15T00:00:00.000Z';
export const SYNTHETIC_ENGINE_VERSION = 'synthetic-engine';

export function syntheticReference(
  key: string,
  overrides: Partial<RuleReference> = {},
): RuleReference {
  return {
    ruleId: `synthetic-${key}`,
    ruleKey: key,
    version: 1,
    category: 'FEDERAL_WITHHOLDING',
    taxYear: SYNTHETIC_TAX_YEAR,
    jurisdictionId: 'synthetic-us',
    jurisdictionCode: 'US',
    effectiveFrom: new Date('2099-01-01T00:00:00.000Z'),
    effectiveTo: null,
    sourceIds: [`synthetic-source-${key}`],
    verified: true,
    ...overrides,
  };
}

// --- synthetic details, all values invented ---------------------------------

/** Ten percent over 100, with a 200 line-1g amount for the single status. */
export const syntheticStandardSchedule = {
  shape: 'WITHHOLDING_SCHEDULE' as const,
  method: 'PERCENTAGE_AUTOMATED' as const,
  scheduleType: 'STANDARD' as const,
  payPeriodBasis: 'ANNUAL' as const,
  schedules: [
    {
      filingStatus: 'SINGLE_OR_MFS' as const,
      rows: [
        {
          rowOrder: 0,
          atLeast: '0',
          lessThan: '100',
          baseAmount: '0',
          rate: '0',
          unit: 'PERCENT' as const,
        },
        {
          rowOrder: 1,
          atLeast: '100',
          lessThan: null,
          baseAmount: '0',
          rate: '10',
          unit: 'PERCENT' as const,
        },
      ],
    },
    {
      filingStatus: 'MARRIED_FILING_JOINTLY' as const,
      rows: [
        {
          rowOrder: 0,
          atLeast: '0',
          lessThan: null,
          baseAmount: '0',
          rate: '5',
          unit: 'PERCENT' as const,
        },
      ],
    },
  ],
};

export const syntheticStep2Schedule = {
  shape: 'WITHHOLDING_SCHEDULE' as const,
  method: 'PERCENTAGE_AUTOMATED' as const,
  scheduleType: 'STEP2_CHECKBOX' as const,
  payPeriodBasis: 'ANNUAL' as const,
  schedules: [
    {
      filingStatus: 'SINGLE_OR_MFS' as const,
      rows: [
        {
          rowOrder: 0,
          atLeast: '0',
          lessThan: '50',
          baseAmount: '0',
          rate: '0',
          unit: 'PERCENT' as const,
        },
        {
          rowOrder: 1,
          atLeast: '50',
          lessThan: null,
          baseAmount: '0',
          rate: '20',
          unit: 'PERCENT' as const,
        },
      ],
    },
  ],
};

export const syntheticStep2Adjustment = {
  shape: 'AMOUNT_BY_FILING_STATUS' as const,
  amounts: [
    { filingStatus: 'SINGLE_OR_MFS' as const, amount: '200' },
    { filingStatus: 'MARRIED_FILING_JOINTLY' as const, amount: '400' },
    // Deliberately NOT_STATED, to exercise the honest-refusal path.
    { filingStatus: 'HEAD_OF_HOUSEHOLD' as const, amount: null },
  ],
};

export const syntheticAllowanceValue = { shape: 'SCALAR_AMOUNT' as const, amount: '50' };

export const syntheticPayPeriods = {
  shape: 'COUNT_BY_PAY_PERIOD' as const,
  counts: [
    { payFrequency: 'WEEKLY', count: 52 },
    { payFrequency: 'BIWEEKLY', count: 26 },
    { payFrequency: 'SEMIMONTHLY', count: 24 },
    { payFrequency: 'MONTHLY', count: 12 },
    { payFrequency: 'QUARTERLY', count: 4 },
    { payFrequency: 'DAILY', count: 260 },
    // V-05: no official factor published, so the engine must refuse.
    { payFrequency: 'ANNUAL', count: null },
  ],
};

export const syntheticRoundingPolicy = {
  shape: 'POLICY' as const,
  policyId: 'synthetic-rounding',
  currencyScale: 2,
  currencyMode: 'HALF_UP' as const,
  intermediateScale: 12,
  appliedAt: 'TAX_LEVEL' as const,
};

const rate = (value: string | null, appliesTo: 'EMPLOYEE' | 'EMPLOYER') => ({
  shape: 'RATE' as const,
  rate: value,
  unit: 'PERCENT' as const,
  appliesTo,
});

export const syntheticSsEmployeeRate = rate('10', 'EMPLOYEE');
export const syntheticSsEmployerRate = rate('10', 'EMPLOYER');
export const syntheticSsWageBase = {
  shape: 'WAGE_BASE' as const,
  amount: '1000',
  basis: 'ANNUAL' as const,
  applicability: 'APPLIES' as const,
};

export const syntheticMedicareEmployeeRate = rate('2', 'EMPLOYEE');
export const syntheticMedicareEmployerRate = rate('2', 'EMPLOYER');
/** §14.3 — the explicit NOT_APPLICABLE record that makes "uncapped" data-driven. */
export const syntheticMedicareWageBase = {
  shape: 'WAGE_BASE' as const,
  amount: null,
  basis: 'ANNUAL' as const,
  applicability: 'NOT_APPLICABLE' as const,
};
/** A capped Medicare fixture, to prove the cap path is data-driven (§14.4 case 4). */
export const syntheticMedicareWageBaseCapped = {
  shape: 'WAGE_BASE' as const,
  amount: '500',
  basis: 'ANNUAL' as const,
  applicability: 'APPLIES' as const,
};

export const syntheticAddlMedicareRate = rate('1', 'EMPLOYEE');
export const syntheticAddlMedicareThreshold = {
  shape: 'THRESHOLD' as const,
  amount: '2000',
  basis: 'ANNUAL_YTD' as const,
  /** V-02 unresolved — surfaced as a disclosure, never guessed. */
  inclusive: null,
};

export const syntheticFutaGrossRate = rate('10', 'EMPLOYER');
export const syntheticFutaStandardCredit = rate('4', 'EMPLOYER');
export const syntheticFutaWageBase = {
  shape: 'WAGE_BASE' as const,
  amount: '700',
  basis: 'ANNUAL' as const,
  applicability: 'APPLIES' as const,
};

export const syntheticSuppOptionalFlat = rate('20', 'EMPLOYEE');
export const syntheticSuppMandatoryFlat = rate('40', 'EMPLOYEE');
export const syntheticSuppThreshold = {
  shape: 'THRESHOLD' as const,
  amount: '1000',
  basis: 'ANNUAL_YTD' as const,
  inclusive: false,
};

export const syntheticAnnualStandardDeduction = {
  shape: 'AMOUNT_BY_FILING_STATUS' as const,
  amounts: [
    { filingStatus: 'SINGLE_OR_MFS' as const, amount: '500' },
    { filingStatus: 'MARRIED_FILING_JOINTLY' as const, amount: '1000' },
    // Head of Household is PENDING DATA (§4.3) — Track A must not borrow.
  ],
};

export const syntheticAnnualPersonalExemption = {
  shape: 'SCALAR_AMOUNT' as const,
  amount: '100',
};

export const syntheticAnnualBrackets = {
  shape: 'BRACKET_TABLE' as const,
  bracketSets: [
    {
      filingStatus: 'SINGLE_OR_MFS' as const,
      brackets: [
        { rowOrder: 0, atLeast: '0', lessThan: '1000', rate: '10', unit: 'PERCENT' as const },
        { rowOrder: 1, atLeast: '1000', lessThan: null, rate: '20', unit: 'PERCENT' as const },
      ],
    },
  ],
};

const DETAILS: Record<string, unknown> = {
  [FederalRuleKey.FIT_RATE_SCHEDULE_STANDARD]: syntheticStandardSchedule,
  [FederalRuleKey.FIT_RATE_SCHEDULE_STEP2]: syntheticStep2Schedule,
  [FederalRuleKey.FIT_STEP2_UNCHECKED_ADJUSTMENT]: syntheticStep2Adjustment,
  [FederalRuleKey.FIT_ALLOWANCE_VALUE]: syntheticAllowanceValue,
  [FederalRuleKey.FIT_PAY_PERIODS_PER_YEAR]: syntheticPayPeriods,
  [FederalRuleKey.FIT_ROUNDING_POLICY]: syntheticRoundingPolicy,
  [FederalRuleKey.SUPP_OPTIONAL_FLAT_RATE]: syntheticSuppOptionalFlat,
  [FederalRuleKey.SUPP_MANDATORY_FLAT_RATE]: syntheticSuppMandatoryFlat,
  [FederalRuleKey.SUPP_MANDATORY_THRESHOLD]: syntheticSuppThreshold,
  [FederalRuleKey.SS_EMPLOYEE_RATE]: syntheticSsEmployeeRate,
  [FederalRuleKey.SS_EMPLOYER_RATE]: syntheticSsEmployerRate,
  [FederalRuleKey.SS_WAGE_BASE]: syntheticSsWageBase,
  [FederalRuleKey.MEDICARE_EMPLOYEE_RATE]: syntheticMedicareEmployeeRate,
  [FederalRuleKey.MEDICARE_EMPLOYER_RATE]: syntheticMedicareEmployerRate,
  [FederalRuleKey.MEDICARE_WAGE_BASE]: syntheticMedicareWageBase,
  [FederalRuleKey.ADDL_MEDICARE_EMPLOYEE_RATE]: syntheticAddlMedicareRate,
  [FederalRuleKey.ADDL_MEDICARE_WITHHOLDING_THRESHOLD]: syntheticAddlMedicareThreshold,
  [FederalRuleKey.FUTA_GROSS_RATE]: syntheticFutaGrossRate,
  [FederalRuleKey.FUTA_STANDARD_CREDIT]: syntheticFutaStandardCredit,
  [FederalRuleKey.FUTA_WAGE_BASE]: syntheticFutaWageBase,
  [FederalRuleKey.ANNUAL_STANDARD_DEDUCTION]: syntheticAnnualStandardDeduction,
  [FederalRuleKey.ANNUAL_PERSONAL_EXEMPTION]: syntheticAnnualPersonalExemption,
  [FederalRuleKey.ANNUAL_RATE_BRACKETS]: syntheticAnnualBrackets,
};

/** Deduction taxability profiles with DELIBERATELY DIFFERENT bucket flags. */
export const SYNTHETIC_PROFILES: Readonly<Record<string, DeductionTaxabilityProfile>> = {
  // Reduces income tax wages only — the classic FICA trap.
  SYNTHETIC_DEFERRAL: {
    deductionTypeKey: 'SYNTHETIC_DEFERRAL',
    reducesFederalIncomeTaxWages: Taxability.TRUE,
    reducesSocialSecurityWages: Taxability.FALSE,
    reducesMedicareWages: Taxability.FALSE,
    reducesFutaWages: Taxability.FALSE,
    ruleId: 'synthetic-profile-deferral',
    sourceIds: ['synthetic-source-profile'],
  },
  // Four DIFFERENT flags, proving buckets are independent (§19.3).
  SYNTHETIC_MIXED: {
    deductionTypeKey: 'SYNTHETIC_MIXED',
    reducesFederalIncomeTaxWages: Taxability.TRUE,
    reducesSocialSecurityWages: Taxability.TRUE,
    reducesMedicareWages: Taxability.FALSE,
    reducesFutaWages: Taxability.TRUE,
    ruleId: 'synthetic-profile-mixed',
    sourceIds: ['synthetic-source-profile'],
  },
  // A gap the engine must refuse rather than assume away.
  SYNTHETIC_UNSTATED: {
    deductionTypeKey: 'SYNTHETIC_UNSTATED',
    reducesFederalIncomeTaxWages: Taxability.TRUE,
    reducesSocialSecurityWages: Taxability.NOT_STATED,
    reducesMedicareWages: Taxability.TRUE,
    reducesFutaWages: Taxability.TRUE,
    ruleId: 'synthetic-profile-unstated',
    sourceIds: ['synthetic-source-profile'],
  },
  // Post-tax: reduces nothing (§12.6 case 5).
  SYNTHETIC_POST_TAX: {
    deductionTypeKey: 'SYNTHETIC_POST_TAX',
    reducesFederalIncomeTaxWages: Taxability.FALSE,
    reducesSocialSecurityWages: Taxability.FALSE,
    reducesMedicareWages: Taxability.FALSE,
    reducesFutaWages: Taxability.FALSE,
    ruleId: 'synthetic-profile-post-tax',
    sourceIds: ['synthetic-source-profile'],
  },
};

export interface SyntheticRuleSetOptions {
  readonly omit?: readonly string[];
  readonly unverified?: readonly string[];
  readonly conflicted?: readonly string[];
  readonly overrides?: Readonly<Record<string, unknown>>;
}

/** Assembles a frozen synthetic rule set. Every value inside is invented. */
export function syntheticRuleSet(options: SyntheticRuleSetOptions = {}): ResolvedFederalRuleSet {
  const omit = new Set(options.omit ?? []);
  const unverified = new Set(options.unverified ?? []);
  const conflicted = new Set(options.conflicted ?? []);
  const overrides = options.overrides ?? {};

  const entries: Record<string, FederalRuleEntry> = {};
  const references: RuleReference[] = [];

  for (const [key, detail] of Object.entries(DETAILS)) {
    if (omit.has(key)) {
      continue;
    }
    if (conflicted.has(key)) {
      entries[key] = {
        available: false,
        problem: {
          reason: 'RULE_CONFLICT',
          ruleKey: key,
          detail: '2 ACTIVE rules apply simultaneously (synthetic)',
        },
      };
      continue;
    }
    const reference = syntheticReference(key);
    references.push(reference);
    entries[key] = {
      available: true,
      rule: {
        key: key as never,
        reference,
        detail: overrides[key] ?? detail,
        verificationStatus: unverified.has(key)
          ? 'PENDING'
          : key === FederalRuleKey.MEDICARE_WAGE_BASE
            ? 'NOT_APPLICABLE'
            : 'VERIFIED',
      },
    };
  }

  return {
    taxYear: SYNTHETIC_TAX_YEAR,
    effectiveDate: SYNTHETIC_EFFECTIVE_DATE,
    jurisdictionCode: 'US',
    engineVersion: SYNTHETIC_ENGINE_VERSION,
    resolvedAt: SYNTHETIC_EFFECTIVE_DATE,
    missing: [],
    entries: entries as ResolvedFederalRuleSet['entries'],
    ruleReferences: references,
    sourceIds: [...new Set(references.flatMap((reference) => reference.sourceIds))],
  };
}

import { DEFAULT_FEDERAL_FLAGS, withFlags } from '@/lib/tax/federal/flags';
import { FEDERAL_ROUNDING_V1 } from '@/lib/tax/federal/rounding/federal-rounding';
import type { ResolvedFederalRuleSet } from '@/lib/tax/federal/rules/resolved-rule-set';
import type {
  FederalCalculationContext,
  FederalW4,
  FederalWageBuckets,
  FederalYtd,
} from '@/lib/tax/federal/types';

import { syntheticRuleSet, SYNTHETIC_EFFECTIVE_DATE, SYNTHETIC_TAX_YEAR } from './synthetic-rules';

/** Context builder for federal engine tests. All values synthetic — never tax data. */

export const syntheticW4: FederalW4 = {
  revision: 'REVISION_2020_PLUS',
  filingStatus: 'SYNTHETIC_SINGLE',
  step2MultipleJobsChecked: false,
  step3CreditsAnnual: null,
  step4aOtherIncomeAnnual: null,
  step4bDeductionsAnnual: null,
  step4cExtraPerPeriod: null,
  claimsExemption: false,
  isNonresidentAlien: false,
  pre2020Allowances: null,
};

export const zeroYtd: FederalYtd = {
  socialSecurityWages: '0',
  medicareWages: '0',
  futaWages: '0',
  federalWithholding: '0',
};

export function buckets(amount: string): FederalWageBuckets {
  return {
    federalIncomeTaxWages: amount,
    socialSecurityWages: amount,
    medicareWages: amount,
    futaWages: amount,
  };
}

export interface ContextOverrides {
  readonly w4?: Partial<FederalW4>;
  readonly ruleSet?: ResolvedFederalRuleSet;
  readonly wageAmount?: string;
  readonly buckets?: FederalWageBuckets;
  readonly ytd?: Partial<FederalYtd>;
  readonly periodsPerYear?: number;
  readonly flags?: Partial<typeof DEFAULT_FEDERAL_FLAGS>;
  readonly includeAnnualEstimate?: boolean;
  readonly includeEmployerTaxes?: boolean;
}

export function context(overrides: ContextOverrides = {}): FederalCalculationContext {
  const wageAmount = overrides.wageAmount ?? '100';
  return {
    taxYear: SYNTHETIC_TAX_YEAR,
    effectiveDate: SYNTHETIC_EFFECTIVE_DATE,
    payFrequency: 'BIWEEKLY',
    periodsPerYear: overrides.periodsPerYear ?? 26,
    w4: { ...syntheticW4, ...overrides.w4 },
    wages: { regular: wageAmount, supplemental: '0', tips: '0', qualifiedOvertime: '0' },
    buckets: overrides.buckets ?? buckets(wageAmount),
    ytd: { ...zeroYtd, ...overrides.ytd },
    ruleSet: overrides.ruleSet ?? syntheticRuleSet(),
    rounding: FEDERAL_ROUNDING_V1,
    flags: overrides.flags === undefined ? DEFAULT_FEDERAL_FLAGS : withFlags(overrides.flags),
    includeAnnualEstimate: overrides.includeAnnualEstimate ?? false,
    includeEmployerTaxes: overrides.includeEmployerTaxes ?? true,
  };
}

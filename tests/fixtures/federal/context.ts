import { money } from '@/lib/core/money';

import {
  DEFAULT_FEDERAL_FLAGS,
  withFlags,
  type FederalFeatureFlags,
} from '@/lib/tax/federal/flags';
import { SupplementalMethod } from '@/lib/tax/federal/fit/supplemental';
import type { ResolvedFederalRuleSet } from '@/lib/tax/federal/rules/resolved-rule-set';
import type { FederalCalculationContext, FederalW4, FederalYtd } from '@/lib/tax/federal/types';
import { asAnnual, asPerPeriod } from '@/lib/tax/federal/types';
import type { FederalDeductionLine } from '@/lib/tax/federal/wages/federalWageBuckets';

import {
  SYNTHETIC_EFFECTIVE_DATE,
  SYNTHETIC_PROFILES,
  SYNTHETIC_TAX_YEAR,
  syntheticRuleSet,
} from './synthetic-rules';

/** Context builder for federal engine tests. All values synthetic. */

export const syntheticW4: FederalW4 = {
  revision: 'REVISION_2020_PLUS',
  filingStatus: 'SINGLE_OR_MFS',
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
  supplementalWages: '0',
  assumedZero: false,
};

export { asAnnual, asPerPeriod, SYNTHETIC_PROFILES };

export interface ContextOverrides {
  readonly w4?: Partial<FederalW4>;
  readonly ruleSet?: ResolvedFederalRuleSet;
  readonly regular?: string;
  readonly supplemental?: string;
  readonly tips?: string;
  readonly qualifiedOvertime?: string;
  readonly deductions?: readonly FederalDeductionLine[];
  readonly ytd?: Partial<FederalYtd>;
  readonly payFrequency?: string;
  readonly flags?: Partial<FederalFeatureFlags>;
  readonly supplementalMethod?: SupplementalMethod;
  readonly optionalFlatEligible?: boolean;
  readonly employerSubjectToFuta?: boolean;
  readonly includeAnnualEstimate?: boolean;
  readonly includeEmployerTaxes?: boolean;
}

export function deduction(
  id: string,
  deductionTypeKey: string,
  amount: string,
): FederalDeductionLine {
  return { id, deductionTypeKey, amount: money(amount) };
}

export function context(overrides: ContextOverrides = {}): FederalCalculationContext {
  return {
    taxYear: SYNTHETIC_TAX_YEAR,
    effectiveDate: SYNTHETIC_EFFECTIVE_DATE,
    payFrequency: overrides.payFrequency ?? 'BIWEEKLY',
    w4: { ...syntheticW4, ...overrides.w4 },
    wages: {
      regular: overrides.regular ?? '100',
      supplemental: overrides.supplemental ?? '0',
      tips: overrides.tips ?? '0',
      qualifiedOvertime: overrides.qualifiedOvertime ?? '0',
    },
    deductions: overrides.deductions ?? [],
    taxabilityProfiles: SYNTHETIC_PROFILES,
    ytd: { ...zeroYtd, ...overrides.ytd },
    ruleSet: overrides.ruleSet ?? syntheticRuleSet(),
    flags: overrides.flags === undefined ? DEFAULT_FEDERAL_FLAGS : withFlags(overrides.flags),
    supplementalMethod: overrides.supplementalMethod ?? SupplementalMethod.AGGREGATE,
    federalIncomeTaxWithheldFromRegularWagesCurrentOrPriorYear:
      overrides.optionalFlatEligible ?? false,
    employerSubjectToFuta: overrides.employerSubjectToFuta ?? true,
    includeAnnualEstimate: overrides.includeAnnualEstimate ?? false,
    includeEmployerTaxes: overrides.includeEmployerTaxes ?? true,
  };
}

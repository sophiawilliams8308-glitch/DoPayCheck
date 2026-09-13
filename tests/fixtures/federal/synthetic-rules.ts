import type { RuleReference } from '@/lib/calculator/types/rules';
import { FederalRuleKey } from '@/lib/tax/federal/rule-keys';
import type {
  FederalRuleEntry,
  ResolvedFederalRuleSet,
} from '@/lib/tax/federal/rules/resolved-rule-set';

/**
 * SYNTHETIC FEDERAL RULE FIXTURES — NOT TAX DATA.
 *
 * ===========================================================================
 * READ THIS BEFORE USING ANY NUMBER BELOW.
 *
 * Every value here is INVENTED to exercise arithmetic and control flow. None of it is an IRS
 * figure, none of it is verified, and none of it may ever reach production, a seed, a
 * migration or a fixture presented as authoritative.
 *
 * The numbers are chosen to be obviously fake — round rates like 0.1, a wage base of 1000 —
 * precisely so a real figure can never be confused for one of these, and so a test that
 * accidentally asserted a real-world amount would stand out immediately.
 *
 * Official IRS worked examples remain PENDING_DATA. When they arrive they replace these
 * fixtures in place: the shapes here are the shapes real data takes, so no architectural
 * change is needed to swap them in.
 * ===========================================================================
 */

export const SYNTHETIC = true;

/** A tax year far outside any real one, so a fixture can never look authoritative. */
export const SYNTHETIC_TAX_YEAR = 2099;
export const SYNTHETIC_EFFECTIVE_DATE = '2099-06-15T00:00:00.000Z';

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

function entry(key: string, detail: unknown, verificationStatus = 'VERIFIED'): FederalRuleEntry {
  return {
    available: true,
    rule: {
      key: key as FederalRuleKey,
      reference: syntheticReference(key),
      detail,
      verificationStatus,
    },
  };
}

/** Synthetic Worksheet 1A detail: a flat 10% over 100, plus a 200 standard amount. */
export const syntheticWorksheet1A = {
  methodology: 'PUB15T_WORKSHEET_1A' as const,
  standardDeductionAmounts: [
    { filingStatus: 'SYNTHETIC_SINGLE', amount: '200' },
    { filingStatus: 'SYNTHETIC_MARRIED', amount: '400' },
  ],
  schedules: [
    {
      filingStatus: 'SYNTHETIC_SINGLE',
      step2Checkbox: false,
      rows: [
        {
          ordinal: 0,
          atLeast: null,
          lessThan: '100',
          baseAmount: '0',
          marginalRate: '0',
          excessOver: '0',
        },
        {
          ordinal: 1,
          atLeast: '100',
          lessThan: null,
          baseAmount: '0',
          marginalRate: '0.1',
          excessOver: '100',
        },
      ],
    },
    {
      filingStatus: 'SYNTHETIC_SINGLE',
      step2Checkbox: true,
      rows: [
        {
          ordinal: 0,
          atLeast: null,
          lessThan: '50',
          baseAmount: '0',
          marginalRate: '0',
          excessOver: '0',
        },
        {
          ordinal: 1,
          atLeast: '50',
          lessThan: null,
          baseAmount: '0',
          marginalRate: '0.2',
          excessOver: '50',
        },
      ],
    },
    {
      filingStatus: 'SYNTHETIC_MARRIED',
      step2Checkbox: false,
      rows: [
        {
          ordinal: 0,
          atLeast: null,
          lessThan: null,
          baseAmount: '0',
          marginalRate: '0.05',
          excessOver: '0',
        },
      ],
    },
  ],
};

/** Synthetic FICA: 10% employee / 10% employer, wage base 1000. */
export const syntheticSocialSecurity = {
  employeeRate: '0.1',
  employerRate: '0.1',
  wageBase: '1000',
};

export const syntheticMedicare = {
  employeeRate: '0.02',
  employerRate: '0.02',
  hasWageLimit: false,
};

export const syntheticAdditionalMedicare = {
  employeeRate: '0.01',
  thresholds: [
    { filingStatus: 'SYNTHETIC_SINGLE', amount: '2000' },
    { filingStatus: 'SYNTHETIC_MARRIED', amount: '3000' },
  ],
  thresholdInclusive: false,
};

/** Additional Medicare with UNVERIFIED comparison semantics, to exercise the pending path. */
export const syntheticAdditionalMedicarePending = {
  ...syntheticAdditionalMedicare,
  thresholdInclusive: null,
};

export const syntheticFuta = {
  grossRate: '0.06',
  standardCredit: '0.054',
  wageBase: '700',
};

export const syntheticPre2020Allowance = { allowanceAmount: '50' };

export const syntheticSupplemental = {
  optionalFlatPermitted: true,
  optionalFlatRate: '0.22',
  mandatoryFlatRate: '0.37',
  mandatoryFlatThreshold: '1000',
};

export const syntheticNraAdjustment = {
  amounts: [{ payFrequency: 'BIWEEKLY', w4Revision: 'REVISION_2020_PLUS' as const, amount: '100' }],
};

export const syntheticAnnualRateSchedule = {
  methodology: 'ANNUAL_1040_ESTIMATE' as const,
  bracketSets: [
    {
      filingStatus: 'SYNTHETIC_SINGLE',
      brackets: [
        { ordinal: 0, lowerBound: '0', upperBound: '1000', rate: '0.1', baseTax: '0' },
        { ordinal: 1, lowerBound: '1000', upperBound: null, rate: '0.2', baseTax: '100' },
      ],
    },
  ],
};

export const syntheticAnnualStandardDeduction = {
  amounts: [{ filingStatus: 'SYNTHETIC_SINGLE', amount: '500' }],
};

export interface SyntheticRuleSetOptions {
  readonly omit?: readonly FederalRuleKey[];
  readonly unverified?: readonly FederalRuleKey[];
  readonly conflicted?: readonly FederalRuleKey[];
  readonly additionalMedicarePending?: boolean;
  readonly includeAnnual?: boolean;
  readonly includePre2020?: boolean;
  readonly includeSupplemental?: boolean;
  readonly includeNra?: boolean;
}

/** Assembles a frozen synthetic rule set. Every value inside is invented — see the header. */
export function syntheticRuleSet(options: SyntheticRuleSetOptions = {}): ResolvedFederalRuleSet {
  const omit = new Set<string>(options.omit ?? []);
  const unverified = new Set<string>(options.unverified ?? []);
  const conflicted = new Set<string>(options.conflicted ?? []);

  const entries: Record<string, FederalRuleEntry> = {};
  const references: RuleReference[] = [];

  const put = (key: FederalRuleKey, detail: unknown): void => {
    if (omit.has(key)) {
      return;
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
      return;
    }
    entries[key] = entry(key, detail, unverified.has(key) ? 'PENDING' : 'VERIFIED');
    references.push(syntheticReference(key));
  };

  put(FederalRuleKey.FIT_WORKSHEET_1A, syntheticWorksheet1A);
  put(FederalRuleKey.FICA_SOCIAL_SECURITY, syntheticSocialSecurity);
  put(FederalRuleKey.FICA_MEDICARE, syntheticMedicare);
  put(
    FederalRuleKey.FICA_ADDITIONAL_MEDICARE,
    options.additionalMedicarePending === true
      ? syntheticAdditionalMedicarePending
      : syntheticAdditionalMedicare,
  );
  put(FederalRuleKey.FUTA, syntheticFuta);

  if (options.includePre2020 === true) {
    put(FederalRuleKey.FIT_PRE2020_ALLOWANCE, syntheticPre2020Allowance);
  }
  if (options.includeSupplemental === true) {
    put(FederalRuleKey.FIT_SUPPLEMENTAL, syntheticSupplemental);
  }
  if (options.includeNra === true) {
    put(FederalRuleKey.FIT_NRA_ADJUSTMENT, syntheticNraAdjustment);
  }
  if (options.includeAnnual === true) {
    put(FederalRuleKey.ANNUAL_RATE_SCHEDULE, syntheticAnnualRateSchedule);
    put(FederalRuleKey.ANNUAL_STANDARD_DEDUCTION, syntheticAnnualStandardDeduction);
  }

  return {
    taxYear: SYNTHETIC_TAX_YEAR,
    effectiveDate: SYNTHETIC_EFFECTIVE_DATE,
    jurisdictionCode: 'US',
    entries: entries as ResolvedFederalRuleSet['entries'],
    ruleReferences: references,
    sourceIds: [...new Set(references.flatMap((reference) => reference.sourceIds))],
  };
}

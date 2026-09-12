import { JurisdictionType, RuleCategory } from '@/lib/db/generated/index';

/**
 * Rule category registry (spec §20).
 *
 * `RuleCategory` is a database enum, so categories are strongly typed end to end and category
 * strings are never scattered through the codebase. This registry attaches the metadata the
 * enum cannot carry: a human label and which jurisdiction levels a category may legally
 * belong to.
 *
 * The `jurisdictionTypes` list is a STRUCTURAL constraint (a federal payroll tax cannot be
 * attached to a city), not a tax value. No rate, threshold or bracket appears here.
 */

export interface RuleCategoryDefinition {
  readonly category: RuleCategory;
  readonly label: string;
  readonly description: string;
  /** Jurisdiction levels at which this category may be defined. */
  readonly jurisdictionTypes: readonly JurisdictionType[];
  /** True when the category describes an employer-side obligation. */
  readonly employerSide: boolean;
}

const FEDERAL_ONLY = [JurisdictionType.FEDERAL] as const;
const STATE_ONLY = [JurisdictionType.STATE] as const;
const LOCAL_LEVELS = [
  JurisdictionType.COUNTY,
  JurisdictionType.CITY,
  JurisdictionType.LOCALITY,
  JurisdictionType.SCHOOL_DISTRICT,
  JurisdictionType.OTHER,
] as const;

export const RULE_CATEGORY_DEFINITIONS: Readonly<Record<RuleCategory, RuleCategoryDefinition>> = {
  [RuleCategory.FEDERAL_INCOME_TAX]: {
    category: RuleCategory.FEDERAL_INCOME_TAX,
    label: 'Federal Income Tax',
    description: 'Annual federal income tax structure, including filing statuses and brackets.',
    jurisdictionTypes: FEDERAL_ONLY,
    employerSide: false,
  },
  [RuleCategory.FEDERAL_WITHHOLDING]: {
    category: RuleCategory.FEDERAL_WITHHOLDING,
    label: 'Federal Withholding',
    description:
      'Official federal paycheck withholding methodology and tables. Distinct from annual ' +
      'income tax brackets, which must not be used as withholding tables (spec §6).',
    jurisdictionTypes: FEDERAL_ONLY,
    employerSide: false,
  },
  [RuleCategory.SOCIAL_SECURITY]: {
    category: RuleCategory.SOCIAL_SECURITY,
    label: 'Social Security',
    description: 'OASDI employee and employer rates and wage base.',
    jurisdictionTypes: FEDERAL_ONLY,
    employerSide: true,
  },
  [RuleCategory.MEDICARE]: {
    category: RuleCategory.MEDICARE,
    label: 'Medicare',
    description: 'Medicare employee/employer rates plus Additional Medicare rate and threshold.',
    jurisdictionTypes: FEDERAL_ONLY,
    employerSide: true,
  },
  [RuleCategory.STATE_INCOME_TAX]: {
    category: RuleCategory.STATE_INCOME_TAX,
    label: 'State Income Tax',
    description: 'State income tax structure: none, flat, progressive, table, formula or hybrid.',
    jurisdictionTypes: STATE_ONLY,
    employerSide: false,
  },
  [RuleCategory.STATE_WITHHOLDING]: {
    category: RuleCategory.STATE_WITHHOLDING,
    label: 'State Withholding',
    description: 'Official state withholding method, tables and allowances.',
    jurisdictionTypes: STATE_ONLY,
    employerSide: false,
  },
  [RuleCategory.DISABILITY_SDI]: {
    category: RuleCategory.DISABILITY_SDI,
    label: 'Disability / SDI',
    description: 'State disability insurance contributions and wage base.',
    jurisdictionTypes: STATE_ONLY,
    employerSide: true,
  },
  [RuleCategory.PAID_LEAVE]: {
    category: RuleCategory.PAID_LEAVE,
    label: 'Paid Family / Medical Leave',
    description: 'Paid leave programme contributions and wage base.',
    jurisdictionTypes: STATE_ONLY,
    employerSide: true,
  },
  [RuleCategory.SUTA]: {
    category: RuleCategory.SUTA,
    label: 'SUTA',
    description: 'State unemployment tax rates, experience-rate ranges and taxable wage base.',
    jurisdictionTypes: STATE_ONLY,
    employerSide: true,
  },
  [RuleCategory.MINIMUM_WAGE]: {
    category: RuleCategory.MINIMUM_WAGE,
    label: 'Minimum Wage',
    description: 'Standard, tipped and special minimum wage rates, including local overrides.',
    jurisdictionTypes: [JurisdictionType.FEDERAL, JurisdictionType.STATE, ...LOCAL_LEVELS],
    employerSide: true,
  },
  [RuleCategory.OVERTIME]: {
    category: RuleCategory.OVERTIME,
    label: 'Overtime',
    description: 'Overtime thresholds, multipliers, daily/weekly method and exceptions.',
    jurisdictionTypes: [JurisdictionType.FEDERAL, JurisdictionType.STATE],
    employerSide: true,
  },
  [RuleCategory.RECIPROCITY]: {
    category: RuleCategory.RECIPROCITY,
    label: 'Reciprocity',
    description:
      'Agreements between states governing withholding for cross-border work. Never inferred ' +
      'from state names (spec §10).',
    jurisdictionTypes: STATE_ONLY,
    employerSide: false,
  },
  [RuleCategory.LOCAL_TAX]: {
    category: RuleCategory.LOCAL_TAX,
    label: 'Local Tax',
    description: 'City, county, school district and other local employee/employer taxes.',
    jurisdictionTypes: LOCAL_LEVELS,
    employerSide: true,
  },
};

export const ALL_RULE_CATEGORIES: readonly RuleCategory[] = Object.freeze(
  Object.keys(RULE_CATEGORY_DEFINITIONS) as RuleCategory[],
);

export function getRuleCategoryDefinition(category: RuleCategory): RuleCategoryDefinition {
  return RULE_CATEGORY_DEFINITIONS[category];
}

/** True when `category` may legally be defined at `jurisdictionType`. */
export function isCategoryValidForJurisdiction(
  category: RuleCategory,
  jurisdictionType: JurisdictionType,
): boolean {
  return RULE_CATEGORY_DEFINITIONS[category].jurisdictionTypes.includes(jurisdictionType);
}

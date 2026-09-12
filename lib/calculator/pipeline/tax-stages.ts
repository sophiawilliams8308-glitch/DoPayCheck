import { RuleCategory } from '@/lib/db/generated/client';
import type { Money } from '@/lib/core/money';
import { money, sum, toStorageString } from '@/lib/core/money';

import type { TaxComponent } from '../types/result';
import type { ResolvedRuleSet, RuleReference } from '../types/rules';
import { lookupRule } from '../types/rules';
import { CalculationStatus, IncompleteReason, statusForReason } from '../types/status';
import type { TaxableWageResult, WageBucket } from './taxable-wages';

/**
 * Federal, FICA, state, local and employer orchestration (pipeline stages 8–11 and 13).
 *
 * ===========================================================================
 * NO TAX VALUE APPEARS IN THIS FILE.
 *
 * These stages decide WHICH rule governs a component and WHAT to report when no usable rule
 * exists. The arithmetic that consumes rates, brackets, wage bases and withholding tables is
 * rule-driven and arrives in Phases 4–6, once official values have been sourced and verified.
 *
 * When a rule is missing, ambiguous, unverified or has unstated values, the component is
 * returned with `amount: null` and an explicit reason. It is NEVER defaulted to zero
 * (spec §19), because "no data" and "the law says zero" are different facts.
 * ===========================================================================
 */

/** A component the engine knows it must produce, and which rule category governs it. */
export interface ComponentSpec {
  readonly code: string;
  readonly label: string;
  readonly category: RuleCategory;
  /** The wage bucket this component is assessed on. */
  readonly bucket: WageBucket;
  /** True for employer-side liabilities, which never reduce employee net pay. */
  readonly employerSide: boolean;
}

/** Employee-side federal income tax withholding (spec §6). */
export const FEDERAL_COMPONENTS: readonly ComponentSpec[] = [
  {
    code: 'FEDERAL_INCOME_TAX_WITHHOLDING',
    label: 'Federal income tax withheld',
    // Paycheck withholding uses the official withholding methodology, NOT annual brackets.
    // Spec §6 forbids substituting one for the other.
    category: RuleCategory.FEDERAL_WITHHOLDING,
    bucket: 'federalIncomeTax',
    employerSide: false,
  },
];

/** FICA: employee and employer components are tracked separately (spec §6). */
export const FICA_COMPONENTS: readonly ComponentSpec[] = [
  {
    code: 'SOCIAL_SECURITY_EMPLOYEE',
    label: 'Social Security (employee)',
    category: RuleCategory.SOCIAL_SECURITY,
    bucket: 'socialSecurity',
    employerSide: false,
  },
  {
    code: 'MEDICARE_EMPLOYEE',
    label: 'Medicare (employee)',
    category: RuleCategory.MEDICARE,
    bucket: 'medicare',
    employerSide: false,
  },
  {
    code: 'ADDITIONAL_MEDICARE_EMPLOYEE',
    label: 'Additional Medicare (employee)',
    category: RuleCategory.MEDICARE,
    bucket: 'medicare',
    employerSide: false,
  },
];

/** Employer liabilities (spec §48). Reported separately, never deducted from net pay. */
export const EMPLOYER_COMPONENTS: readonly ComponentSpec[] = [
  {
    code: 'SOCIAL_SECURITY_EMPLOYER',
    label: 'Social Security (employer)',
    category: RuleCategory.SOCIAL_SECURITY,
    bucket: 'socialSecurity',
    employerSide: true,
  },
  {
    code: 'MEDICARE_EMPLOYER',
    label: 'Medicare (employer)',
    category: RuleCategory.MEDICARE,
    bucket: 'medicare',
    employerSide: true,
  },
  {
    code: 'FUTA_EMPLOYER',
    label: 'FUTA (employer)',
    // FUTA has no dedicated category in the Phase 2 enum; it is carried as a federal
    // employer obligation. PENDING DECISION: whether Phase 4 adds a FUTA rule category.
    category: RuleCategory.SOCIAL_SECURITY,
    bucket: 'futa',
    employerSide: true,
  },
  {
    code: 'SUTA_EMPLOYER',
    label: 'SUTA (employer)',
    category: RuleCategory.SUTA,
    bucket: 'suta',
    employerSide: true,
  },
];

export const STATE_COMPONENTS: readonly ComponentSpec[] = [
  {
    code: 'STATE_INCOME_TAX_WITHHOLDING',
    label: 'State income tax withheld',
    category: RuleCategory.STATE_WITHHOLDING,
    bucket: 'stateIncomeTax',
    employerSide: false,
  },
];

export const LOCAL_COMPONENTS: readonly ComponentSpec[] = [
  {
    code: 'LOCAL_INCOME_TAX_WITHHOLDING',
    label: 'Local income tax withheld',
    category: RuleCategory.LOCAL_TAX,
    bucket: 'localIncomeTax',
    employerSide: false,
  },
];

/** Builds an undetermined component carrying its reason. Amount is null, never "0". */
function undetermined(
  spec: ComponentSpec,
  reason: IncompleteReason,
  detail?: string,
  rules: readonly RuleReference[] = [],
): TaxComponent {
  return {
    code: spec.code,
    label: spec.label,
    amount: null,
    status: statusForReason(reason),
    reason,
    ...(detail === undefined ? {} : { detail }),
    rules,
  };
}

/**
 * Evaluates one component against the supplied rules.
 *
 * Phase 3 determines applicability and provenance. It does not perform rate arithmetic,
 * because no verified rate data exists yet — so a component backed by a usable rule is
 * reported as METHOD_NOT_IMPLEMENTED (UNSUPPORTED_SCENARIO) rather than a fabricated figure.
 */
export function evaluateComponent(
  spec: ComponentSpec,
  ruleSet: ResolvedRuleSet,
  wages: TaxableWageResult,
): TaxComponent {
  const lookup = lookupRule(ruleSet, spec.category);

  if (!lookup.found) {
    return undetermined(spec, lookup.reason, lookup.detail);
  }

  const { reference, values } = lookup.rule;

  // A rule with no verified source must not be presented as authoritative (spec §21).
  if (!reference.verified) {
    return undetermined(spec, IncompleteReason.RULE_UNVERIFIED, undefined, [reference]);
  }

  // A rule whose authoritative values are not yet stated cannot produce a figure (spec §19).
  const hasUsableValue = values.some((value) => value.value !== null && value.verified);
  if (!hasUsableValue) {
    return undetermined(spec, IncompleteReason.RULE_VALUES_PENDING, undefined, [reference]);
  }

  const bucket = wages[spec.bucket];

  return {
    code: spec.code,
    label: spec.label,
    amount: null,
    status: CalculationStatus.UNSUPPORTED_SCENARIO,
    reason: IncompleteReason.METHOD_NOT_IMPLEMENTED,
    detail:
      `A usable ${spec.category} rule was resolved against taxable wages ` +
      `${toStorageString(bucket.taxableWages)}, but the calculation methodology for this ` +
      'category is delivered in a later phase. No amount is invented.',
    rules: [reference],
  };
}

/** Evaluates a list of component specs. */
export function evaluateComponents(
  specs: readonly ComponentSpec[],
  ruleSet: ResolvedRuleSet,
  wages: TaxableWageResult,
): TaxComponent[] {
  return specs.map((spec) => evaluateComponent(spec, ruleSet, wages));
}

/**
 * Sums determined employee-side tax amounts.
 *
 * Returns null when ANY component is undetermined: a partial total would read as a complete
 * one and understate what the employee owes.
 */
export function totalDeterminedAmounts(components: readonly TaxComponent[]): Money | null {
  if (components.some((component) => component.amount === null)) {
    return null;
  }
  return sum(components.map((component) => money(component.amount ?? '0')));
}

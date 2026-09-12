import { type Money, divide, money, sum, toStorageString, zero } from '@/lib/core/money';
import { RoundingMode } from '@/lib/core/money';

import { calculateDeductions, type DeductionResult } from './pipeline/deductions';
import { annualize, calculateGrossPay } from './pipeline/gross-pay';
import { resolveJurisdiction } from './pipeline/jurisdiction';
import {
  EMPLOYER_COMPONENTS,
  FEDERAL_COMPONENTS,
  FICA_COMPONENTS,
  LOCAL_COMPONENTS,
  STATE_COMPONENTS,
  evaluateComponents,
  totalDeterminedAmounts,
} from './pipeline/tax-stages';
import { determineTaxableWages, type TaxableWageResult } from './pipeline/taxable-wages';
import { type RoundingPolicy } from './rounding/policy';
import { TraceBuilder, TraceStep, traceMoney } from './trace/trace';
import type { CalculationInput } from './types/input';
import type {
  CalculationResult,
  DeductionBreakdown,
  GrossPayBreakdown,
  TaxComponent,
  TaxableWages,
} from './types/result';
import type { ResolvedRuleSet, RuleReference } from './types/rules';
import { CalculationStatus, combineStatuses } from './types/status';
import { validateInput } from './validation/input-schema';

/**
 * DoPayCheck calculation engine — public entry point (spec §4).
 *
 * ===========================================================================
 * DETERMINISTIC AND PURE
 *
 * `calculatePaycheck` is synchronous and performs no I/O. Given identical input, rules,
 * rounding policy and engine version it always returns an identical result — which is what
 * makes a historical calculation reproducible from its snapshot (spec §40).
 *
 * Rules arrive already resolved. The engine never queries the database, so persistence cannot
 * contaminate calculation methodology (spec §3).
 * ===========================================================================
 *
 * NO TAX VALUE IS EVER INVENTED. A component without a usable, verified rule is returned with
 * `amount: null` and an explicit reason — never zero (spec §19).
 */

/**
 * Engine version.
 *
 * Recorded in every result and snapshot. Bump it whenever calculation METHODOLOGY changes, so
 * a historical snapshot can be matched to the engine that produced it.
 */
export const ENGINE_VERSION = '3.0.0-phase3';

export interface CalculationOptions {
  /** Rounding policy. Required — the engine chooses no tax-specific default (spec §4). */
  readonly rounding: RoundingPolicy;
  /** Rules resolved for this scenario. */
  readonly rules: ResolvedRuleSet;
}

function toDeductionBreakdown(items: readonly DeductionResult[], total: Money): DeductionBreakdown {
  return {
    items: items.map((item) => ({
      id: item.id,
      label: item.label,
      amount: toStorageString(item.amount),
    })),
    total: toStorageString(total),
  };
}

function toTaxableWages(derivations: TaxableWageResult): TaxableWages {
  return {
    federalIncomeTaxWages: toStorageString(derivations.federalIncomeTax.taxableWages),
    socialSecurityWages: toStorageString(derivations.socialSecurity.taxableWages),
    medicareWages: toStorageString(derivations.medicare.taxableWages),
    stateIncomeTaxWages: toStorageString(derivations.stateIncomeTax.taxableWages),
    localIncomeTaxWages: toStorageString(derivations.localIncomeTax.taxableWages),
    futaWages: toStorageString(derivations.futa.taxableWages),
    sutaWages: toStorageString(derivations.suta.taxableWages),
  };
}

function collectReferences(groups: readonly (readonly TaxComponent[])[]): RuleReference[] {
  const seen = new Map<string, RuleReference>();
  for (const group of groups) {
    for (const component of group) {
      for (const reference of component.rules) {
        seen.set(`${reference.ruleId}@${String(reference.version)}`, reference);
      }
    }
  }
  return [...seen.values()];
}

/** Builds the INVALID_INPUT result. Distinct from missing tax data (spec §16). */
function invalidInputResult(
  issues: readonly { path: string; message: string }[],
): CalculationResult {
  const emptyDeductions: DeductionBreakdown = { items: [], total: '0' };
  const emptyGross: GrossPayBreakdown = {
    regular: '0',
    overtime: '0',
    bonus: '0',
    commission: '0',
    tips: '0',
    other: '0',
    total: '0',
  };
  const emptyWages: TaxableWages = {
    federalIncomeTaxWages: '0',
    socialSecurityWages: '0',
    medicareWages: '0',
    stateIncomeTaxWages: '0',
    localIncomeTaxWages: '0',
    futaWages: '0',
    sutaWages: '0',
  };

  return {
    status: CalculationStatus.INVALID_INPUT,
    engineVersion: ENGINE_VERSION,
    taxYear: 0,
    effectiveDate: new Date(0).toISOString(),
    payFrequency: 'ANNUAL',
    jurisdiction: { federalCode: 'US', stateCode: null, localCodes: [], resolved: false },
    grossPay: emptyGross,
    preTaxDeductions: emptyDeductions,
    taxableWages: emptyWages,
    federal: [],
    fica: [],
    state: [],
    local: [],
    employerTaxes: [],
    postTaxDeductions: emptyDeductions,
    totalEmployeeTaxes: null,
    totalDeductions: '0',
    netPay: null,
    effectiveTaxRate: null,
    annualized: null,
    ruleReferences: [],
    sourceIds: [],
    trace: [],
    issues,
  };
}

/**
 * Calculates one paycheck.
 *
 * Executes the 17-stage pipeline in order. Each stage is isolated: none mutates the input,
 * and every stage records what it did in the trace.
 */
export function calculatePaycheck(
  input: CalculationInput,
  options: CalculationOptions,
): CalculationResult {
  try {
    const trace = new TraceBuilder();
    const policy = options.rounding;

    // --- 1. validateInput ---------------------------------------------------------------
    const validation = validateInput(input);
    if (!validation.valid) {
      return invalidInputResult(validation.issues);
    }
    trace.addStep(TraceStep.VALIDATE_INPUT, 'Input validated', {}, { valid: true });

    // --- 2. normalizeInput --------------------------------------------------------------
    // Normalization is structural only: defaults for absent optional collections. Monetary
    // values are converted lazily by each stage via money(), never through a JS number.
    const preTax = input.preTaxDeductions ?? [];
    const postTax = input.postTaxDeductions ?? [];
    trace.addStep(
      TraceStep.NORMALIZE_INPUT,
      'Input normalized',
      {},
      { preTaxDeductionCount: preTax.length, postTaxDeductionCount: postTax.length },
    );

    // --- 3. resolveJurisdiction ---------------------------------------------------------
    const jurisdiction = resolveJurisdiction(input.employee);
    trace.addStep(
      TraceStep.RESOLVE_JURISDICTION,
      'Jurisdiction chain resolved',
      {},
      {
        federal: jurisdiction.summary.federalCode,
        state: jurisdiction.summary.stateCode,
        localCount: jurisdiction.summary.localCodes.length,
        resolved: jurisdiction.summary.resolved,
      },
      jurisdiction.unresolved.length > 0
        ? `Unresolved: ${jurisdiction.unresolved.join(', ')}`
        : undefined,
    );

    // --- 4. resolveApplicableRules ------------------------------------------------------
    // Rules are supplied already resolved; this records what arrived.
    const suppliedCategories = Object.keys(options.rules.byCategory);
    trace.addStep(
      TraceStep.RESOLVE_RULES,
      'Applicable rules received',
      {},
      { categories: suppliedCategories.length },
    );

    // --- 5. calculateGrossPay -----------------------------------------------------------
    const grossOutcome = calculateGrossPay(input.pay, policy);
    if (!grossOutcome.ok) {
      return {
        ...invalidInputResult([{ path: 'pay.periodsPerYear', message: grossOutcome.reason }]),
        status: CalculationStatus.UNSUPPORTED_SCENARIO,
      };
    }
    const gross = grossOutcome.gross;
    trace.addStep(
      TraceStep.GROSS_PAY,
      'Gross pay computed',
      { basis: input.pay.basis, payFrequency: input.pay.payFrequency },
      {
        regular: traceMoney(gross.regular),
        overtime: traceMoney(gross.overtime),
        bonus: traceMoney(gross.bonus),
        commission: traceMoney(gross.commission),
        tips: traceMoney(gross.tips),
        other: traceMoney(gross.other),
        total: traceMoney(gross.total),
      },
    );

    // --- 6. calculatePreTaxDeductions ---------------------------------------------------
    const preTaxResult = calculateDeductions(preTax, gross.total, policy);
    trace.addStep(
      TraceStep.PRE_TAX_DEDUCTIONS,
      'Pre-tax deductions computed',
      { grossPay: traceMoney(gross.total) },
      { total: traceMoney(preTaxResult.total), count: preTaxResult.items.length },
    );

    // --- 7. determineTaxableWages -------------------------------------------------------
    const wages = determineTaxableWages(gross.total, preTaxResult.items, policy);
    trace.addStep(
      TraceStep.TAXABLE_WAGES,
      'Taxable wage buckets derived independently',
      { grossWages: traceMoney(gross.total) },
      {
        federalIncomeTax: traceMoney(wages.federalIncomeTax.taxableWages),
        socialSecurity: traceMoney(wages.socialSecurity.taxableWages),
        medicare: traceMoney(wages.medicare.taxableWages),
        stateIncomeTax: traceMoney(wages.stateIncomeTax.taxableWages),
        localIncomeTax: traceMoney(wages.localIncomeTax.taxableWages),
        futa: traceMoney(wages.futa.taxableWages),
        suta: traceMoney(wages.suta.taxableWages),
      },
    );

    // --- 8-11. federal / FICA / state / local -------------------------------------------
    const federal = evaluateComponents(FEDERAL_COMPONENTS, options.rules, wages);
    const fica = evaluateComponents(FICA_COMPONENTS, options.rules, wages);
    const state = evaluateComponents(STATE_COMPONENTS, options.rules, wages);
    const local = evaluateComponents(LOCAL_COMPONENTS, options.rules, wages);

    for (const [step, components] of [
      [TraceStep.FEDERAL, federal],
      [TraceStep.FICA, fica],
      [TraceStep.STATE, state],
      [TraceStep.LOCAL, local],
    ] as const) {
      for (const component of components) {
        trace.add({
          step,
          description: component.label,
          inputs: { taxableWagesBucket: component.code },
          outputs: { amount: component.amount },
          rules: component.rules,
          // The trace carries the component's own status and its source IDs (derived from
          // the attached rules), so a consumer can see provenance per step.
          status: component.status,
          ...(component.reason === undefined ? {} : { note: component.reason }),
        });
      }
    }

    // --- 12. calculatePostTaxDeductions -------------------------------------------------
    const postTaxResult = calculateDeductions(postTax, gross.total, policy);
    trace.addStep(
      TraceStep.POST_TAX_DEDUCTIONS,
      'Post-tax deductions computed',
      { grossPay: traceMoney(gross.total) },
      { total: traceMoney(postTaxResult.total), count: postTaxResult.items.length },
    );

    // --- 13. calculateEmployerTaxes -----------------------------------------------------
    // Employer liabilities are reported separately and NEVER reduce employee net pay.
    const employerTaxes = evaluateComponents(EMPLOYER_COMPONENTS, options.rules, wages);
    trace.addStep(
      TraceStep.EMPLOYER_TAXES,
      'Employer liabilities computed separately from employee pay',
      {},
      { count: employerTaxes.length },
    );

    // --- 14. validateCalculation --------------------------------------------------------
    const employeeComponents = [...federal, ...fica, ...state, ...local];
    const totalEmployeeTaxes = totalDeterminedAmounts(employeeComponents);

    const totalDeductions = sum([preTaxResult.total, postTaxResult.total]);

    // Net pay is null unless every employee tax is determined: a partial figure would read
    // as a complete one and overstate take-home pay.
    const netPay =
      totalEmployeeTaxes === null
        ? null
        : gross.total.minus(totalEmployeeTaxes).minus(totalDeductions);

    trace.addStep(
      TraceStep.VALIDATE_CALCULATION,
      'Calculation validated',
      {},
      {
        employeeTaxesDetermined: totalEmployeeTaxes !== null,
        netPayDetermined: netPay !== null,
      },
    );

    trace.addStep(
      TraceStep.NET_PAY,
      'Net pay',
      {
        grossPay: traceMoney(gross.total),
        totalDeductions: traceMoney(totalDeductions),
      },
      { netPay: netPay === null ? null : traceMoney(netPay) },
      netPay === null ? 'Net pay is undetermined because at least one tax is unknown' : undefined,
    );

    // --- 15/16. attachRuleVersions + attachSources --------------------------------------
    const ruleReferences = collectReferences([federal, fica, state, local, employerTaxes]);
    const sourceIds = [...new Set(ruleReferences.flatMap((reference) => reference.sourceIds))];

    // --- status folding -----------------------------------------------------------------
    const statuses = [...employeeComponents, ...employerTaxes].map((component) => component.status);
    if (!jurisdiction.summary.resolved) {
      statuses.push(CalculationStatus.INCOMPLETE);
    }
    const status = combineStatuses(statuses);

    const annualGross = annualize(gross.total, input.pay, policy);
    const effectiveTaxRate =
      totalEmployeeTaxes !== null && !gross.total.isZero()
        ? divide(totalEmployeeTaxes, gross.total, 6, RoundingMode.HALF_UP)
        : null;

    return {
      status,
      engineVersion: ENGINE_VERSION,
      taxYear: input.taxYear,
      effectiveDate: input.effectiveDate.toISOString(),
      payFrequency: input.pay.payFrequency,
      jurisdiction: jurisdiction.summary,
      grossPay: {
        regular: toStorageString(gross.regular),
        overtime: toStorageString(gross.overtime),
        bonus: toStorageString(gross.bonus),
        commission: toStorageString(gross.commission),
        tips: toStorageString(gross.tips),
        other: toStorageString(gross.other),
        total: toStorageString(gross.total),
      },
      preTaxDeductions: toDeductionBreakdown(preTaxResult.items, preTaxResult.total),
      taxableWages: toTaxableWages(wages),
      federal,
      fica,
      state,
      local,
      employerTaxes,
      postTaxDeductions: toDeductionBreakdown(postTaxResult.items, postTaxResult.total),
      totalEmployeeTaxes: totalEmployeeTaxes === null ? null : toStorageString(totalEmployeeTaxes),
      totalDeductions: toStorageString(totalDeductions),
      netPay: netPay === null ? null : toStorageString(netPay),
      effectiveTaxRate: effectiveTaxRate === null ? null : toStorageString(effectiveTaxRate),
      annualized: annualGross === null ? null : { grossPay: toStorageString(annualGross) },
      ruleReferences,
      sourceIds,
      trace: trace.build(),
      issues: [],
    };
  } catch (error) {
    // An unexpected failure is an engine defect, not a data state (spec §16).
    return {
      ...invalidInputResult([
        {
          path: 'engine',
          message: error instanceof Error ? error.message : 'Unexpected calculation failure',
        },
      ]),
      status: CalculationStatus.CALCULATION_ERROR,
    };
  }
}

export { CalculationStatus, IncompleteReason } from './types/status';
export { GENERIC_CURRENCY_POLICY } from './rounding/policy';
export type { CalculationInput } from './types/input';
export type { CalculationResult } from './types/result';
export type { ResolvedRuleSet, ResolvedRule, RuleReference, RuleValue } from './types/rules';
export { money, zero };

import { type Money, add, money, sum, toStorageString, zero } from '@/lib/core/money';
import { combineStatuses, type CalculationStatus } from '@/lib/calculator/types/status';
import type { RuleReference } from '@/lib/calculator/types/rules';

import { FederalReason, type FederalUnavailable, unavailable } from './errors/federal-errors';
import { statusForFederalReason } from './errors/federal-errors';
import { calculateAdditionalMedicare } from './fica/additional-medicare';
import { calculateMedicare } from './fica/medicare';
import { calculateSocialSecurity } from './fica/social-security';
import { calculateFuta } from './employer/futa';
import { totalEmployerCosts } from './employer/employerCosts';
import { calculateAnnualLiability } from './fit/annualLiability';
import { annualize } from './fit/pay-periods';
import { resolveNraAdjustment } from './fit/nraAdjustment';
import { runWorksheet1A } from './fit/worksheet1A';
import { roundTax } from './rounding/federal-rounding';
import { FederalTraceBuilder, FederalTraceStage, traceMoney } from './trace/federal-trace';
import type {
  FederalAmount,
  FederalCalculationContext,
  FederalCalculationResult,
  FederalDisclosure,
  WorksheetLines,
} from './types';
import type { Read } from './rules/read-detail';

/**
 * FEDERAL TAX ENGINE — STAGE B (Phase 4). PURE AND DETERMINISTIC.
 *
 * ===========================================================================
 * WHAT THIS FUNCTION MAY NOT DO.
 *
 *   no database query · no Date.now() · no process.env · no randomness · no network ·
 *   no hidden global state
 *
 * Everything it needs arrives in the frozen context. Given the same context it returns the
 * same result, for ever — which is the only way a snapshot taken today can still be explained
 * in five years.
 * ===========================================================================
 *
 * FOUR TRACKS, STRUCTURALLY SEPARATE:
 *   A  annual liability estimate  — DISPLAY ONLY, FED.ANNUAL.*
 *   B  paycheck withholding       — Pub. 15-T Worksheet 1A, FED.FIT.*
 *   C  employee FICA              — Social Security, Medicare, Additional Medicare
 *   D  employer taxes             — employer SS, employer Medicare, FUTA
 *
 * Track A never supplies Track B. No component is ever defaulted to zero.
 */

/**
 * Federal engine version.
 *
 * Bump whenever calculation BEHAVIOUR changes; a pure refactor does not. Recorded in every
 * result and snapshot, and part of golden-test identity.
 */
export const FEDERAL_ENGINE_VERSION = '4.0.0-phase4';

export const FEDERAL_METHODOLOGY = 'PUB15T_WORKSHEET_1A+FICA+FUTA';

function amountFrom(
  code: string,
  label: string,
  value: Money,
  rules: readonly RuleReference[],
): FederalAmount {
  return {
    code,
    label,
    amount: toStorageString(value),
    status: 'COMPLETE',
    rules,
  };
}

function amountUnavailable(
  code: string,
  label: string,
  problem: FederalUnavailable,
  rules: readonly RuleReference[] = [],
): FederalAmount {
  return {
    code,
    label,
    // NEVER "0". An absent amount and a zero amount are different facts.
    amount: null,
    status: statusForFederalReason(problem.reason),
    problem,
    rules,
  };
}

/** Rule references for one key, so each amount carries its own provenance. */
function referencesFor(
  context: FederalCalculationContext,
  ruleKeys: readonly string[],
): readonly RuleReference[] {
  return context.ruleSet.ruleReferences.filter((reference) => ruleKeys.includes(reference.ruleKey));
}

/** Calculates federal taxes for one pay period. Pure. */
export function calculateFederalTaxes(
  context: FederalCalculationContext,
): FederalCalculationResult {
  const trace = new FederalTraceBuilder();
  const issues: FederalUnavailable[] = [];
  const disclosures: FederalDisclosure[] = [];
  const policy = context.rounding;

  const note = (problem: FederalUnavailable): void => {
    issues.push(problem);
  };

  trace.add({
    stage: FederalTraceStage.RULE_RESOLUTION,
    description: 'Federal rules resolved and frozen',
    inputs: {
      taxYear: context.taxYear,
      effectiveDate: context.effectiveDate,
      jurisdiction: context.ruleSet.jurisdictionCode,
    },
    outputs: {
      resolvedKeys: Object.keys(context.ruleSet.entries).length,
      sourceCount: context.ruleSet.sourceIds.length,
    },
    rules: context.ruleSet.ruleReferences,
  });

  trace.add({
    stage: FederalTraceStage.WAGE_BUCKETS,
    description: 'Federal taxable wage buckets',
    inputs: { regular: context.wages.regular, supplemental: context.wages.supplemental },
    outputs: { ...context.buckets },
  });

  trace.add({
    stage: FederalTraceStage.W4_NORMALIZATION,
    description: 'W-4 mapped to worksheet vocabulary',
    inputs: { revision: context.w4.revision, filingStatus: context.w4.filingStatus },
    outputs: {
      step2MultipleJobsChecked: context.w4.step2MultipleJobsChecked,
      claimsExemption: context.w4.claimsExemption,
      isNonresidentAlien: context.w4.isNonresidentAlien,
      // Preserved verbatim: a Step 4(c) amount is never silently dropped (D-FIT-2).
      step4cExtraPerPeriod: context.w4.step4cExtraPerPeriod,
    },
  });

  // ================= TRACK B — paycheck withholding ==================================
  const fitWages = money(context.buckets.federalIncomeTaxWages);
  const extraPerPeriod =
    context.w4.step4cExtraPerPeriod === null ? zero() : money(context.w4.step4cExtraPerPeriod);

  let regularAmount: FederalAmount;
  let totalAmount: FederalAmount;
  let worksheetLines: WorksheetLines = {};
  let withholdingMethod: 'PUB15T_WORKSHEET_1A' | 'SUPPLEMENTAL' | 'NONE' = 'NONE';

  const extraAmount: FederalAmount = amountFrom(
    'FEDERAL_EXTRA_WITHHOLDING_STEP_4C',
    'Extra withholding (W-4 Step 4(c))',
    extraPerPeriod,
    [],
  );

  if (context.w4.isNonresidentAlien) {
    // Structure exists; behaviour is flag-gated and off. No approximation.
    const nra = resolveNraAdjustment(
      context.ruleSet,
      context.payFrequency,
      context.w4.revision,
      context.flags,
    );
    const problem = nra.ok
      ? unavailable(
          FederalReason.SCENARIO_UNSUPPORTED,
          'Nonresident-alien withholding is modelled but not yet applied',
        )
      : nra.problem;
    note(problem);
    regularAmount = amountUnavailable(
      'FEDERAL_INCOME_TAX_WITHHELD',
      'Federal income tax withheld',
      problem,
    );
    totalAmount = amountUnavailable(
      'FEDERAL_WITHHOLDING_TOTAL',
      'Total federal withholding',
      problem,
    );
    trace.add({
      stage: FederalTraceStage.NRA_ADJUSTMENT,
      description: 'Nonresident-alien adjustment',
      inputs: { payFrequency: context.payFrequency, revision: context.w4.revision },
      outputs: { applied: false },
      status: statusForFederalReason(problem.reason),
      note: problem.detail,
    });
  } else if (context.w4.claimsExemption) {
    // Exemption is a fact the EMPLOYEE stated on the form, so no income tax is withheld on
    // wages. What is NOT settled is how a Step 4(c) amount interacts with it — so when both
    // are present the total is withheld from judgement rather than guessed, and the 4(c)
    // figure stays visible in the result, the trace and the snapshot (D-FIT-2).
    withholdingMethod = 'NONE';
    regularAmount = amountFrom(
      'FEDERAL_INCOME_TAX_WITHHELD',
      'Federal income tax withheld',
      zero(),
      [],
    );
    disclosures.push({
      code: 'W4_EXEMPTION_CLAIMED',
      message: 'The employee claims exemption from federal income tax withholding.',
    });

    if (extraPerPeriod.isZero()) {
      totalAmount = amountFrom(
        'FEDERAL_WITHHOLDING_TOTAL',
        'Total federal withholding',
        zero(),
        [],
      );
    } else {
      const problem = unavailable(
        FederalReason.PENDING_VERIFICATION,
        'Whether a Step 4(c) extra amount is still withheld when the employee claims exemption ' +
          'is not yet verified. The amount is preserved and reported, not applied or discarded.',
      );
      note(problem);
      totalAmount = amountUnavailable(
        'FEDERAL_WITHHOLDING_TOTAL',
        'Total federal withholding',
        problem,
      );
      disclosures.push({
        code: 'EXEMPT_WITH_STEP_4C',
        message:
          'An extra withholding amount was supplied alongside an exemption claim. The total is ' +
          'reported as pending verification; the amount has been preserved.',
      });
    }
  } else {
    const worksheet = runWorksheet1A(
      context.ruleSet,
      context.w4,
      fitWages,
      context.periodsPerYear,
      policy,
    );

    if (worksheet.ok) {
      withholdingMethod = 'PUB15T_WORKSHEET_1A';
      worksheetLines = worksheet.value.lines;
      const refs = referencesFor(context, worksheet.value.ruleKeys);
      regularAmount = amountFrom(
        'FEDERAL_INCOME_TAX_WITHHELD',
        'Federal income tax withheld',
        worksheet.value.beforeExtra,
        refs,
      );
      totalAmount = amountFrom(
        'FEDERAL_WITHHOLDING_TOTAL',
        'Total federal withholding',
        worksheet.value.total,
        refs,
      );
      trace.add({
        stage: FederalTraceStage.WORKSHEET_1A,
        description: 'Pub. 15-T Worksheet 1A, percentage method',
        inputs: {
          taxableWages: traceMoney(fitWages),
          periodsPerYear: context.periodsPerYear,
          filingStatus: context.w4.filingStatus,
          step2Checked: context.w4.step2MultipleJobsChecked,
        },
        outputs: { ...worksheet.value.lines },
        rules: refs,
        rounding: policy.version,
      });
    } else {
      note(worksheet.problem);
      regularAmount = amountUnavailable(
        'FEDERAL_INCOME_TAX_WITHHELD',
        'Federal income tax withheld',
        worksheet.problem,
      );
      totalAmount = amountUnavailable(
        'FEDERAL_WITHHOLDING_TOTAL',
        'Total federal withholding',
        worksheet.problem,
      );
      trace.add({
        stage: FederalTraceStage.WORKSHEET_1A,
        description: 'Pub. 15-T Worksheet 1A could not be completed',
        inputs: { taxableWages: traceMoney(fitWages) },
        outputs: { amount: null },
        status: statusForFederalReason(worksheet.problem.reason),
        note: worksheet.problem.detail,
      });
    }
  }

  const supplementalAmount: FederalAmount = amountFrom(
    'FEDERAL_SUPPLEMENTAL_WITHHOLDING',
    'Federal withholding on supplemental wages',
    zero(),
    [],
  );

  trace.add({
    stage: FederalTraceStage.WITHHOLDING_TOTAL,
    description: 'Federal withholding total',
    inputs: { extraPerPeriod: traceMoney(extraPerPeriod) },
    outputs: { total: totalAmount.amount },
    status: totalAmount.status,
  });

  // ================= TRACK C — employee FICA =========================================
  const ssWages = money(context.buckets.socialSecurityWages);
  const ssResult = calculateSocialSecurity(
    context.ruleSet,
    ssWages,
    money(context.ytd.socialSecurityWages),
    policy,
  );

  const medWages = money(context.buckets.medicareWages);
  const medResult = calculateMedicare(context.ruleSet, medWages, policy);

  const addlResult = calculateAdditionalMedicare(
    context.ruleSet,
    medWages,
    money(context.ytd.medicareWages),
    context.w4.filingStatus,
    policy,
  );

  const socialSecurityEmployee = ficaAmount(
    'SOCIAL_SECURITY_EMPLOYEE',
    'Social Security (employee)',
    ssResult.ok ? ssResult.value.employee : null,
    ssResult,
    context,
    note,
  );
  const medicareEmployee = ficaAmount(
    'MEDICARE_EMPLOYEE',
    'Medicare (employee)',
    medResult.ok ? medResult.value.employee : null,
    medResult,
    context,
    note,
  );
  const additionalMedicareEmployee = ficaAmount(
    'ADDITIONAL_MEDICARE_EMPLOYEE',
    'Additional Medicare (employee)',
    addlResult.ok ? addlResult.value.employee : null,
    addlResult,
    context,
    note,
  );

  trace.add({
    stage: FederalTraceStage.SOCIAL_SECURITY,
    description: 'Social Security, capped by the annual wage base',
    inputs: { periodWages: traceMoney(ssWages), ytdWages: context.ytd.socialSecurityWages },
    outputs: {
      taxableThisPeriod: ssResult.ok ? traceMoney(ssResult.value.taxableThisPeriod) : null,
      wageBaseRemaining: ssResult.ok ? traceMoney(ssResult.value.wageBaseRemaining) : null,
      employee: socialSecurityEmployee.amount,
    },
    rules: socialSecurityEmployee.rules,
    status: socialSecurityEmployee.status,
    rounding: policy.version,
  });

  trace.add({
    stage: FederalTraceStage.MEDICARE,
    description: 'Medicare',
    inputs: { periodWages: traceMoney(medWages) },
    outputs: {
      employee: medicareEmployee.amount,
      capApplied: medResult.ok ? medResult.value.capApplied : null,
    },
    rules: medicareEmployee.rules,
    status: medicareEmployee.status,
    rounding: policy.version,
  });

  trace.add({
    stage: FederalTraceStage.ADDITIONAL_MEDICARE,
    description: 'Additional Medicare (employee only — there is no employer share)',
    inputs: { periodWages: traceMoney(medWages), ytdWages: context.ytd.medicareWages },
    outputs: { employee: additionalMedicareEmployee.amount },
    rules: additionalMedicareEmployee.rules,
    status: additionalMedicareEmployee.status,
    rounding: policy.version,
  });

  // ================= TRACK D — employer taxes ========================================
  let employer: FederalCalculationResult['employer'] = null;

  if (context.includeEmployerTaxes) {
    const futaResult = calculateFuta(
      context.ruleSet,
      money(context.buckets.futaWages),
      money(context.ytd.futaWages),
      policy,
    );

    const socialSecurityEmployer = ficaAmount(
      'SOCIAL_SECURITY_EMPLOYER',
      'Social Security (employer)',
      ssResult.ok ? ssResult.value.employer : null,
      ssResult,
      context,
      note,
    );
    const medicareEmployer = ficaAmount(
      'MEDICARE_EMPLOYER',
      'Medicare (employer)',
      medResult.ok ? medResult.value.employer : null,
      medResult,
      context,
      note,
    );
    const futaAmount = ficaAmount(
      'FUTA_EMPLOYER',
      'FUTA (employer)',
      futaResult.ok ? futaResult.value.employer : null,
      futaResult,
      context,
      note,
    );

    const parts = [socialSecurityEmployer, medicareEmployer, futaAmount];
    const allKnown = parts.every((part) => part.amount !== null);
    const total: FederalAmount = allKnown
      ? amountFrom(
          'EMPLOYER_FEDERAL_TOTAL',
          'Employer federal payroll taxes',
          totalEmployerCosts({
            socialSecurity: money(socialSecurityEmployer.amount ?? '0'),
            medicare: money(medicareEmployer.amount ?? '0'),
            futa: money(futaAmount.amount ?? '0'),
          }).total,
          [],
        )
      : amountUnavailable(
          'EMPLOYER_FEDERAL_TOTAL',
          'Employer federal payroll taxes',
          unavailable(
            FederalReason.COMPONENT_NOT_STATED,
            'At least one employer component is undetermined, so the total is not stated',
          ),
        );

    employer = { socialSecurityEmployer, medicareEmployer, futa: futaAmount, total };

    if (futaResult.ok) {
      disclosures.push({
        code: 'FUTA_STANDARD_CREDIT_ONLY',
        message:
          'FUTA uses the standard credit. State credit reductions are determined in a later ' +
          'phase and are not applied.',
      });
    }

    trace.add({
      stage: FederalTraceStage.FUTA,
      description: 'FUTA — employer only, never a paycheck deduction',
      inputs: { periodWages: context.buckets.futaWages, ytdWages: context.ytd.futaWages },
      outputs: {
        effectiveRate: futaResult.ok ? traceMoney(futaResult.value.effectiveRate) : null,
        employer: futaAmount.amount,
      },
      rules: futaAmount.rules,
      status: futaAmount.status,
      rounding: policy.version,
    });

    trace.add({
      stage: FederalTraceStage.EMPLOYER_TAXES,
      description: 'Employer federal payroll taxes, reported separately from employee pay',
      inputs: {},
      outputs: { total: total.amount },
      status: total.status,
    });
  }

  // ================= TRACK A — annual estimate (DISPLAY ONLY) ========================
  let annualEstimate: FederalCalculationResult['annualEstimate'] = null;

  if (context.includeAnnualEstimate) {
    const annualGross = annualize(fitWages, context.periodsPerYear);
    const annual = calculateAnnualLiability(
      context.ruleSet,
      annualGross,
      context.w4.filingStatus,
      policy,
    );

    if (annual.ok) {
      const refs = referencesFor(context, annual.value.ruleKeys);
      annualEstimate = {
        displayOnly: true,
        liability: amountFrom(
          'FEDERAL_ANNUAL_LIABILITY_ESTIMATE',
          'Estimated annual federal income tax',
          annual.value.liability,
          refs,
        ),
        taxableIncome: amountFrom(
          'FEDERAL_ANNUAL_TAXABLE_INCOME',
          'Estimated annual taxable income',
          annual.value.taxableIncome,
          refs,
        ),
      };
    } else {
      // Track A failing NEVER falls back to Track B data.
      note(annual.problem);
      annualEstimate = {
        displayOnly: true,
        liability: amountUnavailable(
          'FEDERAL_ANNUAL_LIABILITY_ESTIMATE',
          'Estimated annual federal income tax',
          annual.problem,
        ),
        taxableIncome: amountUnavailable(
          'FEDERAL_ANNUAL_TAXABLE_INCOME',
          'Estimated annual taxable income',
          annual.problem,
        ),
      };
    }

    disclosures.push({
      code: 'ANNUAL_ESTIMATE_DISPLAY_ONLY',
      message:
        'The annual figure is an estimate for display only. It is not the amount withheld from ' +
        'any paycheck.',
    });

    trace.add({
      stage: FederalTraceStage.ANNUAL_ESTIMATE,
      description: 'Annual liability estimate (Track A, display only)',
      inputs: { annualGross: traceMoney(annualGross) },
      outputs: { liability: annualEstimate.liability.amount },
      status: annualEstimate.liability.status,
    });
  }

  trace.add({
    stage: FederalTraceStage.DISCLOSURES,
    description: 'Disclosures and feature flags',
    inputs: { ...context.flags },
    outputs: { disclosureCount: disclosures.length },
  });

  const statuses: CalculationStatus[] = [
    regularAmount.status,
    totalAmount.status,
    socialSecurityEmployee.status,
    medicareEmployee.status,
    additionalMedicareEmployee.status,
  ];
  if (employer !== null) {
    statuses.push(employer.total.status);
  }
  if (annualEstimate !== null) {
    statuses.push(annualEstimate.liability.status);
  }

  return {
    status: combineStatuses(statuses),
    engineVersion: FEDERAL_ENGINE_VERSION,
    taxYear: context.taxYear,
    effectiveDate: context.effectiveDate,
    methodology: FEDERAL_METHODOLOGY,
    buckets: context.buckets,
    withholding: {
      method: withholdingMethod,
      regular: regularAmount,
      supplemental: supplementalAmount,
      extraPerPeriod: extraAmount,
      total: totalAmount,
      worksheetLines,
    },
    fica: { socialSecurityEmployee, medicareEmployee, additionalMedicareEmployee },
    employer,
    annualEstimate,
    disclosures,
    flags: context.flags,
    ruleReferences: context.ruleSet.ruleReferences,
    sourceIds: context.ruleSet.sourceIds,
    trace: trace.build(),
    issues,
  };
}

/** Builds a FICA-shaped amount from a Read result, recording the problem when absent. */
function ficaAmount(
  code: string,
  label: string,
  value: Money | null,
  result: Read<{ readonly ruleKey: string }>,
  context: FederalCalculationContext,
  note: (problem: FederalUnavailable) => void,
): FederalAmount {
  if (!result.ok) {
    note(result.problem);
    return amountUnavailable(code, label, result.problem);
  }
  if (value === null) {
    const problem = unavailable(FederalReason.COMPONENT_NOT_STATED, `${code} is undetermined`);
    note(problem);
    return amountUnavailable(code, label, problem);
  }
  return amountFrom(code, label, value, referencesFor(context, [result.value.ruleKey]));
}

/** Sums determined employee-side federal taxes. Null when any component is unknown. */
export function totalEmployeeFederalTaxes(result: FederalCalculationResult): string | null {
  const parts = [
    result.withholding.total,
    result.fica.socialSecurityEmployee,
    result.fica.medicareEmployee,
    result.fica.additionalMedicareEmployee,
  ];
  if (parts.some((part) => part.amount === null)) {
    return null;
  }
  return toStorageString(sum(parts.map((part) => money(part.amount ?? '0'))));
}

export { FEDERAL_ROUNDING_V1 } from './rounding/federal-rounding';
export { DEFAULT_FEDERAL_FLAGS, withFlags } from './flags';
export { toFederalW4, deriveScenario } from './context';
export { FederalRuleKey, requiredRuleKeys } from './rule-keys';
export { FederalReason } from './errors/federal-errors';
export type { FederalCalculationContext, FederalCalculationResult } from './types';
export { add, roundTax };

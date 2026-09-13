import { type Money, RoundingMode, add, money, sum, toStorageString, zero } from '@/lib/core/money';
import { combineStatuses, type CalculationStatus } from '@/lib/calculator/types/status';
import type { RuleReference } from '@/lib/calculator/types/rules';

import {
  FederalReason,
  type FederalUnavailable,
  statusForFederalReason,
  unavailable,
} from './errors/federal-errors';
import { calculateAdditionalMedicare } from './fica/additional-medicare';
import { calculateMedicare } from './fica/medicare';
import { calculateSocialSecurity } from './fica/social-security';
import { calculateFuta } from './employer/futa';
import { calculateAnnualLiability, effectiveAnnualRate } from './fit/annualLiability';
import { annualize, resolvePayPeriodsPerYear } from './fit/pay-periods';
import { resolveNraAdjustment } from './fit/nraAdjustment';
import { SupplementalMethod, calculateSupplemental } from './fit/supplemental';
import { runWorksheet1A } from './fit/worksheet1A';
import { assertFederalInvariants } from './invariants';
import {
  resolveRoundingPolicy,
  roundTax,
  roundingDisclosure,
  type FederalRoundingPolicy,
} from './rounding/federal-rounding';
import { FederalTraceBuilder, FederalTraceStage, traceMoney } from './trace/federal-trace';
import { deriveFederalWageBuckets, type FederalBucket } from './wages/federalWageBuckets';
import { validateFederalW4 } from './context';
import type {
  FederalAmount,
  FederalCalculationContext,
  FederalCalculationResult,
  FederalDisclosure,
  FederalEmployerResult,
  FederalEstimates,
  WorksheetLines,
} from './types';
import { readFail, readOk, type Read } from './rules/read-detail';

/**
 * FEDERAL TAX ENGINE — STAGE B. PURE AND DETERMINISTIC (spec §2.3).
 *
 * ===========================================================================
 * WHAT THIS FUNCTION MAY NOT DO (§2.2 rule 3).
 *
 *   no database query · no Date.now() · no process.env · no Math.random() ·
 *   no network · no locale-dependent formatting · no hidden global state
 *
 * Everything arrives in the frozen context. Given the same context it returns
 * the same result for ever — which is the only way a snapshot taken today can
 * still be explained in five years (§29.2).
 * ===========================================================================
 *
 * FOUR TRACKS, STRUCTURALLY SEPARATE (§1.2):
 *   A  annual liability estimate  — DISPLAY ONLY, FED.ANNUAL.*, never net pay
 *   B  paycheck withholding       — Pub. 15-T Worksheet 1A, FED.FIT.*
 *   C  employee FICA              — SS, Medicare, Additional Medicare
 *   D  employer taxes             — employer SS, employer Medicare, FUTA
 *
 * Track A never feeds Track B, and TRACK A IS NEVER ALLOWED TO FAIL THE
 * PAYCHECK (§4.2): it is excluded from the status fold by construction.
 */

/**
 * Federal engine version (§29.4).
 *
 * Bumped whenever calculation BEHAVIOUR changes — including a rounding-policy
 * default change. A pure refactor does not bump it. Part of the snapshot and of
 * golden-test identity.
 */
export const FEDERAL_ENGINE_VERSION = '4.1.0-phase4';

export const FIT_METHOD = 'PUB15T_PERCENTAGE_AUTOMATED_WORKSHEET_1A';

function amountFrom(
  code: string,
  label: string,
  value: Money,
  rules: readonly RuleReference[],
): FederalAmount {
  return { code, label, amount: toStorageString(value), status: 'COMPLETE', rules };
}

function amountUnavailable(
  code: string,
  label: string,
  problem: FederalUnavailable,
): FederalAmount {
  return {
    code,
    label,
    // NEVER "0". An absent amount and a zero amount are different facts (§28.2).
    amount: null,
    status: statusForFederalReason(problem.reason),
    problem,
    rules: [],
  };
}

function referencesFor(
  context: FederalCalculationContext,
  ruleKeys: readonly string[],
): readonly RuleReference[] {
  return context.ruleSet.ruleReferences.filter((reference) => ruleKeys.includes(reference.ruleKey));
}

/** Turns a Read into an amount, recording the problem when absent. */
function amountFromRead<T extends { readonly ruleKeys: readonly string[] }>(
  code: string,
  label: string,
  result: Read<T>,
  pick: (value: T) => Money,
  context: FederalCalculationContext,
  note: (problem: FederalUnavailable) => void,
): FederalAmount {
  if (!result.ok) {
    note(result.problem);
    return amountUnavailable(code, label, result.problem);
  }
  return amountFrom(code, label, pick(result.value), referencesFor(context, result.value.ruleKeys));
}

/** Calculates federal taxes for one pay period. Pure. */
export function calculateFederalTaxes(
  context: FederalCalculationContext,
): FederalCalculationResult {
  const trace = new FederalTraceBuilder();
  const issues: FederalUnavailable[] = [];
  const disclosures: FederalDisclosure[] = [];
  const note = (problem: FederalUnavailable): void => {
    issues.push(problem);
  };
  const disclose = (code: string, message: string): void => {
    disclosures.push({ code, message });
  };

  // ---- 0. W-4 validation (§7.5, §8.4) ------------------------------------------
  const w4Issues = validateFederalW4(context.w4);

  // ---- 1. rule-set completeness + rounding policy (§2.6 step 1, §22) -----------
  const policyRead = resolveRoundingPolicy(context.ruleSet);
  const policy: FederalRoundingPolicy | null = policyRead.ok ? policyRead.value : null;
  if (!policyRead.ok) {
    note(policyRead.problem);
  } else {
    disclose('ROUNDING_POLICY', roundingDisclosure(policyRead.value));
  }

  // ---- 2. federal wage buckets (§19) -------------------------------------------
  const grossFederalWages = sum([
    money(context.wages.regular),
    money(context.wages.supplemental),
    money(context.wages.tips),
    money(context.wages.qualifiedOvertime),
  ]);

  const bucketOutcome = deriveFederalWageBuckets(
    grossFederalWages,
    context.deductions,
    context.taxabilityProfiles,
  );
  for (const problem of bucketOutcome.problems) {
    note(problem);
  }
  // The derived buckets are used AS DERIVED. A bucket the profiles could not
  // settle stays null, and every tax that needs it reports INCOMPLETE below.
  // Substituting zero here would silently under-withhold with no symptom.
  const buckets = bucketOutcome.buckets;

  /** One bucket's wages, or the reason that bucket could not be determined (§12.2). */
  const bucketWages = (bucket: FederalBucket): Read<Money> => {
    const problem = bucketOutcome.problemsByBucket[bucket];
    if (problem !== null) {
      return readFail(problem);
    }
    const value = buckets[bucket];
    if (value === null) {
      return readFail(
        unavailable(FederalReason.COMPONENT_NOT_STATED, `${bucket} could not be determined`),
      );
    }
    return readOk(money(value));
  };

  trace.add({
    stage: FederalTraceStage.WAGE_BUCKETS,
    description: 'Federal taxable wage buckets, each derived independently',
    inputs: { grossFederalWages: traceMoney(grossFederalWages) },
    outputs: { ...buckets },
    status: bucketOutcome.problems.length === 0 ? 'COMPLETE' : 'INCOMPLETE',
  });

  if (context.ytd.assumedZero) {
    disclose(
      'YTD_ASSUMED_ZERO',
      'No year-to-date figures were supplied, so this is calculated as the first pay period of ' +
        'the year. Mid-year and high-earner results will differ.',
    );
  }

  // ---- 3/4. pay periods (§20) ---------------------------------------------------
  const periodsRead = resolvePayPeriodsPerYear(context.ruleSet, context.payFrequency);
  if (!periodsRead.ok) {
    note(periodsRead.problem);
  }
  const periodsPerYear = periodsRead.ok ? periodsRead.value : null;

  trace.add({
    stage: FederalTraceStage.PAY_FREQUENCY,
    description: 'Periods per year from Worksheet 1A Table 3',
    inputs: { payFrequency: context.payFrequency },
    outputs: { periodsPerYear },
    status: periodsRead.ok ? 'COMPLETE' : statusForFederalReason(periodsRead.problem.reason),
  });

  // ---- 5. Track B: regular-wage withholding (§5) --------------------------------
  const fitWagesRead = bucketWages('federalIncomeTaxWages');
  const fitWages = fitWagesRead.ok ? fitWagesRead.value : null;
  let worksheetLines: WorksheetLines = {};
  let regularAmount: FederalAmount;
  let regularWithholding: Money = zero();

  const blocked = (problem: FederalUnavailable): FederalAmount => {
    note(problem);
    return amountUnavailable('FEDERAL_INCOME_TAX_WITHHELD', 'Federal income tax withheld', problem);
  };

  if (w4Issues.length > 0) {
    const first = w4Issues[0];
    regularAmount = blocked(
      unavailable(
        FederalReason.INPUT_INVALID,
        first === undefined ? 'Invalid W-4' : `${first.path}: ${first.message}`,
      ),
    );
  } else if (context.w4.isNonresidentAlien) {
    // Structure modelled, flag off, no approximation (§7.8).
    const nra = resolveNraAdjustment(
      context.ruleSet,
      context.payFrequency,
      context.w4.revision,
      context.flags,
    );
    regularAmount = blocked(
      nra.ok
        ? unavailable(
            FederalReason.SCENARIO_UNSUPPORTED,
            'Nonresident-alien withholding is modelled but not applied in Phase 4',
          )
        : nra.problem,
    );
    trace.add({
      stage: FederalTraceStage.NRA_ADJUSTMENT,
      description: 'Nonresident-alien wage addition',
      inputs: { payFrequency: context.payFrequency, revision: context.w4.revision },
      outputs: { applied: false },
      status: 'UNSUPPORTED_SCENARIO',
      note: 'Feature flag FEDERAL_NRA_ADJUSTMENT is off; the India carve-out is unresolved.',
    });
  } else if (context.w4.claimsExemption) {
    // §5.5 — the employee stated exemption on the form, so no FIT is withheld
    // on regular wages. FICA and FUTA are unaffected, and mandatory flat
    // supplemental withholding still applies below.
    regularAmount = amountFrom(
      'FEDERAL_INCOME_TAX_WITHHELD',
      'Federal income tax withheld',
      zero(),
      [],
    );
    disclose(
      'W4_EXEMPTION_CLAIMED',
      'The employee claims exemption from federal income tax withholding. Social Security, ' +
        'Medicare and FUTA are unaffected.',
    );
    if (
      context.w4.step4cExtraPerPeriod !== null &&
      !money(context.w4.step4cExtraPerPeriod).isZero()
    ) {
      // D-FIT-2 is an OPEN DECISION. The amount is preserved and surfaced; it is
      // neither applied as though verified nor silently dropped.
      const problem = unavailable(
        FederalReason.PENDING_VERIFICATION,
        'How a Step 4(c) amount interacts with an exemption claim is unresolved (D-FIT-2). The ' +
          'amount is preserved and reported, not applied or discarded.',
      );
      note(problem);
      disclose(
        'EXEMPT_WITH_STEP_4C',
        'An extra withholding amount was supplied alongside an exemption claim. Its treatment is ' +
          'pending verification; the amount has been preserved.',
      );
    }
  } else if (fitWages === null) {
    // Already recorded as an issue by the bucket stage; reported here as the
    // reason this component has no amount rather than counted a second time.
    regularAmount = amountUnavailable(
      'FEDERAL_INCOME_TAX_WITHHELD',
      'Federal income tax withheld',
      fitWagesRead.ok
        ? unavailable(FederalReason.COMPONENT_NOT_STATED, 'Federal income tax wages are not stated')
        : fitWagesRead.problem,
    );
  } else if (policy === null || periodsPerYear === null) {
    regularAmount = amountUnavailable(
      'FEDERAL_INCOME_TAX_WITHHELD',
      'Federal income tax withheld',
      policy === null
        ? unavailable(FederalReason.RULE_MISSING, 'The rounding policy rule is unavailable')
        : unavailable(FederalReason.RULE_MISSING, 'Periods per year is unavailable'),
    );
  } else {
    const worksheet = runWorksheet1A(context.ruleSet, context.w4, fitWages, periodsPerYear, policy);
    if (worksheet.ok) {
      worksheetLines = worksheet.value.lines;
      regularWithholding = worksheet.value.total;
      regularAmount = amountFrom(
        'FEDERAL_INCOME_TAX_WITHHELD',
        'Federal income tax withheld',
        worksheet.value.total,
        referencesFor(context, worksheet.value.ruleKeys),
      );
      trace.add({
        stage: FederalTraceStage.WORKSHEET_1A,
        description: 'Pub. 15-T Worksheet 1A, percentage method for automated systems',
        inputs: {
          taxableWages: traceMoney(fitWages),
          periodsPerYear,
          filingStatus: context.w4.filingStatus,
          step2Checked: context.w4.step2MultipleJobsChecked,
          revision: context.w4.revision,
        },
        outputs: { ...worksheet.value.lines },
        rules: referencesFor(context, worksheet.value.ruleKeys),
        rounding: policy.policyId,
      });
      trace.add({
        stage: FederalTraceStage.SCHEDULE_ROW,
        description: 'Rate-schedule row selected',
        inputs: {
          scheduleType: worksheet.value.scheduleType,
          filingStatus: context.w4.filingStatus,
        },
        outputs: {
          rowOrder: worksheet.value.selectedRowOrder,
          columnA: worksheet.value.lines['2b'] ?? null,
          columnC: worksheet.value.lines['2c'] ?? null,
          columnD: worksheet.value.lines['2d'] ?? null,
        },
      });
    } else {
      regularAmount = blocked(worksheet.problem);
    }
  }

  // ---- 6. Track B: supplemental wages (§5.6) ------------------------------------
  const supplementalWages = money(context.wages.supplemental);
  let supplementalAmount: FederalAmount;

  if (supplementalWages.isZero()) {
    supplementalAmount = amountFrom(
      'FEDERAL_SUPPLEMENTAL_WITHHELD',
      'Federal withholding on supplemental wages',
      zero(),
      [],
    );
  } else if (policy === null) {
    supplementalAmount = amountUnavailable(
      'FEDERAL_SUPPLEMENTAL_WITHHELD',
      'Federal withholding on supplemental wages',
      unavailable(FederalReason.RULE_MISSING, 'The rounding policy rule is unavailable'),
    );
  } else {
    // AGGREGATE needs Worksheet 1A run on combined wages; the increment over
    // the regular-only figure is the supplemental share (§5.6).
    let aggregateIncrement: Money | null = null;
    if (context.w4.claimsExemption) {
      // §5.5 — the exemption covers ordinary withholding, so the elected method
      // yields nothing. Only the MANDATORY flat rate survives an exemption
      // claim, which the supplemental module applies on the excess portion.
      aggregateIncrement = zero();
    } else if (
      context.supplementalMethod === SupplementalMethod.AGGREGATE &&
      periodsPerYear !== null &&
      fitWages !== null
    ) {
      const combined = runWorksheet1A(
        context.ruleSet,
        context.w4,
        add(fitWages, supplementalWages),
        periodsPerYear,
        policy,
      );
      if (combined.ok) {
        aggregateIncrement = combined.value.total.minus(regularWithholding);
      }
    }

    const supplemental = calculateSupplemental(
      context.ruleSet,
      {
        wages: supplementalWages,
        ytdWages: money(context.ytd.supplementalWages),
        // An exempt employee cannot elect a method that withholds; the
        // aggregate path with a zero increment is the honest representation.
        requestedMethod: context.w4.claimsExemption
          ? SupplementalMethod.AGGREGATE
          : context.supplementalMethod,
        federalIncomeTaxWithheldFromRegularWagesCurrentOrPriorYear:
          context.federalIncomeTaxWithheldFromRegularWagesCurrentOrPriorYear,
        aggregateIncrement,
      },
      policy,
    );

    supplementalAmount = amountFromRead(
      'FEDERAL_SUPPLEMENTAL_WITHHELD',
      'Federal withholding on supplemental wages',
      supplemental,
      (value) => value.withholding,
      context,
      note,
    );

    trace.add({
      stage: FederalTraceStage.SUPPLEMENTAL,
      description: 'Supplemental wage withholding',
      inputs: {
        requestedMethod: context.supplementalMethod,
        wages: traceMoney(supplementalWages),
        ytdWages: context.ytd.supplementalWages,
        optionalFlatEligible: context.federalIncomeTaxWithheldFromRegularWagesCurrentOrPriorYear,
      },
      outputs: {
        methodApplied: supplemental.ok ? supplemental.value.methodApplied : null,
        mandatoryPortion: supplemental.ok ? traceMoney(supplemental.value.mandatoryPortion) : null,
        electedPortion: supplemental.ok ? traceMoney(supplemental.value.electedPortion) : null,
        withholding: supplementalAmount.amount,
      },
      status: supplementalAmount.status,
    });
  }

  // ---- 7/8/9. Track C: employee FICA ---------------------------------------------
  const ssWagesRead = bucketWages('socialSecurityWages');
  const medWagesRead = bucketWages('medicareWages');
  /**
   * When the policy rule is unavailable every component that needs it is
   * already blocked, so this placeholder only keeps the arithmetic total-ordered
   * while those components report INCOMPLETE. It is never the source of a
   * reported figure — `methodology.roundingPolicy` stays null so nothing can
   * mistake it for a resolved policy.
   */
  const effectivePolicy: FederalRoundingPolicy = policy ?? {
    policyId: 'UNRESOLVED',
    currencyScale: 2,
    currencyMode: RoundingMode.HALF_UP,
    intermediateScale: 12,
    appliedAt: 'TAX_LEVEL',
  };

  const ssRead: ReturnType<typeof calculateSocialSecurity> = ssWagesRead.ok
    ? calculateSocialSecurity(
        context.ruleSet,
        ssWagesRead.value,
        money(context.ytd.socialSecurityWages),
        effectivePolicy,
      )
    : readFail(ssWagesRead.problem);
  const medRead: ReturnType<typeof calculateMedicare> = medWagesRead.ok
    ? calculateMedicare(context.ruleSet, medWagesRead.value, effectivePolicy)
    : readFail(medWagesRead.problem);
  const addlRead: ReturnType<typeof calculateAdditionalMedicare> = medWagesRead.ok
    ? calculateAdditionalMedicare(
        context.ruleSet,
        medWagesRead.value,
        money(context.ytd.medicareWages),
        effectivePolicy,
      )
    : readFail(medWagesRead.problem);

  const socialSecurityEmployee = amountFromRead(
    'SOCIAL_SECURITY_EMPLOYEE',
    'Social Security (employee)',
    ssRead,
    (value) => value.employee,
    context,
    note,
  );
  const medicareEmployee = amountFromRead(
    'MEDICARE_EMPLOYEE',
    'Medicare (employee)',
    medRead,
    (value) => value.employee,
    context,
    note,
  );
  const additionalMedicareEmployee = amountFromRead(
    'ADDITIONAL_MEDICARE_EMPLOYEE',
    'Additional Medicare (employee)',
    addlRead,
    (value) => value.employee,
    context,
    note,
  );

  if (addlRead.ok && addlRead.value.thresholdInclusive === null) {
    disclose(
      'ADDL_MEDICARE_THRESHOLD_SEMANTICS',
      'Whether the Additional Medicare threshold comparison is inclusive at exactly the ' +
        'threshold is pending verification. It affects only an exact-threshold wage.',
    );
  }

  trace.add({
    stage: FederalTraceStage.SOCIAL_SECURITY,
    description: 'Social Security, capped by the annual wage base',
    inputs: {
      wages: ssWagesRead.ok ? traceMoney(ssWagesRead.value) : null,
      ytdWages: context.ytd.socialSecurityWages,
    },
    outputs: {
      remainingBase: ssRead.ok ? traceMoney(ssRead.value.wageBaseRemaining) : null,
      taxable: ssRead.ok ? traceMoney(ssRead.value.taxableThisPeriod) : null,
      employee: socialSecurityEmployee.amount,
      employer: ssRead.ok ? traceMoney(ssRead.value.employer) : null,
    },
    rules: socialSecurityEmployee.rules,
    status: socialSecurityEmployee.status,
    rounding: effectivePolicy.policyId,
  });

  trace.add({
    stage: FederalTraceStage.MEDICARE,
    description: 'Medicare',
    inputs: { wages: medWagesRead.ok ? traceMoney(medWagesRead.value) : null },
    outputs: {
      wageBaseBasis: medRead.ok ? medRead.value.wageBaseBasis : null,
      employee: medicareEmployee.amount,
      employer: medRead.ok ? traceMoney(medRead.value.employer) : null,
    },
    rules: medicareEmployee.rules,
    status: medicareEmployee.status,
    rounding: effectivePolicy.policyId,
  });

  trace.add({
    stage: FederalTraceStage.ADDITIONAL_MEDICARE,
    description: 'Additional Medicare — employee only, filing-status independent',
    inputs: {
      wages: medWagesRead.ok ? traceMoney(medWagesRead.value) : null,
      priorYtd: context.ytd.medicareWages,
    },
    outputs: {
      newYtd: addlRead.ok ? traceMoney(addlRead.value.newYtd) : null,
      threshold: addlRead.ok ? traceMoney(addlRead.value.threshold) : null,
      taxable: addlRead.ok ? traceMoney(addlRead.value.taxableThisPeriod) : null,
      employee: additionalMedicareEmployee.amount,
    },
    rules: additionalMedicareEmployee.rules,
    status: additionalMedicareEmployee.status,
    rounding: effectivePolicy.policyId,
  });

  const employeeParts = [
    regularAmount,
    supplementalAmount,
    socialSecurityEmployee,
    medicareEmployee,
    additionalMedicareEmployee,
  ];
  const employeeTotal: FederalAmount = employeeParts.every((part) => part.amount !== null)
    ? amountFrom(
        'TOTAL_EMPLOYEE_FEDERAL_TAXES',
        'Total employee federal taxes',
        roundTax(sum(employeeParts.map((part) => money(part.amount ?? '0'))), effectivePolicy),
        [],
      )
    : amountUnavailable(
        'TOTAL_EMPLOYEE_FEDERAL_TAXES',
        'Total employee federal taxes',
        unavailable(
          FederalReason.COMPONENT_NOT_STATED,
          'At least one employee component is undetermined, so no total is stated',
        ),
      );

  // ---- 10. Track D: employer taxes (§17, §18) -----------------------------------
  let employer: FederalEmployerResult | null = null;

  if (context.includeEmployerTaxes) {
    const futaWagesRead = bucketWages('futaWages');
    const futaRead: ReturnType<typeof calculateFuta> = futaWagesRead.ok
      ? calculateFuta(
          context.ruleSet,
          futaWagesRead.value,
          money(context.ytd.futaWages),
          context.employerSubjectToFuta,
          effectivePolicy,
        )
      : readFail(futaWagesRead.problem);

    const socialSecurityEmployer = amountFromRead(
      'SOCIAL_SECURITY_EMPLOYER',
      'Social Security (employer)',
      ssRead,
      (value) => value.employer,
      context,
      note,
    );
    const medicareEmployer = amountFromRead(
      'MEDICARE_EMPLOYER',
      'Medicare (employer)',
      medRead,
      (value) => value.employer,
      context,
      note,
    );
    const futaEmployer = amountFromRead(
      'FUTA_EMPLOYER',
      'FUTA (employer)',
      futaRead,
      (value) => value.employer,
      context,
      note,
    );

    const employerParts = [socialSecurityEmployer, medicareEmployer, futaEmployer];
    const employerTotal: FederalAmount = employerParts.every((part) => part.amount !== null)
      ? amountFrom(
          'TOTAL_EMPLOYER_FEDERAL_TAXES',
          'Total employer federal taxes',
          roundTax(sum(employerParts.map((part) => money(part.amount ?? '0'))), effectivePolicy),
          [],
        )
      : amountUnavailable(
          'TOTAL_EMPLOYER_FEDERAL_TAXES',
          'Total employer federal taxes',
          unavailable(
            FederalReason.COMPONENT_NOT_STATED,
            'At least one employer component is undetermined, so no total is stated',
          ),
        );

    const employerDisclosures = [
      'This employer cost covers federal taxes only. It excludes state employer taxes, SUTA, ' +
        'benefits and workers’ compensation, so it is a partial figure.',
    ];
    if (futaRead.ok) {
      employerDisclosures.push(
        'FUTA uses the standard credit. State credit reductions were not evaluated.',
      );
      employerDisclosures.push(
        'FUTA assumes the employer is subject to FUTA; the statutory employer tests are not evaluated.',
      );
    }

    employer = {
      socialSecurityEmployer,
      medicareEmployer,
      futaEmployer,
      totalEmployerFederalTaxes: employerTotal,
      disclosures: employerDisclosures,
    };

    trace.add({
      stage: FederalTraceStage.FUTA,
      description: 'FUTA — employer only, never a paycheck deduction',
      inputs: { wages: buckets.futaWages, ytdWages: context.ytd.futaWages },
      outputs: {
        grossRate: futaRead.ok ? traceMoney(futaRead.value.grossRate) : null,
        credit: futaRead.ok ? traceMoney(futaRead.value.credit) : null,
        effectiveRate: futaRead.ok ? traceMoney(futaRead.value.effectiveRate) : null,
        employer: futaEmployer.amount,
        creditReductionEvaluated: false,
      },
      rules: futaEmployer.rules,
      status: futaEmployer.status,
      rounding: effectivePolicy.policyId,
    });

    trace.add({
      stage: FederalTraceStage.EMPLOYER_TAXES,
      description: 'Employer federal payroll taxes, reported apart from employee pay',
      inputs: {},
      outputs: { total: employerTotal.amount },
      status: employerTotal.status,
    });
  }

  // ---- 11. Track A: annual estimate. NEVER FAILS THE PAYCHECK (§4.2) -------------
  let estimates: FederalEstimates | null = null;

  if (context.includeAnnualEstimate) {
    const annualGross =
      periodsPerYear === null || fitWages === null ? null : annualize(fitWages, periodsPerYear);
    const annual =
      annualGross === null || policy === null
        ? null
        : calculateAnnualLiability(context.ruleSet, annualGross, context.w4.filingStatus, policy);

    if (annual !== null && annual.ok && annualGross !== null) {
      const rate = effectiveAnnualRate(annual.value.liability, annualGross, 6);
      estimates = {
        isEstimate: true,
        available: true,
        annualFederalIncomeTaxEstimate: toStorageString(annual.value.liability),
        effectiveFederalRateEstimate: rate === null ? null : toStorageString(rate),
        taxableIncome: toStorageString(annual.value.taxableIncome),
        limitations: annual.value.limitations,
        unavailableReason: null,
      };
    } else {
      // Unavailable — recorded, NOT added to `issues` and NOT folded into the
      // status. Track A must never degrade the paycheck (§4.2).
      estimates = {
        isEstimate: true,
        available: false,
        annualFederalIncomeTaxEstimate: null,
        effectiveFederalRateEstimate: null,
        taxableIncome: null,
        limitations: [],
        unavailableReason:
          annual !== null && !annual.ok
            ? annual.problem.detail
            : 'Annual estimate inputs are unavailable',
      };
    }

    disclose(
      'ANNUAL_ESTIMATE_DISPLAY_ONLY',
      'The annual figure is a wages-only estimate for display. It is not the amount withheld ' +
        'from any paycheck.',
    );

    trace.add({
      stage: FederalTraceStage.ANNUAL_ESTIMATE,
      description: 'Annual liability estimate (Track A — display only)',
      inputs: { annualGross: annualGross === null ? null : traceMoney(annualGross) },
      outputs: {
        available: estimates.available,
        liability: estimates.annualFederalIncomeTaxEstimate,
      },
      status: 'COMPLETE',
    });
  }

  trace.add({
    stage: FederalTraceStage.DISCLOSURES,
    description: 'Disclosures, assumptions and feature flags',
    inputs: { ...context.flags },
    outputs: { disclosureCount: disclosures.length },
  });

  // ---- 12/13. status fold and invariants (§28.4, §28.5) --------------------------
  // Track A is deliberately absent from this list.
  const statuses: CalculationStatus[] = employeeParts.map((part) => part.status);
  if (employer !== null) {
    statuses.push(employer.totalEmployerFederalTaxes.status);
  }
  if (bucketOutcome.problems.length > 0) {
    statuses.push('INCOMPLETE');
  }
  if (w4Issues.length > 0) {
    statuses.push('INVALID_INPUT');
  }

  const result: FederalCalculationResult = {
    status: combineStatuses(statuses),
    engineVersion: FEDERAL_ENGINE_VERSION,
    taxYear: context.taxYear,
    effectiveDate: context.effectiveDate,
    methodology: {
      fitMethod: FIT_METHOD,
      supplementalMethod: supplementalWages.isZero() ? null : context.supplementalMethod,
      roundingPolicy: policy,
    },
    buckets,
    worksheetLines,
    employee: {
      federalIncomeTaxWithheld: regularAmount,
      supplementalWithheld: supplementalAmount,
      socialSecurityEmployee,
      medicareEmployee,
      additionalMedicareEmployee,
      totalEmployeeFederalTaxes: employeeTotal,
    },
    employer,
    estimates,
    disclosures,
    flags: context.flags,
    ruleReferences: context.ruleSet.ruleReferences,
    sourceIds: context.ruleSet.sourceIds,
    trace: trace.build(),
    issues,
    missingRules: context.ruleSet.missing,
  };

  const breaches = assertFederalInvariants(result);
  if (breaches.length === 0) {
    return result;
  }

  // An invariant breach is an engine defect, not a data state (§28.5).
  const first = breaches[0];
  return {
    ...result,
    status: 'CALCULATION_ERROR',
    issues: [
      ...issues,
      unavailable(
        FederalReason.INVARIANT_BREACH,
        first === undefined ? 'Invariant breach' : `${first.id}: ${first.detail}`,
      ),
    ],
  };
}

export { FEDERAL_BUCKETS, Taxability } from './wages/federalWageBuckets';
export { SupplementalMethod } from './fit/supplemental';
export { DEFAULT_FEDERAL_FLAGS, withFlags } from './flags';
export { toFederalW4, deriveScenario, federalYtdOrZero, validateFederalW4 } from './context';
export { FederalRuleKey, FilingStatus, requiredRuleKeys } from './rule-keys';
export { FederalReason } from './errors/federal-errors';
export { resolveRoundingPolicy } from './rounding/federal-rounding';
export type { FederalCalculationContext, FederalCalculationResult } from './types';

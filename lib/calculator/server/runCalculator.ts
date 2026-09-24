'use server';

import { z } from 'zod';

import { GENERIC_CURRENCY_POLICY, calculatePaycheck } from '@/lib/calculator';
import type { CalculationInput, PayBasis } from '@/lib/calculator/types/input';
import type { CalculationResult } from '@/lib/calculator/types/result';
import { DEFAULT_FEDERAL_FLAGS } from '@/lib/tax/federal/flags';
import { type FilingStatus, isFilingStatus } from '@/lib/tax/federal/rule-keys';
import {
  resolveFederalRuleSet,
  type FederalResolutionQuery,
} from '@/lib/tax/federal/rules/resolver';
import { getDefault as getDefaultTaxYear } from '@/lib/tax-years/repository';

import { CALCULATOR_UI_FREQUENCIES, getCalculatorDefinition } from '../../seo/calculators/registry';
import { ENGINE_VERSION } from '../index';

/**
 * Calculator page → existing calculation engine orchestration (SEO-05 contract §10, §14).
 *
 * ===========================================================================
 * ONE ENGINE, ONE RESOLVER. NO NEW CALCULATION LOGIC.
 *
 * This is the ONLY new code between a calculator page's form and `calculatePaycheck()`. It:
 *   1. Validates shape only (contract §13) — the same "reject nonsense, never judge
 *      plausibility" rule `lib/calculator/validation/input-schema.ts` already follows.
 *   2. Resolves LIVE federal rules via the existing Stage A resolver
 *      (`resolveFederalRuleSet`, Phase 4) — never a second resolution path, never a synthetic
 *      rule set outside tests.
 *   3. Calls the existing, unmodified `calculatePaycheck()` (Stage B).
 *
 * It duplicates NO federal formula, NO FICA formula, NO deduction logic, NO pay-period
 * conversion (contract §10). State/local components are supplied no rules (`rules: { byCategory:
 * {} }`) — Phase 5's state engine is not wired into `calculatePaycheck()` (SEO-05 inspection
 * report §3, §11; SEO-05 contract §11 forbids "silently solving the entire state-calculation
 * integration problem"), so every calculator built in SEO-05 is FEDERAL-ONLY. This means
 * `netPay`/`totalEmployeeTaxes` will be `null` and `status` will never reach `COMPLETE` today —
 * not a bug introduced here, an honest, fail-closed consequence of that still-open boundary.
 * The UI must show this as an explicit INCOMPLETE outcome, never as a fabricated total
 * (contract §13, §31).
 *
 * SERVER-ONLY BY CONSTRUCTION (`'use server'`): rule resolution needs the database, so this
 * can never run in the browser (contract §14, §32 — no server secret or private rule data
 * ever reaches the client; the client only ever receives this function's plain-data return
 * value).
 * ===========================================================================
 */

const decimalString = z
  .string()
  .trim()
  .regex(/^\d+(\.\d+)?$/, 'Must be a positive decimal number');

const optionalDecimalString = decimalString.optional();

const calculatorFormInputSchema = z.object({
  calculatorKey: z.string().min(1),
  payBasis: z.enum(['SALARY', 'HOURLY']),
  payFrequency: z.enum(CALCULATOR_UI_FREQUENCIES as [string, ...string[]]),
  filingStatus: z.string().refine(isFilingStatus, 'Unrecognized filing status'),
  annualSalary: optionalDecimalString,
  hourlyRate: optionalDecimalString,
  regularHours: optionalDecimalString,
  overtimeHours: optionalDecimalString,
  overtimeMultiplier: optionalDecimalString,
  bonus: optionalDecimalString,
});

export type CalculatorFormInput = z.input<typeof calculatorFormInputSchema>;

export interface CalculatorFormFieldIssue {
  readonly path: string;
  readonly message: string;
}

export type CalculatorRunOutcome =
  | {
      readonly ok: true;
      readonly taxYear: number;
      readonly result: CalculationResult;
    }
  | {
      readonly ok: false;
      readonly reason: 'REQUEST_INVALID' | 'UNKNOWN_CALCULATOR' | 'NO_DEFAULT_TAX_YEAR';
      readonly issues?: readonly CalculatorFormFieldIssue[];
    };

function hasPositiveAmount(value: string | undefined): boolean {
  return value !== undefined && Number(value) > 0;
}

/** Runs one calculator request end to end. Never throws — every failure mode (bad input,
 * unknown calculator, no default tax year, or a calculation-engine outcome short of COMPLETE)
 * is reported through `CalculatorRunOutcome`/`CalculationStatus`, never silently substituted. */
export async function runCalculator(rawInput: CalculatorFormInput): Promise<CalculatorRunOutcome> {
  const parsed = calculatorFormInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    return {
      ok: false,
      reason: 'REQUEST_INVALID',
      issues: parsed.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
    };
  }
  const input = parsed.data;

  const definition = getCalculatorDefinition(input.calculatorKey);
  if (definition === null) {
    return { ok: false, reason: 'UNKNOWN_CALCULATOR' };
  }
  if (!(definition.supportedPayBases as readonly string[]).includes(input.payBasis)) {
    return {
      ok: false,
      reason: 'REQUEST_INVALID',
      issues: [
        {
          path: 'payBasis',
          message: `${definition.displayName} does not accept ${input.payBasis}`,
        },
      ],
    };
  }

  const payBasis: PayBasis = input.payBasis;
  if (payBasis === 'SALARY' && input.annualSalary === undefined) {
    return {
      ok: false,
      reason: 'REQUEST_INVALID',
      issues: [{ path: 'annualSalary', message: 'Required for salary pay' }],
    };
  }
  if (
    payBasis === 'HOURLY' &&
    (input.hourlyRate === undefined || input.regularHours === undefined)
  ) {
    return {
      ok: false,
      reason: 'REQUEST_INVALID',
      issues: [
        {
          path: 'hourlyRate',
          message: 'Hourly rate and regular hours are required for hourly pay',
        },
      ],
    };
  }

  const taxYear = await getDefaultTaxYear();
  if (taxYear === null) {
    return { ok: false, reason: 'NO_DEFAULT_TAX_YEAR' };
  }

  const effectiveDate = new Date();
  const filingStatus: FilingStatus = input.filingStatus as FilingStatus;
  const hasSupplementalWages = hasPositiveAmount(input.bonus);

  const federalQuery: FederalResolutionQuery = {
    taxYear: taxYear.year,
    effectiveDate,
    engineVersion: ENGINE_VERSION,
    resolvedAt: effectiveDate,
    scenario: {
      wantsFitWithholding: true,
      claimsExemption: false,
      step2MultipleJobsChecked: false,
      isPre2020W4: false,
      hasSupplementalWages,
      isNonresidentAlien: false,
      nraFlagEnabled: DEFAULT_FEDERAL_FLAGS.FEDERAL_NRA_ADJUSTMENT,
      wantsAnnualEstimate: false,
      wantsEmployerTaxes: true,
    },
  };

  const federalRuleSet = await resolveFederalRuleSet(federalQuery);

  const calculationInput: CalculationInput = {
    taxYear: taxYear.year,
    effectiveDate,
    employee: { workLocation: {} },
    pay: {
      basis: payBasis,
      payFrequency: input.payFrequency as CalculationInput['pay']['payFrequency'],
      ...(input.annualSalary === undefined ? {} : { annualSalary: input.annualSalary }),
      ...(input.hourlyRate === undefined ? {} : { hourlyRate: input.hourlyRate }),
      ...(input.regularHours === undefined ? {} : { regularHours: input.regularHours }),
      ...(input.overtimeHours === undefined
        ? {}
        : {
            overtimeHours: input.overtimeHours,
            overtimeMultiplier: input.overtimeMultiplier ?? '1.5',
          }),
      ...(input.bonus === undefined ? {} : { bonus: input.bonus }),
    },
    w4: { filingStatus },
  };

  const result = calculatePaycheck(calculationInput, {
    rounding: GENERIC_CURRENCY_POLICY,
    rules: { byCategory: {} },
    federal: { ruleSet: federalRuleSet },
  });

  return { ok: true, taxYear: taxYear.year, result };
}

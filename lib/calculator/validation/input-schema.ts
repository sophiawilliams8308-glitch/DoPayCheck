import { z } from 'zod';

import { PAY_FREQUENCIES } from '../pipeline/pay-frequency';
import type { FieldIssue } from '@/lib/errors/app-error';

/**
 * Calculation input validation (pipeline stage 1).
 *
 * Validates SHAPE and INTERNAL CONSISTENCY only. It never judges whether an amount is
 * plausible — there is no correct range for a salary, and rejecting one would be inventing
 * policy.
 *
 * A validation failure yields INVALID_INPUT, which is deliberately distinct from missing tax
 * data (INCOMPLETE) — the caller can fix the former, only sourcing fixes the latter.
 */

const decimalString = z
  .string()
  .trim()
  .regex(/^-?\d+(\.\d+)?$/, 'Must be a decimal number expressed as a string');

const nonNegativeDecimal = decimalString.refine(
  (value) => !value.startsWith('-'),
  'Must not be negative',
);

const locationSchema = z.object({
  stateCode: z.string().trim().min(1).optional(),
  countyCode: z.string().trim().min(1).optional(),
  cityCode: z.string().trim().min(1).optional(),
  localityCode: z.string().trim().min(1).optional(),
  zipCode: z.string().trim().min(1).optional(),
});

const deductionTaxabilitySchema = z.object({
  federalIncomeTax: z.boolean().optional(),
  socialSecurity: z.boolean().optional(),
  medicare: z.boolean().optional(),
  stateIncomeTax: z.boolean().optional(),
  localIncomeTax: z.boolean().optional(),
  futa: z.boolean().optional(),
  suta: z.boolean().optional(),
});

const deductionSchema = z
  .object({
    id: z.string().trim().min(1),
    label: z.string().trim().optional(),
    basis: z.enum(['FIXED_AMOUNT', 'PERCENT_OF_GROSS']),
    amount: nonNegativeDecimal.optional(),
    percent: nonNegativeDecimal.optional(),
    enabled: z.boolean().optional(),
    ordinal: z.number().int().min(0).optional(),
    deductionTypeKey: z.string().trim().min(1).optional(),
    taxability: deductionTaxabilitySchema,
  })
  .superRefine((value, ctx) => {
    if (value.basis === 'FIXED_AMOUNT' && value.amount === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['amount'],
        message: 'amount is required for FIXED_AMOUNT',
      });
    }
    if (value.basis === 'PERCENT_OF_GROSS' && value.percent === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['percent'],
        message: 'percent is required for PERCENT_OF_GROSS',
      });
    }
  });

const paySchema = z
  .object({
    basis: z.enum(['SALARY', 'HOURLY']),
    payFrequency: z.enum(PAY_FREQUENCIES),
    annualSalary: nonNegativeDecimal.optional(),
    hourlyRate: nonNegativeDecimal.optional(),
    regularHours: nonNegativeDecimal.optional(),
    overtimeHours: nonNegativeDecimal.optional(),
    overtimeRate: nonNegativeDecimal.optional(),
    overtimeMultiplier: nonNegativeDecimal.optional(),
    bonus: nonNegativeDecimal.optional(),
    commission: nonNegativeDecimal.optional(),
    tips: nonNegativeDecimal.optional(),
    otherCompensation: nonNegativeDecimal.optional(),
    periodsPerYear: z.number().int().min(1).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.basis === 'SALARY' && value.annualSalary === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['annualSalary'],
        message: 'annualSalary is required when basis is SALARY',
      });
    }
    if (value.basis === 'HOURLY') {
      if (value.hourlyRate === undefined) {
        ctx.addIssue({
          code: 'custom',
          path: ['hourlyRate'],
          message: 'hourlyRate is required when basis is HOURLY',
        });
      }
      if (value.regularHours === undefined && value.overtimeHours === undefined) {
        ctx.addIssue({
          code: 'custom',
          path: ['regularHours'],
          message: 'regularHours or overtimeHours is required when basis is HOURLY',
        });
      }
    }
    if (value.overtimeHours !== undefined) {
      const hasRate = value.overtimeRate !== undefined;
      const hasMultiplier = value.overtimeMultiplier !== undefined;
      // Neither is ever assumed — jurisdiction overtime law is rule-driven (Phase 5).
      if (!hasRate && !hasMultiplier) {
        ctx.addIssue({
          code: 'custom',
          path: ['overtimeMultiplier'],
          message:
            'overtimeRate or overtimeMultiplier is required when overtimeHours is supplied; ' +
            'the engine does not assume an overtime premium',
        });
      }
      if (hasRate && hasMultiplier) {
        ctx.addIssue({
          code: 'custom',
          path: ['overtimeRate'],
          message: 'overtimeRate and overtimeMultiplier are mutually exclusive; supply exactly one',
        });
      }
    }
  });

/**
 * Phase 5 state inputs. ADDITIVE — `w4` above is untouched.
 *
 * An amount election must declare its unit. The alternative is guessing whether
 * a state form's "additional amount" is annual or per period, and guessing wrong
 * is off by a factor of the pay-period count on every cheque.
 */
const stateElectionValueSchema = z
  .object({
    fieldKey: z.string().trim().min(1),
    value: z.union([decimalString, z.number(), z.boolean()]),
    unit: z.enum(['ANNUAL', 'PER_PERIOD']).optional(),
  })
  .superRefine((election, ctx) => {
    if (typeof election.value === 'string' && election.unit === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['unit'],
        message: 'An amount election must declare its unit as ANNUAL or PER_PERIOD',
      });
    }
  });

const stateElectionsSchema = z.object({
  formCode: z.string().trim().min(1),
  filingStatus: z.string().trim().min(1).optional(),
  values: z.array(stateElectionValueSchema).optional(),
});

const stateInputSchema = z.object({
  workState: z.string().trim().min(1).optional(),
  residenceState: z.string().trim().min(1).optional(),
  residencyStatus: z.enum(['RESIDENT', 'NONRESIDENT', 'PART_YEAR_RESIDENT']).optional(),
  stateElections: z.record(z.string().trim().min(1), stateElectionsSchema).optional(),
  /** Non-negative integer only — no coercion, no rounding, no default. */
  allowanceCounts: z.record(z.string().trim().min(1), z.number().int().min(0)).optional(),
  employerEmployeeCount: z.number().int().min(0).optional(),
  employerSutaRate: nonNegativeDecimal.optional(),
  employerPlanElection: z.boolean().optional(),
  reciprocityCertificateFiled: z.boolean().optional(),
});

export const calculationInputSchema = z.object({
  taxYear: z.number().int().min(1900).max(2200),
  effectiveDate: z.date(),
  employee: z.object({
    employeeId: z.string().trim().min(1).optional(),
    workLocation: locationSchema,
    residenceLocation: locationSchema.optional(),
  }),
  pay: paySchema,
  w4: z.object({
    filingStatus: z.string().trim().min(1),
    multipleJobs: z.boolean().optional(),
    dependentsAmount: nonNegativeDecimal.optional(),
    otherIncome: nonNegativeDecimal.optional(),
    deductionsAmount: nonNegativeDecimal.optional(),
    additionalWithholding: nonNegativeDecimal.optional(),
    // Phase 4 additive fields. Optional, so every existing caller stays valid.
    w4Revision: z.enum(['PRE_2020', 'REVISION_2020_PLUS']).optional(),
    claimsExemption: z.boolean().optional(),
    isNonresidentAlien: z.boolean().optional(),
    pre2020Allowances: z.number().int().min(0).optional(),
  }),
  preTaxDeductions: z.array(deductionSchema).optional(),
  postTaxDeductions: z.array(deductionSchema).optional(),
  ytd: z
    .object({
      grossWages: nonNegativeDecimal.optional(),
      socialSecurityWages: nonNegativeDecimal.optional(),
      medicareWages: nonNegativeDecimal.optional(),
      federalWithholding: nonNegativeDecimal.optional(),
      stateWithholding: nonNegativeDecimal.optional(),
      localWithholding: nonNegativeDecimal.optional(),
    })
    .optional(),
  // Phase 5 additive block. Optional throughout, so every existing caller stays valid.
  state: stateInputSchema.optional(),
});

export type ValidationOutcome =
  { readonly valid: true } | { readonly valid: false; readonly issues: readonly FieldIssue[] };

/** Stage 1 — validateInput. Returns issues rather than throwing. */
export function validateInput(input: unknown): ValidationOutcome {
  const result = calculationInputSchema.safeParse(input);
  if (result.success) {
    return { valid: true };
  }
  return {
    valid: false,
    issues: result.error.issues.map((issue) => ({
      path: issue.path.join('.'),
      message: issue.message,
    })),
  };
}

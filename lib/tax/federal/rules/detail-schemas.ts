import { z } from 'zod';

/**
 * Federal rule detail shapes — spec §6.3, with the §6.4 unit discipline.
 *
 * ===========================================================================
 * SHAPE ONLY. NOT ONE TAX VALUE IN THIS FILE.
 *
 * Every amount, rate, threshold and bracket bound is a nullable decimal STRING
 * supplied later from a verified official source. `null` means the source does
 * not state the value — never zero, never a default.
 * ===========================================================================
 *
 * RATE UNIT DISCIPLINE (§6.4). Every rate carries an explicit `unit`. A
 * percent/fraction mix-up is a 100x error, so the unit is mandatory data rather
 * than a convention, and conversion happens exactly once — in `readRate()` at
 * the Stage A/Stage B boundary.
 */

const decimalString = z
  .string()
  .trim()
  .regex(/^-?\d+(\.\d+)?$/, 'Must be a decimal number expressed as a string');

/** `null` records "not stated by the source", which is never the same as "0". */
const nullableDecimal = decimalString.nullable();

const filingStatusKey = z.enum(['SINGLE_OR_MFS', 'MARRIED_FILING_JOINTLY', 'HEAD_OF_HOUSEHOLD']);

/** §6.4 — the unit a rate is expressed in. Mandatory. */
export const RateUnit = z.enum(['PERCENT', 'DECIMAL_FRACTION']);

// --- §6.3 shape: RATE -------------------------------------------------------
export const rateDetailSchema = z.object({
  shape: z.literal('RATE'),
  rate: nullableDecimal,
  unit: RateUnit,
  appliesTo: z.enum(['EMPLOYEE', 'EMPLOYER']),
});

// --- §6.3 shape: WAGE_BASE --------------------------------------------------
export const wageBaseDetailSchema = z.object({
  shape: z.literal('WAGE_BASE'),
  amount: nullableDecimal,
  basis: z.literal('ANNUAL'),
  /**
   * `NOT_APPLICABLE` is a positive, source-backed statement that no base exists
   * (§14.3). It is emphatically different from an absent record, which means
   * the data is missing and the calculation must refuse.
   */
  applicability: z.enum(['APPLIES', 'NOT_APPLICABLE']),
});

// --- §6.3 shape: THRESHOLD --------------------------------------------------
export const thresholdDetailSchema = z.object({
  shape: z.literal('THRESHOLD'),
  amount: nullableDecimal,
  basis: z.literal('ANNUAL_YTD'),
  /** `null` while the strict-vs-inclusive question is PENDING VERIFICATION V-02. */
  inclusive: z.boolean().nullable(),
});

// --- §6.3 shape: AMOUNT_BY_FILING_STATUS ------------------------------------
export const amountByFilingStatusDetailSchema = z.object({
  shape: z.literal('AMOUNT_BY_FILING_STATUS'),
  amounts: z.array(z.object({ filingStatus: filingStatusKey, amount: nullableDecimal })),
});

// --- §6.3 shape: AMOUNT_BY_PAY_PERIOD ---------------------------------------
export const amountByPayPeriodDetailSchema = z.object({
  shape: z.literal('AMOUNT_BY_PAY_PERIOD'),
  amounts: z.array(z.object({ payFrequency: z.string().trim().min(1), amount: nullableDecimal })),
});

// --- §6.3 shape: COUNT_BY_PAY_PERIOD (Worksheet 1A Table 3) -----------------
export const countByPayPeriodDetailSchema = z.object({
  shape: z.literal('COUNT_BY_PAY_PERIOD'),
  counts: z.array(
    z.object({
      payFrequency: z.string().trim().min(1),
      /** `null` where no official factor is published (e.g. ANNUAL — V-05). */
      count: z.number().int().min(1).nullable(),
    }),
  ),
});

// --- §6.3 shape: SCALAR_AMOUNT ----------------------------------------------
export const scalarAmountDetailSchema = z.object({
  shape: z.literal('SCALAR_AMOUNT'),
  amount: nullableDecimal,
});

// --- §6.3 shape: POLICY (rounding — §22.3, policy is rule data) -------------
export const roundingPolicyDetailSchema = z.object({
  shape: z.literal('POLICY'),
  policyId: z.string().trim().min(1),
  currencyScale: z.number().int().min(0).max(12),
  currencyMode: z.enum(['HALF_UP', 'HALF_EVEN', 'DOWN', 'UP']),
  intermediateScale: z.number().int().min(2).max(30),
  /** Where rounding is applied. Pub. 15-T is permissive; the choice is ours and disclosed. */
  appliedAt: z.enum(['TAX_LEVEL', 'STEP_LEVEL']),
});

// --- §6.3 shape: BRACKET_TABLE (Track A ONLY — no base amount column) -------
export const bracketTableDetailSchema = z.object({
  shape: z.literal('BRACKET_TABLE'),
  bracketSets: z.array(
    z.object({
      filingStatus: filingStatusKey,
      brackets: z.array(
        z.object({
          rowOrder: z.number().int().min(0),
          atLeast: nullableDecimal,
          lessThan: nullableDecimal,
          rate: nullableDecimal,
          unit: RateUnit,
        }),
      ),
    }),
  ),
});

// --- Track B withholding schedule (§6.2 / D-SCHEMA-2: JSON per Phase 2) -----
/**
 * Columns A/B/C/D exactly as Pub. 15-T publishes them.
 *
 * Deliberately a DIFFERENT shape from BRACKET_TABLE: Track A brackets have no
 * base-amount column, and making them share a type would invite exactly the
 * substitution error the project forbids (§6.3).
 */
export const withholdingScheduleRowSchema = z.object({
  rowOrder: z.number().int().min(0),
  /** Column A. */
  atLeast: nullableDecimal,
  /** Column B. `null` marks the open-ended final row (FIT-INV-5). */
  lessThan: nullableDecimal,
  /** Column C. */
  baseAmount: nullableDecimal,
  /** Column D. */
  rate: nullableDecimal,
  unit: RateUnit,
});

export type WithholdingScheduleRow = z.infer<typeof withholdingScheduleRowSchema>;

export const withholdingScheduleDetailSchema = z.object({
  shape: z.literal('WITHHOLDING_SCHEDULE'),
  method: z.literal('PERCENTAGE_AUTOMATED'),
  scheduleType: z.enum(['STANDARD', 'STEP2_CHECKBOX']),
  payPeriodBasis: z.literal('ANNUAL'),
  schedules: z.array(
    z.object({
      filingStatus: filingStatusKey,
      rows: z.array(withholdingScheduleRowSchema),
    }),
  ),
});

export type RateDetail = z.infer<typeof rateDetailSchema>;
export type WageBaseDetail = z.infer<typeof wageBaseDetailSchema>;
export type ThresholdDetail = z.infer<typeof thresholdDetailSchema>;
export type AmountByFilingStatusDetail = z.infer<typeof amountByFilingStatusDetailSchema>;
export type AmountByPayPeriodDetail = z.infer<typeof amountByPayPeriodDetailSchema>;
export type CountByPayPeriodDetail = z.infer<typeof countByPayPeriodDetailSchema>;
export type ScalarAmountDetail = z.infer<typeof scalarAmountDetailSchema>;
export type RoundingPolicyDetail = z.infer<typeof roundingPolicyDetailSchema>;
export type BracketTableDetail = z.infer<typeof bracketTableDetailSchema>;
export type WithholdingScheduleDetail = z.infer<typeof withholdingScheduleDetailSchema>;

/** Detail schema per canonical rule key (§2.5 x §6.3). */
export const FEDERAL_DETAIL_SCHEMAS = {
  'FED.FIT.RATE_SCHEDULE.ANNUAL.STANDARD': withholdingScheduleDetailSchema,
  'FED.FIT.RATE_SCHEDULE.ANNUAL.STEP2_CHECKBOX': withholdingScheduleDetailSchema,
  'FED.FIT.W4.STEP2_UNCHECKED_ADJUSTMENT': amountByFilingStatusDetailSchema,
  'FED.FIT.W4.ALLOWANCE_VALUE': scalarAmountDetailSchema,
  'FED.FIT.PAY_PERIODS_PER_YEAR': countByPayPeriodDetailSchema,
  'FED.FIT.ROUNDING_POLICY': roundingPolicyDetailSchema,
  'FED.FIT.NRA_WAGE_ADDITION.PRE2020': amountByPayPeriodDetailSchema,
  'FED.FIT.NRA_WAGE_ADDITION.POST2019': amountByPayPeriodDetailSchema,
  'FED.FIT.COMPUTATIONAL_BRIDGE': scalarAmountDetailSchema,
  'FED.SUPP.OPTIONAL_FLAT_RATE': rateDetailSchema,
  'FED.SUPP.MANDATORY_FLAT_RATE': rateDetailSchema,
  'FED.SUPP.MANDATORY_THRESHOLD': thresholdDetailSchema,
  'FED.SS.EMPLOYEE_RATE': rateDetailSchema,
  'FED.SS.EMPLOYER_RATE': rateDetailSchema,
  'FED.SS.WAGE_BASE': wageBaseDetailSchema,
  'FED.MEDICARE.EMPLOYEE_RATE': rateDetailSchema,
  'FED.MEDICARE.EMPLOYER_RATE': rateDetailSchema,
  'FED.MEDICARE.WAGE_BASE': wageBaseDetailSchema,
  'FED.ADDL_MEDICARE.EMPLOYEE_RATE': rateDetailSchema,
  'FED.ADDL_MEDICARE.WITHHOLDING_THRESHOLD': thresholdDetailSchema,
  'FED.FUTA.GROSS_RATE': rateDetailSchema,
  'FED.FUTA.STANDARD_CREDIT': rateDetailSchema,
  'FED.FUTA.WAGE_BASE': wageBaseDetailSchema,
  'FED.ANNUAL.STANDARD_DEDUCTION': amountByFilingStatusDetailSchema,
  'FED.ANNUAL.PERSONAL_EXEMPTION': scalarAmountDetailSchema,
  'FED.ANNUAL.RATE_BRACKETS': bracketTableDetailSchema,
} as const;

export type FederalDetailSchemas = typeof FEDERAL_DETAIL_SCHEMAS;

/** Validates a detail payload against its key's schema (§6.5). */
export function validateFederalDetail(
  key: keyof FederalDetailSchemas,
  detail: unknown,
): { ok: true } | { ok: false; issues: readonly { path: string; message: string }[] } {
  const result = FEDERAL_DETAIL_SCHEMAS[key].safeParse(detail);
  if (result.success) {
    return { ok: true };
  }
  return {
    ok: false,
    issues: result.error.issues.map((issue) => ({
      path: issue.path.join('.'),
      message: issue.message,
    })),
  };
}

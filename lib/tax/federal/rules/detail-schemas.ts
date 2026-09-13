import { z } from 'zod';

/**
 * Federal rule detail schemas (Phase 4).
 *
 * ===========================================================================
 * SHAPE ONLY. NOT ONE TAX VALUE IN THIS FILE.
 *
 * Every amount, rate, threshold and wage base is a nullable decimal STRING supplied later
 * from a verified official source. `null` means the source does not state the value — it is
 * never zero, and the engine reports COMPONENT_NOT_STATED rather than substituting one.
 * ===========================================================================
 *
 * These mirror the Phase 2 convention in `lib/rules/payloads.ts`: decimal strings so no
 * authoritative value passes through IEEE-754, and optional/nullable everywhere so a partially
 * published source can be stored honestly.
 */

const decimalString = z
  .string()
  .trim()
  .regex(/^-?\d+(\.\d+)?$/, 'Must be a decimal number expressed as a string');

/** `null` records "not stated by the source", which is never the same as "0". */
const nullableDecimal = decimalString.nullable();

const filingStatusKey = z.string().trim().min(1);

/**
 * One row of a Pub. 15-T percentage-method rate schedule.
 *
 * `atLeast` / `lessThan` are the adjusted-annual-wage bounds; `null` marks the open ends.
 */
export const rateScheduleRowSchema = z.object({
  ordinal: z.number().int().min(0),
  atLeast: nullableDecimal,
  lessThan: nullableDecimal,
  /** Column C on the published schedule. */
  baseAmount: nullableDecimal,
  /** Column D — the marginal rate, held as a fraction once an official source states it. */
  marginalRate: nullableDecimal,
  /** Column E — the amount the excess is measured over. */
  excessOver: nullableDecimal,
});

export type RateScheduleRow = z.infer<typeof rateScheduleRowSchema>;

/** One schedule: a filing status, a Step 2 variant, and its ordered rows. */
export const rateScheduleSchema = z.object({
  filingStatus: filingStatusKey,
  /** Pub. 15-T publishes separate schedules for the Step 2 checkbox. */
  step2Checkbox: z.boolean(),
  rows: z.array(rateScheduleRowSchema),
});

/**
 * Worksheet 1A rule detail (Track B).
 *
 * `standardDeductionAmount` and `dependentCreditPerChild` are the worksheet's own constants,
 * NOT the annual 1040 standard deduction — Pub. 15-T states its own figures.
 */
export const worksheet1ADetailSchema = z.object({
  methodology: z.literal('PUB15T_WORKSHEET_1A'),
  /** Worksheet 1A line 1c/1d constant, per filing status. */
  standardDeductionAmounts: z.array(
    z.object({ filingStatus: filingStatusKey, amount: nullableDecimal }),
  ),
  schedules: z.array(rateScheduleSchema),
});

export const supplementalDetailSchema = z.object({
  /** Whether the optional flat method is permitted, per the official source. */
  optionalFlatPermitted: z.boolean().nullable(),
  optionalFlatRate: nullableDecimal,
  /** The mandatory flat rate above the statutory threshold. */
  mandatoryFlatRate: nullableDecimal,
  mandatoryFlatThreshold: nullableDecimal,
});

export const nraAdjustmentDetailSchema = z.object({
  /** Additional amount added to wages before applying the schedule, by pay frequency. */
  amounts: z.array(
    z.object({
      payFrequency: z.string().trim().min(1),
      /** Pub. 15-T publishes separate figures for pre-2020 and 2020+ W-4s. */
      w4Revision: z.enum(['PRE_2020', 'REVISION_2020_PLUS']),
      amount: nullableDecimal,
    }),
  ),
});

export const pre2020AllowanceDetailSchema = z.object({
  /** Worksheet 1A line 1j — the per-allowance amount. */
  allowanceAmount: nullableDecimal,
});

export const socialSecurityDetailSchema = z.object({
  employeeRate: nullableDecimal,
  employerRate: nullableDecimal,
  wageBase: nullableDecimal,
});

export const medicareDetailSchema = z.object({
  employeeRate: nullableDecimal,
  employerRate: nullableDecimal,
  /** A stated fact about the programme, not a missing value. */
  hasWageLimit: z.boolean(),
  wageLimit: nullableDecimal.optional(),
});

export const additionalMedicareDetailSchema = z.object({
  /** Employee only — there is no employer share of Additional Medicare. */
  employeeRate: nullableDecimal,
  thresholds: z.array(z.object({ filingStatus: filingStatusKey, amount: nullableDecimal })),
  /**
   * Whether the threshold comparison is inclusive of the threshold itself.
   *
   * `null` means the official semantics are not yet verified. The engine then reports
   * PENDING_VERIFICATION rather than picking one — see D-FIT/PENDING notes in the report.
   */
  thresholdInclusive: z.boolean().nullable(),
});

export const futaDetailSchema = z.object({
  grossRate: nullableDecimal,
  /** The standard credit against the gross rate. */
  standardCredit: nullableDecimal,
  wageBase: nullableDecimal,
});

export const annualRateScheduleDetailSchema = z.object({
  methodology: z.literal('ANNUAL_1040_ESTIMATE'),
  bracketSets: z.array(
    z.object({
      filingStatus: filingStatusKey,
      brackets: z.array(
        z.object({
          ordinal: z.number().int().min(0),
          lowerBound: nullableDecimal,
          upperBound: nullableDecimal,
          rate: nullableDecimal,
          baseTax: nullableDecimal.optional(),
        }),
      ),
    }),
  ),
});

export const annualStandardDeductionDetailSchema = z.object({
  amounts: z.array(z.object({ filingStatus: filingStatusKey, amount: nullableDecimal })),
});

/** Detail schema per federal rule key. Exhaustiveness is enforced by the resolver's lookup. */
export const FEDERAL_DETAIL_SCHEMAS = {
  'FED.FIT.WORKSHEET_1A': worksheet1ADetailSchema,
  'FED.FIT.SUPPLEMENTAL': supplementalDetailSchema,
  'FED.FIT.NRA_ADJUSTMENT': nraAdjustmentDetailSchema,
  'FED.FIT.PRE2020_ALLOWANCE': pre2020AllowanceDetailSchema,
  'FED.ANNUAL.RATE_SCHEDULE': annualRateScheduleDetailSchema,
  'FED.ANNUAL.STANDARD_DEDUCTION': annualStandardDeductionDetailSchema,
  'FED.FICA.SOCIAL_SECURITY': socialSecurityDetailSchema,
  'FED.FICA.MEDICARE': medicareDetailSchema,
  'FED.FICA.ADDITIONAL_MEDICARE': additionalMedicareDetailSchema,
  'FED.FUTA.STANDARD': futaDetailSchema,
} as const;

export type FederalDetailSchemas = typeof FEDERAL_DETAIL_SCHEMAS;

export type Worksheet1ADetail = z.infer<typeof worksheet1ADetailSchema>;
export type SupplementalDetail = z.infer<typeof supplementalDetailSchema>;
export type NraAdjustmentDetail = z.infer<typeof nraAdjustmentDetailSchema>;
export type Pre2020AllowanceDetail = z.infer<typeof pre2020AllowanceDetailSchema>;
export type SocialSecurityDetail = z.infer<typeof socialSecurityDetailSchema>;
export type MedicareDetail = z.infer<typeof medicareDetailSchema>;
export type AdditionalMedicareDetail = z.infer<typeof additionalMedicareDetailSchema>;
export type FutaDetail = z.infer<typeof futaDetailSchema>;
export type AnnualRateScheduleDetail = z.infer<typeof annualRateScheduleDetailSchema>;
export type AnnualStandardDeductionDetail = z.infer<typeof annualStandardDeductionDetailSchema>;

/** Validates a detail payload against its key's schema. */
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

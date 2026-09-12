import { z } from 'zod';

import { RuleCategory } from '@/lib/db/generated/index';

/**
 * Structured rule payload schemas (spec §20).
 *
 * ===========================================================================
 * WHAT THESE SCHEMAS DO AND DO NOT DO
 *
 *   DO     — describe the SHAPE a category's data must take, so a federal withholding
 *            table cannot be stored where a flat state rate belongs.
 *   DO NOT — contain any tax rate, bracket, threshold or wage base. Not one number in this
 *            file is a tax value; every amount is `decimalString` (an unvalidated-by-value
 *            string) supplied later from an official source.
 * ===========================================================================
 *
 * NUMBERS ARE STRINGS. Every monetary or rate field is a decimal STRING, never a JS `number`,
 * so an authoritative value can never pass through IEEE-754 (spec §4). Exact values are
 * additionally stored in NUMERIC columns via `TaxRuleValue`; the payload carries structure.
 *
 * EVERY VALUE FIELD IS OPTIONAL/NULLABLE. A source that does not state a value yields an
 * absent field plus a NOT_STATED verification status — never a fabricated zero (spec §19).
 */

/** A decimal value carried as an exact string. Format only — the value itself is not judged. */
const decimalString = z
  .string()
  .trim()
  .regex(/^-?\d+(\.\d+)?$/, 'Must be a decimal number expressed as a string');

/** Nullable decimal: `null` records "not stated", which is never the same as "0". */
const nullableDecimal = decimalString.nullable();

const filingStatusKey = z.string().trim().min(1);
const payFrequencyKey = z.string().trim().min(1);

/** One progressive bracket. Bounds are open-ended when the source states no bound. */
const bracketSchema = z.object({
  ordinal: z.number().int().min(0),
  lowerBound: nullableDecimal,
  /** `null` means the top, open-ended bracket. */
  upperBound: nullableDecimal,
  rate: nullableDecimal,
  /** Flat amount added before the marginal rate, where the official method states one. */
  baseTax: nullableDecimal.optional(),
});

const bracketSetSchema = z.object({
  filingStatus: filingStatusKey,
  brackets: z.array(bracketSchema),
});

/** Structures a state income tax may take (spec §7). */
export const StateTaxStructure = z.enum([
  'NONE',
  'FLAT',
  'PROGRESSIVE',
  'TABLE',
  'FORMULA',
  'HYBRID',
]);

const withholdingRowSchema = z.object({
  ordinal: z.number().int().min(0),
  filingStatus: filingStatusKey,
  payFrequency: payFrequencyKey,
  wageFrom: nullableDecimal,
  wageTo: nullableDecimal,
  baseWithholding: nullableDecimal,
  rate: nullableDecimal,
});

const federalIncomeTaxPayload = z.object({
  structure: z.literal('PROGRESSIVE'),
  standardDeductions: z.array(z.object({ filingStatus: filingStatusKey, amount: nullableDecimal })),
  personalExemption: nullableDecimal.optional(),
  bracketSets: z.array(bracketSetSchema),
});

const federalWithholdingPayload = z.object({
  method: z.string().trim().min(1),
  /** Full official table preserved row by row (spec §20). */
  rows: z.array(withholdingRowSchema),
  allowanceAmount: nullableDecimal.optional(),
  adjustments: z.record(z.string(), nullableDecimal).optional(),
});

const socialSecurityPayload = z.object({
  employeeRate: nullableDecimal,
  employerRate: nullableDecimal,
  wageBase: nullableDecimal,
});

const medicarePayload = z.object({
  employeeRate: nullableDecimal,
  employerRate: nullableDecimal,
  /** `hasWageLimit: false` is a stated fact about the programme, not a missing value. */
  hasWageLimit: z.boolean(),
  wageLimit: nullableDecimal.optional(),
  additionalRate: nullableDecimal.optional(),
  additionalThreshold: nullableDecimal.optional(),
});

const stateIncomeTaxPayload = z.object({
  structure: StateTaxStructure,
  flatRate: nullableDecimal.optional(),
  bracketSets: z.array(bracketSetSchema).optional(),
  standardDeductions: z
    .array(z.object({ filingStatus: filingStatusKey, amount: nullableDecimal }))
    .optional(),
});

const stateWithholdingPayload = z.object({
  method: z.string().trim().min(1),
  rows: z.array(withholdingRowSchema).optional(),
  allowanceAmount: nullableDecimal.optional(),
  supplementalRate: nullableDecimal.optional(),
});

const contributionProgramPayload = z.object({
  programName: z.string().trim().min(1),
  employeeRate: nullableDecimal,
  employerRate: nullableDecimal,
  wageBase: nullableDecimal,
  maximumContribution: nullableDecimal.optional(),
});

const sutaPayload = z.object({
  employeeApplicable: z.boolean(),
  employeeRate: nullableDecimal.optional(),
  employerRate: nullableDecimal.optional(),
  newEmployerRate: nullableDecimal.optional(),
  experienceRateMin: nullableDecimal.optional(),
  experienceRateMax: nullableDecimal.optional(),
  taxableWageBase: nullableDecimal,
});

const minimumWagePayload = z.object({
  standardRate: nullableDecimal,
  tippedRate: nullableDecimal.optional(),
  youthOrTrainingRate: nullableDecimal.optional(),
  notes: z.string().optional(),
});

const overtimePayload = z.object({
  method: z.enum(['WEEKLY', 'DAILY', 'BOTH']),
  weeklyThresholdHours: nullableDecimal.optional(),
  dailyThresholdHours: nullableDecimal.optional(),
  multiplier: nullableDecimal.optional(),
  doubleTimeThresholdHours: nullableDecimal.optional(),
  doubleTimeMultiplier: nullableDecimal.optional(),
  exceptions: z.array(z.string()).optional(),
});

const reciprocityPayload = z.object({
  fromStateCode: z.string().trim().length(2),
  toStateCode: z.string().trim().length(2),
  withholdingTreatment: z.string().trim().min(1),
  conditions: z.array(z.string()).optional(),
  requiredForm: z.string().optional(),
});

const localTaxPayload = z.object({
  taxType: z.string().trim().min(1),
  employeeRate: nullableDecimal,
  employerRate: nullableDecimal.optional(),
  wageBase: nullableDecimal.optional(),
  threshold: nullableDecimal.optional(),
  appliesToResidents: z.boolean().optional(),
  appliesToNonResidents: z.boolean().optional(),
});

/** Payload schema per category. */
export const RULE_PAYLOAD_SCHEMAS = {
  [RuleCategory.FEDERAL_INCOME_TAX]: federalIncomeTaxPayload,
  [RuleCategory.FEDERAL_WITHHOLDING]: federalWithholdingPayload,
  [RuleCategory.SOCIAL_SECURITY]: socialSecurityPayload,
  [RuleCategory.MEDICARE]: medicarePayload,
  [RuleCategory.STATE_INCOME_TAX]: stateIncomeTaxPayload,
  [RuleCategory.STATE_WITHHOLDING]: stateWithholdingPayload,
  [RuleCategory.DISABILITY_SDI]: contributionProgramPayload,
  [RuleCategory.PAID_LEAVE]: contributionProgramPayload,
  [RuleCategory.SUTA]: sutaPayload,
  [RuleCategory.MINIMUM_WAGE]: minimumWagePayload,
  [RuleCategory.OVERTIME]: overtimePayload,
  [RuleCategory.RECIPROCITY]: reciprocityPayload,
  [RuleCategory.LOCAL_TAX]: localTaxPayload,
} as const satisfies Record<RuleCategory, z.ZodType>;

export type RulePayloadSchemas = typeof RULE_PAYLOAD_SCHEMAS;

export function getPayloadSchema(category: RuleCategory): z.ZodType {
  return RULE_PAYLOAD_SCHEMAS[category];
}

/**
 * Validates a payload against its category's schema.
 *
 * A `null` payload is VALID: it is the correct representation of PENDING DATA, and is what a
 * rule looks like before official values have been sourced. Activation is gated separately by
 * `evaluateActivation`.
 */
export function validatePayload(
  category: RuleCategory,
  payload: unknown,
): { success: true } | { success: false; issues: readonly { path: string; message: string }[] } {
  if (payload === null || payload === undefined) {
    return { success: true };
  }

  const result = getPayloadSchema(category).safeParse(payload);
  if (result.success) {
    return { success: true };
  }

  return {
    success: false,
    issues: result.error.issues.map((issue) => ({
      path: issue.path.join('.'),
      message: issue.message,
    })),
  };
}

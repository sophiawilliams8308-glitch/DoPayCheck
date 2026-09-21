import { z } from 'zod';

import { StateRuleKey } from '../ruleKeys';

/**
 * State rule detail shapes — Phase 5 Step 1.
 *
 * ===========================================================================
 * SHAPE ONLY. NOT ONE TAX VALUE IN THIS FILE.
 *
 * Every amount, rate, threshold and bracket bound is a nullable decimal STRING
 * supplied later from a verified official source. `null` means the source does
 * not state the value — never zero, never a default. No jurisdiction is named
 * anywhere in this file: a schema that mentioned a state would be a value.
 * ===========================================================================
 *
 * These schemas live INSIDE the Phase 2 rule architecture. They validate the
 * `TaxRule.payload` JSON column under the existing state `RuleCategory`
 * members; they do not introduce a second rule system, a second table or a
 * second resolution path.
 *
 * RATE UNIT DISCIPLINE. Every rate carries an explicit `unit`, as federally:
 * a percent/fraction mix-up is a 100x error, so the unit is mandatory DATA
 * rather than a convention, and conversion happens exactly once at the
 * resolver boundary.
 */

const decimalString = z
  .string()
  .trim()
  .regex(/^-?\d+(\.\d+)?$/, 'Must be a decimal number expressed as a string');

/** `null` records "not stated by the source", which is never the same as "0". */
const nullableDecimal = decimalString.nullable();

/**
 * Filing status is FREE TEXT, not an enum.
 *
 * Deliberate, and the same choice Phase 2 made for `TaxBracket.filingStatus`:
 * jurisdictions define their own statuses, and enumerating them in code would
 * turn jurisdiction data into an application constant that needs a deploy to
 * change.
 */
const filingStatusKey = z.string().trim().min(1);

const payFrequencyKey = z.enum([
  'WEEKLY',
  'BIWEEKLY',
  'SEMIMONTHLY',
  'MONTHLY',
  'QUARTERLY',
  'SEMIANNUAL',
  'ANNUAL',
  'DAILY',
]);

/** Mandatory on every rate. */
export const StateRateUnit = z.enum(['PERCENT', 'DECIMAL_FRACTION']);

/**
 * `NOT_APPLICABLE` is a positive, source-backed statement that the concept does
 * not exist here — a state with no wage base, no disability programme, no
 * supplemental rate. It is emphatically different from an ABSENT record, which
 * means nobody has looked yet and the calculation must refuse.
 */
export const StateApplicability = z.enum(['APPLIES', 'NOT_APPLICABLE']);

/** Whose side of the payroll a figure falls on. Never inferred from the amount. */
const appliesTo = z.enum(['EMPLOYEE', 'EMPLOYER']);

/** Explicit unit for every amount an employee elects. Never inferred. */
export const StateAmountUnit = z.enum(['ANNUAL', 'PER_PERIOD']);

// --- RATE -------------------------------------------------------------------
export const stateRateDetailSchema = z.object({
  shape: z.literal('RATE'),
  rate: nullableDecimal,
  unit: StateRateUnit,
  appliesTo,
  applicability: StateApplicability,
});

// --- BRACKET_TABLE (annual liability structure) -----------------------------
/**
 * No base-amount column, deliberately.
 *
 * A withholding schedule HAS one; an annual bracket table does not. Making the
 * two share a type would invite exactly the substitution this engine forbids —
 * so they are different schemas that cannot validate as each other.
 */
export const stateBracketTableDetailSchema = z.object({
  shape: z.literal('BRACKET_TABLE'),
  bracketSets: z.array(
    z.object({
      filingStatus: filingStatusKey,
      brackets: z.array(
        z.object({
          ordinal: z.number().int().min(0),
          atLeast: nullableDecimal,
          /** `null` marks the open-ended top bracket. */
          lessThan: nullableDecimal,
          rate: nullableDecimal,
          unit: StateRateUnit,
        }),
      ),
    }),
  ),
});

// --- WITHHOLDING_TABLE (the paycheck number) --------------------------------
export const stateWithholdingTableDetailSchema = z.object({
  shape: z.literal('WITHHOLDING_TABLE'),
  /** The identifier the official document gives this table. */
  tableCode: z.string().trim().min(1),
  /** Free text: each jurisdiction names its own methods. */
  method: z.string().trim().min(1),
  rows: z.array(
    z.object({
      ordinal: z.number().int().min(0),
      filingStatus: filingStatusKey,
      payFrequency: payFrequencyKey,
      wageFrom: nullableDecimal,
      /** `null` marks the open-ended final row. */
      wageTo: nullableDecimal,
      /** The flat amount before the marginal rate, where the method states one. */
      baseWithholding: nullableDecimal,
      rate: nullableDecimal,
      unit: StateRateUnit,
    }),
  ),
});

// --- WAGE_BASE --------------------------------------------------------------
export const stateWageBaseDetailSchema = z.object({
  shape: z.literal('WAGE_BASE'),
  amount: nullableDecimal,
  basis: z.literal('ANNUAL'),
  applicability: StateApplicability,
});

// --- THRESHOLD --------------------------------------------------------------
export const stateThresholdDetailSchema = z.object({
  shape: z.literal('THRESHOLD'),
  amount: nullableDecimal,
  basis: z.enum(['ANNUAL_YTD', 'PER_PERIOD']),
  /** `null` while strict-vs-inclusive is unverified for this jurisdiction. */
  inclusive: z.boolean().nullable(),
  applicability: StateApplicability,
});

// --- AMOUNT_BY_FILING_STATUS ------------------------------------------------
export const stateAmountByFilingStatusDetailSchema = z.object({
  shape: z.literal('AMOUNT_BY_FILING_STATUS'),
  unit: StateAmountUnit,
  amounts: z.array(z.object({ filingStatus: filingStatusKey, amount: nullableDecimal })),
});

// --- AMOUNT_PER_ALLOWANCE ---------------------------------------------------
export const stateAmountPerAllowanceDetailSchema = z.object({
  shape: z.literal('AMOUNT_PER_ALLOWANCE'),
  unit: StateAmountUnit,
  /** Some jurisdictions value a personal allowance differently from a dependent one. */
  allowanceType: z.string().trim().min(1),
  amount: nullableDecimal,
  applicability: StateApplicability,
});

// --- SCALAR_AMOUNT -----------------------------------------------------------
/**
 * A single generic scalar monetary amount — Task 4O-6R4/4O-6R5.
 *
 * ===========================================================================
 * GENERIC INFRASTRUCTURE ONLY. NOT A TAX CONCEPT.
 *
 * This shape carries no filing-status dependence and no allowance/dependent
 * count — it is the simplest possible amount shape this engine has: one
 * amount, one unit. It exists to back a future rule key representing
 * whatever named formula-level amount a jurisdiction's transcribed
 * `WITHHOLDING_FORMULA` needs beyond the concepts this engine already has
 * dedicated shapes and operations for (`AMOUNT_BY_FILING_STATUS` for
 * standard deductions/personal exemptions, `AMOUNT_PER_ALLOWANCE` for
 * dependent exemptions/withholding allowances). Mirrors federal's own
 * `scalarAmountDetailSchema` (`FED.ANNUAL.PERSONAL_EXEMPTION`,
 * `FED.FIT.W4.ALLOWANCE_VALUE`) as ARCHITECTURAL PRECEDENT only — no
 * federal code or schema is imported.
 *
 * DELIBERATELY NOT REGISTERED IN `STATE_DETAIL_SCHEMAS` YET: that registry
 * is exhaustive over `StateRuleKey`, and no `StateRuleKey` for a generic
 * scalar amount exists (Task 4O-6R4 explicitly locked that none may be
 * invented merely to exercise this schema — see the Task 4O-6R series).
 * A future rule key representing one concrete, evidenced real-world amount
 * concept registers against this same shared schema, exactly as
 * `stateAmountByFilingStatusDetailSchema` is already shared, unmodified,
 * across `PIT_STANDARD_DEDUCTION`, `PIT_PERSONAL_EXEMPTION`, and
 * `WITHHOLDING_STANDARD_DEDUCTION`.
 *
 * `amount: null` means the source does not state a value — never zero.
 * `unit` records the amount's authored basis; this schema performs no
 * `ANNUAL`/`PER_PERIOD` conversion of any kind — that remains, as with
 * every other amount shape in this engine, entirely outside the schema.
 * ===========================================================================
 */
export const stateScalarAmountDetailSchema = z.object({
  shape: z.literal('SCALAR_AMOUNT'),
  unit: StateAmountUnit,
  amount: nullableDecimal,
});

// --- COUNT_BY_PAY_PERIOD ----------------------------------------------------
export const stateCountByPayPeriodDetailSchema = z.object({
  shape: z.literal('COUNT_BY_PAY_PERIOD'),
  counts: z.array(
    z.object({
      payFrequency: payFrequencyKey,
      /** `null` where the jurisdiction does not state a count for this frequency. */
      periodsPerYear: z.number().int().positive().nullable(),
    }),
  ),
});

// --- METHOD_DESCRIPTOR ------------------------------------------------------
/**
 * Which published methodology this jurisdiction uses.
 *
 * The engine reads this to decide WHICH shape to consume — it is the one
 * permitted form of dispatch, and it dispatches on DECLARED METHOD, never on a
 * state code. That distinction is what stops fifty-one special cases accruing
 * in the engine.
 */
export const stateMethodDescriptorDetailSchema = z.object({
  shape: z.literal('METHOD_DESCRIPTOR'),
  structure: z.enum(['NONE', 'FLAT', 'PROGRESSIVE', 'TABLE', 'FORMULA', 'HYBRID']),
  /** The method's name in the jurisdiction's own documentation. */
  methodName: z.string().trim().min(1),
  usesAllowances: z.boolean(),
  usesStandardDeduction: z.boolean(),
  usesExemptions: z.boolean(),
  /** True when the state's taxable wages start from a federal figure. */
  startsFromFederalTaxableWages: z.boolean(),
});

// --- FORMULA_STEPS ----------------------------------------------------------
/**
 * A published formula, transcribed as ORDERED DECLARATIVE STEPS.
 *
 * ===========================================================================
 * NOT AN EXPRESSION LANGUAGE, AND DELIBERATELY NOT ONE.
 *
 * Each step names an operation from a CLOSED set and refers to operands by
 * name. There is no arithmetic string to parse, so there is nothing to `eval`,
 * no `new Function`, and no admin-authored code path. An administrator
 * transcribing a state's formula cannot, even by accident, author executable
 * code — the worst they can do is describe a wrong calculation, which review
 * and tests catch.
 * ===========================================================================
 */
export const StateFormulaOperation = z.enum([
  'SUBTRACT_STANDARD_DEDUCTION',
  'SUBTRACT_EXEMPTIONS',
  'SUBTRACT_ALLOWANCES',
  'SUBTRACT_AMOUNT',
  'ADD_AMOUNT',
  'APPLY_BRACKETS',
  'APPLY_FLAT_RATE',
  'APPLY_PERCENTAGE_OF',
  'FLOOR_AT_ZERO',
  'ROUND',
  'ANNUALIZE',
  'DEANNUALIZE',
]);

export const stateFormulaStepsDetailSchema = z.object({
  shape: z.literal('FORMULA_STEPS'),
  steps: z.array(
    z.object({
      ordinal: z.number().int().min(0),
      operation: StateFormulaOperation,
      /** Names the rule key or context field supplying the operand, never a value. */
      operandRef: z.string().trim().min(1).nullable(),
      note: z.string().trim().min(1).nullable(),
    }),
  ),
});

// --- TAXABILITY_PROFILE -----------------------------------------------------
/**
 * Tri-state, as federally. `NOT_STATED` is never coerced to `FALSE`: a
 * deduction whose treatment a state has not published makes the affected
 * bucket undeterminable, rather than silently reducing nothing.
 */
export const StateTaxability = z.enum(['TRUE', 'FALSE', 'NOT_STATED']);

export const stateTaxabilityProfileDetailSchema = z.object({
  shape: z.literal('TAXABILITY_PROFILE'),
  deductionTypeKey: z.string().trim().min(1),
  reducesStateIncomeTaxWages: StateTaxability,
  reducesSdiWages: StateTaxability,
  reducesPfmlWages: StateTaxability,
  reducesSutaWages: StateTaxability,
});

// --- SUPPLEMENTAL_TREATMENT -------------------------------------------------
export const stateSupplementalTreatmentDetailSchema = z.object({
  shape: z.literal('SUPPLEMENTAL_TREATMENT'),
  /** NO_SPECIAL_TREATMENT is a stated fact, not an absence of data. */
  treatment: z.enum([
    'NO_SPECIAL_TREATMENT',
    'FLAT_RATE',
    'AGGREGATE',
    'FLAT_OR_AGGREGATE_EMPLOYER_ELECTS',
  ]),
  flatRate: nullableDecimal,
  unit: StateRateUnit,
  applicability: StateApplicability,
});

// --- ROUNDING_POLICY --------------------------------------------------------
export const stateRoundingPolicyDetailSchema = z.object({
  shape: z.literal('ROUNDING_POLICY'),
  policyId: z.string().trim().min(1),
  currencyScale: z.number().int().min(0).max(6),
  currencyMode: z.enum(['HALF_UP', 'HALF_EVEN', 'DOWN', 'UP']),
  intermediateScale: z.number().int().min(0).max(20),
  appliedAt: z.enum(['TAX_LEVEL', 'STEP_LEVEL']),
  /** True when the jurisdiction MANDATES this; false when it is our disclosed choice. */
  mandatedBySource: z.boolean(),
});

// --- RECIPROCITY_AGREEMENT --------------------------------------------------
/**
 * Jurisdiction codes are DATA here, supplied per rule row — this schema names
 * none. Reciprocity is never inferred from geography or state names.
 */
export const stateReciprocityAgreementDetailSchema = z.object({
  shape: z.literal('RECIPROCITY_AGREEMENT'),
  /** The jurisdiction whose residents this agreement covers. */
  residenceJurisdictionCode: z.string().trim().min(1),
  workJurisdictionCode: z.string().trim().min(1),
  /** Whether a filed certificate is required before the agreement applies. */
  certificateRequired: z.boolean(),
  certificateFormCode: z.string().trim().min(1).nullable(),
  /** What the agreement does to work-state withholding when it applies. */
  effect: z.enum(['EXEMPT_WORK_STATE_WITHHOLDING', 'CREDIT_AGAINST_RESIDENCE', 'NONE']),
});

// --- FILING_STATUS_MAP ------------------------------------------------------
/**
 * How this jurisdiction's own statuses relate to the federal ones.
 *
 * A map, not an assumption: "Single" federally is not always "Single" for a
 * state, and several states have statuses with no federal counterpart.
 * `NOT_STATED` records that the jurisdiction does not publish a mapping.
 */
export const stateFilingStatusMapDetailSchema = z.object({
  shape: z.literal('FILING_STATUS_MAP'),
  entries: z.array(
    z.object({
      stateFilingStatus: filingStatusKey,
      federalFilingStatus: z.enum([
        'SINGLE_OR_MFS',
        'MARRIED_FILING_JOINTLY',
        'HEAD_OF_HOUSEHOLD',
        'NOT_STATED',
      ]),
      /** True when the state form offers this status at all. */
      availableOnStateForm: z.boolean(),
    }),
  ),
});

// --- ELECTION_FORM_SCHEMA ---------------------------------------------------
/**
 * The jurisdiction's withholding certificate, described as fields.
 *
 * EVERY AMOUNT FIELD DECLARES ITS UNIT. A state form's "additional amount" is
 * per pay period on some forms and annual on others; leaving that implicit is
 * how an extra withholding amount gets multiplied or divided by 26.
 */
export const StateElectionFieldType = z.enum([
  'FILING_STATUS',
  'ALLOWANCE_COUNT',
  'DEPENDENT_COUNT',
  'AMOUNT',
  'PERCENTAGE',
  'BOOLEAN',
  'EXEMPTION_CLAIM',
]);

export const stateElectionFormSchemaDetailSchema = z.object({
  shape: z.literal('ELECTION_FORM_SCHEMA'),
  formCode: z.string().trim().min(1),
  formName: z.string().trim().min(1),
  fields: z.array(
    z
      .object({
        fieldKey: z.string().trim().min(1),
        label: z.string().trim().min(1),
        type: StateElectionFieldType,
        required: z.boolean(),
        /** MANDATORY on AMOUNT fields; must be absent on every other type. */
        unit: StateAmountUnit.optional(),
      })
      .superRefine((field, ctx) => {
        if (field.type === 'AMOUNT' && field.unit === undefined) {
          ctx.addIssue({
            code: 'custom',
            path: ['unit'],
            message: 'An AMOUNT field must declare its unit as ANNUAL or PER_PERIOD',
          });
        }
        if (field.type !== 'AMOUNT' && field.unit !== undefined) {
          ctx.addIssue({
            code: 'custom',
            path: ['unit'],
            message: 'Only an AMOUNT field may declare a unit',
          });
        }
      }),
  ),
});

// --- PROGRAM_DESCRIPTOR -----------------------------------------------------
export const stateProgramDescriptorDetailSchema = z.object({
  shape: z.literal('PROGRAM_DESCRIPTOR'),
  programName: z.string().trim().min(1),
  /** Employee, employer, or both — stated, never inferred from which rates exist. */
  contributors: z.array(appliesTo).min(1),
  applicability: StateApplicability,
  /** True when an employer may substitute an approved private plan. */
  privatePlanPermitted: z.boolean(),
  /** Employee headcount at or above which the programme applies, when stated. */
  employerSizeThreshold: z.number().int().min(0).nullable(),
});

// --- CAPABILITY_DECLARATION -------------------------------------------------
/**
 * What this jurisdiction's data claims to support.
 *
 * Read FIRST. Without it the engine does not know whether "no SDI rule" means
 * "this state has no SDI" or "nobody has entered it yet" — and those must
 * never collapse into the same answer.
 */
export const stateCapabilityDeclarationDetailSchema = z.object({
  shape: z.literal('CAPABILITY_DECLARATION'),
  programs: z.array(
    z.object({
      program: z.enum(['INCOME_TAX_WITHHOLDING', 'SDI', 'PFML', 'SUTA']),
      /** NOT_APPLICABLE = the state has no such programme. Absent = not yet entered. */
      applicability: StateApplicability,
      /** True once the data is complete enough to compute. Never assumed. */
      dataComplete: z.boolean(),
    }),
  ),
  supportsReciprocity: z.boolean(),
  supportsSupplementalWages: z.boolean(),
  /** Scenarios this jurisdiction's data explicitly does not cover yet. */
  unsupportedScenarios: z.array(z.string().trim().min(1)),
});

export type StateRateDetail = z.infer<typeof stateRateDetailSchema>;
export type StateBracketTableDetail = z.infer<typeof stateBracketTableDetailSchema>;
export type StateWithholdingTableDetail = z.infer<typeof stateWithholdingTableDetailSchema>;
export type StateWageBaseDetail = z.infer<typeof stateWageBaseDetailSchema>;
export type StateThresholdDetail = z.infer<typeof stateThresholdDetailSchema>;
export type StateAmountByFilingStatusDetail = z.infer<typeof stateAmountByFilingStatusDetailSchema>;
export type StateAmountPerAllowanceDetail = z.infer<typeof stateAmountPerAllowanceDetailSchema>;
export type StateScalarAmountDetail = z.infer<typeof stateScalarAmountDetailSchema>;
export type StateCountByPayPeriodDetail = z.infer<typeof stateCountByPayPeriodDetailSchema>;
export type StateMethodDescriptorDetail = z.infer<typeof stateMethodDescriptorDetailSchema>;
export type StateFormulaStepsDetail = z.infer<typeof stateFormulaStepsDetailSchema>;
export type StateTaxabilityProfileDetail = z.infer<typeof stateTaxabilityProfileDetailSchema>;
export type StateSupplementalTreatmentDetail = z.infer<
  typeof stateSupplementalTreatmentDetailSchema
>;
export type StateRoundingPolicyDetail = z.infer<typeof stateRoundingPolicyDetailSchema>;
export type StateReciprocityAgreementDetail = z.infer<typeof stateReciprocityAgreementDetailSchema>;
export type StateFilingStatusMapDetail = z.infer<typeof stateFilingStatusMapDetailSchema>;
export type StateElectionFormSchemaDetail = z.infer<typeof stateElectionFormSchemaDetailSchema>;
export type StateProgramDescriptorDetail = z.infer<typeof stateProgramDescriptorDetailSchema>;
export type StateCapabilityDeclarationDetail = z.infer<
  typeof stateCapabilityDeclarationDetailSchema
>;

/** Detail schema per canonical state rule key. Exhaustive by construction. */
export const STATE_DETAIL_SCHEMAS = {
  [StateRuleKey.CAPABILITY_DECLARATION]: stateCapabilityDeclarationDetailSchema,

  [StateRuleKey.PIT_RATE_BRACKETS]: stateBracketTableDetailSchema,
  [StateRuleKey.PIT_STANDARD_DEDUCTION]: stateAmountByFilingStatusDetailSchema,
  [StateRuleKey.PIT_PERSONAL_EXEMPTION]: stateAmountByFilingStatusDetailSchema,
  [StateRuleKey.PIT_DEPENDENT_EXEMPTION]: stateAmountPerAllowanceDetailSchema,
  [StateRuleKey.PIT_FLAT_RATE]: stateRateDetailSchema,

  [StateRuleKey.WITHHOLDING_METHOD]: stateMethodDescriptorDetailSchema,
  [StateRuleKey.WITHHOLDING_TABLE]: stateWithholdingTableDetailSchema,
  [StateRuleKey.WITHHOLDING_FORMULA]: stateFormulaStepsDetailSchema,
  [StateRuleKey.WITHHOLDING_ALLOWANCE_VALUE]: stateAmountPerAllowanceDetailSchema,
  [StateRuleKey.WITHHOLDING_STANDARD_DEDUCTION]: stateAmountByFilingStatusDetailSchema,
  [StateRuleKey.WITHHOLDING_PAY_PERIODS_PER_YEAR]: stateCountByPayPeriodDetailSchema,
  [StateRuleKey.WITHHOLDING_ROUNDING_POLICY]: stateRoundingPolicyDetailSchema,
  [StateRuleKey.WITHHOLDING_SUPPLEMENTAL]: stateSupplementalTreatmentDetailSchema,
  [StateRuleKey.WITHHOLDING_FILING_STATUS_MAP]: stateFilingStatusMapDetailSchema,
  [StateRuleKey.WITHHOLDING_ELECTION_FORM]: stateElectionFormSchemaDetailSchema,

  [StateRuleKey.TAXABILITY_PROFILE]: stateTaxabilityProfileDetailSchema,

  [StateRuleKey.SDI_PROGRAM]: stateProgramDescriptorDetailSchema,
  [StateRuleKey.SDI_EMPLOYEE_RATE]: stateRateDetailSchema,
  [StateRuleKey.SDI_EMPLOYER_RATE]: stateRateDetailSchema,
  [StateRuleKey.SDI_WAGE_BASE]: stateWageBaseDetailSchema,
  [StateRuleKey.SDI_MAX_CONTRIBUTION]: stateThresholdDetailSchema,

  [StateRuleKey.PFML_PROGRAM]: stateProgramDescriptorDetailSchema,
  [StateRuleKey.PFML_EMPLOYEE_RATE]: stateRateDetailSchema,
  [StateRuleKey.PFML_EMPLOYER_RATE]: stateRateDetailSchema,
  [StateRuleKey.PFML_WAGE_BASE]: stateWageBaseDetailSchema,
  [StateRuleKey.PFML_MAX_CONTRIBUTION]: stateThresholdDetailSchema,

  [StateRuleKey.SUTA_PROGRAM]: stateProgramDescriptorDetailSchema,
  [StateRuleKey.SUTA_EMPLOYER_RATE]: stateRateDetailSchema,
  [StateRuleKey.SUTA_NEW_EMPLOYER_RATE]: stateRateDetailSchema,
  [StateRuleKey.SUTA_EMPLOYEE_RATE]: stateRateDetailSchema,
  [StateRuleKey.SUTA_WAGE_BASE]: stateWageBaseDetailSchema,

  [StateRuleKey.RECIPROCITY_AGREEMENT]: stateReciprocityAgreementDetailSchema,
} as const;

export type StateDetailSchemas = typeof STATE_DETAIL_SCHEMAS;

/** Validates a detail payload against its key's schema. Never throws. */
export function validateStateDetail(
  key: keyof StateDetailSchemas,
  detail: unknown,
): { ok: true } | { ok: false; issues: readonly { path: string; message: string }[] } {
  const result = STATE_DETAIL_SCHEMAS[key].safeParse(detail);
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

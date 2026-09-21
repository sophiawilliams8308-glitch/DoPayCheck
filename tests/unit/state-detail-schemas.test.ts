import { describe, expect, it } from 'vitest';

import { StateRuleKey, ALL_STATE_RULE_KEYS } from '@/lib/tax/state/ruleKeys';
import {
  STATE_DETAIL_SCHEMAS,
  stateElectionFormSchemaDetailSchema,
  stateRateDetailSchema,
  stateScalarAmountDetailSchema,
  stateThresholdDetailSchema,
  stateTaxabilityProfileDetailSchema,
  stateWageBaseDetailSchema,
  validateStateDetail,
} from '@/lib/tax/state/rules/detailSchemas';

/**
 * State rule detail shapes (Phase 5 Step 1).
 *
 * Every payload below is SYNTHETIC and structural. The numbers exist to prove a
 * field accepts a decimal string; none is a tax value, and no jurisdiction is
 * named anywhere in this file.
 */

describe('schema registry', () => {
  it('covers every canonical key', () => {
    for (const key of ALL_STATE_RULE_KEYS) {
      expect(STATE_DETAIL_SCHEMAS[key], `${key} has no detail schema`).toBeDefined();
    }
    expect(Object.keys(STATE_DETAIL_SCHEMAS).length).toBe(ALL_STATE_RULE_KEYS.length);
  });
});

describe('RATE', () => {
  it('accepts a structurally valid rate with an explicit unit', () => {
    expect(
      stateRateDetailSchema.safeParse({
        shape: 'RATE',
        rate: '1',
        unit: 'PERCENT',
        appliesTo: 'EMPLOYEE',
        applicability: 'APPLIES',
      }).success,
    ).toBe(true);
  });

  it('rejects a rate with no unit — a percent/fraction mix-up is a 100x error', () => {
    const result = stateRateDetailSchema.safeParse({
      shape: 'RATE',
      rate: '1',
      appliesTo: 'EMPLOYEE',
      applicability: 'APPLIES',
    });
    expect(result.success).toBe(false);
  });

  it('rejects a floating-point rate — money and rates travel as strings', () => {
    const result = stateRateDetailSchema.safeParse({
      shape: 'RATE',
      rate: 0.01,
      unit: 'DECIMAL_FRACTION',
      appliesTo: 'EMPLOYEE',
      applicability: 'APPLIES',
    });
    expect(result.success).toBe(false);
  });

  it('accepts a null rate — NOT_STATED is not zero', () => {
    const result = stateRateDetailSchema.safeParse({
      shape: 'RATE',
      rate: null,
      unit: 'PERCENT',
      appliesTo: 'EMPLOYER',
      applicability: 'APPLIES',
    });
    expect(result.success).toBe(true);
  });

  it('rejects a side it cannot attribute', () => {
    expect(
      stateRateDetailSchema.safeParse({
        shape: 'RATE',
        rate: null,
        unit: 'PERCENT',
        appliesTo: 'SOMEBODY',
        applicability: 'APPLIES',
      }).success,
    ).toBe(false);
  });
});

describe('NOT_APPLICABLE versus an absent record', () => {
  it('accepts NOT_APPLICABLE as a positive statement that no base exists', () => {
    const result = stateWageBaseDetailSchema.safeParse({
      shape: 'WAGE_BASE',
      amount: null,
      basis: 'ANNUAL',
      applicability: 'NOT_APPLICABLE',
    });
    expect(result.success).toBe(true);
  });

  it('requires applicability to be stated at all', () => {
    // Omitting it would leave "no base" and "nobody looked" indistinguishable.
    const result = stateWageBaseDetailSchema.safeParse({
      shape: 'WAGE_BASE',
      amount: null,
      basis: 'ANNUAL',
    });
    expect(result.success).toBe(false);
  });
});

describe('THRESHOLD', () => {
  it('allows inclusive to be null while it is unverified', () => {
    expect(
      stateThresholdDetailSchema.safeParse({
        shape: 'THRESHOLD',
        amount: null,
        basis: 'ANNUAL_YTD',
        inclusive: null,
        applicability: 'APPLIES',
      }).success,
    ).toBe(true);
  });

  it('rejects an unknown basis', () => {
    expect(
      stateThresholdDetailSchema.safeParse({
        shape: 'THRESHOLD',
        amount: null,
        basis: 'WEEKLY_SOMETHING',
        inclusive: null,
        applicability: 'APPLIES',
      }).success,
    ).toBe(false);
  });
});

describe('TAXABILITY_PROFILE is tri-state', () => {
  it('accepts NOT_STATED alongside TRUE and FALSE', () => {
    expect(
      stateTaxabilityProfileDetailSchema.safeParse({
        shape: 'TAXABILITY_PROFILE',
        deductionTypeKey: 'SYNTHETIC_TYPE',
        reducesStateIncomeTaxWages: 'TRUE',
        reducesSdiWages: 'FALSE',
        reducesPfmlWages: 'NOT_STATED',
        reducesSutaWages: 'NOT_STATED',
      }).success,
    ).toBe(true);
  });

  it('rejects a boolean in place of the tri-state', () => {
    expect(
      stateTaxabilityProfileDetailSchema.safeParse({
        shape: 'TAXABILITY_PROFILE',
        deductionTypeKey: 'SYNTHETIC_TYPE',
        reducesStateIncomeTaxWages: true,
        reducesSdiWages: 'FALSE',
        reducesPfmlWages: 'NOT_STATED',
        reducesSutaWages: 'NOT_STATED',
      }).success,
    ).toBe(false);
  });
});

describe('ELECTION_FORM_SCHEMA unit discipline', () => {
  const form = (fields: unknown[]): unknown => ({
    shape: 'ELECTION_FORM_SCHEMA',
    formCode: 'SYNTHETIC-FORM',
    formName: 'Synthetic withholding certificate',
    fields,
  });

  it('requires an AMOUNT field to declare its unit', () => {
    const result = stateElectionFormSchemaDetailSchema.safeParse(
      form([{ fieldKey: 'extra', label: 'Additional amount', type: 'AMOUNT', required: false }]),
    );
    expect(result.success).toBe(false);
  });

  it('accepts an AMOUNT field that declares PER_PERIOD', () => {
    expect(
      stateElectionFormSchemaDetailSchema.safeParse(
        form([
          {
            fieldKey: 'extra',
            label: 'Additional amount',
            type: 'AMOUNT',
            required: false,
            unit: 'PER_PERIOD',
          },
        ]),
      ).success,
    ).toBe(true);
  });

  it('accepts an AMOUNT field that declares ANNUAL', () => {
    expect(
      stateElectionFormSchemaDetailSchema.safeParse(
        form([
          {
            fieldKey: 'estimated_deductions',
            label: 'Estimated deductions',
            type: 'AMOUNT',
            required: false,
            unit: 'ANNUAL',
          },
        ]),
      ).success,
    ).toBe(true);
  });

  it('refuses a unit on a field where a unit is meaningless', () => {
    expect(
      stateElectionFormSchemaDetailSchema.safeParse(
        form([
          {
            fieldKey: 'allowances',
            label: 'Allowances',
            type: 'ALLOWANCE_COUNT',
            required: false,
            unit: 'ANNUAL',
          },
        ]),
      ).success,
    ).toBe(false);
  });
});

describe('SCALAR_AMOUNT — generic formula-amount infrastructure (Task 4O-6R5)', () => {
  /**
   * This shape is intentionally NOT registered in `STATE_DETAIL_SCHEMAS`
   * (no `StateRuleKey` exists for it yet — see the Task 4O-6R series), so
   * these tests call the schema directly rather than through
   * `validateStateDetail()`, matching the existing convention already used
   * here for `stateRateDetailSchema`/`stateThresholdDetailSchema`.
   */

  it('accepts a valid annual scalar amount', () => {
    const result = stateScalarAmountDetailSchema.safeParse({
      shape: 'SCALAR_AMOUNT',
      unit: 'ANNUAL',
      amount: '500',
    });
    expect(result.success).toBe(true);
  });

  it('accepts a valid per-period scalar amount', () => {
    const result = stateScalarAmountDetailSchema.safeParse({
      shape: 'SCALAR_AMOUNT',
      unit: 'PER_PERIOD',
      amount: '19.23',
    });
    expect(result.success).toBe(true);
  });

  it('accepts a null amount and preserves it as null — NOT_STATED is not zero', () => {
    const result = stateScalarAmountDetailSchema.safeParse({
      shape: 'SCALAR_AMOUNT',
      unit: 'ANNUAL',
      amount: null,
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.amount).toBeNull();
  });

  it('rejects an invalid shape literal', () => {
    const result = stateScalarAmountDetailSchema.safeParse({
      shape: 'WAGE_BASE',
      unit: 'ANNUAL',
      amount: '500',
    });
    expect(result.success).toBe(false);
  });

  it('rejects an unsupported unit', () => {
    const result = stateScalarAmountDetailSchema.safeParse({
      shape: 'SCALAR_AMOUNT',
      unit: 'PERCENT',
      amount: '500',
    });
    expect(result.success).toBe(false);
  });

  it('rejects a payload with amount entirely omitted', () => {
    const result = stateScalarAmountDetailSchema.safeParse({
      shape: 'SCALAR_AMOUNT',
      unit: 'ANNUAL',
    });
    expect(result.success).toBe(false);
  });

  it('rejects a floating-point amount — money travels as a string', () => {
    const result = stateScalarAmountDetailSchema.safeParse({
      shape: 'SCALAR_AMOUNT',
      unit: 'ANNUAL',
      amount: 500,
    });
    expect(result.success).toBe(false);
  });

  it('rejects a malformed decimal string', () => {
    const result = stateScalarAmountDetailSchema.safeParse({
      shape: 'SCALAR_AMOUNT',
      unit: 'ANNUAL',
      amount: '12.34.56',
    });
    expect(result.success).toBe(false);
  });

  it('rejects a non-numeric string', () => {
    const result = stateScalarAmountDetailSchema.safeParse({
      shape: 'SCALAR_AMOUNT',
      unit: 'ANNUAL',
      amount: 'five hundred',
    });
    expect(result.success).toBe(false);
  });

  it('accepts an unknown extra field, matching this file’s existing permissive schemas', () => {
    // No schema in this file uses `.strict()`; a new strictness policy is
    // not introduced here.
    const result = stateScalarAmountDetailSchema.safeParse({
      shape: 'SCALAR_AMOUNT',
      unit: 'ANNUAL',
      amount: '500',
      unexpectedField: 'ignored',
    });
    expect(result.success).toBe(true);
  });

  it('stores ANNUAL exactly as ANNUAL, performing no conversion', () => {
    const result = stateScalarAmountDetailSchema.safeParse({
      shape: 'SCALAR_AMOUNT',
      unit: 'ANNUAL',
      amount: '1200',
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.unit).toBe('ANNUAL');
    expect(result.data.amount).toBe('1200');
  });

  it('stores PER_PERIOD exactly as PER_PERIOD, performing no conversion', () => {
    const result = stateScalarAmountDetailSchema.safeParse({
      shape: 'SCALAR_AMOUNT',
      unit: 'PER_PERIOD',
      amount: '46.15',
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.unit).toBe('PER_PERIOD');
    expect(result.data.amount).toBe('46.15');
  });

  it('is not registered in STATE_DETAIL_SCHEMAS — no StateRuleKey exists for it yet', () => {
    const registered = Object.values(STATE_DETAIL_SCHEMAS) as unknown[];
    expect(registered).not.toContain(stateScalarAmountDetailSchema);
  });
});

describe('FORMULA_STEPS carries no executable expression', () => {
  it('accepts ordered steps naming operations from a closed set', () => {
    const result = validateStateDetail(StateRuleKey.WITHHOLDING_FORMULA, {
      shape: 'FORMULA_STEPS',
      steps: [
        { ordinal: 0, operation: 'SUBTRACT_STANDARD_DEDUCTION', operandRef: null, note: null },
        { ordinal: 1, operation: 'FLOOR_AT_ZERO', operandRef: null, note: null },
        {
          ordinal: 2,
          operation: 'APPLY_BRACKETS',
          operandRef: StateRuleKey.PIT_RATE_BRACKETS,
          note: null,
        },
      ],
    });
    expect(result.ok).toBe(true);
  });

  it('rejects an arbitrary expression posing as an operation', () => {
    // There is no operation whose payload is an arithmetic string, so an
    // administrator cannot author something that would need evaluating.
    const result = validateStateDetail(StateRuleKey.WITHHOLDING_FORMULA, {
      shape: 'FORMULA_STEPS',
      steps: [{ ordinal: 0, operation: 'wages * 0.05', operandRef: null, note: null }],
    });
    expect(result.ok).toBe(false);
  });
});

describe('validateStateDetail reports issues rather than throwing', () => {
  it('names the offending path', () => {
    const result = validateStateDetail(StateRuleKey.SDI_EMPLOYEE_RATE, {
      shape: 'RATE',
      rate: '1',
      unit: 'NOT_A_UNIT',
      appliesTo: 'EMPLOYEE',
      applicability: 'APPLIES',
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues.map((issue) => issue.path)).toContain('unit');
  });

  it('rejects a withholding table validated as a bracket table', () => {
    // The substitution the two distinct shapes exist to prevent.
    const bracketTable = {
      shape: 'BRACKET_TABLE',
      bracketSets: [{ filingStatus: 'SYNTHETIC_STATUS', brackets: [] }],
    };
    expect(validateStateDetail(StateRuleKey.PIT_RATE_BRACKETS, bracketTable).ok).toBe(true);
    expect(validateStateDetail(StateRuleKey.WITHHOLDING_TABLE, bracketTable).ok).toBe(false);
  });
});

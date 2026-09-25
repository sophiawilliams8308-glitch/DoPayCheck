import { describe, expect, it } from 'vitest';

import { StateRuleKey, ALL_STATE_RULE_KEYS } from '@/lib/tax/state/ruleKeys';
import {
  STATE_DETAIL_SCHEMAS,
  stateElectionFormSchemaDetailSchema,
  stateRateDetailSchema,
  stateScalarAmountDetailSchema,
  stateThresholdDetailSchema,
  stateTaxabilityProfileDetailSchema,
  stateTaxabilityProfileSetDetailSchema,
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

/**
 * TAXABILITY_PROFILE_SET — DM-03 (State Deduction Taxability Contract, 2026-09-19).
 *
 * Every payload below is SYNTHETIC and structural, matching this file's own header rule: no
 * jurisdiction is named, and no figure is a real tax value (contract §3 principle 6; CLAUDE.md
 * §13). This suite covers ONLY schema validity — resolver/wage-bucket behavior is Slice 2/3+.
 */
describe('TAXABILITY_PROFILE_SET (DM-03) — valid structures', () => {
  function unlimitedProfile(
    deductionTypeKey: string,
    effect: 'REDUCE_WAGES' | 'INCREASE_WAGES' | 'NO_CHANGE' | 'NOT_STATED' = 'REDUCE_WAGES',
  ) {
    return {
      deductionTypeKey,
      programTreatments: {
        INCOME_TAX_WITHHOLDING: {
          variants: [{ conditions: [], effect, limit: null }],
        },
      },
    };
  }

  it('accepts a minimal valid collection payload with one deductionTypeKey', () => {
    const result = stateTaxabilityProfileSetDetailSchema.safeParse({
      shape: 'TAXABILITY_PROFILE_SET',
      profiles: [unlimitedProfile('SYNTHETIC_DEDUCTION_A')],
    });
    expect(result.success).toBe(true);
  });

  it('accepts multiple distinct deductionTypeKey entries', () => {
    const result = stateTaxabilityProfileSetDetailSchema.safeParse({
      shape: 'TAXABILITY_PROFILE_SET',
      profiles: [
        unlimitedProfile('SYNTHETIC_DEDUCTION_A'),
        unlimitedProfile('SYNTHETIC_DEDUCTION_B'),
      ],
    });
    expect(result.success).toBe(true);
  });

  it('accepts multiple StateProgram treatments diverging on the same deduction', () => {
    const result = stateTaxabilityProfileSetDetailSchema.safeParse({
      shape: 'TAXABILITY_PROFILE_SET',
      profiles: [
        {
          deductionTypeKey: 'SYNTHETIC_PRE_TAX',
          programTreatments: {
            INCOME_TAX_WITHHOLDING: {
              variants: [{ conditions: [], effect: 'REDUCE_WAGES', limit: null }],
            },
            PFML: {
              variants: [{ conditions: [], effect: 'NO_CHANGE', limit: null }],
            },
          },
        },
      ],
    });
    expect(result.success).toBe(true);
  });

  it.each(['REDUCE_WAGES', 'INCREASE_WAGES', 'NO_CHANGE', 'NOT_STATED'] as const)(
    'accepts effect %s with limit: null',
    (effect) => {
      const result = stateTaxabilityProfileSetDetailSchema.safeParse({
        shape: 'TAXABILITY_PROFILE_SET',
        profiles: [unlimitedProfile('SYNTHETIC_DEDUCTION', effect)],
      });
      expect(result.success).toBe(true);
    },
  );

  it('accepts a valid capped treatment with excessEffect', () => {
    const result = stateTaxabilityProfileSetDetailSchema.safeParse({
      shape: 'TAXABILITY_PROFILE_SET',
      profiles: [
        {
          deductionTypeKey: 'SYNTHETIC_CAPPED',
          programTreatments: {
            INCOME_TAX_WITHHOLDING: {
              variants: [
                {
                  conditions: [],
                  effect: 'REDUCE_WAGES',
                  limit: {
                    basis: 'ANNUAL',
                    amount: '5000',
                    scope: 'PER_EMPLOYEE',
                    variantsByDiscriminator: null,
                  },
                  excessEffect: 'NO_CHANGE',
                },
              ],
            },
          },
        },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('accepts a DELIVERY_MECHANISM condition with a default-last variant', () => {
    const result = stateTaxabilityProfileSetDetailSchema.safeParse({
      shape: 'TAXABILITY_PROFILE_SET',
      profiles: [
        {
          deductionTypeKey: 'SYNTHETIC_HSA',
          programTreatments: {
            INCOME_TAX_WITHHOLDING: {
              variants: [
                {
                  conditions: [
                    {
                      dimension: 'DELIVERY_MECHANISM',
                      operator: 'EQUALS',
                      values: ['CAFETERIA_PLAN'],
                    },
                  ],
                  effect: 'REDUCE_WAGES',
                  limit: null,
                },
                { conditions: [], effect: 'NO_CHANGE', limit: null },
              ],
            },
          },
        },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('accepts a structurally valid variantsByDiscriminator list', () => {
    const result = stateTaxabilityProfileSetDetailSchema.safeParse({
      shape: 'TAXABILITY_PROFILE_SET',
      profiles: [
        {
          deductionTypeKey: 'SYNTHETIC_DEPENDENT_CARE',
          programTreatments: {
            INCOME_TAX_WITHHOLDING: {
              variants: [
                {
                  conditions: [],
                  effect: 'REDUCE_WAGES',
                  limit: {
                    basis: 'ANNUAL',
                    amount: '5000',
                    scope: 'PER_EMPLOYEE',
                    variantsByDiscriminator: [
                      { discriminator: 'FILING_STATUS_SINGLE', amount: '2500' },
                      { discriminator: 'FILING_STATUS_JOINT', amount: '5000' },
                    ],
                  },
                  excessEffect: 'NO_CHANGE',
                },
              ],
            },
          },
        },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('validates through the STATE_DETAIL_SCHEMAS registry under the existing TAXABILITY_PROFILE key', () => {
    const result = validateStateDetail(StateRuleKey.TAXABILITY_PROFILE, {
      shape: 'TAXABILITY_PROFILE_SET',
      profiles: [unlimitedProfile('SYNTHETIC_DEDUCTION')],
    });
    expect(result.ok).toBe(true);
  });

  it('the legacy TAXABILITY_PROFILE shape still validates under the same key (coexistence, not replacement)', () => {
    const result = validateStateDetail(StateRuleKey.TAXABILITY_PROFILE, {
      shape: 'TAXABILITY_PROFILE',
      deductionTypeKey: 'SYNTHETIC_DEDUCTION',
      reducesStateIncomeTaxWages: 'TRUE',
      reducesSdiWages: 'FALSE',
      reducesPfmlWages: 'NOT_STATED',
      reducesSutaWages: 'TRUE',
    });
    expect(result.ok).toBe(true);
  });
});

describe('TAXABILITY_PROFILE_SET (DM-03) — invalid structures', () => {
  const validProfile = {
    deductionTypeKey: 'SYNTHETIC_DEDUCTION',
    programTreatments: {
      INCOME_TAX_WITHHOLDING: {
        variants: [{ conditions: [], effect: 'REDUCE_WAGES', limit: null }],
      },
    },
  };

  it('rejects an unrecognized shape literal', () => {
    const result = stateTaxabilityProfileSetDetailSchema.safeParse({
      shape: 'NOT_A_REAL_SHAPE',
      profiles: [validProfile],
    });
    expect(result.success).toBe(false);
  });

  it('rejects a payload with no shape at all', () => {
    const result = stateTaxabilityProfileSetDetailSchema.safeParse({ profiles: [validProfile] });
    expect(result.success).toBe(false);
  });

  it('rejects a payload with no profiles key', () => {
    const result = stateTaxabilityProfileSetDetailSchema.safeParse({
      shape: 'TAXABILITY_PROFILE_SET',
    });
    expect(result.success).toBe(false);
  });

  it('rejects an empty deductionTypeKey', () => {
    const result = stateTaxabilityProfileSetDetailSchema.safeParse({
      shape: 'TAXABILITY_PROFILE_SET',
      profiles: [{ ...validProfile, deductionTypeKey: '' }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects a duplicate deductionTypeKey across profiles', () => {
    const result = stateTaxabilityProfileSetDetailSchema.safeParse({
      shape: 'TAXABILITY_PROFILE_SET',
      profiles: [validProfile, validProfile],
    });
    expect(result.success).toBe(false);
  });

  it('rejects an unknown StateProgram key', () => {
    const result = stateTaxabilityProfileSetDetailSchema.safeParse({
      shape: 'TAXABILITY_PROFILE_SET',
      profiles: [
        {
          deductionTypeKey: 'SYNTHETIC_DEDUCTION',
          programTreatments: {
            NOT_A_REAL_PROGRAM: {
              variants: [{ conditions: [], effect: 'REDUCE_WAGES', limit: null }],
            },
          },
        },
      ],
    });
    expect(result.success).toBe(false);
  });

  it('rejects a treatment with zero variants', () => {
    const result = stateTaxabilityProfileSetDetailSchema.safeParse({
      shape: 'TAXABILITY_PROFILE_SET',
      profiles: [
        {
          deductionTypeKey: 'SYNTHETIC_DEDUCTION',
          programTreatments: { INCOME_TAX_WITHHOLDING: { variants: [] } },
        },
      ],
    });
    expect(result.success).toBe(false);
  });

  it('rejects a default variant (empty conditions) that is not last', () => {
    const result = stateTaxabilityProfileSetDetailSchema.safeParse({
      shape: 'TAXABILITY_PROFILE_SET',
      profiles: [
        {
          deductionTypeKey: 'SYNTHETIC_DEDUCTION',
          programTreatments: {
            INCOME_TAX_WITHHOLDING: {
              variants: [
                { conditions: [], effect: 'NO_CHANGE', limit: null },
                {
                  conditions: [
                    {
                      dimension: 'DELIVERY_MECHANISM',
                      operator: 'EQUALS',
                      values: ['CAFETERIA_PLAN'],
                    },
                  ],
                  effect: 'REDUCE_WAGES',
                  limit: null,
                },
              ],
            },
          },
        },
      ],
    });
    expect(result.success).toBe(false);
  });

  it('rejects more than one default (empty-conditions) variant', () => {
    const result = stateTaxabilityProfileSetDetailSchema.safeParse({
      shape: 'TAXABILITY_PROFILE_SET',
      profiles: [
        {
          deductionTypeKey: 'SYNTHETIC_DEDUCTION',
          programTreatments: {
            INCOME_TAX_WITHHOLDING: {
              variants: [
                { conditions: [], effect: 'REDUCE_WAGES', limit: null },
                { conditions: [], effect: 'NO_CHANGE', limit: null },
              ],
            },
          },
        },
      ],
    });
    expect(result.success).toBe(false);
  });

  it('rejects two non-default variants whose conditions are not mutually exclusive', () => {
    const result = stateTaxabilityProfileSetDetailSchema.safeParse({
      shape: 'TAXABILITY_PROFILE_SET',
      profiles: [
        {
          deductionTypeKey: 'SYNTHETIC_DEDUCTION',
          programTreatments: {
            INCOME_TAX_WITHHOLDING: {
              variants: [
                {
                  conditions: [
                    {
                      dimension: 'DELIVERY_MECHANISM',
                      operator: 'EQUALS',
                      values: ['CAFETERIA_PLAN'],
                    },
                  ],
                  effect: 'REDUCE_WAGES',
                  limit: null,
                },
                {
                  conditions: [
                    {
                      dimension: 'DELIVERY_MECHANISM',
                      operator: 'IN',
                      values: ['CAFETERIA_PLAN', 'PAYROLL_DEDUCTION'],
                    },
                  ],
                  effect: 'NO_CHANGE',
                  limit: null,
                },
              ],
            },
          },
        },
      ],
    });
    expect(result.success).toBe(false);
  });

  it('rejects an invalid effect value', () => {
    const result = stateTaxabilityProfileSetDetailSchema.safeParse({
      shape: 'TAXABILITY_PROFILE_SET',
      profiles: [
        {
          deductionTypeKey: 'SYNTHETIC_DEDUCTION',
          programTreatments: {
            INCOME_TAX_WITHHOLDING: {
              variants: [{ conditions: [], effect: 'MAYBE', limit: null }],
            },
          },
        },
      ],
    });
    expect(result.success).toBe(false);
  });

  it('rejects a variant with no limit key at all (omission is invalid, not "unlimited")', () => {
    const result = stateTaxabilityProfileSetDetailSchema.safeParse({
      shape: 'TAXABILITY_PROFILE_SET',
      profiles: [
        {
          deductionTypeKey: 'SYNTHETIC_DEDUCTION',
          programTreatments: {
            INCOME_TAX_WITHHOLDING: { variants: [{ conditions: [], effect: 'REDUCE_WAGES' }] },
          },
        },
      ],
    });
    expect(result.success).toBe(false);
  });

  it('rejects an invalid limit basis', () => {
    const result = stateTaxabilityProfileSetDetailSchema.safeParse({
      shape: 'TAXABILITY_PROFILE_SET',
      profiles: [
        {
          deductionTypeKey: 'SYNTHETIC_DEDUCTION',
          programTreatments: {
            INCOME_TAX_WITHHOLDING: {
              variants: [
                {
                  conditions: [],
                  effect: 'REDUCE_WAGES',
                  limit: {
                    basis: 'WEEKLY',
                    amount: '100',
                    scope: 'PER_EMPLOYEE',
                    variantsByDiscriminator: null,
                  },
                  excessEffect: 'NO_CHANGE',
                },
              ],
            },
          },
        },
      ],
    });
    expect(result.success).toBe(false);
  });

  it.each(['-100', '0', '0.00'])('rejects a non-positive limit amount (%s)', (amount) => {
    const result = stateTaxabilityProfileSetDetailSchema.safeParse({
      shape: 'TAXABILITY_PROFILE_SET',
      profiles: [
        {
          deductionTypeKey: 'SYNTHETIC_DEDUCTION',
          programTreatments: {
            INCOME_TAX_WITHHOLDING: {
              variants: [
                {
                  conditions: [],
                  effect: 'REDUCE_WAGES',
                  limit: {
                    basis: 'ANNUAL',
                    amount,
                    scope: 'PER_EMPLOYEE',
                    variantsByDiscriminator: null,
                  },
                  excessEffect: 'NO_CHANGE',
                },
              ],
            },
          },
        },
      ],
    });
    expect(result.success).toBe(false);
  });

  it('rejects a non-null limit with no excessEffect', () => {
    const result = stateTaxabilityProfileSetDetailSchema.safeParse({
      shape: 'TAXABILITY_PROFILE_SET',
      profiles: [
        {
          deductionTypeKey: 'SYNTHETIC_DEDUCTION',
          programTreatments: {
            INCOME_TAX_WITHHOLDING: {
              variants: [
                {
                  conditions: [],
                  effect: 'REDUCE_WAGES',
                  limit: {
                    basis: 'ANNUAL',
                    amount: '100',
                    scope: 'PER_EMPLOYEE',
                    variantsByDiscriminator: null,
                  },
                },
              ],
            },
          },
        },
      ],
    });
    expect(result.success).toBe(false);
  });

  it('rejects excessEffect present when limit is null', () => {
    const result = stateTaxabilityProfileSetDetailSchema.safeParse({
      shape: 'TAXABILITY_PROFILE_SET',
      profiles: [
        {
          deductionTypeKey: 'SYNTHETIC_DEDUCTION',
          programTreatments: {
            INCOME_TAX_WITHHOLDING: {
              variants: [
                { conditions: [], effect: 'REDUCE_WAGES', limit: null, excessEffect: 'NO_CHANGE' },
              ],
            },
          },
        },
      ],
    });
    expect(result.success).toBe(false);
  });

  it.each(['NO_CHANGE', 'NOT_STATED', 'INCREASE_WAGES'] as const)(
    'rejects a non-null limit attached to effect %s',
    (effect) => {
      const result = stateTaxabilityProfileSetDetailSchema.safeParse({
        shape: 'TAXABILITY_PROFILE_SET',
        profiles: [
          {
            deductionTypeKey: 'SYNTHETIC_DEDUCTION',
            programTreatments: {
              INCOME_TAX_WITHHOLDING: {
                variants: [
                  {
                    conditions: [],
                    effect,
                    limit: {
                      basis: 'ANNUAL',
                      amount: '100',
                      scope: 'PER_EMPLOYEE',
                      variantsByDiscriminator: null,
                    },
                    excessEffect: 'NO_CHANGE',
                  },
                ],
              },
            },
          },
        ],
      });
      expect(result.success).toBe(false);
    },
  );

  it('rejects an invalid condition dimension', () => {
    const result = stateTaxabilityProfileSetDetailSchema.safeParse({
      shape: 'TAXABILITY_PROFILE_SET',
      profiles: [
        {
          deductionTypeKey: 'SYNTHETIC_DEDUCTION',
          programTreatments: {
            INCOME_TAX_WITHHOLDING: {
              variants: [
                {
                  conditions: [
                    {
                      dimension: 'EMPLOYEE_STATUS',
                      operator: 'EQUALS',
                      values: ['CAFETERIA_PLAN'],
                    },
                  ],
                  effect: 'REDUCE_WAGES',
                  limit: null,
                },
                { conditions: [], effect: 'NO_CHANGE', limit: null },
              ],
            },
          },
        },
      ],
    });
    expect(result.success).toBe(false);
  });

  it('rejects an invalid condition operator', () => {
    const result = stateTaxabilityProfileSetDetailSchema.safeParse({
      shape: 'TAXABILITY_PROFILE_SET',
      profiles: [
        {
          deductionTypeKey: 'SYNTHETIC_DEDUCTION',
          programTreatments: {
            INCOME_TAX_WITHHOLDING: {
              variants: [
                {
                  conditions: [
                    {
                      dimension: 'DELIVERY_MECHANISM',
                      operator: 'CONTAINS',
                      values: ['CAFETERIA_PLAN'],
                    },
                  ],
                  effect: 'REDUCE_WAGES',
                  limit: null,
                },
                { conditions: [], effect: 'NO_CHANGE', limit: null },
              ],
            },
          },
        },
      ],
    });
    expect(result.success).toBe(false);
  });

  it('rejects an invalid delivery mechanism value', () => {
    const result = stateTaxabilityProfileSetDetailSchema.safeParse({
      shape: 'TAXABILITY_PROFILE_SET',
      profiles: [
        {
          deductionTypeKey: 'SYNTHETIC_DEDUCTION',
          programTreatments: {
            INCOME_TAX_WITHHOLDING: {
              variants: [
                {
                  conditions: [
                    {
                      dimension: 'DELIVERY_MECHANISM',
                      operator: 'EQUALS',
                      values: ['NOT_A_MECHANISM'],
                    },
                  ],
                  effect: 'REDUCE_WAGES',
                  limit: null,
                },
                { conditions: [], effect: 'NO_CHANGE', limit: null },
              ],
            },
          },
        },
      ],
    });
    expect(result.success).toBe(false);
  });

  it('rejects a duplicate discriminator within variantsByDiscriminator', () => {
    const result = stateTaxabilityProfileSetDetailSchema.safeParse({
      shape: 'TAXABILITY_PROFILE_SET',
      profiles: [
        {
          deductionTypeKey: 'SYNTHETIC_DEDUCTION',
          programTreatments: {
            INCOME_TAX_WITHHOLDING: {
              variants: [
                {
                  conditions: [],
                  effect: 'REDUCE_WAGES',
                  limit: {
                    basis: 'ANNUAL',
                    amount: '5000',
                    scope: 'PER_EMPLOYEE',
                    variantsByDiscriminator: [
                      { discriminator: 'FILING_STATUS_SINGLE', amount: '2500' },
                      { discriminator: 'FILING_STATUS_SINGLE', amount: '3000' },
                    ],
                  },
                  excessEffect: 'NO_CHANGE',
                },
              ],
            },
          },
        },
      ],
    });
    expect(result.success).toBe(false);
  });

  it('rejects a malformed decimal representation', () => {
    const result = stateTaxabilityProfileSetDetailSchema.safeParse({
      shape: 'TAXABILITY_PROFILE_SET',
      profiles: [
        {
          deductionTypeKey: 'SYNTHETIC_DEDUCTION',
          programTreatments: {
            INCOME_TAX_WITHHOLDING: {
              variants: [
                {
                  conditions: [],
                  effect: 'REDUCE_WAGES',
                  limit: {
                    basis: 'ANNUAL',
                    amount: '12.34.56',
                    scope: 'PER_EMPLOYEE',
                    variantsByDiscriminator: null,
                  },
                  excessEffect: 'NO_CHANGE',
                },
              ],
            },
          },
        },
      ],
    });
    expect(result.success).toBe(false);
  });

  it('rejects a numeric (non-string) amount — never binary floating point', () => {
    const result = stateTaxabilityProfileSetDetailSchema.safeParse({
      shape: 'TAXABILITY_PROFILE_SET',
      profiles: [
        {
          deductionTypeKey: 'SYNTHETIC_DEDUCTION',
          programTreatments: {
            INCOME_TAX_WITHHOLDING: {
              variants: [
                {
                  conditions: [],
                  effect: 'REDUCE_WAGES',
                  limit: {
                    basis: 'ANNUAL',
                    amount: 5000,
                    scope: 'PER_EMPLOYEE',
                    variantsByDiscriminator: null,
                  },
                  excessEffect: 'NO_CHANGE',
                },
              ],
            },
          },
        },
      ],
    });
    expect(result.success).toBe(false);
  });
});

describe('TAXABILITY_PROFILE_SET (DM-03) — positive-amount zero regression (4O-6R65)', () => {
  /**
   * 4O-6R64 found that `positiveDecimalString`'s prior zero-detection pattern
   * (`^0(\.0+)?$`) only matched a SINGLE leading zero digit, so non-canonical zero
   * representations like `"00"`/`"000.00"` slipped through as "positive" — a direct
   * violation of DM-03 contract §14 rule 10 ("amount > 0. Negative or zero cap is
   * invalid"). 4O-6R65 widened the pattern to `^0+(\.0+)?$`, matching ANY number of
   * leading/trailing zero digits. These tests exercise `limit.amount`, which shares the
   * same `positiveDecimalString` primitive as `variantsByDiscriminator[].amount`.
   */
  function withLimitAmount(amount: string | number) {
    return {
      shape: 'TAXABILITY_PROFILE_SET',
      profiles: [
        {
          deductionTypeKey: 'SYNTHETIC_DEDUCTION',
          programTreatments: {
            INCOME_TAX_WITHHOLDING: {
              variants: [
                {
                  conditions: [],
                  effect: 'REDUCE_WAGES',
                  limit: {
                    basis: 'ANNUAL',
                    amount,
                    scope: 'PER_EMPLOYEE',
                    variantsByDiscriminator: null,
                  },
                  excessEffect: 'NO_CHANGE',
                },
              ],
            },
          },
        },
      ],
    };
  }

  it.each(['0', '0.0', '0.00', '00', '000', '000.00', '000.000', '-0', '-0.00', '-100'])(
    'rejects zero/negative amount %s',
    (amount) => {
      const result = stateTaxabilityProfileSetDetailSchema.safeParse(withLimitAmount(amount));
      expect(result.success).toBe(false);
    },
  );

  it.each(['1', '1.0', '1.25', '0001', '0001.00', '5000', '5000.50'])(
    'accepts positive amount %s, including leading-zero notation for a non-zero value',
    (amount) => {
      const result = stateTaxabilityProfileSetDetailSchema.safeParse(withLimitAmount(amount));
      expect(result.success).toBe(true);
    },
  );

  it('rejects a "00"-shaped variantsByDiscriminator amount identically to a plain "0"', () => {
    const result = stateTaxabilityProfileSetDetailSchema.safeParse({
      shape: 'TAXABILITY_PROFILE_SET',
      profiles: [
        {
          deductionTypeKey: 'SYNTHETIC_DISCRIMINATED',
          programTreatments: {
            INCOME_TAX_WITHHOLDING: {
              variants: [
                {
                  conditions: [],
                  effect: 'REDUCE_WAGES',
                  limit: {
                    basis: 'ANNUAL',
                    amount: '5000',
                    scope: 'PER_EMPLOYEE',
                    variantsByDiscriminator: [{ discriminator: 'SYNTHETIC', amount: '00' }],
                  },
                  excessEffect: 'NO_CHANGE',
                },
              ],
            },
          },
        },
      ],
    });
    expect(result.success).toBe(false);
  });
});

describe('TAXABILITY_PROFILE — legacy/DM-03 hybrid payload regression (4O-6R65)', () => {
  /**
   * 4O-6R64 found that a payload carrying every legacy field PLUS an extraneous
   * DM-03 field (or the reverse) validated successfully, because neither object
   * schema declared `.strict()` — Zod's default behavior silently strips an
   * unrecognized key rather than rejecting the payload. Contract §13.8: "What if
   * both representations exist for one rule? A hard error. `RULE_DETAIL_INVALID`.
   * Never silent precedence, never a merge." 4O-6R65 added `.strict()` to both
   * `stateTaxabilityProfileDetailSchema` and `stateTaxabilityProfileSetDetailSchema`
   * so a mixed-shape payload is rejected rather than silently trimmed.
   */
  const pureLegacyPayload = {
    shape: 'TAXABILITY_PROFILE',
    deductionTypeKey: 'SYNTHETIC',
    reducesStateIncomeTaxWages: 'TRUE',
    reducesSdiWages: 'FALSE',
    reducesPfmlWages: 'NOT_STATED',
    reducesSutaWages: 'TRUE',
  };

  const pureNewPayload = {
    shape: 'TAXABILITY_PROFILE_SET',
    profiles: [
      {
        deductionTypeKey: 'SYNTHETIC_DEDUCTION',
        programTreatments: {
          INCOME_TAX_WITHHOLDING: {
            variants: [{ conditions: [], effect: 'REDUCE_WAGES', limit: null }],
          },
        },
      },
    ],
  };

  it('still accepts a pure legacy payload with no extraneous fields', () => {
    expect(stateTaxabilityProfileDetailSchema.safeParse(pureLegacyPayload).success).toBe(true);
    expect(validateStateDetail(StateRuleKey.TAXABILITY_PROFILE, pureLegacyPayload).ok).toBe(true);
  });

  it('still accepts a pure TAXABILITY_PROFILE_SET payload with no extraneous fields', () => {
    expect(stateTaxabilityProfileSetDetailSchema.safeParse(pureNewPayload).success).toBe(true);
    expect(validateStateDetail(StateRuleKey.TAXABILITY_PROFILE, pureNewPayload).ok).toBe(true);
  });

  it('rejects a legacy-shaped payload carrying an extraneous DM-03 "profiles" field', () => {
    const hybrid = { ...pureLegacyPayload, profiles: pureNewPayload.profiles };
    expect(stateTaxabilityProfileDetailSchema.safeParse(hybrid).success).toBe(false);

    const outcome = validateStateDetail(StateRuleKey.TAXABILITY_PROFILE, hybrid);
    expect(outcome.ok).toBe(false);
  });

  it('rejects a TAXABILITY_PROFILE_SET-shaped payload carrying extraneous legacy fields', () => {
    const hybrid = {
      shape: 'TAXABILITY_PROFILE_SET',
      profiles: pureNewPayload.profiles,
      reducesStateIncomeTaxWages: 'TRUE',
      reducesSdiWages: 'FALSE',
      reducesPfmlWages: 'NOT_STATED',
      reducesSutaWages: 'TRUE',
    };
    expect(stateTaxabilityProfileSetDetailSchema.safeParse(hybrid).success).toBe(false);

    const outcome = validateStateDetail(StateRuleKey.TAXABILITY_PROFILE, hybrid);
    expect(outcome.ok).toBe(false);
  });

  it('never silently strips the stray field to produce a false success through validateStateDetail()', () => {
    const hybrid = { ...pureLegacyPayload, profiles: pureNewPayload.profiles };
    const outcome = validateStateDetail(StateRuleKey.TAXABILITY_PROFILE, hybrid);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.issues.length).toBeGreaterThan(0);
    }
  });
});

import { describe, expect, it } from 'vitest';

import { money, toStorageString } from '@/lib/core/money';
import type { RuleReference } from '@/lib/calculator/types/rules';
import { runStateWithholdingFormula } from '@/lib/tax/state/rules/withholdingFormulaInterpreter';
import {
  freezeStateRuleSet,
  type ResolvedStateRule,
  type ResolvedStateRuleSet,
  type StateRuleEntry,
} from '@/lib/tax/state/rules/stateRuleSet';
import { StateRuleKey } from '@/lib/tax/state/ruleKeys';
import type { StateFormulaStepsDetail } from '@/lib/tax/state/rules/detailSchemas';
import {
  resolveWorkJurisdictionElections,
  stateYtdAssumedZero,
  validateStateContext,
  type StateCalculationContext,
  type StateElectionValue,
} from '@/lib/tax/state/context';
import { ResidencyStatus } from '@/lib/tax/state/types';

/**
 * `ADD_AMOUNT` — generic over any `AMOUNT`-typed field a jurisdiction's
 * `WITHHOLDING_ELECTION_FORM` declares (Task 4O-6R20/4O-6R21/4O-6R22/4O-6R23).
 *
 * ===========================================================================
 * SCOPE NOTE.
 *
 * Unlike every other formula operation, `ADD_AMOUNT`'s `operandRef` is an
 * election `fieldKey`, never a `StateRuleKey` — Task 4O-6R21/4O-6R22 locked
 * this after finding no composite-identifier convention anywhere in the
 * repository and explicitly forbidding treating an employee election as a
 * `StateRuleKey`. `WITHHOLDING_ELECTION_FORM` IS a registered production
 * `StateRuleKey`, so its lookup reuses the existing `readDetail()` machinery
 * exactly as every other operation already does — no new generic election
 * reader is introduced. The submitted value itself comes from
 * `resolvedElections`, an already-resolved, `fieldKey`-keyed map of the
 * current WORK jurisdiction's election values
 * (`resolveWorkJurisdictionElections()`, `lib/tax/state/context.ts`) — never
 * residence, and never the whole `StateCalculationContext`.
 * ===========================================================================
 *
 * Fixtures use RESERVED TEST jurisdiction/source ids and no real tax value.
 */

const JURISDICTION_CODE = 'TEST-ADD-AMOUNT';
const JURISDICTION_ID = 'test-add-amount-jurisdiction-id';
const RESIDENCE_JURISDICTION_CODE = 'TEST-ADD-AMOUNT-RESIDENCE';
const TAX_YEAR = 2099;
const EFFECTIVE = '2099-06-15T00:00:00.000Z';
const FORM_KEY = StateRuleKey.WITHHOLDING_ELECTION_FORM;
const SINGLE = 'SINGLE';
const AMOUNT_FIELD = 'additionalAmount';

function reference(ruleKey: string, jurisdictionCode: string = JURISDICTION_CODE): RuleReference {
  return {
    ruleId: `synthetic-${ruleKey}`,
    ruleKey,
    version: 1,
    category: 'STATE_WITHHOLDING',
    taxYear: TAX_YEAR,
    jurisdictionId: JURISDICTION_ID,
    jurisdictionCode,
    effectiveFrom: new Date('2099-01-01T00:00:00.000Z'),
    effectiveTo: null,
    sourceIds: [`synthetic-source-${ruleKey}`],
    verified: true,
  };
}

function availableEntry(
  key: StateRuleKey,
  detail: unknown,
  overrides: { verificationStatus?: string } = {},
): { available: true; rule: ResolvedStateRule } {
  return {
    available: true,
    rule: {
      key,
      reference: reference(key),
      detail,
      verificationStatus: overrides.verificationStatus ?? 'VERIFIED',
    },
  };
}

function buildRuleSet(
  entries: Partial<Record<StateRuleKey, StateRuleEntry>>,
): ResolvedStateRuleSet {
  return freezeStateRuleSet({
    taxYear: TAX_YEAR,
    effectiveDate: EFFECTIVE,
    jurisdictionCode: JURISDICTION_CODE,
    engineVersion: 'test-engine',
    resolvedAt: EFFECTIVE,
    missing: [],
    entries,
    ruleReferences: [],
    sourceIds: [],
  });
}

function formulaDetail(steps: readonly Record<string, unknown>[]): StateFormulaStepsDetail {
  return { shape: 'FORMULA_STEPS', steps } as StateFormulaStepsDetail;
}

function electionFormDetail(
  fields: readonly {
    fieldKey: string;
    type: string;
    unit?: 'ANNUAL' | 'PER_PERIOD';
  }[],
) {
  return {
    shape: 'ELECTION_FORM_SCHEMA',
    formCode: 'SYNTHETIC-FORM',
    formName: 'Synthetic Election Form',
    fields: fields.map((field) => ({
      fieldKey: field.fieldKey,
      label: field.fieldKey,
      type: field.type,
      required: false,
      ...(field.unit === undefined ? {} : { unit: field.unit }),
    })),
  };
}

const step = (
  ordinal: number,
  operation: string,
  operandRef: string | null = null,
): Record<string, unknown> => ({ ordinal, operation, operandRef, note: null });

/** The map runStateWithholdingFormula() receives — mirrors resolveWorkJurisdictionElections()'s output shape. */
function elections(
  values: Readonly<Partial<Record<string, StateElectionValue | null>>>,
): Readonly<Partial<Record<string, StateElectionValue | null>>> {
  return values;
}

describe('ADD_AMOUNT — operandRef validation', () => {
  it('reports RULE_DETAIL_INVALID for a null operandRef', () => {
    const ruleSet = buildRuleSet({});
    const detail = formulaDetail([step(0, 'ADD_AMOUNT', null)]);

    const result = runStateWithholdingFormula(detail, ruleSet, money('1000'), SINGLE, {}, {});

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.problem.reason).toBe('RULE_DETAIL_INVALID');
  });

  it('reports RULE_DETAIL_INVALID for a non-empty operandRef that names no declared field', () => {
    const ruleSet = buildRuleSet({
      [FORM_KEY]: availableEntry(FORM_KEY, electionFormDetail([])),
    });
    const detail = formulaDetail([step(0, 'ADD_AMOUNT', 'NOT_A_REAL_FIELD_KEY')]);

    const result = runStateWithholdingFormula(detail, ruleSet, money('1000'), SINGLE, {}, {});

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.problem.reason).toBe('RULE_DETAIL_INVALID');
  });
});

describe('ADD_AMOUNT — election form resolution', () => {
  it('reports RULE_MISSING when WITHHOLDING_ELECTION_FORM was never resolved', () => {
    const ruleSet = buildRuleSet({});
    const detail = formulaDetail([step(0, 'ADD_AMOUNT', AMOUNT_FIELD)]);

    const result = runStateWithholdingFormula(detail, ruleSet, money('1000'), SINGLE, {}, {});

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.problem.reason).toBe('RULE_MISSING');
  });

  it('reports RULE_UNVERIFIED for a PENDING WITHHOLDING_ELECTION_FORM', () => {
    const ruleSet = buildRuleSet({
      [FORM_KEY]: availableEntry(
        FORM_KEY,
        electionFormDetail([{ fieldKey: AMOUNT_FIELD, type: 'AMOUNT', unit: 'PER_PERIOD' }]),
        { verificationStatus: 'PENDING' },
      ),
    });
    const detail = formulaDetail([step(0, 'ADD_AMOUNT', AMOUNT_FIELD)]);

    const result = runStateWithholdingFormula(detail, ruleSet, money('1000'), SINGLE, {}, {});

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.problem.reason).toBe('RULE_UNVERIFIED');
  });

  it('reports RULE_DETAIL_INVALID when the resolved rule is not an ELECTION_FORM_SCHEMA', () => {
    const ruleSet = buildRuleSet({
      [FORM_KEY]: availableEntry(FORM_KEY, {
        shape: 'RATE',
        rate: '0.05',
        unit: 'DECIMAL_FRACTION',
        appliesTo: 'EMPLOYEE',
        applicability: 'APPLIES',
      }),
    });
    const detail = formulaDetail([step(0, 'ADD_AMOUNT', AMOUNT_FIELD)]);

    const result = runStateWithholdingFormula(detail, ruleSet, money('1000'), SINGLE, {}, {});

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.problem.reason).toBe('RULE_DETAIL_INVALID');
  });
});

describe('ADD_AMOUNT — field declaration and type', () => {
  it('reports RULE_DETAIL_INVALID when the fieldKey is not declared in the form', () => {
    const ruleSet = buildRuleSet({
      [FORM_KEY]: availableEntry(
        FORM_KEY,
        electionFormDetail([{ fieldKey: 'someOtherField', type: 'AMOUNT', unit: 'ANNUAL' }]),
      ),
    });
    const detail = formulaDetail([step(0, 'ADD_AMOUNT', AMOUNT_FIELD)]);

    const result = runStateWithholdingFormula(detail, ruleSet, money('1000'), SINGLE, {}, {});

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.problem.reason).toBe('RULE_DETAIL_INVALID');
  });

  it('reports RULE_DETAIL_INVALID when the declared field type is not AMOUNT', () => {
    const ruleSet = buildRuleSet({
      [FORM_KEY]: availableEntry(
        FORM_KEY,
        electionFormDetail([{ fieldKey: AMOUNT_FIELD, type: 'BOOLEAN' }]),
      ),
    });
    const detail = formulaDetail([step(0, 'ADD_AMOUNT', AMOUNT_FIELD)]);

    const result = runStateWithholdingFormula(detail, ruleSet, money('1000'), SINGLE, {}, {});

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.problem.reason).toBe('RULE_DETAIL_INVALID');
  });

  it('proceeds past field validation for a declared AMOUNT field', () => {
    const ruleSet = buildRuleSet({
      [FORM_KEY]: availableEntry(
        FORM_KEY,
        electionFormDetail([{ fieldKey: AMOUNT_FIELD, type: 'AMOUNT', unit: 'PER_PERIOD' }]),
      ),
    });
    const detail = formulaDetail([step(0, 'ADD_AMOUNT', AMOUNT_FIELD)]);

    const result = runStateWithholdingFormula(
      detail,
      ruleSet,
      money('1000'),
      SINGLE,
      {},
      elections({ [AMOUNT_FIELD]: { fieldKey: AMOUNT_FIELD, value: '25', unit: 'PER_PERIOD' } }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(toStorageString(result.value)).toBe('1025');
  });
});

describe('ADD_AMOUNT — submitted value resolution', () => {
  const ruleSet = buildRuleSet({
    [FORM_KEY]: availableEntry(
      FORM_KEY,
      electionFormDetail([{ fieldKey: AMOUNT_FIELD, type: 'AMOUNT', unit: 'PER_PERIOD' }]),
    ),
  });

  it('reports COMPONENT_NOT_STATED when no value was submitted for the field', () => {
    const detail = formulaDetail([step(0, 'ADD_AMOUNT', AMOUNT_FIELD)]);

    const result = runStateWithholdingFormula(detail, ruleSet, money('1000'), SINGLE, {}, {});

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.problem.reason).toBe('COMPONENT_NOT_STATED');
  });

  it('reports COMPONENT_NOT_STATED for a defensive null submitted value', () => {
    const detail = formulaDetail([step(0, 'ADD_AMOUNT', AMOUNT_FIELD)]);

    const result = runStateWithholdingFormula(
      detail,
      ruleSet,
      money('1000'),
      SINGLE,
      {},
      elections({ [AMOUNT_FIELD]: null }),
    );

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.problem.reason).toBe('COMPONENT_NOT_STATED');
  });

  it('accepts a valid DecimalString value', () => {
    const detail = formulaDetail([step(0, 'ADD_AMOUNT', AMOUNT_FIELD)]);

    const result = runStateWithholdingFormula(
      detail,
      ruleSet,
      money('1000'),
      SINGLE,
      {},
      elections({ [AMOUNT_FIELD]: { fieldKey: AMOUNT_FIELD, value: '50', unit: 'PER_PERIOD' } }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(toStorageString(result.value)).toBe('1050');
  });

  it('reports RULE_DETAIL_INVALID for a submitted number value', () => {
    const detail = formulaDetail([step(0, 'ADD_AMOUNT', AMOUNT_FIELD)]);

    const result = runStateWithholdingFormula(
      detail,
      ruleSet,
      money('1000'),
      SINGLE,
      {},
      elections({ [AMOUNT_FIELD]: { fieldKey: AMOUNT_FIELD, value: 50 } }),
    );

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.problem.reason).toBe('RULE_DETAIL_INVALID');
  });

  it('reports RULE_DETAIL_INVALID for a submitted boolean value', () => {
    const detail = formulaDetail([step(0, 'ADD_AMOUNT', AMOUNT_FIELD)]);

    const result = runStateWithholdingFormula(
      detail,
      ruleSet,
      money('1000'),
      SINGLE,
      {},
      elections({ [AMOUNT_FIELD]: { fieldKey: AMOUNT_FIELD, value: true } }),
    );

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.problem.reason).toBe('RULE_DETAIL_INVALID');
  });
});

describe('ADD_AMOUNT — unit matching', () => {
  it('accepts a matching ANNUAL unit', () => {
    const ruleSet = buildRuleSet({
      [FORM_KEY]: availableEntry(
        FORM_KEY,
        electionFormDetail([{ fieldKey: AMOUNT_FIELD, type: 'AMOUNT', unit: 'ANNUAL' }]),
      ),
    });
    const detail = formulaDetail([step(0, 'ADD_AMOUNT', AMOUNT_FIELD)]);

    const result = runStateWithholdingFormula(
      detail,
      ruleSet,
      money('1000'),
      SINGLE,
      {},
      elections({ [AMOUNT_FIELD]: { fieldKey: AMOUNT_FIELD, value: '100', unit: 'ANNUAL' } }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(toStorageString(result.value)).toBe('1100');
  });

  it('accepts a matching PER_PERIOD unit', () => {
    const ruleSet = buildRuleSet({
      [FORM_KEY]: availableEntry(
        FORM_KEY,
        electionFormDetail([{ fieldKey: AMOUNT_FIELD, type: 'AMOUNT', unit: 'PER_PERIOD' }]),
      ),
    });
    const detail = formulaDetail([step(0, 'ADD_AMOUNT', AMOUNT_FIELD)]);

    const result = runStateWithholdingFormula(
      detail,
      ruleSet,
      money('1000'),
      SINGLE,
      {},
      elections({ [AMOUNT_FIELD]: { fieldKey: AMOUNT_FIELD, value: '100', unit: 'PER_PERIOD' } }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(toStorageString(result.value)).toBe('1100');
  });

  it('reports RULE_CONFLICT when the form declares ANNUAL but the submitted value declares PER_PERIOD', () => {
    const ruleSet = buildRuleSet({
      [FORM_KEY]: availableEntry(
        FORM_KEY,
        electionFormDetail([{ fieldKey: AMOUNT_FIELD, type: 'AMOUNT', unit: 'ANNUAL' }]),
      ),
    });
    const detail = formulaDetail([step(0, 'ADD_AMOUNT', AMOUNT_FIELD)]);

    const result = runStateWithholdingFormula(
      detail,
      ruleSet,
      money('1000'),
      SINGLE,
      {},
      elections({ [AMOUNT_FIELD]: { fieldKey: AMOUNT_FIELD, value: '100', unit: 'PER_PERIOD' } }),
    );

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.problem.reason).toBe('RULE_CONFLICT');
  });

  it('reports RULE_CONFLICT when the form declares PER_PERIOD but the submitted value declares ANNUAL', () => {
    const ruleSet = buildRuleSet({
      [FORM_KEY]: availableEntry(
        FORM_KEY,
        electionFormDetail([{ fieldKey: AMOUNT_FIELD, type: 'AMOUNT', unit: 'PER_PERIOD' }]),
      ),
    });
    const detail = formulaDetail([step(0, 'ADD_AMOUNT', AMOUNT_FIELD)]);

    const result = runStateWithholdingFormula(
      detail,
      ruleSet,
      money('1000'),
      SINGLE,
      {},
      elections({ [AMOUNT_FIELD]: { fieldKey: AMOUNT_FIELD, value: '100', unit: 'ANNUAL' } }),
    );

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.problem.reason).toBe('RULE_CONFLICT');
  });
});

describe('ADD_AMOUNT — arithmetic', () => {
  const ruleSet = buildRuleSet({
    [FORM_KEY]: availableEntry(
      FORM_KEY,
      electionFormDetail([{ fieldKey: AMOUNT_FIELD, type: 'AMOUNT', unit: 'PER_PERIOD' }]),
    ),
  });

  it('adds a positive amount', () => {
    const detail = formulaDetail([step(0, 'ADD_AMOUNT', AMOUNT_FIELD)]);
    const result = runStateWithholdingFormula(
      detail,
      ruleSet,
      money('1000'),
      SINGLE,
      {},
      elections({ [AMOUNT_FIELD]: { fieldKey: AMOUNT_FIELD, value: '75', unit: 'PER_PERIOD' } }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(toStorageString(result.value)).toBe('1075');
  });

  it('adds zero, leaving the running value unchanged, without rejecting it', () => {
    const detail = formulaDetail([step(0, 'ADD_AMOUNT', AMOUNT_FIELD)]);
    const result = runStateWithholdingFormula(
      detail,
      ruleSet,
      money('1000'),
      SINGLE,
      {},
      elections({ [AMOUNT_FIELD]: { fieldKey: AMOUNT_FIELD, value: '0', unit: 'PER_PERIOD' } }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(toStorageString(result.value)).toBe('1000');
  });

  it('adds a negative amount exactly as authored, without inventing a restriction', () => {
    const detail = formulaDetail([step(0, 'ADD_AMOUNT', AMOUNT_FIELD)]);
    const result = runStateWithholdingFormula(
      detail,
      ruleSet,
      money('1000'),
      SINGLE,
      {},
      elections({ [AMOUNT_FIELD]: { fieldKey: AMOUNT_FIELD, value: '-40', unit: 'PER_PERIOD' } }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(toStorageString(result.value)).toBe('960');
  });

  it('operates on the running value left by a preceding formula step (sequential accumulator)', () => {
    const deductionKey = StateRuleKey.WITHHOLDING_STANDARD_DEDUCTION;
    const combinedRuleSet = buildRuleSet({
      [FORM_KEY]: availableEntry(
        FORM_KEY,
        electionFormDetail([{ fieldKey: AMOUNT_FIELD, type: 'AMOUNT', unit: 'PER_PERIOD' }]),
      ),
      [deductionKey]: availableEntry(deductionKey, {
        shape: 'AMOUNT_BY_FILING_STATUS',
        unit: 'ANNUAL',
        amounts: [{ filingStatus: SINGLE, amount: '200' }],
      }),
    });
    const detail = formulaDetail([
      step(0, 'SUBTRACT_STANDARD_DEDUCTION'),
      step(1, 'ADD_AMOUNT', AMOUNT_FIELD),
    ]);

    const result = runStateWithholdingFormula(
      detail,
      combinedRuleSet,
      money('1000'),
      SINGLE,
      {},
      elections({ [AMOUNT_FIELD]: { fieldKey: AMOUNT_FIELD, value: '30', unit: 'PER_PERIOD' } }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    // 1000 - 200 = 800; 800 + 30 = 830.
    expect(toStorageString(result.value)).toBe('830');
  });
});

/** Builds a minimal StateCalculationContext for jurisdiction-scoping tests. */
function testRuleSet(jurisdictionCode: string): ResolvedStateRuleSet {
  const key = StateRuleKey.WITHHOLDING_METHOD;
  return freezeStateRuleSet({
    taxYear: TAX_YEAR,
    effectiveDate: EFFECTIVE,
    jurisdictionCode,
    engineVersion: 'test-engine',
    resolvedAt: EFFECTIVE,
    missing: [],
    entries: {
      [key]: {
        available: true,
        rule: {
          key,
          reference: reference(key, jurisdictionCode),
          detail: null,
          verificationStatus: 'VERIFIED',
        },
      },
    },
    ruleReferences: [reference(key, jurisdictionCode)],
    sourceIds: [`synthetic-source-${key}`],
  });
}

function testContext(overrides: Partial<StateCalculationContext> = {}): StateCalculationContext {
  return {
    taxYear: TAX_YEAR,
    effectiveDate: EFFECTIVE,
    payFrequency: 'BIWEEKLY',
    workJurisdictions: [{ jurisdictionCode: JURISDICTION_CODE, allocation: '1' }],
    residenceJurisdictionCode: JURISDICTION_CODE,
    residencyStatus: ResidencyStatus.RESIDENT,
    wages: { regular: '1000', supplemental: '0' },
    deductions: [],
    taxabilityProfiles: {},
    ytd: stateYtdAssumedZero(),
    workRuleSet: testRuleSet(JURISDICTION_CODE),
    residenceRuleSet: null,
    elections: {},
    allowanceCounts: {},
    employer: {},
    reciprocityCertificateFiled: false,
    includeEmployerTaxes: true,
    ...overrides,
  };
}

describe('ADD_AMOUNT — jurisdiction scoping (via resolveWorkJurisdictionElections)', () => {
  const ruleSet = buildRuleSet({
    [FORM_KEY]: availableEntry(
      FORM_KEY,
      electionFormDetail([{ fieldKey: AMOUNT_FIELD, type: 'AMOUNT', unit: 'PER_PERIOD' }]),
    ),
  });

  it('uses the work jurisdiction election value when present', () => {
    const context = testContext({
      elections: {
        [JURISDICTION_CODE]: {
          formCode: 'SYNTHETIC-FORM',
          filingStatus: null,
          values: [{ fieldKey: AMOUNT_FIELD, value: '60', unit: 'PER_PERIOD' }],
        },
      },
    });
    const resolved = resolveWorkJurisdictionElections(context);
    const detail = formulaDetail([step(0, 'ADD_AMOUNT', AMOUNT_FIELD)]);

    const result = runStateWithholdingFormula(detail, ruleSet, money('1000'), SINGLE, {}, resolved);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(toStorageString(result.value)).toBe('1060');
  });

  it('never leaks a residence-jurisdiction election value into the resolved map', () => {
    const context = testContext({
      residenceJurisdictionCode: RESIDENCE_JURISDICTION_CODE,
      elections: {
        [RESIDENCE_JURISDICTION_CODE]: {
          formCode: 'RESIDENCE-FORM',
          filingStatus: null,
          values: [{ fieldKey: AMOUNT_FIELD, value: '999', unit: 'PER_PERIOD' }],
        },
      },
    });
    const resolved = resolveWorkJurisdictionElections(context);
    const detail = formulaDetail([step(0, 'ADD_AMOUNT', AMOUNT_FIELD)]);

    const result = runStateWithholdingFormula(detail, ruleSet, money('1000'), SINGLE, {}, resolved);

    // The residence jurisdiction's value is never visible: no value was
    // resolved for the work jurisdiction, so this is COMPONENT_NOT_STATED,
    // never the residence jurisdiction's 999.
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.problem.reason).toBe('COMPONENT_NOT_STATED');
  });
});

describe('ADD_AMOUNT — duplicate fieldKey is rejected upstream, never here', () => {
  it('validateStateContext() rejects a duplicate fieldKey as INPUT_INVALID', () => {
    const context = testContext({
      elections: {
        [JURISDICTION_CODE]: {
          formCode: 'SYNTHETIC-FORM',
          filingStatus: null,
          values: [
            { fieldKey: AMOUNT_FIELD, value: '10', unit: 'PER_PERIOD' },
            { fieldKey: AMOUNT_FIELD, value: '20', unit: 'PER_PERIOD' },
          ],
        },
      },
    });

    const issues = validateStateContext(context);
    expect(issues.length).toBe(1);
    expect(issues[0]?.kind).toBe('INPUT_INVALID');
    expect(issues[0]?.message).toContain('Duplicate election fieldKey');
  });

  it('the same fieldKey in two different jurisdictions remains valid', () => {
    const context = testContext({
      elections: {
        [JURISDICTION_CODE]: {
          formCode: 'SYNTHETIC-FORM',
          filingStatus: null,
          values: [{ fieldKey: AMOUNT_FIELD, value: '10', unit: 'PER_PERIOD' }],
        },
        [RESIDENCE_JURISDICTION_CODE]: {
          formCode: 'RESIDENCE-FORM',
          filingStatus: null,
          values: [{ fieldKey: AMOUNT_FIELD, value: '20', unit: 'ANNUAL' }],
        },
      },
    });

    expect(validateStateContext(context)).toEqual([]);
  });
});

describe('ADD_AMOUNT — regression: other operations are unaffected', () => {
  it('SUBTRACT_STANDARD_DEDUCTION, FLOOR_AT_ZERO, and APPLY_BRACKETS still execute normally', () => {
    const deductionKey = StateRuleKey.WITHHOLDING_STANDARD_DEDUCTION;
    const bracketsKey = StateRuleKey.PIT_RATE_BRACKETS;
    const ruleSet = buildRuleSet({
      [deductionKey]: availableEntry(deductionKey, {
        shape: 'AMOUNT_BY_FILING_STATUS',
        unit: 'ANNUAL',
        amounts: [{ filingStatus: SINGLE, amount: '1000' }],
      }),
      [bracketsKey]: availableEntry(bracketsKey, {
        shape: 'BRACKET_TABLE',
        bracketSets: [
          {
            filingStatus: SINGLE,
            brackets: [
              {
                ordinal: 0,
                atLeast: null,
                lessThan: null,
                rate: '0.1',
                unit: 'DECIMAL_FRACTION',
              },
            ],
          },
        ],
      }),
    });
    const detail = formulaDetail([
      step(0, 'SUBTRACT_STANDARD_DEDUCTION'),
      step(1, 'FLOOR_AT_ZERO'),
      step(2, 'APPLY_BRACKETS', bracketsKey),
    ]);

    const result = runStateWithholdingFormula(detail, ruleSet, money('5000'), SINGLE, {}, {});

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    // 5000 - 1000 = 4000; floor no-op; 4000 * 0.1 = 400.
    expect(toStorageString(result.value)).toBe('400');
  });

  it('SUBTRACT_AMOUNT remains blocked on its own SCALAR_AMOUNT registry gap, unaffected by ADD_AMOUNT', () => {
    const ruleSet = buildRuleSet({});
    const detail = formulaDetail([step(0, 'SUBTRACT_AMOUNT', 'NOT_A_REAL_STATE_RULE_KEY')]);

    const result = runStateWithholdingFormula(detail, ruleSet, money('1000'), SINGLE, {}, {});

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.problem.reason).toBe('RULE_DETAIL_INVALID');
  });
});

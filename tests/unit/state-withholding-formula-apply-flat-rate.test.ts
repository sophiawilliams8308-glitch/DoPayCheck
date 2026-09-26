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

/**
 * `APPLY_FLAT_RATE` — generic over `RATE`-shaped `StateRuleKey`s
 * (Task 4O-6R9-4O-6R12).
 *
 * ===========================================================================
 * SCOPE NOTE.
 *
 * `operandRef` is validated generically against `VALID_RULE_KEYS`, never
 * hard-coded to `StateRuleKey.PIT_FLAT_RATE` (Task 4O-6R10/4O-6R11 found no
 * real formula example proving that exact requirement). `PIT_FLAT_RATE` is
 * used below only because it is the one existing, already-registered `RATE`-
 * shaped production key most plausibly associated with this operation — its
 * synthetic fixture data here is not authoritative tax data, exactly as
 * `PIT_RATE_BRACKETS` is already used synthetically in the `APPLY_BRACKETS`
 * tests. `applicability`/`appliesTo` handling (`SCENARIO_UNSUPPORTED` for
 * `NOT_APPLICABLE`/`EMPLOYER`) is an explicit Task 4O-6R11 owner decision,
 * not a rediscovered repository fact — no other `RATE` consumer in this
 * engine has ever had to handle either field before.
 * ===========================================================================
 *
 * Fixtures use RESERVED TEST jurisdiction/source ids and no real tax value.
 */

const JURISDICTION_CODE = 'TEST-APPLY-FLAT-RATE';
const JURISDICTION_ID = 'test-apply-flat-rate-jurisdiction-id';
const TAX_YEAR = 2099;
const EFFECTIVE = '2099-06-15T00:00:00.000Z';
const RATE_KEY = StateRuleKey.PIT_FLAT_RATE;
const DEDUCTION_KEY = StateRuleKey.WITHHOLDING_STANDARD_DEDUCTION;
const SINGLE = 'SINGLE';

function reference(ruleKey: string): RuleReference {
  return {
    ruleId: `synthetic-${ruleKey}`,
    ruleKey,
    version: 1,
    category: 'STATE_WITHHOLDING',
    taxYear: TAX_YEAR,
    jurisdictionId: JURISDICTION_ID,
    jurisdictionCode: JURISDICTION_CODE,
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

function rateDetail(overrides: {
  rate: string | null;
  unit?: 'PERCENT' | 'DECIMAL_FRACTION';
  appliesTo?: 'EMPLOYEE' | 'EMPLOYER';
  applicability?: 'APPLIES' | 'NOT_APPLICABLE';
}) {
  return {
    shape: 'RATE',
    rate: overrides.rate,
    unit: overrides.unit ?? 'DECIMAL_FRACTION',
    appliesTo: overrides.appliesTo ?? 'EMPLOYEE',
    applicability: overrides.applicability ?? 'APPLIES',
  };
}

const step = (
  ordinal: number,
  operation: string,
  operandRef: string | null = null,
): Record<string, unknown> => ({ ordinal, operation, operandRef, note: null });

describe('APPLY_FLAT_RATE — arithmetic', () => {
  it('multiplies the running value by a DECIMAL_FRACTION rate', () => {
    const ruleSet = buildRuleSet({
      [RATE_KEY]: availableEntry(RATE_KEY, rateDetail({ rate: '0.05' })),
    });
    const detail = formulaDetail([step(0, 'APPLY_FLAT_RATE', RATE_KEY)]);

    const result = runStateWithholdingFormula(detail, ruleSet, money('100'), SINGLE, {}, {}, null);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(toStorageString(result.value.amount)).toBe('5');
  });

  it('multiplies the running value by a PERCENT rate, converted via readRate()', () => {
    const ruleSet = buildRuleSet({
      [RATE_KEY]: availableEntry(RATE_KEY, rateDetail({ rate: '5', unit: 'PERCENT' })),
    });
    const detail = formulaDetail([step(0, 'APPLY_FLAT_RATE', RATE_KEY)]);

    const result = runStateWithholdingFormula(detail, ruleSet, money('100'), SINGLE, {}, {}, null);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(toStorageString(result.value.amount)).toBe('5');
  });

  it('produces zero for a zero rate, without rejecting it', () => {
    const ruleSet = buildRuleSet({
      [RATE_KEY]: availableEntry(RATE_KEY, rateDetail({ rate: '0' })),
    });
    const detail = formulaDetail([step(0, 'APPLY_FLAT_RATE', RATE_KEY)]);

    const result = runStateWithholdingFormula(detail, ruleSet, money('500'), SINGLE, {}, {}, null);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(toStorageString(result.value.amount)).toBe('0');
  });

  it('applies a negative rate exactly as normalized, without clamping/flooring/zeroing', () => {
    const ruleSet = buildRuleSet({
      [RATE_KEY]: availableEntry(RATE_KEY, rateDetail({ rate: '-0.1' })),
    });
    const detail = formulaDetail([step(0, 'APPLY_FLAT_RATE', RATE_KEY)]);

    const result = runStateWithholdingFormula(detail, ruleSet, money('100'), SINGLE, {}, {}, null);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(toStorageString(result.value.amount)).toBe('-10');
  });
});

describe('APPLY_FLAT_RATE — operandRef validation', () => {
  it('reports RULE_DETAIL_INVALID for a null operandRef', () => {
    const ruleSet = buildRuleSet({});
    const detail = formulaDetail([step(0, 'APPLY_FLAT_RATE', null)]);

    const result = runStateWithholdingFormula(detail, ruleSet, money('100'), SINGLE, {}, {}, null);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.problem.reason).toBe('RULE_DETAIL_INVALID');
  });

  it('reports RULE_DETAIL_INVALID for an operandRef that is not a known StateRuleKey', () => {
    const ruleSet = buildRuleSet({});
    const detail = formulaDetail([step(0, 'APPLY_FLAT_RATE', 'NOT_A_REAL_STATE_RULE_KEY')]);

    const result = runStateWithholdingFormula(detail, ruleSet, money('100'), SINGLE, {}, {}, null);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.problem.reason).toBe('RULE_DETAIL_INVALID');
  });

  it('does not require operandRef to equal PIT_FLAT_RATE exactly — any RATE-shaped key is accepted', () => {
    const otherRateKey = StateRuleKey.SDI_EMPLOYEE_RATE;
    const ruleSet = buildRuleSet({
      [otherRateKey]: availableEntry(otherRateKey, rateDetail({ rate: '0.02' })),
    });
    const detail = formulaDetail([step(0, 'APPLY_FLAT_RATE', otherRateKey)]);

    const result = runStateWithholdingFormula(detail, ruleSet, money('100'), SINGLE, {}, {}, null);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(toStorageString(result.value.amount)).toBe('2');
  });
});

describe('APPLY_FLAT_RATE — referenced rule missing/unverified/malformed', () => {
  it('reports RULE_MISSING when the named rule was never resolved', () => {
    const ruleSet = buildRuleSet({});
    const detail = formulaDetail([step(0, 'APPLY_FLAT_RATE', RATE_KEY)]);

    const result = runStateWithholdingFormula(detail, ruleSet, money('100'), SINGLE, {}, {}, null);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.problem.reason).toBe('RULE_MISSING');
  });

  it('reports RULE_UNVERIFIED for a PENDING referenced rule', () => {
    const ruleSet = buildRuleSet({
      [RATE_KEY]: availableEntry(RATE_KEY, rateDetail({ rate: '0.05' }), {
        verificationStatus: 'PENDING',
      }),
    });
    const detail = formulaDetail([step(0, 'APPLY_FLAT_RATE', RATE_KEY)]);

    const result = runStateWithholdingFormula(detail, ruleSet, money('100'), SINGLE, {}, {}, null);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.problem.reason).toBe('RULE_UNVERIFIED');
  });

  it('reports RULE_DETAIL_INVALID for a malformed detail (invalid rate string)', () => {
    const ruleSet = buildRuleSet({
      [RATE_KEY]: availableEntry(RATE_KEY, {
        shape: 'RATE',
        rate: 'not-a-number',
        unit: 'DECIMAL_FRACTION',
        appliesTo: 'EMPLOYEE',
        applicability: 'APPLIES',
      }),
    });
    const detail = formulaDetail([step(0, 'APPLY_FLAT_RATE', RATE_KEY)]);

    const result = runStateWithholdingFormula(detail, ruleSet, money('100'), SINGLE, {}, {}, null);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.problem.reason).toBe('RULE_DETAIL_INVALID');
  });

  it('reports RULE_DETAIL_INVALID when the referenced rule resolves to a non-RATE shape', () => {
    const ruleSet = buildRuleSet({
      [RATE_KEY]: availableEntry(RATE_KEY, {
        shape: 'WAGE_BASE',
        amount: '1000',
        basis: 'ANNUAL',
        applicability: 'APPLIES',
      }),
    });
    const detail = formulaDetail([step(0, 'APPLY_FLAT_RATE', RATE_KEY)]);

    const result = runStateWithholdingFormula(detail, ruleSet, money('100'), SINGLE, {}, {}, null);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.problem.reason).toBe('RULE_DETAIL_INVALID');
  });
});

describe('APPLY_FLAT_RATE — null rate', () => {
  it('reports COMPONENT_NOT_STATED for a null rate, never treating it as zero', () => {
    const ruleSet = buildRuleSet({
      [RATE_KEY]: availableEntry(RATE_KEY, rateDetail({ rate: null })),
    });
    const detail = formulaDetail([step(0, 'APPLY_FLAT_RATE', RATE_KEY)]);

    const result = runStateWithholdingFormula(detail, ruleSet, money('100'), SINGLE, {}, {}, null);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.problem.reason).toBe('COMPONENT_NOT_STATED');
  });
});

describe('APPLY_FLAT_RATE — applicability and appliesTo (owner-locked, Task 4O-6R11)', () => {
  it('reports SCENARIO_UNSUPPORTED for applicability = NOT_APPLICABLE, never zero or COMPONENT_NOT_STATED', () => {
    const ruleSet = buildRuleSet({
      [RATE_KEY]: availableEntry(
        RATE_KEY,
        rateDetail({ rate: '0.05', applicability: 'NOT_APPLICABLE' }),
      ),
    });
    const detail = formulaDetail([step(0, 'APPLY_FLAT_RATE', RATE_KEY)]);

    const result = runStateWithholdingFormula(detail, ruleSet, money('100'), SINGLE, {}, {}, null);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.problem.reason).toBe('SCENARIO_UNSUPPORTED');
  });

  it('reports SCENARIO_UNSUPPORTED for appliesTo = EMPLOYER, never calculating employer withholding', () => {
    const ruleSet = buildRuleSet({
      [RATE_KEY]: availableEntry(RATE_KEY, rateDetail({ rate: '0.05', appliesTo: 'EMPLOYER' })),
    });
    const detail = formulaDetail([step(0, 'APPLY_FLAT_RATE', RATE_KEY)]);

    const result = runStateWithholdingFormula(detail, ruleSet, money('100'), SINGLE, {}, {}, null);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.problem.reason).toBe('SCENARIO_UNSUPPORTED');
  });

  it('proceeds with normal calculation for appliesTo = EMPLOYEE and applicability = APPLIES', () => {
    const ruleSet = buildRuleSet({
      [RATE_KEY]: availableEntry(
        RATE_KEY,
        rateDetail({ rate: '0.05', appliesTo: 'EMPLOYEE', applicability: 'APPLIES' }),
      ),
    });
    const detail = formulaDetail([step(0, 'APPLY_FLAT_RATE', RATE_KEY)]);

    const result = runStateWithholdingFormula(detail, ruleSet, money('100'), SINGLE, {}, {}, null);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(toStorageString(result.value.amount)).toBe('5');
  });
});

describe('APPLY_FLAT_RATE — precision', () => {
  it('performs no rounding, preserving exact Decimal precision', () => {
    const ruleSet = buildRuleSet({
      [RATE_KEY]: availableEntry(RATE_KEY, rateDetail({ rate: '0.1' })),
    });
    const detail = formulaDetail([step(0, 'APPLY_FLAT_RATE', RATE_KEY)]);

    // 10.005 * 0.1 === 1.0005 exactly; naive IEEE-754 float arithmetic would
    // produce 1.0005000000000002.
    const result = runStateWithholdingFormula(
      detail,
      ruleSet,
      money('10.005'),
      SINGLE,
      {},
      {},
      null,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(toStorageString(result.value.amount)).toBe('1.0005');
  });
});

describe('APPLY_FLAT_RATE — sequential accumulator behavior', () => {
  it('operates on the running value left by a preceding formula step', () => {
    const ruleSet = buildRuleSet({
      [DEDUCTION_KEY]: availableEntry(DEDUCTION_KEY, {
        shape: 'AMOUNT_BY_FILING_STATUS',
        unit: 'ANNUAL',
        amounts: [{ filingStatus: SINGLE, amount: '200' }],
      }),
      [RATE_KEY]: availableEntry(RATE_KEY, rateDetail({ rate: '0.1' })),
    });
    const detail = formulaDetail([
      step(0, 'SUBTRACT_STANDARD_DEDUCTION'),
      step(1, 'APPLY_FLAT_RATE', RATE_KEY),
    ]);

    const result = runStateWithholdingFormula(detail, ruleSet, money('1000'), SINGLE, {}, {}, null);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    // 1000 - 200 = 800; 800 * 0.1 = 80.
    expect(toStorageString(result.value.amount)).toBe('80');
  });
});

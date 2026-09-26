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
 * State withholding formula provenance (DM-03 Slice 23, contract locked at
 * Slice 22).
 *
 * ===========================================================================
 * SCOPE NOTE.
 *
 * This file covers ONLY the provenance-collection contract added in Slice
 * 23: which references `runStateWithholdingFormula()`'s successful result
 * carries, in what order, deduplicated how, and what happens to provenance
 * on failure. It does not re-test any operation's own arithmetic or
 * validation semantics — those remain covered by
 * `state-withholding-formula-interpreter.test.ts` and each operation's own
 * dedicated test file, all of which this slice's mechanical `result.value`
 * -> `result.value.amount` update left otherwise unchanged.
 *
 * `WITHHOLDING_FORMULA`'s own reference is deliberately never asserted to
 * appear in the result — Slice 22's Question A decision — this interpreter
 * never reads that rule itself (`detail` arrives already resolved), so its
 * reference belongs to a future external caller.
 * ===========================================================================
 *
 * Fixtures use RESERVED TEST jurisdiction/source ids and no real tax value.
 */

const JURISDICTION_CODE = 'TEST-WITHHOLDING-FORMULA-PROVENANCE';
const JURISDICTION_ID = 'test-withholding-formula-provenance-jurisdiction-id';
const TAX_YEAR = 2099;
const EFFECTIVE = '2099-06-15T00:00:00.000Z';
const SINGLE = 'SINGLE';

const DEDUCTION_KEY = StateRuleKey.WITHHOLDING_STANDARD_DEDUCTION;
const RATE_KEY = StateRuleKey.PIT_FLAT_RATE;
const PERIODS_KEY = StateRuleKey.WITHHOLDING_PAY_PERIODS_PER_YEAR;

function reference(
  ruleKey: string,
  overrides: { ruleId?: string; version?: number } = {},
): RuleReference {
  return {
    ruleId: overrides.ruleId ?? `synthetic-${ruleKey}`,
    ruleKey,
    version: overrides.version ?? 1,
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
  overrides: {
    verificationStatus?: string;
    referenceOverrides?: { ruleId?: string; version?: number };
  } = {},
): { available: true; rule: ResolvedStateRule } {
  return {
    available: true,
    rule: {
      key,
      reference: reference(key, overrides.referenceOverrides),
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

const step = (
  ordinal: number,
  operation: string,
  operandRef: string | null = null,
): Record<string, unknown> => ({ ordinal, operation, operandRef, note: null });

function standardDeductionDetail(amount: string) {
  return {
    shape: 'AMOUNT_BY_FILING_STATUS',
    unit: 'ANNUAL',
    amounts: [{ filingStatus: SINGLE, amount }],
  };
}

function rateDetail(rate: string) {
  return {
    shape: 'RATE',
    rate,
    unit: 'DECIMAL_FRACTION',
    appliesTo: 'EMPLOYEE',
    applicability: 'APPLIES',
  };
}

const COUNTS_DETAIL = {
  shape: 'COUNT_BY_PAY_PERIOD',
  counts: [{ payFrequency: 'BIWEEKLY', periodsPerYear: 26 }],
};

describe('provenance — single operand', () => {
  it('one successful rule read produces exactly one reference', () => {
    const ruleSet = buildRuleSet({
      [DEDUCTION_KEY]: availableEntry(DEDUCTION_KEY, standardDeductionDetail('100')),
    });
    const result = runStateWithholdingFormula(
      formulaDetail([step(0, 'SUBTRACT_STANDARD_DEDUCTION')]),
      ruleSet,
      money('1000'),
      SINGLE,
      {},
      {},
      null,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.value.rules).toHaveLength(1);
    expect(result.value.rules[0]?.ruleKey).toBe(DEDUCTION_KEY);
    expect(result.value.rules[0]?.ruleId).toBe(`synthetic-${DEDUCTION_KEY}`);
    expect(result.value.rules[0]?.version).toBe(1);
  });
});

describe('provenance — multiple distinct operands', () => {
  it('a standard-deduction step plus a rate step produces both references', () => {
    const ruleSet = buildRuleSet({
      [DEDUCTION_KEY]: availableEntry(DEDUCTION_KEY, standardDeductionDetail('100')),
      [RATE_KEY]: availableEntry(RATE_KEY, rateDetail('0.05')),
    });
    const result = runStateWithholdingFormula(
      formulaDetail([step(0, 'SUBTRACT_STANDARD_DEDUCTION'), step(1, 'APPLY_FLAT_RATE', RATE_KEY)]),
      ruleSet,
      money('1000'),
      SINGLE,
      {},
      {},
      null,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    const ruleKeys = result.value.rules.map((r) => r.ruleKey);
    expect(ruleKeys).toContain(DEDUCTION_KEY);
    expect(ruleKeys).toContain(RATE_KEY);
    expect(result.value.rules).toHaveLength(2);
  });
});

describe('provenance — duplicate rule, same operation type', () => {
  it('two APPLY_FLAT_RATE steps against the same rate key collapse to one reference', () => {
    const ruleSet = buildRuleSet({
      [RATE_KEY]: availableEntry(RATE_KEY, rateDetail('0.05')),
    });
    const result = runStateWithholdingFormula(
      formulaDetail([step(0, 'APPLY_FLAT_RATE', RATE_KEY), step(1, 'APPLY_FLAT_RATE', RATE_KEY)]),
      ruleSet,
      money('1000'),
      SINGLE,
      {},
      {},
      null,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.value.rules).toHaveLength(1);
    expect(result.value.rules[0]?.ruleKey).toBe(RATE_KEY);
    // Arithmetic sanity: 1000 * 0.05 * 0.05 = 2.5 — proves the running value
    // was genuinely computed twice, not short-circuited by deduplication.
    expect(toStorageString(result.value.amount)).toBe('2.5');
  });
});

describe('provenance — deterministic ordering', () => {
  it('follows the actual successful execution order, not declaration or key order', () => {
    const ruleSet = buildRuleSet({
      [DEDUCTION_KEY]: availableEntry(DEDUCTION_KEY, standardDeductionDetail('100')),
      [RATE_KEY]: availableEntry(RATE_KEY, rateDetail('0.05')),
      [PERIODS_KEY]: availableEntry(PERIODS_KEY, COUNTS_DETAIL),
    });
    const result = runStateWithholdingFormula(
      formulaDetail([
        step(0, 'SUBTRACT_STANDARD_DEDUCTION'),
        step(1, 'APPLY_FLAT_RATE', RATE_KEY),
        step(2, 'ANNUALIZE'),
      ]),
      ruleSet,
      money('1000'),
      SINGLE,
      {},
      {},
      'BIWEEKLY',
    );

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.value.rules.map((r) => r.ruleKey)).toEqual([
      DEDUCTION_KEY,
      RATE_KEY,
      PERIODS_KEY,
    ]);
  });

  it('preserves the first-occurrence position when a rule is encountered again later', () => {
    const ruleSet = buildRuleSet({
      [RATE_KEY]: availableEntry(RATE_KEY, rateDetail('0.05')),
      [DEDUCTION_KEY]: availableEntry(DEDUCTION_KEY, standardDeductionDetail('50')),
    });
    const result = runStateWithholdingFormula(
      formulaDetail([
        step(0, 'APPLY_FLAT_RATE', RATE_KEY),
        step(1, 'SUBTRACT_STANDARD_DEDUCTION'),
        step(2, 'APPLY_FLAT_RATE', RATE_KEY),
      ]),
      ruleSet,
      money('1000'),
      SINGLE,
      {},
      {},
      null,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    // RATE_KEY's first occurrence was step 0 — it must stay first, never
    // move to reflect its second (step 2) appearance.
    expect(result.value.rules.map((r) => r.ruleKey)).toEqual([RATE_KEY, DEDUCTION_KEY]);
  });
});

describe('provenance — failure carries no partial references', () => {
  it('failure before any successful rule read exposes no rules array at all', () => {
    const ruleSet = buildRuleSet({});
    const result = runStateWithholdingFormula(
      formulaDetail([step(0, 'SUBTRACT_STANDARD_DEDUCTION')]),
      ruleSet,
      money('1000'),
      SINGLE,
      {},
      {},
      null,
    );

    expect(result.ok).toBe(false);
    // Exact structural equality — proves no stray `rules` key exists on the
    // failure object, not merely that we didn't check for one.
    expect(result).toEqual({
      ok: false,
      problem: expect.objectContaining({ reason: 'RULE_MISSING' }),
    });
  });

  it('failure after prior successful reads still exposes no rules array — no partial credit', () => {
    const ruleSet = buildRuleSet({
      [DEDUCTION_KEY]: availableEntry(DEDUCTION_KEY, standardDeductionDetail('100')),
      // RATE_KEY deliberately absent — the second step fails.
    });
    const result = runStateWithholdingFormula(
      formulaDetail([step(0, 'SUBTRACT_STANDARD_DEDUCTION'), step(1, 'APPLY_FLAT_RATE', RATE_KEY)]),
      ruleSet,
      money('1000'),
      SINGLE,
      {},
      {},
      null,
    );

    expect(result.ok).toBe(false);
    expect(result).toEqual({
      ok: false,
      problem: expect.objectContaining({ reason: 'RULE_MISSING' }),
    });
  });

  it('an unsupported operation (ROUND) after a successful read exposes no rules array', () => {
    const ruleSet = buildRuleSet({
      [DEDUCTION_KEY]: availableEntry(DEDUCTION_KEY, standardDeductionDetail('100')),
    });
    const result = runStateWithholdingFormula(
      formulaDetail([step(0, 'SUBTRACT_STANDARD_DEDUCTION'), step(1, 'ROUND')]),
      ruleSet,
      money('1000'),
      SINGLE,
      {},
      {},
      null,
    );

    expect(result.ok).toBe(false);
    expect(result).toEqual({
      ok: false,
      problem: expect.objectContaining({ reason: 'METHOD_NOT_IMPLEMENTED' }),
    });
  });
});

describe('provenance — ANNUALIZE / DEANNUALIZE include the pay-period reference', () => {
  it('ANNUALIZE includes WITHHOLDING_PAY_PERIODS_PER_YEAR in the result', () => {
    const ruleSet = buildRuleSet({
      [PERIODS_KEY]: availableEntry(PERIODS_KEY, COUNTS_DETAIL),
    });
    const result = runStateWithholdingFormula(
      formulaDetail([step(0, 'ANNUALIZE')]),
      ruleSet,
      money('1000'),
      SINGLE,
      {},
      {},
      'BIWEEKLY',
    );

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.value.rules).toHaveLength(1);
    expect(result.value.rules[0]?.ruleKey).toBe(PERIODS_KEY);
    // The value still comes from resolveStatePayPeriodsPerYear() alone.
    expect(toStorageString(result.value.amount)).toBe('26000');
  });

  it('DEANNUALIZE includes WITHHOLDING_PAY_PERIODS_PER_YEAR in the result', () => {
    const ruleSet = buildRuleSet({
      [PERIODS_KEY]: availableEntry(PERIODS_KEY, COUNTS_DETAIL),
    });
    const result = runStateWithholdingFormula(
      formulaDetail([step(0, 'DEANNUALIZE')]),
      ruleSet,
      money('26000'),
      SINGLE,
      {},
      {},
      'BIWEEKLY',
    );

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.value.rules).toHaveLength(1);
    expect(result.value.rules[0]?.ruleKey).toBe(PERIODS_KEY);
    expect(toStorageString(result.value.amount)).toBe('1000');
  });
});

describe('provenance — WITHHOLDING_FORMULA container exclusion', () => {
  it('never includes WITHHOLDING_FORMULA even though it is resolvable in the same rule set', () => {
    const ruleSet = buildRuleSet({
      [DEDUCTION_KEY]: availableEntry(DEDUCTION_KEY, standardDeductionDetail('100')),
      // A resolvable WITHHOLDING_FORMULA entry is deliberately present, to
      // prove exclusion is a real decision and not an accident of the rule
      // simply being absent from the fixture.
      [StateRuleKey.WITHHOLDING_FORMULA]: availableEntry(StateRuleKey.WITHHOLDING_FORMULA, {
        shape: 'FORMULA_STEPS',
        steps: [],
      }),
    });
    const result = runStateWithholdingFormula(
      formulaDetail([step(0, 'SUBTRACT_STANDARD_DEDUCTION')]),
      ruleSet,
      money('1000'),
      SINGLE,
      {},
      {},
      null,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.value.rules.map((r) => r.ruleKey)).not.toContain(
      StateRuleKey.WITHHOLDING_FORMULA,
    );
    expect(result.value.rules).toHaveLength(1);
    expect(result.value.rules[0]?.ruleKey).toBe(DEDUCTION_KEY);
  });
});

describe('provenance — cross-operation deduplication', () => {
  it('the same rate rule read by two different operations collapses to one reference', () => {
    const ruleSet = buildRuleSet({
      [RATE_KEY]: availableEntry(RATE_KEY, rateDetail('0.05')),
    });
    const result = runStateWithholdingFormula(
      formulaDetail([
        step(0, 'APPLY_FLAT_RATE', RATE_KEY),
        step(1, 'APPLY_PERCENTAGE_OF', RATE_KEY),
      ]),
      ruleSet,
      money('1000'),
      SINGLE,
      {},
      {},
      null,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.value.rules).toHaveLength(1);
    expect(result.value.rules[0]?.ruleKey).toBe(RATE_KEY);
  });
});

describe('provenance — rule identity is ruleId@version, not StateRuleKey', () => {
  it('two different StateRuleKeys sharing the same ruleId and version collapse to one reference', () => {
    const sharedRuleId = 'shared-synthetic-rule-id';
    const ruleSet = buildRuleSet({
      [DEDUCTION_KEY]: availableEntry(DEDUCTION_KEY, standardDeductionDetail('100'), {
        referenceOverrides: { ruleId: sharedRuleId, version: 1 },
      }),
      [RATE_KEY]: availableEntry(RATE_KEY, rateDetail('0.05'), {
        referenceOverrides: { ruleId: sharedRuleId, version: 1 },
      }),
    });
    const result = runStateWithholdingFormula(
      formulaDetail([step(0, 'SUBTRACT_STANDARD_DEDUCTION'), step(1, 'APPLY_FLAT_RATE', RATE_KEY)]),
      ruleSet,
      money('1000'),
      SINGLE,
      {},
      {},
      null,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.value.rules).toHaveLength(1);
    expect(result.value.rules[0]?.ruleId).toBe(sharedRuleId);
  });

  it('two different StateRuleKeys sharing the same ruleId but a different version stay distinct', () => {
    const sharedRuleId = 'shared-synthetic-rule-id';
    const ruleSet = buildRuleSet({
      [DEDUCTION_KEY]: availableEntry(DEDUCTION_KEY, standardDeductionDetail('100'), {
        referenceOverrides: { ruleId: sharedRuleId, version: 1 },
      }),
      [RATE_KEY]: availableEntry(RATE_KEY, rateDetail('0.05'), {
        referenceOverrides: { ruleId: sharedRuleId, version: 2 },
      }),
    });
    const result = runStateWithholdingFormula(
      formulaDetail([step(0, 'SUBTRACT_STANDARD_DEDUCTION'), step(1, 'APPLY_FLAT_RATE', RATE_KEY)]),
      ruleSet,
      money('1000'),
      SINGLE,
      {},
      {},
      null,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.value.rules).toHaveLength(2);
    expect(result.value.rules.map((r) => r.version)).toEqual([1, 2]);
  });
});

describe('provenance — result shape', () => {
  it('is readonly-typed and structurally matches the established SDI/PFML/SUTA contract', () => {
    const ruleSet = buildRuleSet({
      [DEDUCTION_KEY]: availableEntry(DEDUCTION_KEY, standardDeductionDetail('100')),
    });
    const result = runStateWithholdingFormula(
      formulaDetail([step(0, 'SUBTRACT_STANDARD_DEDUCTION')]),
      ruleSet,
      money('1000'),
      SINGLE,
      {},
      {},
      null,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(Object.keys(result.value).sort()).toEqual(['amount', 'rules']);
    expect(Array.isArray(result.value.rules)).toBe(true);
  });

  it('FLOOR_AT_ZERO alone (no rule read) produces an empty rules array, not a missing one', () => {
    const ruleSet = buildRuleSet({});
    const result = runStateWithholdingFormula(
      formulaDetail([step(0, 'FLOOR_AT_ZERO')]),
      ruleSet,
      money('-5'),
      SINGLE,
      {},
      {},
      null,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.value.rules).toEqual([]);
  });
});

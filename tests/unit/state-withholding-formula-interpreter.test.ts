import { describe, expect, it } from 'vitest';

import { money, subtract, toStorageString, type Money } from '@/lib/core/money';
import type { RuleReference } from '@/lib/calculator/types/rules';
import { runStateWithholdingFormula } from '@/lib/tax/state/rules/withholdingFormulaInterpreter';
import {
  freezeStateRuleSet,
  stateRule,
  type ResolvedStateRule,
  type ResolvedStateRuleSet,
  type StateRuleEntry,
} from '@/lib/tax/state/rules/stateRuleSet';
import { StateRuleKey } from '@/lib/tax/state/ruleKeys';
import type { StateFormulaStepsDetail } from '@/lib/tax/state/rules/detailSchemas';

/**
 * State withholding formula core interpreter (Task 4O-3A).
 *
 * ===========================================================================
 * SCOPE NOTE.
 *
 * This file covers the three Task 4O-2 contract-locked operations —
 * `SUBTRACT_STANDARD_DEDUCTION`, `FLOOR_AT_ZERO`, `APPLY_BRACKETS`. The
 * personal-exemption path of `SUBTRACT_EXEMPTIONS` (Task 4O-4/4O-5) has its
 * own dedicated test file,
 * `state-withholding-formula-subtract-exemptions.test.ts`; `SUBTRACT_AMOUNT`
 * (Task 4O-6R3-6R6) has its own dedicated test file,
 * `state-withholding-formula-subtract-amount.test.ts`; `APPLY_FLAT_RATE`
 * (Task 4O-6R9-6R12) has its own dedicated test file,
 * `state-withholding-formula-apply-flat-rate.test.ts`; `SUBTRACT_ALLOWANCES`
 * (Task 4O-6R14-6R17) has its own dedicated test file,
 * `state-withholding-formula-subtract-allowances.test.ts`; `ADD_AMOUNT`
 * (Task 4O-6R20-6R23) has its own dedicated test file,
 * `state-withholding-formula-add-amount.test.ts`; and `APPLY_PERCENTAGE_OF`
 * (Task 4O-6R24-6R26) has its own dedicated test file,
 * `state-withholding-formula-apply-percentage-of.test.ts` — all six are
 * therefore excluded from this file's "unsupported operation" list below.
 * The remaining three operations are asserted to report
 * `METHOD_NOT_IMPLEMENTED` rather than silently executing — their own
 * semantics are NOT locked, and these tests do not attempt to pin down
 * state->federal filing-status mapping, `ANNUALIZE`/`DEANNUALIZE`
 * periods-per-year, or `ROUND` scale selection, since Task 4O-2 left all of
 * those unresolved.
 * ===========================================================================
 *
 * Fixtures use RESERVED TEST jurisdiction/source ids and no real tax value.
 */

const JURISDICTION_CODE = 'TEST-WITHHOLDING-FORMULA-INTERPRETER';
const JURISDICTION_ID = 'test-withholding-formula-interpreter-jurisdiction-id';
const TAX_YEAR = 2099;
const EFFECTIVE = '2099-06-15T00:00:00.000Z';
const DEDUCTION_KEY = StateRuleKey.WITHHOLDING_STANDARD_DEDUCTION;
const BRACKETS_KEY = StateRuleKey.PIT_RATE_BRACKETS;
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

function standardDeductionDetail(
  amounts: readonly { filingStatus: string; amount: string | null }[],
) {
  return { shape: 'AMOUNT_BY_FILING_STATUS', unit: 'ANNUAL', amounts };
}

function bracketTableDetail(
  bracketSets: readonly {
    filingStatus: string;
    brackets: readonly {
      ordinal: number;
      atLeast: string | null;
      lessThan: string | null;
      rate: string | null;
      unit: 'PERCENT' | 'DECIMAL_FRACTION';
    }[];
  }[],
) {
  return { shape: 'BRACKET_TABLE', bracketSets };
}

const step = (
  ordinal: number,
  operation: string,
  operandRef: string | null = null,
): Record<string, unknown> => ({ ordinal, operation, operandRef, note: null });

describe('empty step list', () => {
  it('returns the initial value unchanged when there are no steps', () => {
    const ruleSet = buildRuleSet({});
    const result = runStateWithholdingFormula(
      formulaDetail([]),
      ruleSet,
      money('500'),
      SINGLE,
      {},
      {},
    );

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(toStorageString(result.value)).toBe('500');
  });
});

describe('FLOOR_AT_ZERO', () => {
  it('leaves a positive running value unchanged', () => {
    const ruleSet = buildRuleSet({});
    const detail = formulaDetail([step(0, 'FLOOR_AT_ZERO')]);

    const result = runStateWithholdingFormula(detail, ruleSet, money('42.50'), SINGLE, {}, {});

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(toStorageString(result.value)).toBe('42.5');
  });

  it('replaces a negative running value with zero', () => {
    const ruleSet = buildRuleSet({});
    const detail = formulaDetail([step(0, 'FLOOR_AT_ZERO')]);

    const result = runStateWithholdingFormula(detail, ruleSet, money('-10'), SINGLE, {}, {});

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(toStorageString(result.value)).toBe('0');
  });

  it('reports RULE_DETAIL_INVALID for a non-null operandRef, which the operation takes none of', () => {
    const ruleSet = buildRuleSet({});
    const detail = formulaDetail([step(0, 'FLOOR_AT_ZERO', 'SOME_REF')]);

    const result = runStateWithholdingFormula(detail, ruleSet, money('10'), SINGLE, {}, {});

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.problem.reason).toBe('RULE_DETAIL_INVALID');
  });
});

describe('SUBTRACT_STANDARD_DEDUCTION', () => {
  it('subtracts the resolved filing-status amount from the running value', () => {
    const ruleSet = buildRuleSet({
      [DEDUCTION_KEY]: availableEntry(
        DEDUCTION_KEY,
        standardDeductionDetail([{ filingStatus: SINGLE, amount: '1000' }]),
      ),
    });
    const detail = formulaDetail([step(0, 'SUBTRACT_STANDARD_DEDUCTION')]);

    const result = runStateWithholdingFormula(detail, ruleSet, money('5000'), SINGLE, {}, {});

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(toStorageString(result.value)).toBe('4000');
  });

  it('reports RULE_DETAIL_INVALID for a non-null operandRef', () => {
    const ruleSet = buildRuleSet({
      [DEDUCTION_KEY]: availableEntry(
        DEDUCTION_KEY,
        standardDeductionDetail([{ filingStatus: SINGLE, amount: '1000' }]),
      ),
    });
    const detail = formulaDetail([step(0, 'SUBTRACT_STANDARD_DEDUCTION', DEDUCTION_KEY)]);

    const result = runStateWithholdingFormula(detail, ruleSet, money('5000'), SINGLE, {}, {});

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.problem.reason).toBe('RULE_DETAIL_INVALID');
  });

  it('reports SCENARIO_UNSUPPORTED when no filing status is available, never assuming one', () => {
    const ruleSet = buildRuleSet({
      [DEDUCTION_KEY]: availableEntry(
        DEDUCTION_KEY,
        standardDeductionDetail([{ filingStatus: SINGLE, amount: '1000' }]),
      ),
    });
    const detail = formulaDetail([step(0, 'SUBTRACT_STANDARD_DEDUCTION')]);

    const result = runStateWithholdingFormula(detail, ruleSet, money('5000'), null, {}, {});

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.problem.reason).toBe('SCENARIO_UNSUPPORTED');
  });
});

describe('missing / unverified / invalid standard deduction rule', () => {
  it('reports RULE_MISSING when WITHHOLDING_STANDARD_DEDUCTION was never resolved', () => {
    const ruleSet = buildRuleSet({});
    const detail = formulaDetail([step(0, 'SUBTRACT_STANDARD_DEDUCTION')]);

    const result = runStateWithholdingFormula(detail, ruleSet, money('5000'), SINGLE, {}, {});

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.problem.reason).toBe('RULE_MISSING');
  });

  it('reports RULE_UNVERIFIED for a PENDING standard deduction rule', () => {
    const ruleSet = buildRuleSet({
      [DEDUCTION_KEY]: availableEntry(
        DEDUCTION_KEY,
        standardDeductionDetail([{ filingStatus: SINGLE, amount: '1000' }]),
        { verificationStatus: 'PENDING' },
      ),
    });
    const detail = formulaDetail([step(0, 'SUBTRACT_STANDARD_DEDUCTION')]);

    const result = runStateWithholdingFormula(detail, ruleSet, money('5000'), SINGLE, {}, {});

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.problem.reason).toBe('RULE_UNVERIFIED');
  });

  it('reports RULE_DETAIL_INVALID for a standard deduction detail failing its schema', () => {
    const ruleSet = buildRuleSet({
      [DEDUCTION_KEY]: availableEntry(DEDUCTION_KEY, {
        shape: 'WAGE_BASE',
        amount: '1',
        basis: 'ANNUAL',
        applicability: 'APPLIES',
      }),
    });
    const detail = formulaDetail([step(0, 'SUBTRACT_STANDARD_DEDUCTION')]);

    const result = runStateWithholdingFormula(detail, ruleSet, money('5000'), SINGLE, {}, {});

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.problem.reason).toBe('RULE_DETAIL_INVALID');
  });
});

describe('filing-status row behavior', () => {
  it('reports COMPONENT_NOT_STATED when no row matches the supplied filing status', () => {
    const ruleSet = buildRuleSet({
      [DEDUCTION_KEY]: availableEntry(
        DEDUCTION_KEY,
        standardDeductionDetail([{ filingStatus: 'MARRIED', amount: '2000' }]),
      ),
    });
    const detail = formulaDetail([step(0, 'SUBTRACT_STANDARD_DEDUCTION')]);

    const result = runStateWithholdingFormula(detail, ruleSet, money('5000'), SINGLE, {}, {});

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.problem.reason).toBe('COMPONENT_NOT_STATED');
  });

  it('reports COMPONENT_NOT_STATED, not zero, when the matched row amount is null', () => {
    const ruleSet = buildRuleSet({
      [DEDUCTION_KEY]: availableEntry(
        DEDUCTION_KEY,
        standardDeductionDetail([{ filingStatus: SINGLE, amount: null }]),
      ),
    });
    const detail = formulaDetail([step(0, 'SUBTRACT_STANDARD_DEDUCTION')]);

    const result = runStateWithholdingFormula(detail, ruleSet, money('5000'), SINGLE, {}, {});

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.problem.reason).toBe('COMPONENT_NOT_STATED');
  });
});

const SINGLE_BRACKETS = bracketTableDetail([
  {
    filingStatus: SINGLE,
    brackets: [
      { ordinal: 0, atLeast: '0', lessThan: '1000', rate: '0.10', unit: 'DECIMAL_FRACTION' },
      { ordinal: 1, atLeast: '1000', lessThan: null, rate: '0.20', unit: 'DECIMAL_FRACTION' },
    ],
  },
]);

describe('APPLY_BRACKETS', () => {
  it('sums the taxed slice of every applicable bracket', () => {
    const ruleSet = buildRuleSet({
      [BRACKETS_KEY]: availableEntry(BRACKETS_KEY, SINGLE_BRACKETS),
    });
    const detail = formulaDetail([step(0, 'APPLY_BRACKETS', BRACKETS_KEY)]);

    const result = runStateWithholdingFormula(detail, ruleSet, money('4000'), SINGLE, {}, {});

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    // First 1000 at 10% = 100; remaining 3000 at 20% = 600; total 700.
    expect(toStorageString(result.value)).toBe('700');
  });

  it('reports RULE_DETAIL_INVALID for a null operandRef, which this operation requires', () => {
    const ruleSet = buildRuleSet({
      [BRACKETS_KEY]: availableEntry(BRACKETS_KEY, SINGLE_BRACKETS),
    });
    const detail = formulaDetail([step(0, 'APPLY_BRACKETS')]);

    const result = runStateWithholdingFormula(detail, ruleSet, money('4000'), SINGLE, {}, {});

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.problem.reason).toBe('RULE_DETAIL_INVALID');
  });

  it('reports RULE_DETAIL_INVALID when operandRef does not name a known StateRuleKey', () => {
    const ruleSet = buildRuleSet({
      [BRACKETS_KEY]: availableEntry(BRACKETS_KEY, SINGLE_BRACKETS),
    });
    const detail = formulaDetail([step(0, 'APPLY_BRACKETS', 'NOT_A_REAL_STATE_RULE_KEY')]);

    const result = runStateWithholdingFormula(detail, ruleSet, money('4000'), SINGLE, {}, {});

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.problem.reason).toBe('RULE_DETAIL_INVALID');
  });

  it('reports SCENARIO_UNSUPPORTED when no filing status is available', () => {
    const ruleSet = buildRuleSet({
      [BRACKETS_KEY]: availableEntry(BRACKETS_KEY, SINGLE_BRACKETS),
    });
    const detail = formulaDetail([step(0, 'APPLY_BRACKETS', BRACKETS_KEY)]);

    const result = runStateWithholdingFormula(detail, ruleSet, money('4000'), null, {}, {});

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.problem.reason).toBe('SCENARIO_UNSUPPORTED');
  });

  it('reports COMPONENT_NOT_STATED when no bracket set matches the filing status', () => {
    const ruleSet = buildRuleSet({
      [BRACKETS_KEY]: availableEntry(BRACKETS_KEY, SINGLE_BRACKETS),
    });
    const detail = formulaDetail([step(0, 'APPLY_BRACKETS', BRACKETS_KEY)]);

    const result = runStateWithholdingFormula(detail, ruleSet, money('4000'), 'MARRIED', {}, {});

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.problem.reason).toBe('COMPONENT_NOT_STATED');
  });
});

describe('missing / unverified / invalid bracket rule', () => {
  it('reports RULE_MISSING when the named bracket rule was never resolved', () => {
    const ruleSet = buildRuleSet({});
    const detail = formulaDetail([step(0, 'APPLY_BRACKETS', BRACKETS_KEY)]);

    const result = runStateWithholdingFormula(detail, ruleSet, money('4000'), SINGLE, {}, {});

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.problem.reason).toBe('RULE_MISSING');
  });

  it('reports RULE_UNVERIFIED for a CONFLICT bracket rule', () => {
    const ruleSet = buildRuleSet({
      [BRACKETS_KEY]: availableEntry(BRACKETS_KEY, SINGLE_BRACKETS, {
        verificationStatus: 'CONFLICT',
      }),
    });
    const detail = formulaDetail([step(0, 'APPLY_BRACKETS', BRACKETS_KEY)]);

    const result = runStateWithholdingFormula(detail, ruleSet, money('4000'), SINGLE, {}, {});

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.problem.reason).toBe('RULE_UNVERIFIED');
  });

  it('reports RULE_DETAIL_INVALID when the resolved detail is not a BRACKET_TABLE', () => {
    const ruleSet = buildRuleSet({
      [BRACKETS_KEY]: availableEntry(BRACKETS_KEY, {
        shape: 'WAGE_BASE',
        amount: '1',
        basis: 'ANNUAL',
        applicability: 'APPLIES',
      }),
    });
    const detail = formulaDetail([step(0, 'APPLY_BRACKETS', BRACKETS_KEY)]);

    const result = runStateWithholdingFormula(detail, ruleSet, money('4000'), SINGLE, {}, {});

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.problem.reason).toBe('RULE_DETAIL_INVALID');
  });
});

describe('ordered sequential execution', () => {
  it('executes steps in ascending ordinal order regardless of array order', () => {
    const ruleSet = buildRuleSet({
      [DEDUCTION_KEY]: availableEntry(
        DEDUCTION_KEY,
        standardDeductionDetail([{ filingStatus: SINGLE, amount: '1000' }]),
      ),
    });
    // Deliberately supplied out of ordinal order: FLOOR_AT_ZERO (ordinal 1) before
    // SUBTRACT_STANDARD_DEDUCTION (ordinal 0). If array order were used instead of
    // ordinal order, flooring a still-positive value first then subtracting would
    // still coincidentally match here, so use a deduction that would go negative:
    // subtracting first then flooring must yield zero; flooring first then
    // subtracting would yield a negative number if floor ran second.
    const detail = formulaDetail([
      step(1, 'FLOOR_AT_ZERO'),
      step(0, 'SUBTRACT_STANDARD_DEDUCTION'),
    ]);

    const result = runStateWithholdingFormula(detail, ruleSet, money('600'), SINGLE, {}, {});

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    // Ordinal order: subtract 1000 from 600 (-400), then floor to 0.
    expect(toStorageString(result.value)).toBe('0');
  });

  it('reports RULE_CONFLICT for duplicate ordinals rather than choosing an order', () => {
    const ruleSet = buildRuleSet({});
    const detail = formulaDetail([step(0, 'FLOOR_AT_ZERO'), step(0, 'FLOOR_AT_ZERO')]);

    const result = runStateWithholdingFormula(detail, ruleSet, money('10'), SINGLE, {}, {});

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.problem.reason).toBe('RULE_CONFLICT');
  });
});

describe('multiple formula steps', () => {
  it('runs the full three-step example end to end', () => {
    const ruleSet = buildRuleSet({
      [DEDUCTION_KEY]: availableEntry(
        DEDUCTION_KEY,
        standardDeductionDetail([{ filingStatus: SINGLE, amount: '1000' }]),
      ),
      [BRACKETS_KEY]: availableEntry(BRACKETS_KEY, SINGLE_BRACKETS),
    });
    const detail = formulaDetail([
      step(0, 'SUBTRACT_STANDARD_DEDUCTION'),
      step(1, 'FLOOR_AT_ZERO'),
      step(2, 'APPLY_BRACKETS', BRACKETS_KEY),
    ]);

    const result = runStateWithholdingFormula(detail, ruleSet, money('5000'), SINGLE, {}, {});

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    // 5000 - 1000 = 4000; floor no-op; brackets: 100 + 600 = 700.
    expect(toStorageString(result.value)).toBe('700');
  });

  it('short-circuits on the first failing step without running later steps', () => {
    const ruleSet = buildRuleSet({
      [BRACKETS_KEY]: availableEntry(BRACKETS_KEY, SINGLE_BRACKETS),
    });
    // Standard deduction rule is unresolved, so this must fail before APPLY_BRACKETS runs.
    const detail = formulaDetail([
      step(0, 'SUBTRACT_STANDARD_DEDUCTION'),
      step(1, 'APPLY_BRACKETS', BRACKETS_KEY),
    ]);

    const result = runStateWithholdingFormula(detail, ruleSet, money('5000'), SINGLE, {}, {});

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.problem.reason).toBe('RULE_MISSING');
    expect(result.problem.ruleKey).toBe(DEDUCTION_KEY);
  });
});

describe('unsupported operations do not silently execute', () => {
  const unsupported = ['ROUND', 'ANNUALIZE', 'DEANNUALIZE'] as const;

  it.each(unsupported)(
    'reports METHOD_NOT_IMPLEMENTED for %s rather than inventing a result',
    (operation) => {
      const ruleSet = buildRuleSet({});
      const detail = formulaDetail([step(0, operation)]);

      const result = runStateWithholdingFormula(detail, ruleSet, money('100'), SINGLE, {}, {});

      expect(result.ok).toBe(false);
      if (result.ok) throw new Error('expected failure');
      expect(result.problem.reason).toBe('METHOD_NOT_IMPLEMENTED');
    },
  );

  it('does not execute a later supported step once an unsupported step is reached', () => {
    const ruleSet = buildRuleSet({});
    const detail = formulaDetail([step(0, 'ROUND'), step(1, 'FLOOR_AT_ZERO')]);

    const result = runStateWithholdingFormula(detail, ruleSet, money('-5'), SINGLE, {}, {});

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.problem.reason).toBe('METHOD_NOT_IMPLEMENTED');
  });
});

describe('purity', () => {
  it('does not mutate the supplied ResolvedStateRuleSet', () => {
    const entry = availableEntry(
      DEDUCTION_KEY,
      standardDeductionDetail([{ filingStatus: SINGLE, amount: '1000' }]),
    );
    const ruleSet = buildRuleSet({ [DEDUCTION_KEY]: entry });
    const detail = formulaDetail([step(0, 'SUBTRACT_STANDARD_DEDUCTION')]);

    const before = stateRule(ruleSet, DEDUCTION_KEY);
    runStateWithholdingFormula(detail, ruleSet, money('5000'), SINGLE, {}, {});
    const after = stateRule(ruleSet, DEDUCTION_KEY);

    expect(after).toBe(before);
    expect(Object.isFrozen(ruleSet)).toBe(true);
  });

  it('does not mutate the supplied initialValue or filingStatus arguments', () => {
    const ruleSet = buildRuleSet({});
    const detail = formulaDetail([step(0, 'FLOOR_AT_ZERO')]);
    const initialValue: Money = money('-25');
    const filingStatus = SINGLE;

    runStateWithholdingFormula(detail, ruleSet, initialValue, filingStatus, {}, {});

    expect(toStorageString(initialValue)).toBe('-25');
    expect(filingStatus).toBe(SINGLE);
  });

  it('is synchronous — no awaited call, no Promise return', () => {
    const ruleSet = buildRuleSet({});
    const detail = formulaDetail([step(0, 'FLOOR_AT_ZERO')]);
    const result = runStateWithholdingFormula(detail, ruleSet, money('1'), SINGLE, {}, {});
    expect(result).not.toBeInstanceOf(Promise);
  });
});

describe('determinism', () => {
  it('produces an identical result across repeated calls with the same input', () => {
    const ruleSet = buildRuleSet({
      [DEDUCTION_KEY]: availableEntry(
        DEDUCTION_KEY,
        standardDeductionDetail([{ filingStatus: SINGLE, amount: '1000' }]),
      ),
      [BRACKETS_KEY]: availableEntry(BRACKETS_KEY, SINGLE_BRACKETS),
    });
    const detail = formulaDetail([
      step(0, 'SUBTRACT_STANDARD_DEDUCTION'),
      step(1, 'FLOOR_AT_ZERO'),
      step(2, 'APPLY_BRACKETS', BRACKETS_KEY),
    ]);

    const first = runStateWithholdingFormula(detail, ruleSet, money('5000'), SINGLE, {}, {});
    const second = runStateWithholdingFormula(detail, ruleSet, money('5000'), SINGLE, {}, {});

    expect(first).toEqual(second);
  });
});

describe('Money precision — no floating-point arithmetic', () => {
  it('subtracts an exact decimal amount without binary floating-point error', () => {
    const ruleSet = buildRuleSet({
      [DEDUCTION_KEY]: availableEntry(
        DEDUCTION_KEY,
        standardDeductionDetail([{ filingStatus: SINGLE, amount: '0.1' }]),
      ),
    });
    const detail = formulaDetail([step(0, 'SUBTRACT_STANDARD_DEDUCTION')]);

    const result = runStateWithholdingFormula(detail, ruleSet, money('0.3'), SINGLE, {}, {});

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    // In IEEE-754 doubles, 0.3 - 0.1 === 0.19999999999999998. This must be exact.
    expect(toStorageString(result.value)).toBe('0.2');
    expect(subtract(money('0.3'), money('0.1')).equals(result.value)).toBe(true);
  });

  it('sums bracket slices exactly across three brackets, avoiding 0.1+0.1+0.1 drift', () => {
    const brackets = bracketTableDetail([
      {
        filingStatus: SINGLE,
        brackets: [
          { ordinal: 0, atLeast: '0', lessThan: '1', rate: '0.1', unit: 'DECIMAL_FRACTION' },
          { ordinal: 1, atLeast: '1', lessThan: '2', rate: '0.1', unit: 'DECIMAL_FRACTION' },
          { ordinal: 2, atLeast: '2', lessThan: null, rate: '0.1', unit: 'DECIMAL_FRACTION' },
        ],
      },
    ]);
    const ruleSet = buildRuleSet({ [BRACKETS_KEY]: availableEntry(BRACKETS_KEY, brackets) });
    const detail = formulaDetail([step(0, 'APPLY_BRACKETS', BRACKETS_KEY)]);

    const result = runStateWithholdingFormula(detail, ruleSet, money('3'), SINGLE, {}, {});

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(toStorageString(result.value)).toBe('0.3');
  });
});

describe('no forbidden responsibilities', () => {
  it('imports no database client, Prisma, resolver, or rule-assembly module', async () => {
    const fs = await import('node:fs');
    const source = fs.readFileSync(
      new URL('../../lib/tax/state/rules/withholdingFormulaInterpreter.ts', import.meta.url),
      'utf8',
    );
    const importLines = source
      .split('\n')
      .filter((line) => /^import\b/.test(line.trim()))
      .join('\n');
    expect(importLines).not.toMatch(/getPrisma|PrismaClient|from '@\/lib\/db\//);
    expect(importLines).not.toMatch(/candidateRetrieval|resolveCandidates|assembleStateRuleSet/);
    expect(importLines).not.toMatch(/coverageGate/);
    expect(importLines).not.toMatch(/from '@\/lib\/rules\/resolution'/);
    expect(importLines).not.toMatch(/from '@\/lib\/jurisdictions\/repository'/);
    expect(importLines).not.toMatch(/tax\/federal/);
  });

  it('imports no calculator pipeline / tax-orchestration module', async () => {
    const fs = await import('node:fs');
    const source = fs.readFileSync(
      new URL('../../lib/tax/state/rules/withholdingFormulaInterpreter.ts', import.meta.url),
      'utf8',
    );
    const importLines = source
      .split('\n')
      .filter((line) => /^import\b/.test(line.trim()))
      .join('\n');
    expect(importLines).not.toMatch(/lib\/calculator/);
    expect(importLines).not.toMatch(
      /withholdingTable|withholdingPayPeriods|withholdingFilingStatusMap|withholdingRoundingPolicy/,
    );
  });
});

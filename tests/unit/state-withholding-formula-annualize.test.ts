import { describe, expect, it } from 'vitest';

import { money, toStorageString } from '@/lib/core/money';
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
 * `ANNUALIZE` — contract-locked by Task 4O-6R33 following the Task 4O-6R32
 * audit.
 *
 * ===========================================================================
 * SCOPE NOTE.
 *
 * `runningValue = runningValue × periodsPerYear`, where the factor comes
 * EXCLUSIVELY from the pre-existing, unmodified
 * `resolveStatePayPeriodsPerYear(ruleSet, payFrequency)` reader (Task 4K) —
 * never the generic calculator `periodsPerYear()`, never a hardcoded
 * frequency table, never a federal rule key. `operandRef` MUST be `null`
 * (single implicit target, mirroring `SUBTRACT_STANDARD_DEDUCTION`), since
 * `WITHHOLDING_PAY_PERIODS_PER_YEAR` is the sole `StateRuleKey` ever
 * registered against the `COUNT_BY_PAY_PERIOD` shape. `payFrequency` is a
 * new, explicit, narrow interpreter parameter (Task 4O-6R33 Decision 3) —
 * structurally identical in role to the existing `filingStatus` parameter: a
 * per-calculation runtime fact, never rule data.
 *
 * This operation performs NO ROUNDING and never consumes
 * `WITHHOLDING_ROUNDING_POLICY` (locked outside the formula interpreter
 * entirely by Task 4O-6R31). `DEANNUALIZE` — the inverse operation (Task
 * 4O-6R38 through 4O-6R45) — is implemented and tested separately, in its
 * own dedicated file `state-withholding-formula-deannualize.test.ts`, not
 * here.
 * ===========================================================================
 *
 * Fixtures use RESERVED TEST jurisdiction/source ids and no real tax value.
 */

const JURISDICTION_CODE = 'TEST-ANNUALIZE';
const JURISDICTION_ID = 'test-annualize-jurisdiction-id';
const TAX_YEAR = 2099;
const EFFECTIVE = '2099-06-15T00:00:00.000Z';
const PERIODS_KEY = StateRuleKey.WITHHOLDING_PAY_PERIODS_PER_YEAR;
const SINGLE = 'SINGLE';
const WEEKLY = 'WEEKLY';

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

const step = (
  ordinal: number,
  operation: string,
  operandRef: string | null = null,
): Record<string, unknown> => ({ ordinal, operation, operandRef, note: null });

const COUNTS_DETAIL = {
  shape: 'COUNT_BY_PAY_PERIOD',
  counts: [
    { payFrequency: 'WEEKLY', periodsPerYear: 52 },
    { payFrequency: 'BIWEEKLY', periodsPerYear: 26 },
    { payFrequency: 'MONTHLY', periodsPerYear: 12 },
    { payFrequency: 'DAILY', periodsPerYear: null },
  ],
};

describe('ANNUALIZE — arithmetic (Task 4O-6R33-locked)', () => {
  it('multiplies the running value by the state-native periods-per-year count (happy path)', () => {
    const ruleSet = buildRuleSet({
      [PERIODS_KEY]: availableEntry(PERIODS_KEY, COUNTS_DETAIL),
    });
    const detail = formulaDetail([step(0, 'ANNUALIZE')]);

    const result = runStateWithholdingFormula(
      detail,
      ruleSet,
      money('1000'),
      SINGLE,
      {},
      {},
      WEEKLY,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    // 1000 * 52 = 52000.
    expect(toStorageString(result.value.amount)).toBe('52000');
  });

  it.each([
    ['WEEKLY', 52, '52000'],
    ['BIWEEKLY', 26, '26000'],
    ['MONTHLY', 12, '12000'],
  ])(
    "uses the requested frequency %s (count %i), not a different frequency's count",
    (frequency, _count, expected) => {
      const ruleSet = buildRuleSet({
        [PERIODS_KEY]: availableEntry(PERIODS_KEY, COUNTS_DETAIL),
      });
      const detail = formulaDetail([step(0, 'ANNUALIZE')]);

      const result = runStateWithholdingFormula(
        detail,
        ruleSet,
        money('1000'),
        SINGLE,
        {},
        {},
        frequency,
      );

      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error('expected ok');
      expect(toStorageString(result.value.amount)).toBe(expected);
    },
  );

  it('produces zero when the running value is zero, without rejecting it', () => {
    const ruleSet = buildRuleSet({
      [PERIODS_KEY]: availableEntry(PERIODS_KEY, COUNTS_DETAIL),
    });
    const detail = formulaDetail([step(0, 'ANNUALIZE')]);

    const result = runStateWithholdingFormula(detail, ruleSet, money('0'), SINGLE, {}, {}, WEEKLY);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(toStorageString(result.value.amount)).toBe('0');
  });

  it('performs no rounding, preserving exact Decimal precision', () => {
    const ruleSet = buildRuleSet({
      [PERIODS_KEY]: availableEntry(PERIODS_KEY, COUNTS_DETAIL),
    });
    const detail = formulaDetail([step(0, 'ANNUALIZE')]);

    // 10.005 * 52 = 520.26 exactly; naive IEEE-754 float arithmetic would not
    // reproduce this exactly.
    const result = runStateWithholdingFormula(
      detail,
      ruleSet,
      money('10.005'),
      SINGLE,
      {},
      {},
      WEEKLY,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(toStorageString(result.value.amount)).toBe('520.26');
  });
});

describe('ANNUALIZE — operandRef validation', () => {
  it('succeeds with a null operandRef (single implicit target)', () => {
    const ruleSet = buildRuleSet({
      [PERIODS_KEY]: availableEntry(PERIODS_KEY, COUNTS_DETAIL),
    });
    const detail = formulaDetail([step(0, 'ANNUALIZE', null)]);

    const result = runStateWithholdingFormula(
      detail,
      ruleSet,
      money('1000'),
      SINGLE,
      {},
      {},
      WEEKLY,
    );

    expect(result.ok).toBe(true);
  });

  it('reports RULE_DETAIL_INVALID for a non-null operandRef', () => {
    const ruleSet = buildRuleSet({
      [PERIODS_KEY]: availableEntry(PERIODS_KEY, COUNTS_DETAIL),
    });
    const detail = formulaDetail([step(0, 'ANNUALIZE', PERIODS_KEY)]);

    const result = runStateWithholdingFormula(
      detail,
      ruleSet,
      money('1000'),
      SINGLE,
      {},
      {},
      WEEKLY,
    );

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.problem.reason).toBe('RULE_DETAIL_INVALID');
  });
});

describe('ANNUALIZE — pay frequency availability', () => {
  it('reports SCENARIO_UNSUPPORTED when payFrequency is null', () => {
    const ruleSet = buildRuleSet({
      [PERIODS_KEY]: availableEntry(PERIODS_KEY, COUNTS_DETAIL),
    });
    const detail = formulaDetail([step(0, 'ANNUALIZE')]);

    const result = runStateWithholdingFormula(detail, ruleSet, money('1000'), SINGLE, {}, {}, null);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.problem.reason).toBe('SCENARIO_UNSUPPORTED');
  });
});

describe('ANNUALIZE — referenced rule missing/unverified/malformed', () => {
  it('reports RULE_MISSING when WITHHOLDING_PAY_PERIODS_PER_YEAR was never resolved', () => {
    const ruleSet = buildRuleSet({});
    const detail = formulaDetail([step(0, 'ANNUALIZE')]);

    const result = runStateWithholdingFormula(
      detail,
      ruleSet,
      money('1000'),
      SINGLE,
      {},
      {},
      WEEKLY,
    );

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.problem.reason).toBe('RULE_MISSING');
    expect(result.problem.ruleKey).toBe(PERIODS_KEY);
  });

  it('reports RULE_UNVERIFIED for a PENDING rule', () => {
    const ruleSet = buildRuleSet({
      [PERIODS_KEY]: availableEntry(PERIODS_KEY, COUNTS_DETAIL, {
        verificationStatus: 'PENDING',
      }),
    });
    const detail = formulaDetail([step(0, 'ANNUALIZE')]);

    const result = runStateWithholdingFormula(
      detail,
      ruleSet,
      money('1000'),
      SINGLE,
      {},
      {},
      WEEKLY,
    );

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.problem.reason).toBe('RULE_UNVERIFIED');
  });

  it('reports RULE_DETAIL_INVALID for a detail shape mismatched to this rule key', () => {
    const detail = formulaDetail([step(0, 'ANNUALIZE')]);
    const ruleSet = buildRuleSet({
      [PERIODS_KEY]: availableEntry(PERIODS_KEY, {
        shape: 'WAGE_BASE',
        amount: '1000',
        basis: 'ANNUAL',
        applicability: 'APPLIES',
      }),
    });

    const result = runStateWithholdingFormula(
      detail,
      ruleSet,
      money('1000'),
      SINGLE,
      {},
      {},
      WEEKLY,
    );

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.problem.reason).toBe('RULE_DETAIL_INVALID');
  });
});

describe('ANNUALIZE — frequency absent from counts[] or stated as null', () => {
  it('reports SCENARIO_UNSUPPORTED for a frequency the rule never lists', () => {
    const ruleSet = buildRuleSet({
      [PERIODS_KEY]: availableEntry(PERIODS_KEY, COUNTS_DETAIL),
    });
    const detail = formulaDetail([step(0, 'ANNUALIZE')]);

    const result = runStateWithholdingFormula(
      detail,
      ruleSet,
      money('1000'),
      SINGLE,
      {},
      {},
      'QUARTERLY',
    );

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.problem.reason).toBe('SCENARIO_UNSUPPORTED');
  });

  it('reports SCENARIO_UNSUPPORTED for a frequency with periodsPerYear stated as null, never treating it as zero', () => {
    const ruleSet = buildRuleSet({
      [PERIODS_KEY]: availableEntry(PERIODS_KEY, COUNTS_DETAIL),
    });
    const detail = formulaDetail([step(0, 'ANNUALIZE')]);

    const result = runStateWithholdingFormula(
      detail,
      ruleSet,
      money('1000'),
      SINGLE,
      {},
      {},
      'DAILY',
    );

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.problem.reason).toBe('SCENARIO_UNSUPPORTED');
  });
});

describe('ANNUALIZE — no generic fallback', () => {
  it('does not substitute the generic calculator periodsPerYear() when the state rule is missing', () => {
    const ruleSet = buildRuleSet({});
    const detail = formulaDetail([step(0, 'ANNUALIZE')]);

    // If a generic fallback existed, WEEKLY would silently resolve to 52 via
    // the calendar table and this would succeed. It must not.
    const result = runStateWithholdingFormula(
      detail,
      ruleSet,
      money('1000'),
      SINGLE,
      {},
      {},
      WEEKLY,
    );

    expect(result.ok).toBe(false);
  });

  it('does not substitute a generic count for a frequency the state rule never lists', () => {
    const ruleSet = buildRuleSet({
      [PERIODS_KEY]: availableEntry(PERIODS_KEY, COUNTS_DETAIL),
    });
    const detail = formulaDetail([step(0, 'ANNUALIZE')]);

    const result = runStateWithholdingFormula(
      detail,
      ruleSet,
      money('1000'),
      SINGLE,
      {},
      {},
      'QUARTERLY',
    );

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    // Never 4000 (1000 * 4, the generic quarterly calendar count).
    expect(result).not.toEqual({ ok: true, value: money('4000') });
  });
});

describe('ANNUALIZE — no rounding policy consumed', () => {
  it('does not require a WITHHOLDING_ROUNDING_POLICY rule to be resolved', () => {
    const ruleSet = buildRuleSet({
      [PERIODS_KEY]: availableEntry(PERIODS_KEY, COUNTS_DETAIL),
      // Deliberately no WITHHOLDING_ROUNDING_POLICY entry at all.
    });
    const detail = formulaDetail([step(0, 'ANNUALIZE')]);

    const result = runStateWithholdingFormula(
      detail,
      ruleSet,
      money('1000'),
      SINGLE,
      {},
      {},
      WEEKLY,
    );

    expect(result.ok).toBe(true);
  });

  it('does not reference WITHHOLDING_ROUNDING_POLICY outside of doc comments', async () => {
    const fs = await import('node:fs');
    const source = fs
      .readFileSync(
        new URL('../../lib/tax/state/rules/withholdingFormulaInterpreter.ts', import.meta.url),
        'utf8',
      )
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    expect(source).not.toMatch(/WITHHOLDING_ROUNDING_POLICY/);
  });
});

describe('ANNUALIZE — ROUND remains unsupported', () => {
  it('reports METHOD_NOT_IMPLEMENTED for ROUND', () => {
    const ruleSet = buildRuleSet({
      [PERIODS_KEY]: availableEntry(PERIODS_KEY, COUNTS_DETAIL),
    });
    const detail = formulaDetail([step(0, 'ROUND')]);

    const result = runStateWithholdingFormula(
      detail,
      ruleSet,
      money('1000'),
      SINGLE,
      {},
      {},
      WEEKLY,
    );

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.problem.reason).toBe('METHOD_NOT_IMPLEMENTED');
  });
});

describe('ANNUALIZE — sequential accumulator behavior', () => {
  it('operates on the running value left by a preceding formula step', () => {
    const ruleSet = buildRuleSet({
      [StateRuleKey.WITHHOLDING_STANDARD_DEDUCTION]: availableEntry(
        StateRuleKey.WITHHOLDING_STANDARD_DEDUCTION,
        {
          shape: 'AMOUNT_BY_FILING_STATUS',
          unit: 'ANNUAL',
          amounts: [{ filingStatus: SINGLE, amount: '200' }],
        },
      ),
      [PERIODS_KEY]: availableEntry(PERIODS_KEY, COUNTS_DETAIL),
    });
    const detail = formulaDetail([step(0, 'SUBTRACT_STANDARD_DEDUCTION'), step(1, 'ANNUALIZE')]);

    const result = runStateWithholdingFormula(
      detail,
      ruleSet,
      money('1000'),
      SINGLE,
      {},
      {},
      WEEKLY,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    // 1000 - 200 = 800; 800 * 52 = 41600.
    expect(toStorageString(result.value.amount)).toBe('41600');
  });

  it('does not read wages or StateCalculationContext directly — only the running value passed in', () => {
    const ruleSet = buildRuleSet({
      [PERIODS_KEY]: availableEntry(PERIODS_KEY, COUNTS_DETAIL),
    });
    const detail = formulaDetail([step(0, 'ANNUALIZE')]);

    const result = runStateWithholdingFormula(
      detail,
      ruleSet,
      money('123.45'),
      SINGLE,
      {},
      {},
      WEEKLY,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    // 123.45 * 52 = 6419.4 — computed purely from the supplied running value.
    expect(toStorageString(result.value.amount)).toBe('6419.4');
  });
});

describe('purity', () => {
  it('does not mutate the supplied ResolvedStateRuleSet', () => {
    const entry = availableEntry(PERIODS_KEY, COUNTS_DETAIL);
    const ruleSet = buildRuleSet({ [PERIODS_KEY]: entry });
    const detail = formulaDetail([step(0, 'ANNUALIZE')]);

    const before = stateRule(ruleSet, PERIODS_KEY);
    runStateWithholdingFormula(detail, ruleSet, money('1000'), SINGLE, {}, {}, WEEKLY);
    const after = stateRule(ruleSet, PERIODS_KEY);

    expect(after).toBe(before);
    if (!after.available) throw new Error('expected available');
    expect(after.rule.reference).toEqual(entry.rule.reference);
    expect(Object.isFrozen(ruleSet)).toBe(true);
  });

  it('is synchronous — no awaited call, no Promise return', () => {
    const ruleSet = buildRuleSet({
      [PERIODS_KEY]: availableEntry(PERIODS_KEY, COUNTS_DETAIL),
    });
    const detail = formulaDetail([step(0, 'ANNUALIZE')]);

    const result = runStateWithholdingFormula(
      detail,
      ruleSet,
      money('1000'),
      SINGLE,
      {},
      {},
      WEEKLY,
    );

    expect(result).not.toBeInstanceOf(Promise);
  });
});

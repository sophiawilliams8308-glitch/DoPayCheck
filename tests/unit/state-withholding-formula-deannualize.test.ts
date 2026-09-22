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
 * `DEANNUALIZE` — contract-locked by Tasks 4O-6R38 through 4O-6R45.
 *
 * ===========================================================================
 * SCOPE NOTE.
 *
 * `runningValue = runningValue ÷ periodsPerYear`, the inverse of `ANNUALIZE`
 * (`state-withholding-formula-annualize.test.ts`), using an IDENTICAL
 * contract shape: `operandRef` must be `null`, the factor comes exclusively
 * from `resolveStatePayPeriodsPerYear(ruleSet, payFrequency)`, and
 * `payFrequency` is the same, already-existing interpreter parameter
 * `ANNUALIZE` already consumes — never a new one.
 *
 * The one respect in which this operation differs from `ANNUALIZE`:
 * division, performed via `divideHighPrecision()` (`lib/core/money.ts`,
 * Task 4O-6R41/4O-6R44) rather than `multiply()` — high-precision Decimal
 * arithmetic at this module's configured working precision, explicitly NOT
 * mathematically exact, and never consuming `WITHHOLDING_ROUNDING_POLICY`
 * or any scale/`RoundingMode` of any kind (Task 4O-6R38/4O-6R43 locks).
 * ===========================================================================
 *
 * Fixtures use RESERVED TEST jurisdiction/source ids and no real tax value.
 */

const JURISDICTION_CODE = 'TEST-DEANNUALIZE';
const JURISDICTION_ID = 'test-deannualize-jurisdiction-id';
const TAX_YEAR = 2099;
const EFFECTIVE = '2099-06-15T00:00:00.000Z';
const PERIODS_KEY = StateRuleKey.WITHHOLDING_PAY_PERIODS_PER_YEAR;
const SINGLE = 'SINGLE';
const WEEKLY = 'WEEKLY';
const MONTHLY = 'MONTHLY';

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

describe('DEANNUALIZE — arithmetic (Tasks 4O-6R38-6R45-locked)', () => {
  it('divides the running value by the state-native periods-per-year count (happy path)', () => {
    const ruleSet = buildRuleSet({
      [PERIODS_KEY]: availableEntry(PERIODS_KEY, COUNTS_DETAIL),
    });
    const detail = formulaDetail([step(0, 'DEANNUALIZE')]);

    const result = runStateWithholdingFormula(
      detail,
      ruleSet,
      money('120000'),
      SINGLE,
      {},
      {},
      MONTHLY,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    // 120000 / 12 = 10000.
    expect(toStorageString(result.value)).toBe('10000');
  });

  it.each([
    ['WEEKLY', 52, '10'],
    ['BIWEEKLY', 26, '10'],
    ['MONTHLY', 12, '10'],
  ])(
    "uses the requested frequency %s's own count, not a different frequency's",
    (frequency, count, expected) => {
      const ruleSet = buildRuleSet({
        [PERIODS_KEY]: availableEntry(PERIODS_KEY, COUNTS_DETAIL),
      });
      const detail = formulaDetail([step(0, 'DEANNUALIZE')]);

      const result = runStateWithholdingFormula(
        detail,
        ruleSet,
        money(String(10 * count)),
        SINGLE,
        {},
        {},
        frequency,
      );

      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error('expected ok');
      expect(toStorageString(result.value)).toBe(expected);
    },
  );

  it('produces zero when the running value is zero, without rejecting it', () => {
    const ruleSet = buildRuleSet({
      [PERIODS_KEY]: availableEntry(PERIODS_KEY, COUNTS_DETAIL),
    });
    const detail = formulaDetail([step(0, 'DEANNUALIZE')]);

    const result = runStateWithholdingFormula(detail, ruleSet, money('0'), SINGLE, {}, {}, WEEKLY);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(toStorageString(result.value)).toBe('0');
  });
});

describe('DEANNUALIZE — high-precision division, no rounding', () => {
  it('preserves the configured Decimal.js working precision for a non-terminating quotient, without currency rounding', () => {
    const ruleSet = buildRuleSet({
      [PERIODS_KEY]: availableEntry(PERIODS_KEY, COUNTS_DETAIL),
    });
    const detail = formulaDetail([step(0, 'DEANNUALIZE')]);

    // 100 / 12 has no terminating decimal expansion. The result is this
    // module's configured 34-significant-digit high-precision Decimal
    // approximation — NOT a mathematically exact rational value, and never
    // rounded to a currency or intermediate scale.
    const result = runStateWithholdingFormula(
      detail,
      ruleSet,
      money('100'),
      SINGLE,
      {},
      {},
      MONTHLY,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(toStorageString(result.value)).toBe('8.333333333333333333333333333333333');
  });

  it('does not consume WITHHOLDING_ROUNDING_POLICY — succeeds with no such rule resolved', () => {
    const ruleSet = buildRuleSet({
      [PERIODS_KEY]: availableEntry(PERIODS_KEY, COUNTS_DETAIL),
      // Deliberately no WITHHOLDING_ROUNDING_POLICY entry at all.
    });
    const detail = formulaDetail([step(0, 'DEANNUALIZE')]);

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

  it('imports no WITHHOLDING_ROUNDING_POLICY, currencyScale, currencyMode, intermediateScale, or RoundingMode reference from the deannualize() handler', async () => {
    const fs = await import('node:fs');
    const source = fs.readFileSync(
      new URL('../../lib/tax/state/rules/withholdingFormulaInterpreter.ts', import.meta.url),
      'utf8',
    );
    const match = /function deannualize\([\s\S]*?\n}\n/.exec(source);
    if (!match) throw new Error('deannualize() not found in source');
    const functionSource = match[0];
    expect(functionSource).not.toMatch(
      /WITHHOLDING_ROUNDING_POLICY|currencyScale|currencyMode|intermediateScale|RoundingMode/,
    );
    expect(functionSource).not.toMatch(/\bdivide\(|\bround\(|toDecimalPlaces/);
  });
});

describe('DEANNUALIZE — operandRef validation', () => {
  it('succeeds with a null operandRef (single implicit target)', () => {
    const ruleSet = buildRuleSet({
      [PERIODS_KEY]: availableEntry(PERIODS_KEY, COUNTS_DETAIL),
    });
    const detail = formulaDetail([step(0, 'DEANNUALIZE', null)]);

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
    const detail = formulaDetail([step(0, 'DEANNUALIZE', PERIODS_KEY)]);

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

describe('DEANNUALIZE — pay frequency availability', () => {
  it('reports SCENARIO_UNSUPPORTED when payFrequency is null', () => {
    const ruleSet = buildRuleSet({
      [PERIODS_KEY]: availableEntry(PERIODS_KEY, COUNTS_DETAIL),
    });
    const detail = formulaDetail([step(0, 'DEANNUALIZE')]);

    const result = runStateWithholdingFormula(detail, ruleSet, money('1000'), SINGLE, {}, {}, null);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.problem.reason).toBe('SCENARIO_UNSUPPORTED');
  });
});

describe('DEANNUALIZE — referenced rule missing/unverified/malformed', () => {
  it('reports RULE_MISSING when WITHHOLDING_PAY_PERIODS_PER_YEAR was never resolved', () => {
    const ruleSet = buildRuleSet({});
    const detail = formulaDetail([step(0, 'DEANNUALIZE')]);

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
    const detail = formulaDetail([step(0, 'DEANNUALIZE')]);

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
    const detail = formulaDetail([step(0, 'DEANNUALIZE')]);
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

describe('DEANNUALIZE — frequency absent from counts[] or stated as null', () => {
  it('reports SCENARIO_UNSUPPORTED for a frequency the rule never lists', () => {
    const ruleSet = buildRuleSet({
      [PERIODS_KEY]: availableEntry(PERIODS_KEY, COUNTS_DETAIL),
    });
    const detail = formulaDetail([step(0, 'DEANNUALIZE')]);

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
    const detail = formulaDetail([step(0, 'DEANNUALIZE')]);

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

describe('DEANNUALIZE — no generic fallback', () => {
  it('does not substitute the generic calculator periodsPerYear() when the state rule is missing', () => {
    const ruleSet = buildRuleSet({});
    const detail = formulaDetail([step(0, 'DEANNUALIZE')]);

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
    const detail = formulaDetail([step(0, 'DEANNUALIZE')]);

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
    // Never 250 (1000 / 4, the generic quarterly calendar count).
    expect(result).not.toEqual({ ok: true, value: money('250') });
  });
});

describe('DEANNUALIZE — ROUND remains unsupported', () => {
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

describe('DEANNUALIZE — ordinal placement', () => {
  it('works as the first (and only) step in a formula', () => {
    const ruleSet = buildRuleSet({
      [PERIODS_KEY]: availableEntry(PERIODS_KEY, COUNTS_DETAIL),
    });
    const detail = formulaDetail([step(0, 'DEANNUALIZE')]);

    const result = runStateWithholdingFormula(
      detail,
      ruleSet,
      money('1200'),
      SINGLE,
      {},
      {},
      MONTHLY,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(toStorageString(result.value)).toBe('100');
  });

  it('works as a middle step, sandwiched between ANNUALIZE and an already-supported operation', () => {
    const ruleSet = buildRuleSet({
      [PERIODS_KEY]: availableEntry(PERIODS_KEY, COUNTS_DETAIL),
      [StateRuleKey.WITHHOLDING_STANDARD_DEDUCTION]: availableEntry(
        StateRuleKey.WITHHOLDING_STANDARD_DEDUCTION,
        {
          shape: 'AMOUNT_BY_FILING_STATUS',
          unit: 'ANNUAL',
          amounts: [{ filingStatus: SINGLE, amount: '20' }],
        },
      ),
    });
    const detail = formulaDetail([
      step(10, 'ANNUALIZE'),
      step(20, 'DEANNUALIZE'),
      step(30, 'SUBTRACT_STANDARD_DEDUCTION'),
    ]);

    const result = runStateWithholdingFormula(
      detail,
      ruleSet,
      money('100'),
      SINGLE,
      {},
      {},
      MONTHLY,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    // 100 * 12 = 1200 (ANNUALIZE); 1200 / 12 = 100 (DEANNUALIZE);
    // 100 - 20 = 80 (SUBTRACT_STANDARD_DEDUCTION).
    expect(toStorageString(result.value)).toBe('80');
  });

  it('works as the final step in a multi-step formula', () => {
    const ruleSet = buildRuleSet({
      [PERIODS_KEY]: availableEntry(PERIODS_KEY, COUNTS_DETAIL),
      [StateRuleKey.WITHHOLDING_STANDARD_DEDUCTION]: availableEntry(
        StateRuleKey.WITHHOLDING_STANDARD_DEDUCTION,
        {
          shape: 'AMOUNT_BY_FILING_STATUS',
          unit: 'ANNUAL',
          amounts: [{ filingStatus: SINGLE, amount: '200' }],
        },
      ),
    });
    const detail = formulaDetail([step(0, 'SUBTRACT_STANDARD_DEDUCTION'), step(1, 'DEANNUALIZE')]);

    const result = runStateWithholdingFormula(
      detail,
      ruleSet,
      money('1200'),
      SINGLE,
      {},
      {},
      MONTHLY,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    // 1200 - 200 = 1000; 1000 / 12 (high precision).
    expect(toStorageString(result.value)).toBe('83.33333333333333333333333333333333');
  });

  it('executes two DEANNUALIZE steps in the same formula, each exactly once, in ordinal order', () => {
    const ruleSet = buildRuleSet({
      [PERIODS_KEY]: availableEntry(PERIODS_KEY, COUNTS_DETAIL),
    });
    const detail = formulaDetail([step(0, 'DEANNUALIZE'), step(1, 'DEANNUALIZE')]);

    const result = runStateWithholdingFormula(
      detail,
      ruleSet,
      money('1440'),
      SINGLE,
      {},
      {},
      MONTHLY,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    // 1440 / 12 = 120; 120 / 12 = 10.
    expect(toStorageString(result.value)).toBe('10');
  });
});

describe('purity', () => {
  it('does not mutate the supplied ResolvedStateRuleSet', () => {
    const entry = availableEntry(PERIODS_KEY, COUNTS_DETAIL);
    const ruleSet = buildRuleSet({ [PERIODS_KEY]: entry });
    const detail = formulaDetail([step(0, 'DEANNUALIZE')]);

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
    const detail = formulaDetail([step(0, 'DEANNUALIZE')]);

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

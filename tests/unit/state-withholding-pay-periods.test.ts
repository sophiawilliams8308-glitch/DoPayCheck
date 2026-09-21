import { describe, expect, it } from 'vitest';

import type { RuleReference } from '@/lib/calculator/types/rules';
import { resolveStatePayPeriodsPerYear } from '@/lib/tax/state/rules/withholdingPayPeriods';
import {
  freezeStateRuleSet,
  stateRule,
  type ResolvedStateRule,
  type ResolvedStateRuleSet,
  type StateRuleEntry,
} from '@/lib/tax/state/rules/stateRuleSet';
import { StateRuleKey } from '@/lib/tax/state/ruleKeys';

/**
 * State withholding pay-periods-per-year reader (Task 4K).
 *
 * ===========================================================================
 * SCOPE NOTE — this tests the READER ONLY.
 *
 * `ANNUALIZE`/`DEANNUALIZE` formula execution and `WITHHOLDING_TABLE` row
 * selection are NOT implemented and therefore not tested here — see
 * `withholdingPayPeriods.ts`'s own doc comment. These tests cover exactly
 * what IS implemented: reading and exact-preserving one frequency's
 * periods-per-year count from the one resolvable
 * `WITHHOLDING_PAY_PERIODS_PER_YEAR` rule, with no fallback to the generic
 * calendar table.
 * ===========================================================================
 *
 * Fixtures use RESERVED TEST jurisdiction/source ids and no real tax value.
 */

const JURISDICTION_CODE = 'TEST-WITHHOLDING-PAY-PERIODS';
const JURISDICTION_ID = 'test-withholding-pay-periods-jurisdiction-id';
const TAX_YEAR = 2099;
const EFFECTIVE = '2099-06-15T00:00:00.000Z';
const KEY = StateRuleKey.WITHHOLDING_PAY_PERIODS_PER_YEAR;

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

/** An always-`available: true` entry, typed concretely so `.rule` needs no narrowing. */
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

const COUNTS_DETAIL = {
  shape: 'COUNT_BY_PAY_PERIOD',
  counts: [
    { payFrequency: 'WEEKLY', periodsPerYear: 52 },
    { payFrequency: 'BIWEEKLY', periodsPerYear: 26 },
    { payFrequency: 'MONTHLY', periodsPerYear: 12 },
    { payFrequency: 'DAILY', periodsPerYear: null },
  ],
};

describe('resolveStatePayPeriodsPerYear — valid lookup', () => {
  it('returns OK with the exact stated count for WEEKLY', () => {
    const ruleSet = buildRuleSet({ [KEY]: availableEntry(KEY, COUNTS_DETAIL) });

    const result = resolveStatePayPeriodsPerYear(ruleSet, 'WEEKLY');

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.value).toBe(52);
  });
});

describe('resolveStatePayPeriodsPerYear — multiple frequencies', () => {
  it.each([
    ['WEEKLY', 52],
    ['BIWEEKLY', 26],
    ['MONTHLY', 12],
  ])('resolves %s to %i independently', (frequency, expected) => {
    const ruleSet = buildRuleSet({ [KEY]: availableEntry(KEY, COUNTS_DETAIL) });

    const result = resolveStatePayPeriodsPerYear(ruleSet, frequency);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.value).toBe(expected);
  });
});

describe('resolveStatePayPeriodsPerYear — frequency absent from counts[]', () => {
  it('reports SCENARIO_UNSUPPORTED for a frequency the rule never lists', () => {
    const ruleSet = buildRuleSet({ [KEY]: availableEntry(KEY, COUNTS_DETAIL) });

    const result = resolveStatePayPeriodsPerYear(ruleSet, 'QUARTERLY');

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.problem.reason).toBe('SCENARIO_UNSUPPORTED');
  });
});

describe('resolveStatePayPeriodsPerYear — frequency present with null count', () => {
  it('reports SCENARIO_UNSUPPORTED, never a substituted count', () => {
    const ruleSet = buildRuleSet({ [KEY]: availableEntry(KEY, COUNTS_DETAIL) });

    const result = resolveStatePayPeriodsPerYear(ruleSet, 'DAILY');

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.problem.reason).toBe('SCENARIO_UNSUPPORTED');
  });
});

describe('resolveStatePayPeriodsPerYear — missing rule', () => {
  it('reports RULE_MISSING, delegated from readDetail()', () => {
    const ruleSet = buildRuleSet({});

    const result = resolveStatePayPeriodsPerYear(ruleSet, 'WEEKLY');

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.problem.reason).toBe('RULE_MISSING');
    expect(result.problem.ruleKey).toBe(KEY);
  });
});

describe('resolveStatePayPeriodsPerYear — unverified rule', () => {
  it('reports RULE_UNVERIFIED for a PENDING rule, never treating it as verified', () => {
    const ruleSet = buildRuleSet({
      [KEY]: availableEntry(KEY, COUNTS_DETAIL, { verificationStatus: 'PENDING' }),
    });

    const result = resolveStatePayPeriodsPerYear(ruleSet, 'WEEKLY');

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.problem.reason).toBe('RULE_UNVERIFIED');
  });
});

describe('resolveStatePayPeriodsPerYear — invalid rule detail', () => {
  it('reports RULE_DETAIL_INVALID for a detail shape mismatched to this rule key', () => {
    const detail = {
      shape: 'WAGE_BASE',
      amount: '1000',
      basis: 'ANNUAL',
      applicability: 'APPLIES',
    };
    const ruleSet = buildRuleSet({ [KEY]: availableEntry(KEY, detail) });

    const result = resolveStatePayPeriodsPerYear(ruleSet, 'WEEKLY');

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.problem.reason).toBe('RULE_DETAIL_INVALID');
  });

  it('reports RULE_DETAIL_INVALID for a negative periodsPerYear', () => {
    const detail = {
      shape: 'COUNT_BY_PAY_PERIOD',
      counts: [{ payFrequency: 'WEEKLY', periodsPerYear: -1 }],
    };
    const ruleSet = buildRuleSet({ [KEY]: availableEntry(KEY, detail) });

    const result = resolveStatePayPeriodsPerYear(ruleSet, 'WEEKLY');

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.problem.reason).toBe('RULE_DETAIL_INVALID');
  });
});

describe('resolveStatePayPeriodsPerYear — no generic fallback', () => {
  it('does not substitute the generic calendar count (52) when the state rule is missing', () => {
    const ruleSet = buildRuleSet({});

    const result = resolveStatePayPeriodsPerYear(ruleSet, 'WEEKLY');

    expect(result.ok).toBe(false);
  });

  it('does not substitute the generic calendar count (52) when the state row states null', () => {
    const ruleSet = buildRuleSet({ [KEY]: availableEntry(KEY, COUNTS_DETAIL) });

    const result = resolveStatePayPeriodsPerYear(ruleSet, 'DAILY');

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    // Never 52, 26, 24, 12, 4 or 1 — no calendar fact stands in for absent rule data.
    expect(result).not.toEqual({ ok: true, value: 1 });
  });

  it('does not substitute a generic count for a frequency the rule never lists', () => {
    const ruleSet = buildRuleSet({ [KEY]: availableEntry(KEY, COUNTS_DETAIL) });

    const result = resolveStatePayPeriodsPerYear(ruleSet, 'QUARTERLY');

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result).not.toEqual({ ok: true, value: 4 });
  });
});

describe('purity', () => {
  it('does not mutate the supplied ResolvedStateRuleSet', () => {
    const entry = availableEntry(KEY, COUNTS_DETAIL);
    const ruleSet = buildRuleSet({ [KEY]: entry });

    const before = stateRule(ruleSet, KEY);
    resolveStatePayPeriodsPerYear(ruleSet, 'WEEKLY');
    const after = stateRule(ruleSet, KEY);

    expect(after).toBe(before);
    if (!after.available) throw new Error('expected available');
    expect(after.rule.reference).toEqual(entry.rule.reference);
    expect(Object.isFrozen(ruleSet)).toBe(true);
  });

  it('is synchronous — no awaited call, no Promise return', () => {
    const ruleSet = buildRuleSet({ [KEY]: availableEntry(KEY, COUNTS_DETAIL) });
    const result = resolveStatePayPeriodsPerYear(ruleSet, 'WEEKLY');
    expect(result).not.toBeInstanceOf(Promise);
  });
});

describe('no forbidden dependencies', () => {
  it('imports no generic pay-frequency module, federal module, Prisma, or state pipeline module beyond read-detail/stateRuleSet/detailSchemas/ruleKeys/stateErrors', async () => {
    const fs = await import('node:fs');
    const source = fs.readFileSync(
      new URL('../../lib/tax/state/rules/withholdingPayPeriods.ts', import.meta.url),
      'utf8',
    );
    const importLines = source
      .split('\n')
      .filter((line) => /^import\b/.test(line.trim()))
      .join('\n');
    expect(importLines).not.toMatch(/lib\/calculator\/pipeline\/pay-frequency/);
    expect(importLines).not.toMatch(/tax\/federal/);
    expect(importLines).not.toMatch(/getPrisma|PrismaClient|from '@\/lib\/db\//);
    expect(importLines).not.toMatch(/candidateRetrieval|resolveCandidates|assembleStateRuleSet/);
    expect(importLines).not.toMatch(/coverageGate/);
    expect(importLines).not.toMatch(/from '@\/lib\/rules\/resolution'/);
    expect(importLines).not.toMatch(/from '@\/lib\/jurisdictions\/repository'/);
    expect(importLines).not.toMatch(/lib\/calculator\/(?!types)/);
  });

  it('performs no formula interpretation, table selection, or tax calculation', async () => {
    const fs = await import('node:fs');
    const source = fs
      .readFileSync(
        new URL('../../lib/tax/state/rules/withholdingPayPeriods.ts', import.meta.url),
        'utf8',
      )
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    expect(source).not.toMatch(/\bsubtract\(|\bsum\(|\bmultiply\(|\bmoney\(|\bdivide\(/);
    expect(source).not.toMatch(/ANNUALIZE|DEANNUALIZE|WITHHOLDING_TABLE|WITHHOLDING_FORMULA/);
  });
});

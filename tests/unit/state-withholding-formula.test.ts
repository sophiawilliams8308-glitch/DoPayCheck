import { describe, expect, it } from 'vitest';

import type { RuleReference } from '@/lib/calculator/types/rules';
import { readWithholdingFormula } from '@/lib/tax/state/rules/withholdingFormula';
import {
  freezeStateRuleSet,
  stateRule,
  type ResolvedStateRule,
  type ResolvedStateRuleSet,
  type StateRuleEntry,
} from '@/lib/tax/state/rules/stateRuleSet';
import { StateRuleKey } from '@/lib/tax/state/ruleKeys';

/**
 * State withholding-formula reader (Task 4O-1).
 *
 * ===========================================================================
 * SCOPE NOTE — this tests the READER ONLY.
 *
 * Formula interpretation, operand resolution, operand vocabulary, step
 * sequencing validation, filing-status resolution, annualization/
 * deannualization, periods-per-year resolution, rounding, and any tax
 * arithmetic are NOT implemented and therefore not tested here — see
 * `withholdingFormula.ts`'s own doc comment and the Task 4O contract audit.
 * These tests cover exactly what IS implemented: reading and
 * exact-preserving the whole resolvable `WITHHOLDING_FORMULA` rule.
 * ===========================================================================
 *
 * Fixtures use RESERVED TEST jurisdiction/source ids and no real tax value.
 */

const JURISDICTION_CODE = 'TEST-WITHHOLDING-FORMULA';
const JURISDICTION_ID = 'test-withholding-formula-jurisdiction-id';
const TAX_YEAR = 2099;
const EFFECTIVE = '2099-06-15T00:00:00.000Z';
const KEY = StateRuleKey.WITHHOLDING_FORMULA;

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

function formulaDetail(steps: readonly Record<string, unknown>[]): Record<string, unknown> {
  return { shape: 'FORMULA_STEPS', steps };
}

const VALID_STEPS = [
  { ordinal: 0, operation: 'SUBTRACT_STANDARD_DEDUCTION', operandRef: null, note: null },
  { ordinal: 1, operation: 'FLOOR_AT_ZERO', operandRef: null, note: null },
  {
    ordinal: 2,
    operation: 'APPLY_BRACKETS',
    operandRef: StateRuleKey.PIT_RATE_BRACKETS,
    note: 'Reuses the annual bracket schedule',
  },
];

describe('readWithholdingFormula — valid formula', () => {
  it('returns OK and preserves the full detail exactly', () => {
    const detail = formulaDetail(VALID_STEPS);
    const ruleSet = buildRuleSet({ [KEY]: availableEntry(KEY, detail) });

    const result = readWithholdingFormula(ruleSet);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.value).toEqual(detail);
  });

  it('preserves multiple steps exactly, in the supplied order', () => {
    const ruleSet = buildRuleSet({ [KEY]: availableEntry(KEY, formulaDetail(VALID_STEPS)) });

    const result = readWithholdingFormula(ruleSet);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.value.steps).toHaveLength(3);
    expect(result.value.steps.map((step) => step.ordinal)).toEqual([0, 1, 2]);
  });

  it('preserves ordinal values exactly', () => {
    const ruleSet = buildRuleSet({ [KEY]: availableEntry(KEY, formulaDetail(VALID_STEPS)) });

    const result = readWithholdingFormula(ruleSet);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.value.steps[2]?.ordinal).toBe(2);
  });

  it('preserves operation values exactly', () => {
    const ruleSet = buildRuleSet({ [KEY]: availableEntry(KEY, formulaDetail(VALID_STEPS)) });

    const result = readWithholdingFormula(ruleSet);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.value.steps.map((step) => step.operation)).toEqual([
      'SUBTRACT_STANDARD_DEDUCTION',
      'FLOOR_AT_ZERO',
      'APPLY_BRACKETS',
    ]);
  });

  it('preserves a non-null operandRef exactly', () => {
    const ruleSet = buildRuleSet({ [KEY]: availableEntry(KEY, formulaDetail(VALID_STEPS)) });

    const result = readWithholdingFormula(ruleSet);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.value.steps[2]?.operandRef).toBe(StateRuleKey.PIT_RATE_BRACKETS);
  });

  it('preserves a null operandRef exactly, never substituting a value', () => {
    const ruleSet = buildRuleSet({ [KEY]: availableEntry(KEY, formulaDetail(VALID_STEPS)) });

    const result = readWithholdingFormula(ruleSet);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.value.steps[0]?.operandRef).toBeNull();
  });

  it('preserves a non-null note exactly', () => {
    const ruleSet = buildRuleSet({ [KEY]: availableEntry(KEY, formulaDetail(VALID_STEPS)) });

    const result = readWithholdingFormula(ruleSet);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.value.steps[2]?.note).toBe('Reuses the annual bracket schedule');
  });

  it('preserves a null note exactly', () => {
    const ruleSet = buildRuleSet({ [KEY]: availableEntry(KEY, formulaDetail(VALID_STEPS)) });

    const result = readWithholdingFormula(ruleSet);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.value.steps[0]?.note).toBeNull();
  });

  it('returns OK with an empty steps array, following schema/readDetail semantics', () => {
    const ruleSet = buildRuleSet({ [KEY]: availableEntry(KEY, formulaDetail([])) });

    const result = readWithholdingFormula(ruleSet);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.value.steps).toEqual([]);
  });
});

describe('readWithholdingFormula — missing formula', () => {
  it('reports RULE_MISSING, delegated from readDetail()', () => {
    const ruleSet = buildRuleSet({});

    const result = readWithholdingFormula(ruleSet);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.problem.reason).toBe('RULE_MISSING');
    expect(result.problem.ruleKey).toBe(KEY);
  });
});

describe('readWithholdingFormula — unverified formula', () => {
  it('reports RULE_UNVERIFIED for a PENDING rule, never treating it as verified', () => {
    const ruleSet = buildRuleSet({
      [KEY]: availableEntry(KEY, formulaDetail(VALID_STEPS), { verificationStatus: 'PENDING' }),
    });

    const result = readWithholdingFormula(ruleSet);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.problem.reason).toBe('RULE_UNVERIFIED');
  });
});

describe('readWithholdingFormula — invalid formula detail', () => {
  it('reports RULE_DETAIL_INVALID for an operation outside the closed enum', () => {
    const detail = formulaDetail([
      { ordinal: 0, operation: 'wages * 0.05', operandRef: null, note: null },
    ]);
    const ruleSet = buildRuleSet({ [KEY]: availableEntry(KEY, detail) });

    const result = readWithholdingFormula(ruleSet);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.problem.reason).toBe('RULE_DETAIL_INVALID');
  });

  it('reports RULE_DETAIL_INVALID for a detail shape mismatched to this rule key', () => {
    const detail = {
      shape: 'WAGE_BASE',
      amount: '1000',
      basis: 'ANNUAL',
      applicability: 'APPLIES',
    };
    const ruleSet = buildRuleSet({ [KEY]: availableEntry(KEY, detail) });

    const result = readWithholdingFormula(ruleSet);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.problem.reason).toBe('RULE_DETAIL_INVALID');
  });
});

describe('readWithholdingFormula — delegation to readDetail()', () => {
  it('treats NOT_APPLICABLE as usable, exactly as readDetail() does for every rule key', () => {
    const ruleSet = buildRuleSet({
      [KEY]: availableEntry(KEY, formulaDetail([]), { verificationStatus: 'NOT_APPLICABLE' }),
    });

    const result = readWithholdingFormula(ruleSet);

    expect(result.ok).toBe(true);
  });

  it('produces the identical problem readDetail() itself would for the same input', () => {
    const ruleSet = buildRuleSet({});

    const result = readWithholdingFormula(ruleSet);
    const direct = stateRule(ruleSet, KEY);

    expect(result.ok).toBe(false);
    if (result.ok || direct.available) throw new Error('expected both to report unavailable');
    expect(result.problem).toEqual(direct.problem);
  });
});

describe('purity', () => {
  it('does not mutate the supplied ResolvedStateRuleSet', () => {
    const entry = availableEntry(KEY, formulaDetail(VALID_STEPS));
    const ruleSet = buildRuleSet({ [KEY]: entry });

    const before = stateRule(ruleSet, KEY);
    readWithholdingFormula(ruleSet);
    const after = stateRule(ruleSet, KEY);

    expect(after).toBe(before);
    if (!after.available) throw new Error('expected available');
    expect(after.rule.reference).toEqual(entry.rule.reference);
    expect(Object.isFrozen(ruleSet)).toBe(true);
  });

  it('is synchronous — no awaited call, no Promise return', () => {
    const ruleSet = buildRuleSet({ [KEY]: availableEntry(KEY, formulaDetail(VALID_STEPS)) });
    const result = readWithholdingFormula(ruleSet);
    expect(result).not.toBeInstanceOf(Promise);
  });
});

describe('no forbidden responsibilities', () => {
  it('imports no database client, Prisma, resolver, calculator, federal, or interpreter module beyond read-detail/stateRuleSet/detailSchemas/ruleKeys', async () => {
    const fs = await import('node:fs');
    const source = fs.readFileSync(
      new URL('../../lib/tax/state/rules/withholdingFormula.ts', import.meta.url),
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
    expect(importLines).not.toMatch(/lib\/calculator/);
    expect(importLines).not.toMatch(
      /withholdingTable|withholdingPayPeriods|withholdingFilingStatusMap|withholdingRoundingPolicy/,
    );
  });

  it('performs no formula execution, sorting, or deduplication', async () => {
    const fs = await import('node:fs');
    const source = fs
      .readFileSync(
        new URL('../../lib/tax/state/rules/withholdingFormula.ts', import.meta.url),
        'utf8',
      )
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    expect(source).not.toMatch(/\bsubtract\(|\bsum\(|\bmultiply\(|\bmoney\(|\bdivide\(/);
    expect(source).not.toMatch(/\.sort\(|\.filter\(|\.reduce\(/);
    expect(source.match(/^export function/gm)).toEqual(['export function']);
  });
});

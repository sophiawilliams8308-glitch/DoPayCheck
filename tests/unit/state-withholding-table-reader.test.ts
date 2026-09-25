import { describe, expect, it } from 'vitest';

import type { RuleReference } from '@/lib/calculator/types/rules';
import { readWithholdingTable } from '@/lib/tax/state/rules/withholdingTableReader';
import {
  freezeStateRuleSet,
  stateRule,
  type ResolvedStateRule,
  type ResolvedStateRuleSet,
  type StateRuleEntry,
} from '@/lib/tax/state/rules/stateRuleSet';
import { StateRuleKey } from '@/lib/tax/state/ruleKeys';

/**
 * State withholding-table reader (DM-03 Slice 18).
 *
 * ===========================================================================
 * SCOPE NOTE — this tests the READER ONLY.
 *
 * Row selection (`selectStateWithholdingTableRow()`,
 * `tests/unit/state-withholding-table.test.ts`, Task 4N-R) and any
 * post-selection arithmetic are NOT implemented and therefore not tested
 * here — see `withholdingTableReader.ts`'s own doc comment. These tests
 * cover exactly what IS implemented: reading and exact-preserving the one
 * resolvable `WITHHOLDING_TABLE` rule.
 * ===========================================================================
 *
 * Fixtures use RESERVED TEST jurisdiction/source ids and no real tax value.
 */

const JURISDICTION_CODE = 'TEST-WITHHOLDING-TABLE-READER';
const JURISDICTION_ID = 'test-withholding-table-reader-jurisdiction-id';
const TAX_YEAR = 2099;
const EFFECTIVE = '2099-06-15T00:00:00.000Z';
const KEY = StateRuleKey.WITHHOLDING_TABLE;

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

function tableRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ordinal: 0,
    filingStatus: 'SINGLE',
    payFrequency: 'BIWEEKLY',
    wageFrom: '0',
    wageTo: null,
    baseWithholding: '0',
    rate: '0.05',
    unit: 'DECIMAL_FRACTION',
    ...overrides,
  };
}

function tableDetail(rows: Record<string, unknown>[] = [tableRow()]): Record<string, unknown> {
  return {
    shape: 'WITHHOLDING_TABLE',
    tableCode: 'SYNTHETIC-TABLE-1',
    method: 'Synthetic percentage method',
    rows,
  };
}

describe('readWithholdingTable — valid detail', () => {
  it('returns OK and preserves the full detail exactly', () => {
    const detail = tableDetail();
    const ruleSet = buildRuleSet({ [KEY]: availableEntry(KEY, detail) });

    const result = readWithholdingTable(ruleSet);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.value).toEqual(detail);
  });

  it('preserves tableCode and method independently, not just rows', () => {
    const detail = tableDetail();
    const ruleSet = buildRuleSet({ [KEY]: availableEntry(KEY, detail) });

    const result = readWithholdingTable(ruleSet);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.value.tableCode).toBe('SYNTHETIC-TABLE-1');
    expect(result.value.method).toBe('Synthetic percentage method');
  });

  it('preserves a representative row exactly, field by field', () => {
    const row = tableRow({
      ordinal: 3,
      filingStatus: 'MARRIED_JOINT',
      payFrequency: 'MONTHLY',
      wageFrom: '1000',
      wageTo: '2000',
      baseWithholding: '42.50',
      rate: '0.0625',
      unit: 'PERCENT',
    });
    const detail = tableDetail([row]);
    const ruleSet = buildRuleSet({ [KEY]: availableEntry(KEY, detail) });

    const result = readWithholdingTable(ruleSet);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.value.rows).toHaveLength(1);
    expect(result.value.rows[0]).toEqual(row);
  });

  it('accepts an empty rows array — the schema places no minimum length on rows', () => {
    const detail = tableDetail([]);
    const ruleSet = buildRuleSet({ [KEY]: availableEntry(KEY, detail) });

    const result = readWithholdingTable(ruleSet);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.value.rows).toEqual([]);
  });

  it('preserves multiple rows in their original order', () => {
    const rowA = tableRow({ ordinal: 0, wageFrom: '0', wageTo: '1000' });
    const rowB = tableRow({ ordinal: 1, wageFrom: '1000', wageTo: null });
    const detail = tableDetail([rowA, rowB]);
    const ruleSet = buildRuleSet({ [KEY]: availableEntry(KEY, detail) });

    const result = readWithholdingTable(ruleSet);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.value.rows).toEqual([rowA, rowB]);
  });

  it('preserves a null wageTo, baseWithholding, and rate exactly, never substituting zero', () => {
    const row = tableRow({ wageTo: null, baseWithholding: null, rate: null });
    const detail = tableDetail([row]);
    const ruleSet = buildRuleSet({ [KEY]: availableEntry(KEY, detail) });

    const result = readWithholdingTable(ruleSet);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.value.rows[0]?.wageTo).toBeNull();
    expect(result.value.rows[0]?.baseWithholding).toBeNull();
    expect(result.value.rows[0]?.rate).toBeNull();
  });
});

describe('readWithholdingTable — missing table', () => {
  it('reports RULE_MISSING, never assuming a table', () => {
    const ruleSet = buildRuleSet({});

    const result = readWithholdingTable(ruleSet);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.problem.reason).toBe('RULE_MISSING');
    expect(result.problem.ruleKey).toBe(KEY);
  });
});

describe('readWithholdingTable — invalid table', () => {
  it('reports RULE_DETAIL_INVALID for a missing required field', () => {
    const { tableCode: _tableCode, ...rest } = tableDetail();
    const ruleSet = buildRuleSet({ [KEY]: availableEntry(KEY, rest) });

    const result = readWithholdingTable(ruleSet);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.problem.reason).toBe('RULE_DETAIL_INVALID');
  });

  it('reports RULE_DETAIL_INVALID for a row missing a required field', () => {
    const { ordinal: _ordinal, ...restOfRow } = tableRow();
    const detail = tableDetail([restOfRow]);
    const ruleSet = buildRuleSet({ [KEY]: availableEntry(KEY, detail) });

    const result = readWithholdingTable(ruleSet);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.problem.reason).toBe('RULE_DETAIL_INVALID');
  });

  it('reports RULE_DETAIL_INVALID for an out-of-vocabulary payFrequency', () => {
    const detail = tableDetail([tableRow({ payFrequency: 'MYSTERY' })]);
    const ruleSet = buildRuleSet({ [KEY]: availableEntry(KEY, detail) });

    const result = readWithholdingTable(ruleSet);

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

    const result = readWithholdingTable(ruleSet);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.problem.reason).toBe('RULE_DETAIL_INVALID');
  });
});

describe('readWithholdingTable — unverified table', () => {
  it('reports RULE_UNVERIFIED for a PENDING rule, never treating it as verified', () => {
    const ruleSet = buildRuleSet({
      [KEY]: availableEntry(KEY, tableDetail(), { verificationStatus: 'PENDING' }),
    });

    const result = readWithholdingTable(ruleSet);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.problem.reason).toBe('RULE_UNVERIFIED');
  });

  it('checks verification before schema validity, identical to read-detail.ts ordering', () => {
    const malformed = { shape: 'WITHHOLDING_TABLE' };
    const ruleSet = buildRuleSet({
      [KEY]: availableEntry(KEY, malformed, { verificationStatus: 'CONFLICT' }),
    });

    const result = readWithholdingTable(ruleSet);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.problem.reason).toBe('RULE_UNVERIFIED');
  });
});

describe('readWithholdingTable — delegation to readDetail()', () => {
  it('treats NOT_APPLICABLE as usable, exactly as readDetail() does for every rule key', () => {
    const ruleSet = buildRuleSet({
      [KEY]: availableEntry(KEY, tableDetail(), { verificationStatus: 'NOT_APPLICABLE' }),
    });

    const result = readWithholdingTable(ruleSet);

    expect(result.ok).toBe(true);
  });

  it('produces the identical problem readDetail() itself would for the same input', () => {
    const ruleSet = buildRuleSet({});

    const result = readWithholdingTable(ruleSet);
    const direct = stateRule(ruleSet, KEY);

    expect(result.ok).toBe(false);
    if (result.ok || direct.available) throw new Error('expected both to report unavailable');
    expect(result.problem).toEqual(direct.problem);
  });
});

describe('purity', () => {
  it('does not mutate the supplied ResolvedStateRuleSet', () => {
    const entry = availableEntry(KEY, tableDetail());
    const ruleSet = buildRuleSet({ [KEY]: entry });

    const before = stateRule(ruleSet, KEY);
    readWithholdingTable(ruleSet);
    const after = stateRule(ruleSet, KEY);

    expect(after).toBe(before);
    if (!after.available) throw new Error('expected available');
    expect(after.rule.reference).toEqual(entry.rule.reference);
    expect(Object.isFrozen(ruleSet)).toBe(true);
  });

  it('is synchronous — no awaited call, no Promise return', () => {
    const ruleSet = buildRuleSet({ [KEY]: availableEntry(KEY, tableDetail()) });
    const result = readWithholdingTable(ruleSet);
    expect(result).not.toBeInstanceOf(Promise);
  });
});

describe('no forbidden responsibilities', () => {
  it('imports no database client, Prisma, or state pipeline module beyond read-detail/stateRuleSet/detailSchemas/ruleKeys', async () => {
    const fs = await import('node:fs');
    const source = fs.readFileSync(
      new URL('../../lib/tax/state/rules/withholdingTableReader.ts', import.meta.url),
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
    expect(importLines).not.toMatch(/from '.\/withholdingTable'/);
    expect(importLines).not.toMatch(/withholdingMethodology/);
  });

  it('performs no row selection, arithmetic, or tax calculation', async () => {
    const fs = await import('node:fs');
    const source = fs
      .readFileSync(
        new URL('../../lib/tax/state/rules/withholdingTableReader.ts', import.meta.url),
        'utf8',
      )
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    expect(source).not.toMatch(/\bsubtract\(|\bsum\(|\bmultiply\(|\bmoney\(|\bcompare\(/);
    expect(source).not.toMatch(/selectStateWithholdingTableRow/);
    expect(source).not.toMatch(/switch\s*\(|filingStatus\s*===|payFrequency\s*===/);
    expect(source).not.toMatch(/\b\d+\.\d+\b/);
  });
});

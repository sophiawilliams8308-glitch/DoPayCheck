import { describe, expect, it } from 'vitest';

import type { RuleReference } from '@/lib/calculator/types/rules';
import { readWithholdingFilingStatusMap } from '@/lib/tax/state/rules/withholdingFilingStatusMap';
import {
  freezeStateRuleSet,
  stateRule,
  type ResolvedStateRule,
  type ResolvedStateRuleSet,
  type StateRuleEntry,
} from '@/lib/tax/state/rules/stateRuleSet';
import { StateRuleKey } from '@/lib/tax/state/ruleKeys';

/**
 * State withholding filing-status-map reader (Task 4L).
 *
 * ===========================================================================
 * SCOPE NOTE — this tests the READER ONLY.
 *
 * Whether a future TABLE or FORMULA implementation should look up a status
 * through this map, or whether raw context filing status is used directly,
 * is NOT implemented and therefore not tested here — see
 * `withholdingFilingStatusMap.ts`'s own doc comment. These tests cover
 * exactly what IS implemented: reading and exact-preserving the whole
 * resolvable `WITHHOLDING_FILING_STATUS_MAP` rule, with no lookup, no
 * mapping, and no context interaction of any kind.
 * ===========================================================================
 *
 * Fixtures use RESERVED TEST jurisdiction/source ids and no real tax value.
 */

const JURISDICTION_CODE = 'TEST-FILING-STATUS-MAP';
const JURISDICTION_ID = 'test-filing-status-map-jurisdiction-id';
const TAX_YEAR = 2099;
const EFFECTIVE = '2099-06-15T00:00:00.000Z';
const KEY = StateRuleKey.WITHHOLDING_FILING_STATUS_MAP;

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

function mapDetail(entries: readonly Record<string, unknown>[]): Record<string, unknown> {
  return { shape: 'FILING_STATUS_MAP', entries };
}

const VALID_ENTRIES = [
  { stateFilingStatus: 'S', federalFilingStatus: 'SINGLE_OR_MFS', availableOnStateForm: true },
  {
    stateFilingStatus: 'MJ',
    federalFilingStatus: 'MARRIED_FILING_JOINTLY',
    availableOnStateForm: true,
  },
  {
    stateFilingStatus: 'HOH',
    federalFilingStatus: 'HEAD_OF_HOUSEHOLD',
    availableOnStateForm: false,
  },
];

describe('readWithholdingFilingStatusMap — valid map', () => {
  it('returns OK and preserves every entry exactly, in order', () => {
    const detail = mapDetail(VALID_ENTRIES);
    const ruleSet = buildRuleSet({ [KEY]: availableEntry(KEY, detail) });

    const result = readWithholdingFilingStatusMap(ruleSet);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.value).toEqual(detail);
    expect(result.value.entries.map((e) => e.stateFilingStatus)).toEqual(['S', 'MJ', 'HOH']);
  });
});

describe('readWithholdingFilingStatusMap — multiple mappings', () => {
  it('preserves the complete array without filtering, sorting, or deduplicating', () => {
    const detail = mapDetail(VALID_ENTRIES);
    const ruleSet = buildRuleSet({ [KEY]: availableEntry(KEY, detail) });

    const result = readWithholdingFilingStatusMap(ruleSet);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.value.entries).toHaveLength(3);
    expect(result.value.entries).toEqual(VALID_ENTRIES);
  });
});

describe('readWithholdingFilingStatusMap — NOT_STATED', () => {
  it('preserves federalFilingStatus of NOT_STATED exactly, never converting it', () => {
    const entries = [
      { stateFilingStatus: 'X', federalFilingStatus: 'NOT_STATED', availableOnStateForm: true },
    ];
    const ruleSet = buildRuleSet({ [KEY]: availableEntry(KEY, mapDetail(entries)) });

    const result = readWithholdingFilingStatusMap(ruleSet);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.value.entries[0]?.federalFilingStatus).toBe('NOT_STATED');
  });
});

describe('readWithholdingFilingStatusMap — availableOnStateForm', () => {
  it('preserves both true and false exactly', () => {
    const entries = [
      { stateFilingStatus: 'A', federalFilingStatus: 'SINGLE_OR_MFS', availableOnStateForm: true },
      { stateFilingStatus: 'B', federalFilingStatus: 'SINGLE_OR_MFS', availableOnStateForm: false },
    ];
    const ruleSet = buildRuleSet({ [KEY]: availableEntry(KEY, mapDetail(entries)) });

    const result = readWithholdingFilingStatusMap(ruleSet);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.value.entries[0]?.availableOnStateForm).toBe(true);
    expect(result.value.entries[1]?.availableOnStateForm).toBe(false);
  });
});

describe('readWithholdingFilingStatusMap — empty entries', () => {
  it('returns OK with an empty array, never RULE_MISSING or SCENARIO_UNSUPPORTED', () => {
    const ruleSet = buildRuleSet({ [KEY]: availableEntry(KEY, mapDetail([])) });

    const result = readWithholdingFilingStatusMap(ruleSet);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.value.entries).toEqual([]);
  });
});

describe('readWithholdingFilingStatusMap — missing rule', () => {
  it('reports RULE_MISSING, delegated from readDetail()', () => {
    const ruleSet = buildRuleSet({});

    const result = readWithholdingFilingStatusMap(ruleSet);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.problem.reason).toBe('RULE_MISSING');
    expect(result.problem.ruleKey).toBe(KEY);
  });
});

describe('readWithholdingFilingStatusMap — unverified rule', () => {
  it('reports RULE_UNVERIFIED for a PENDING rule, never treating it as verified', () => {
    const ruleSet = buildRuleSet({
      [KEY]: availableEntry(KEY, mapDetail(VALID_ENTRIES), { verificationStatus: 'PENDING' }),
    });

    const result = readWithholdingFilingStatusMap(ruleSet);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.problem.reason).toBe('RULE_UNVERIFIED');
  });
});

describe('readWithholdingFilingStatusMap — invalid detail', () => {
  it('reports RULE_DETAIL_INVALID for a federalFilingStatus value outside the schema enum', () => {
    const entries = [
      { stateFilingStatus: 'S', federalFilingStatus: 'MYSTERY', availableOnStateForm: true },
    ];
    const ruleSet = buildRuleSet({ [KEY]: availableEntry(KEY, mapDetail(entries)) });

    const result = readWithholdingFilingStatusMap(ruleSet);

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

    const result = readWithholdingFilingStatusMap(ruleSet);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.problem.reason).toBe('RULE_DETAIL_INVALID');
  });
});

describe('purity', () => {
  it('does not mutate the supplied ResolvedStateRuleSet or its detail', () => {
    const detail = mapDetail(VALID_ENTRIES);
    const entry = availableEntry(KEY, detail);
    const ruleSet = buildRuleSet({ [KEY]: entry });

    const before = stateRule(ruleSet, KEY);
    const detailSnapshotBefore = JSON.stringify(detail);
    const result = readWithholdingFilingStatusMap(ruleSet);
    const after = stateRule(ruleSet, KEY);

    expect(after).toBe(before);
    if (!after.available) throw new Error('expected available');
    expect(after.rule.reference).toEqual(entry.rule.reference);
    expect(Object.isFrozen(ruleSet)).toBe(true);
    expect(JSON.stringify(detail)).toBe(detailSnapshotBefore);
    if (result.ok) {
      expect(JSON.stringify(result.value)).toBe(detailSnapshotBefore);
    }
  });

  it('is synchronous — no awaited call, no Promise return', () => {
    const ruleSet = buildRuleSet({ [KEY]: availableEntry(KEY, mapDetail(VALID_ENTRIES)) });
    const result = readWithholdingFilingStatusMap(ruleSet);
    expect(result).not.toBeInstanceOf(Promise);
  });
});

describe('no forbidden dependencies or consumer logic', () => {
  it('imports no calculator, federal, database, or state pipeline module beyond read-detail/stateRuleSet/detailSchemas/ruleKeys', async () => {
    const fs = await import('node:fs');
    const source = fs.readFileSync(
      new URL('../../lib/tax/state/rules/withholdingFilingStatusMap.ts', import.meta.url),
      'utf8',
    );
    const importLines = source
      .split('\n')
      .filter((line) => /^import\b/.test(line.trim()))
      .join('\n');
    expect(importLines).not.toMatch(/lib\/calculator/);
    expect(importLines).not.toMatch(/tax\/federal/);
    expect(importLines).not.toMatch(/getPrisma|PrismaClient|from '@\/lib\/db\//);
    expect(importLines).not.toMatch(/candidateRetrieval|resolveCandidates|assembleStateRuleSet/);
    expect(importLines).not.toMatch(/coverageGate/);
    expect(importLines).not.toMatch(/from '@\/lib\/rules\/resolution'/);
    expect(importLines).not.toMatch(/from '@\/lib\/jurisdictions\/repository'/);
  });

  it('contains no lookup/mapping/normalization function, only the reader', async () => {
    const fs = await import('node:fs');
    const source = fs
      .readFileSync(
        new URL('../../lib/tax/state/rules/withholdingFilingStatusMap.ts', import.meta.url),
        'utf8',
      )
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    expect(source).not.toMatch(
      /\b(lookupFilingStatus|mapFilingStatus|resolveFilingStatus|normalizeFilingStatus|toFederalFilingStatus)\b/,
    );
    expect(source.match(/^export function/gm)).toEqual(['export function']);
    expect(source).not.toMatch(/\.find\(|\.filter\(|\.sort\(|\.map\(/);
  });
});

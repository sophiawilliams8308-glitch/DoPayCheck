import { describe, expect, it } from 'vitest';

import { RoundingMode } from '@/lib/core/money';
import type { RuleReference } from '@/lib/calculator/types/rules';
import { readWithholdingRoundingPolicy } from '@/lib/tax/state/rules/withholdingRoundingPolicy';
import {
  freezeStateRuleSet,
  stateRule,
  type ResolvedStateRule,
  type ResolvedStateRuleSet,
  type StateRuleEntry,
} from '@/lib/tax/state/rules/stateRuleSet';
import { StateRuleKey } from '@/lib/tax/state/ruleKeys';

/**
 * State withholding rounding-policy reader.
 *
 * Fixtures use RESERVED TEST jurisdiction/source ids and no real tax value.
 * `readWithholdingRoundingPolicy` delegates existence/verification/schema
 * handling entirely to `read-detail.ts` — these tests prove that delegation
 * holds for this specific rule key, plus the one thing this module actually
 * adds: mapping the schema onto `StateRoundingPolicy`.
 */

const JURISDICTION_CODE = 'TEST-ROUNDING-POLICY';
const JURISDICTION_ID = 'test-rounding-policy-jurisdiction-id';
const TAX_YEAR = 2099;
const EFFECTIVE = '2099-06-15T00:00:00.000Z';
const KEY = StateRuleKey.WITHHOLDING_ROUNDING_POLICY;

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

const VALID_POLICY_DETAIL = {
  shape: 'ROUNDING_POLICY',
  policyId: 'test-policy-1',
  currencyScale: 2,
  currencyMode: 'HALF_UP',
  intermediateScale: 10,
  appliedAt: 'TAX_LEVEL',
  mandatedBySource: false,
};

describe('readWithholdingRoundingPolicy — valid policy', () => {
  it('returns the policy with currencyMode mapped to the generic RoundingMode enum', () => {
    const ruleSet = buildRuleSet({ [KEY]: availableEntry(KEY, VALID_POLICY_DETAIL) });

    const result = readWithholdingRoundingPolicy(ruleSet);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.value).toEqual({
      policyId: 'test-policy-1',
      currencyScale: 2,
      currencyMode: RoundingMode.HALF_UP,
      intermediateScale: 10,
      appliedAt: 'TAX_LEVEL',
      mandatedBySource: false,
    });
  });

  it('maps every currencyMode value the schema defines, not just HALF_UP', () => {
    const cases: readonly ['HALF_UP' | 'HALF_EVEN' | 'DOWN' | 'UP', RoundingMode][] = [
      ['HALF_UP', RoundingMode.HALF_UP],
      ['HALF_EVEN', RoundingMode.HALF_EVEN],
      ['DOWN', RoundingMode.DOWN],
      ['UP', RoundingMode.UP],
    ];

    for (const [currencyMode, expected] of cases) {
      const ruleSet = buildRuleSet({
        [KEY]: availableEntry(KEY, { ...VALID_POLICY_DETAIL, currencyMode }),
      });
      const result = readWithholdingRoundingPolicy(ruleSet);
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error('expected ok');
      expect(result.value.currencyMode).toBe(expected);
    }
  });

  it('exposes appliedAt: STEP_LEVEL exactly as stated, and a mandated policy exactly as stated', () => {
    const detail = { ...VALID_POLICY_DETAIL, appliedAt: 'STEP_LEVEL', mandatedBySource: true };
    const ruleSet = buildRuleSet({ [KEY]: availableEntry(KEY, detail) });

    const result = readWithholdingRoundingPolicy(ruleSet);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.value.appliedAt).toBe('STEP_LEVEL');
    expect(result.value.mandatedBySource).toBe(true);
  });
});

describe('readWithholdingRoundingPolicy — NOT_APPLICABLE verification', () => {
  it('accepts NOT_APPLICABLE as a usable verification status, consistent with read-detail.ts', () => {
    const ruleSet = buildRuleSet({
      [KEY]: availableEntry(KEY, VALID_POLICY_DETAIL, { verificationStatus: 'NOT_APPLICABLE' }),
    });

    const result = readWithholdingRoundingPolicy(ruleSet);

    expect(result.ok).toBe(true);
  });
});

describe('readWithholdingRoundingPolicy — missing rule', () => {
  it('reports RULE_MISSING when no policy is resolved, never assuming a rounding convention', () => {
    const ruleSet = buildRuleSet({});

    const result = readWithholdingRoundingPolicy(ruleSet);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.problem.reason).toBe('RULE_MISSING');
    expect(result.problem.ruleKey).toBe(KEY);
  });
});

describe('readWithholdingRoundingPolicy — invalid detail', () => {
  it('reports RULE_DETAIL_INVALID for a currencyMode value outside the schema enum', () => {
    const detail = { ...VALID_POLICY_DETAIL, currencyMode: 'NEAREST_NICKEL' };
    const ruleSet = buildRuleSet({ [KEY]: availableEntry(KEY, detail) });

    const result = readWithholdingRoundingPolicy(ruleSet);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.problem.reason).toBe('RULE_DETAIL_INVALID');
  });

  it('reports RULE_DETAIL_INVALID when a required field is missing', () => {
    const { policyId: _policyId, ...rest } = VALID_POLICY_DETAIL;
    const ruleSet = buildRuleSet({ [KEY]: availableEntry(KEY, rest) });

    const result = readWithholdingRoundingPolicy(ruleSet);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.problem.reason).toBe('RULE_DETAIL_INVALID');
  });

  it('reports RULE_DETAIL_INVALID for a detail shape mismatched to this rule key', () => {
    // A RATE-shaped payload stored under the ROUNDING_POLICY key.
    const detail = {
      shape: 'RATE',
      rate: '0.5',
      unit: 'PERCENT',
      appliesTo: 'EMPLOYEE',
      applicability: 'APPLIES',
    };
    const ruleSet = buildRuleSet({ [KEY]: availableEntry(KEY, detail) });

    const result = readWithholdingRoundingPolicy(ruleSet);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.problem.reason).toBe('RULE_DETAIL_INVALID');
  });
});

describe('readWithholdingRoundingPolicy — unverified rule', () => {
  it('reports RULE_UNVERIFIED for a PENDING rule, never treating it as verified', () => {
    const ruleSet = buildRuleSet({
      [KEY]: availableEntry(KEY, VALID_POLICY_DETAIL, { verificationStatus: 'PENDING' }),
    });

    const result = readWithholdingRoundingPolicy(ruleSet);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.problem.reason).toBe('RULE_UNVERIFIED');
  });

  it('checks verification before schema validity, identical to read-detail.ts ordering', () => {
    const malformed = { shape: 'ROUNDING_POLICY' };
    const ruleSet = buildRuleSet({
      [KEY]: availableEntry(KEY, malformed, { verificationStatus: 'CONFLICT' }),
    });

    const result = readWithholdingRoundingPolicy(ruleSet);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.problem.reason).toBe('RULE_UNVERIFIED');
  });
});

describe('exact policy preservation', () => {
  it('does not alter numeric scales, policyId, or mandatedBySource beyond the documented currencyMode mapping', () => {
    const detail = {
      shape: 'ROUNDING_POLICY',
      policyId: 'official-source-policy-42',
      currencyScale: 4,
      currencyMode: 'DOWN',
      intermediateScale: 16,
      appliedAt: 'STEP_LEVEL',
      mandatedBySource: true,
    };
    const ruleSet = buildRuleSet({ [KEY]: availableEntry(KEY, detail) });

    const result = readWithholdingRoundingPolicy(ruleSet);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.value.policyId).toBe('official-source-policy-42');
    expect(result.value.currencyScale).toBe(4);
    expect(result.value.intermediateScale).toBe(16);
    expect(result.value.mandatedBySource).toBe(true);
    expect(result.value.currencyMode).toBe(RoundingMode.DOWN);
  });
});

describe('purity', () => {
  it('does not mutate the supplied ResolvedStateRuleSet', () => {
    const entry = availableEntry(KEY, VALID_POLICY_DETAIL);
    const ruleSet = buildRuleSet({ [KEY]: entry });

    const before = stateRule(ruleSet, KEY);
    readWithholdingRoundingPolicy(ruleSet);
    const after = stateRule(ruleSet, KEY);

    expect(after).toBe(before);
    if (!after.available) throw new Error('expected available');
    expect(after.rule.reference).toEqual(entry.rule.reference);
    expect(Object.isFrozen(ruleSet)).toBe(true);
  });

  it('is synchronous — no awaited call, no Promise return', () => {
    const ruleSet = buildRuleSet({ [KEY]: availableEntry(KEY, VALID_POLICY_DETAIL) });
    const result = readWithholdingRoundingPolicy(ruleSet);
    expect(result).not.toBeInstanceOf(Promise);
  });
});

describe('no forbidden responsibilities', () => {
  it('imports no database client, Prisma, or state pipeline module beyond read-detail/stateRuleSet/detailSchemas', async () => {
    const fs = await import('node:fs');
    const source = fs.readFileSync(
      new URL('../../lib/tax/state/rules/withholdingRoundingPolicy.ts', import.meta.url),
      'utf8',
    );
    const importLines = source
      .split('\n')
      .filter((line) => /^import\b/.test(line.trim()))
      .join('\n');
    expect(importLines).not.toMatch(/getPrisma|PrismaClient|from '@\/lib\/db\//);
    expect(importLines).not.toMatch(/candidateRetrieval|resolveCandidates|assembleStateRuleSet/);
    expect(importLines).not.toMatch(/from '@\/lib\/rules\/resolution'/);
    expect(importLines).not.toMatch(/from '@\/lib\/jurisdictions\/repository'/);
    expect(importLines).not.toMatch(/tax\/federal/);
  });

  it('performs no tax calculation and touches no tax value', async () => {
    const fs = await import('node:fs');
    const source = fs
      .readFileSync(
        new URL('../../lib/tax/state/rules/withholdingRoundingPolicy.ts', import.meta.url),
        'utf8',
      )
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    expect(source).not.toMatch(/\b\d+\.\d+\b/);
    expect(source).not.toMatch(/\bround\(|\bmoney\(/);
  });
});

import { describe, expect, it } from 'vitest';

import type { ResolvableRule } from '@/lib/rules/resolution';
import {
  assembleStateRuleSet,
  type StateRuleSetAssemblyMetadata,
} from '@/lib/tax/state/rules/assembleStateRuleSet';
import type { StateResolvableRule } from '@/lib/tax/state/rules/candidateRetrieval';
import type {
  StateRuleResolution,
  StateRuleResolutionResult,
} from '@/lib/tax/state/rules/resolveCandidates';
import { StateRuleKey } from '@/lib/tax/state/ruleKeys';

/**
 * Step 3.7 — final assembly (`assembleStateRuleSet`).
 *
 * Fixtures use RESERVED TEST jurisdiction/source ids and no real tax value.
 * This suite's central purpose (Test 1) is proving the Step 3.5 provenance
 * fix actually survives all the way to the final `ResolvedStateRuleSet` — not
 * re-testing Step 3.5/3.6's own already-covered behavior.
 */

const JURISDICTION_ID = 'TEST-JURISDICTION-ID';
const JURISDICTION_CODE = 'US-TEST';
const CATEGORY = 'STATE_WITHHOLDING' as ResolvableRule['category'];

const METADATA: StateRuleSetAssemblyMetadata = {
  taxYear: 2099,
  effectiveDate: '2099-06-15T00:00:00.000Z',
  jurisdictionCode: JURISDICTION_CODE,
  engineVersion: 'test-engine-1.0.0',
  resolvedAt: '2099-06-15T12:00:00.000Z',
};

function candidate(overrides: Partial<StateResolvableRule> = {}): StateResolvableRule {
  return {
    id: 'rule-1',
    ruleKey: StateRuleKey.WITHHOLDING_METHOD,
    version: 1,
    category: CATEGORY,
    jurisdictionId: JURISDICTION_ID,
    jurisdictionCode: JURISDICTION_CODE,
    taxYear: 2099,
    status: 'ACTIVE',
    effectiveFrom: new Date('2099-01-01T00:00:00.000Z'),
    effectiveTo: null,
    sourceIds: ['source-1'],
    verified: true,
    detail: { note: 'fixture-detail' },
    verificationStatus: 'VERIFIED',
    ...overrides,
  };
}

function resolved(rule: StateResolvableRule): StateRuleResolution {
  return { ruleKey: rule.ruleKey as StateRuleKey, status: 'RESOLVED', rule };
}

function notFound(
  ruleKey: StateRuleKey,
  reason = `No candidates were retrieved for ${ruleKey}`,
): StateRuleResolution {
  return { ruleKey, status: 'NOT_FOUND', reason };
}

function ambiguous(
  ruleKey: StateRuleKey,
  candidates: readonly StateResolvableRule[],
): StateRuleResolution {
  return { ruleKey, status: 'AMBIGUOUS', candidates };
}

function result(...results: readonly StateRuleResolution[]): StateRuleResolutionResult {
  return { results };
}

describe('Test 1 — RESOLVED with provenance survives to the final rule set', () => {
  it('preserves jurisdictionCode, sourceIds, verified, detail and verificationStatus', () => {
    const rule = candidate({
      id: 'rule-provenance',
      ruleKey: StateRuleKey.PIT_RATE_BRACKETS,
      jurisdictionCode: JURISDICTION_CODE,
      sourceIds: ['source-a', 'source-b'],
      verified: true,
      detail: { brackets: [{ rate: '0.05' }] },
      verificationStatus: 'VERIFIED',
    });

    const ruleSet = assembleStateRuleSet(result(resolved(rule)), METADATA);
    const entry = ruleSet.entries[StateRuleKey.PIT_RATE_BRACKETS];

    expect(entry?.available).toBe(true);
    if (entry?.available !== true) throw new Error('expected available entry');
    expect(entry.rule.key).toBe(StateRuleKey.PIT_RATE_BRACKETS);
    expect(entry.rule.reference.jurisdictionCode).toBe(JURISDICTION_CODE);
    expect(entry.rule.reference.sourceIds).toEqual(['source-a', 'source-b']);
    expect(entry.rule.reference.verified).toBe(true);
    expect(entry.rule.detail).toEqual({ brackets: [{ rate: '0.05' }] });
    expect(entry.rule.verificationStatus).toBe('VERIFIED');
    // Also on the reference itself, and in the deduplicated top-level fields.
    expect(entry.rule.reference.ruleId).toBe('rule-provenance');
    expect(entry.rule.reference.version).toBe(1);
    expect(entry.rule.reference.category).toBe(CATEGORY);
    expect(entry.rule.reference.taxYear).toBe(2099);
    expect(entry.rule.reference.jurisdictionId).toBe(JURISDICTION_ID);
    expect(ruleSet.ruleReferences).toEqual([entry.rule.reference]);
    expect(ruleSet.sourceIds).toEqual(['source-a', 'source-b']);
  });
});

describe('Test 2 — NOT_FOUND', () => {
  it('reports available: false, RULE_MISSING, and preserves the rule key', () => {
    const ruleSet = assembleStateRuleSet(result(notFound(StateRuleKey.PFML_WAGE_BASE)), METADATA);
    const entry = ruleSet.entries[StateRuleKey.PFML_WAGE_BASE];

    expect(entry?.available).toBe(false);
    if (entry?.available !== false) throw new Error('expected unavailable entry');
    expect(entry.problem.reason).toBe('RULE_MISSING');
    expect(entry.problem.ruleKey).toBe(StateRuleKey.PFML_WAGE_BASE);
  });
});

describe('Test 3 — AMBIGUOUS', () => {
  it('reports available: false, RULE_CONFLICT, and selects no candidate', () => {
    const a = candidate({ id: 'rule-a', version: 1 });
    const b = candidate({ id: 'rule-b', version: 2 });
    const ruleSet = assembleStateRuleSet(
      result(ambiguous(StateRuleKey.WITHHOLDING_METHOD, [a, b])),
      METADATA,
    );
    const entry = ruleSet.entries[StateRuleKey.WITHHOLDING_METHOD];

    expect(entry?.available).toBe(false);
    if (entry?.available !== false) throw new Error('expected unavailable entry');
    expect(entry.problem.reason).toBe('RULE_CONFLICT');
    expect(entry.problem.ruleKey).toBe(StateRuleKey.WITHHOLDING_METHOD);
    // Neither candidate id appears anywhere in the entry — nothing was picked.
    expect(JSON.stringify(entry)).not.toContain('rule-a');
    expect(JSON.stringify(entry)).not.toContain('rule-b');
  });
});

describe('Test 4 — mixed outcomes', () => {
  it('represents RESOLVED, NOT_FOUND and AMBIGUOUS independently in one assembly', () => {
    const ruleSet = assembleStateRuleSet(
      result(
        resolved(candidate({ ruleKey: StateRuleKey.WITHHOLDING_METHOD })),
        notFound(StateRuleKey.WITHHOLDING_TABLE),
        ambiguous(StateRuleKey.WITHHOLDING_FORMULA, [
          candidate({ id: 'p', ruleKey: StateRuleKey.WITHHOLDING_FORMULA }),
          candidate({ id: 'q', ruleKey: StateRuleKey.WITHHOLDING_FORMULA, version: 2 }),
        ]),
      ),
      METADATA,
    );

    const methodEntry = ruleSet.entries[StateRuleKey.WITHHOLDING_METHOD];
    const tableEntry = ruleSet.entries[StateRuleKey.WITHHOLDING_TABLE];
    const formulaEntry = ruleSet.entries[StateRuleKey.WITHHOLDING_FORMULA];

    expect(methodEntry?.available).toBe(true);
    expect(tableEntry?.available).toBe(false);
    expect(formulaEntry?.available).toBe(false);
    if (tableEntry?.available !== false) throw new Error('expected unavailable');
    expect(tableEntry.problem.reason).toBe('RULE_MISSING');
    if (formulaEntry?.available !== false) throw new Error('expected unavailable');
    expect(formulaEntry.problem.reason).toBe('RULE_CONFLICT');
  });
});

describe('Test 5 — multiple rule keys', () => {
  it('represents every input key, loses none, invents none', () => {
    const ruleSet = assembleStateRuleSet(
      result(
        resolved(candidate({ ruleKey: StateRuleKey.PIT_RATE_BRACKETS })),
        notFound(StateRuleKey.PIT_STANDARD_DEDUCTION),
        ambiguous(StateRuleKey.PIT_PERSONAL_EXEMPTION, [
          candidate({ id: 'x', ruleKey: StateRuleKey.PIT_PERSONAL_EXEMPTION }),
          candidate({ id: 'y', ruleKey: StateRuleKey.PIT_PERSONAL_EXEMPTION, version: 2 }),
        ]),
      ),
      METADATA,
    );

    const presentKeys = Object.keys(ruleSet.entries).sort();
    expect(presentKeys).toEqual(
      [
        StateRuleKey.PIT_RATE_BRACKETS,
        StateRuleKey.PIT_STANDARD_DEDUCTION,
        StateRuleKey.PIT_PERSONAL_EXEMPTION,
      ].sort(),
    );
  });
});

describe('Test 6 — top-level metadata', () => {
  it('preserves the explicit assembly metadata exactly, without derivation', () => {
    const ruleSet = assembleStateRuleSet(result(), METADATA);

    expect(ruleSet.taxYear).toBe(METADATA.taxYear);
    expect(ruleSet.effectiveDate).toBe(METADATA.effectiveDate);
    expect(ruleSet.jurisdictionCode).toBe(METADATA.jurisdictionCode);
    expect(ruleSet.engineVersion).toBe(METADATA.engineVersion);
    expect(ruleSet.resolvedAt).toBe(METADATA.resolvedAt);
  });
});

describe('Test 7 — immutability', () => {
  it('satisfies the freezeStateRuleSet contract — frozen, cannot be mutated', () => {
    const rule = candidate();
    const ruleSet = assembleStateRuleSet(result(resolved(rule)), METADATA);

    expect(Object.isFrozen(ruleSet)).toBe(true);
    expect(Object.isFrozen(ruleSet.entries)).toBe(true);
    expect(Object.isFrozen(ruleSet.ruleReferences)).toBe(true);
    expect(Object.isFrozen(ruleSet.sourceIds)).toBe(true);
    expect(Object.isFrozen(ruleSet.missing)).toBe(true);
    expect(() => {
      // @ts-expect-error -- proving runtime immutability, not a type error
      ruleSet.taxYear = 1;
    }).toThrow();
  });
});

describe('Test 8 — no database access', () => {
  it('imports no database client, Prisma, or repository', async () => {
    const fs = await import('node:fs');
    const source = fs.readFileSync(
      new URL('../../lib/tax/state/rules/assembleStateRuleSet.ts', import.meta.url),
      'utf8',
    );
    const importLines = source
      .split('\n')
      .filter((line) => /^import\b/.test(line.trim()))
      .join('\n');
    expect(importLines).not.toMatch(/getPrisma|PrismaClient|from '@\/lib\/db\//);
    expect(importLines).not.toMatch(/from '@\/lib\/jurisdictions\/repository'/);
    expect(importLines).not.toMatch(/candidateRetrieval['"]/);
  });
});

describe('Test 9 — no re-resolution', () => {
  it('imports no generic resolver — resolution stays exclusively Step 3.6’s job', async () => {
    const fs = await import('node:fs');
    const source = fs.readFileSync(
      new URL('../../lib/tax/state/rules/assembleStateRuleSet.ts', import.meta.url),
      'utf8',
    );
    const importLines = source
      .split('\n')
      .filter((line) => /^import\b/.test(line.trim()))
      .join('\n');
    expect(importLines).not.toMatch(/resolveApplicableRules|from '@\/lib\/rules\/resolution'/);
    expect(source).not.toMatch(/resolveApplicableRules\(/);
  });

  it('is synchronous — no awaited call, no Promise return', () => {
    const outcome = assembleStateRuleSet(result(), METADATA);
    expect(outcome).not.toBeInstanceOf(Promise);
    expect(assembleStateRuleSet.constructor.name).toBe('Function');
  });
});

describe('Test 10 — provenance is not fabricated', () => {
  it('a verified rule with non-empty source IDs keeps those exact values', () => {
    const rule = candidate({
      sourceIds: ['source-real-1', 'source-real-2'],
      verified: true,
      verificationStatus: 'VERIFIED',
    });
    const ruleSet = assembleStateRuleSet(result(resolved(rule)), METADATA);
    const entry = ruleSet.entries[rule.ruleKey as StateRuleKey];

    if (entry?.available !== true) throw new Error('expected available entry');
    expect(entry.rule.reference.sourceIds).toEqual(['source-real-1', 'source-real-2']);
    expect(entry.rule.reference.verified).toBe(true);
  });

  it('an unverified rule keeps its real unverified values — never upgraded', () => {
    const rule = candidate({
      sourceIds: [],
      verified: false,
      verificationStatus: 'PENDING',
    });
    const ruleSet = assembleStateRuleSet(result(resolved(rule)), METADATA);
    const entry = ruleSet.entries[rule.ruleKey as StateRuleKey];

    if (entry?.available !== true) throw new Error('expected available entry');
    expect(entry.rule.reference.sourceIds).toEqual([]);
    expect(entry.rule.reference.verified).toBe(false);
    expect(entry.rule.verificationStatus).toBe('PENDING');
  });

  it('does not infer verified from sourceIds when the candidate already carries verified: false', () => {
    // A source IS linked, but the candidate's own authoritative `verified`
    // flag is false (e.g. the linked source itself is not VERIFIED) — this
    // must not be silently flipped to true because sourceIds is non-empty.
    const rule = candidate({ sourceIds: ['source-unverified-link'], verified: false });
    const ruleSet = assembleStateRuleSet(result(resolved(rule)), METADATA);
    const entry = ruleSet.entries[rule.ruleKey as StateRuleKey];

    if (entry?.available !== true) throw new Error('expected available entry');
    expect(entry.rule.reference.sourceIds).toEqual(['source-unverified-link']);
    expect(entry.rule.reference.verified).toBe(false);
  });
});

describe('jurisdiction consistency — never silently substituted or rewritten', () => {
  it('reports INVARIANT_BREACH, not a fabricated available rule, on a jurisdiction mismatch', () => {
    const rule = candidate({ jurisdictionCode: 'US-OTHER' });
    const ruleSet = assembleStateRuleSet(result(resolved(rule)), METADATA);
    const entry = ruleSet.entries[rule.ruleKey as StateRuleKey];

    expect(entry?.available).toBe(false);
    if (entry?.available !== false) throw new Error('expected unavailable entry');
    expect(entry.problem.reason).toBe('INVARIANT_BREACH');
  });
});

describe('every entry key round-trips through StateRuleKey', () => {
  it('does not introduce a key absent from the input results', () => {
    const ruleSet = assembleStateRuleSet(
      result(resolved(candidate({ ruleKey: StateRuleKey.SUTA_PROGRAM }))),
      METADATA,
    );
    expect(Object.keys(ruleSet.entries)).toEqual([StateRuleKey.SUTA_PROGRAM]);
  });
});

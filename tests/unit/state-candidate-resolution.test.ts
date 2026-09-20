import { describe, expect, it } from 'vitest';

import { ResolutionStatus, type ResolvableRule } from '@/lib/rules/resolution';
import type {
  StateResolvableRule,
  StateRuleCandidates,
} from '@/lib/tax/state/rules/candidateRetrieval';
import { resolveCandidates } from '@/lib/tax/state/rules/resolveCandidates';
import { StateRuleKey } from '@/lib/tax/state/ruleKeys';

/**
 * Step 3.6 — candidate resolution.
 *
 * Fixtures use RESERVED TEST jurisdiction ids and no real tax value. This
 * module delegates every decision to Phase 2's existing `resolveApplicableRules`
 * — these tests prove delegation and boundary, not a second algorithm.
 *
 * Fixtures build `StateResolvableRule` (not bare `ResolvableRule`) — the
 * provenance fields (`jurisdictionCode`, `sourceIds`, `verified`, `detail`,
 * `verificationStatus`) are what this follow-up correction proves survive
 * resolution unchanged; see Test 8 below.
 */

const JURISDICTION = 'TEST-JURISDICTION';
const JURISDICTION_CODE = 'US-TEST';
const CATEGORY = 'STATE_WITHHOLDING' as ResolvableRule['category'];

function rule(overrides: Partial<StateResolvableRule> = {}): StateResolvableRule {
  return {
    id: 'rule-1',
    ruleKey: StateRuleKey.WITHHOLDING_METHOD,
    version: 1,
    category: CATEGORY,
    jurisdictionId: JURISDICTION,
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

function group(
  ruleKey: StateRuleKey,
  candidates: readonly StateResolvableRule[],
): StateRuleCandidates {
  return { ruleKey, candidates };
}

describe('Test 1 — resolved candidate', () => {
  it('resolves a single candidate exactly, unmutated', () => {
    const candidate = rule({ id: 'rule-a', ruleKey: StateRuleKey.PIT_RATE_BRACKETS });
    const { results } = resolveCandidates([group(StateRuleKey.PIT_RATE_BRACKETS, [candidate])]);

    expect(results).toHaveLength(1);
    expect(results[0]?.ruleKey).toBe(StateRuleKey.PIT_RATE_BRACKETS);
    expect(results[0]?.status).toBe(ResolutionStatus.RESOLVED);
    expect(results[0]?.status === ResolutionStatus.RESOLVED && results[0].rule).toEqual(candidate);
  });
});

describe('Test 2 — no candidates', () => {
  it('reports NOT_FOUND with no fabricated rule', () => {
    const { results } = resolveCandidates([group(StateRuleKey.PFML_WAGE_BASE, [])]);

    expect(results).toHaveLength(1);
    expect(results[0]?.ruleKey).toBe(StateRuleKey.PFML_WAGE_BASE);
    expect(results[0]?.status).toBe(ResolutionStatus.NOT_FOUND);
    expect(results[0]).not.toHaveProperty('rule');
    expect(results[0]).not.toHaveProperty('candidates');
  });
});

describe('Test 3 — ambiguous candidates', () => {
  it('preserves all candidates and selects none', () => {
    const a = rule({ id: 'rule-a', version: 1 });
    const b = rule({ id: 'rule-b', version: 2 });
    const { results } = resolveCandidates([group(StateRuleKey.WITHHOLDING_METHOD, [a, b])]);

    expect(results[0]?.status).toBe(ResolutionStatus.AMBIGUOUS);
    if (results[0]?.status !== ResolutionStatus.AMBIGUOUS) throw new Error('expected AMBIGUOUS');
    expect(results[0].candidates).toEqual(expect.arrayContaining([a, b]));
    expect(results[0].candidates).toHaveLength(2);
    // No field anywhere claims one of the two is "the" rule.
    expect(results[0]).not.toHaveProperty('rule');
  });
});

describe('Test 4 — multiple keys', () => {
  it('returns one result per input group, in exact input order', () => {
    const { results } = resolveCandidates([
      group(StateRuleKey.PIT_RATE_BRACKETS, [rule({ ruleKey: StateRuleKey.PIT_RATE_BRACKETS })]),
      group(StateRuleKey.PIT_STANDARD_DEDUCTION, []),
      group(StateRuleKey.PIT_PERSONAL_EXEMPTION, [
        rule({ id: 'x', ruleKey: StateRuleKey.PIT_PERSONAL_EXEMPTION }),
        rule({ id: 'y', ruleKey: StateRuleKey.PIT_PERSONAL_EXEMPTION, version: 2 }),
      ]),
    ]);

    expect(results.map((r) => r.ruleKey)).toEqual([
      StateRuleKey.PIT_RATE_BRACKETS,
      StateRuleKey.PIT_STANDARD_DEDUCTION,
      StateRuleKey.PIT_PERSONAL_EXEMPTION,
    ]);
  });
});

describe('Test 5 — mixed outcomes', () => {
  it('represents RESOLVED, NOT_FOUND and AMBIGUOUS independently in one call', () => {
    const { results } = resolveCandidates([
      group(StateRuleKey.WITHHOLDING_METHOD, [rule({ ruleKey: StateRuleKey.WITHHOLDING_METHOD })]),
      group(StateRuleKey.WITHHOLDING_TABLE, []),
      group(StateRuleKey.WITHHOLDING_FORMULA, [
        rule({ id: 'p', ruleKey: StateRuleKey.WITHHOLDING_FORMULA }),
        rule({ id: 'q', ruleKey: StateRuleKey.WITHHOLDING_FORMULA, version: 2 }),
      ]),
    ]);

    expect(results.map((r) => r.status)).toEqual([
      ResolutionStatus.RESOLVED,
      ResolutionStatus.NOT_FOUND,
      ResolutionStatus.AMBIGUOUS,
    ]);
  });
});

describe('Test 6 — purity / database independence', () => {
  it('imports no database client, Prisma, or network module', async () => {
    const fs = await import('node:fs');
    const source = fs.readFileSync(
      new URL('../../lib/tax/state/rules/resolveCandidates.ts', import.meta.url),
      'utf8',
    );
    // Scoped to actual `import` statement lines — the module's own doc
    // comment discusses (and thereby mentions) these exact terms in prose to
    // explain what it does NOT do, so a comment-blind scan would false-fail.
    const importLines = source
      .split('\n')
      .filter((line) => /^import\b/.test(line.trim()))
      .join('\n');
    expect(importLines).not.toMatch(/getPrisma|PrismaClient|from '@\/lib\/db\//);
    expect(importLines).not.toMatch(/from '@\/lib\/jurisdictions\/repository'/);
    expect(importLines).not.toMatch(/retrieveCandidates/);
  });

  it('is synchronous — no awaited call, no Promise return', () => {
    const result = resolveCandidates([]);
    expect(result).not.toBeInstanceOf(Promise);
    expect(resolveCandidates.constructor.name).toBe('Function');
  });

  it('returns an empty result for an empty input, without throwing', () => {
    expect(resolveCandidates([])).toEqual({ results: [] });
  });
});

describe('Test 7 — delegates to the existing generic resolver, not a second algorithm', () => {
  it('never resolves a group the generic resolver would call AMBIGUOUS', () => {
    // Two ACTIVE, jurisdiction/category-matching, overlapping-window candidates
    // are unconditionally AMBIGUOUS per resolveApplicableRules — proving
    // Step 3.6 never substitutes its own selection heuristic (e.g. "first
    // wins", "highest version wins").
    const older = rule({ id: 'older', version: 1 });
    const newer = rule({ id: 'newer', version: 2 });
    const { results } = resolveCandidates([group(StateRuleKey.WITHHOLDING_METHOD, [older, newer])]);
    expect(results[0]?.status).toBe(ResolutionStatus.AMBIGUOUS);
  });

  it('ignores a non-ACTIVE candidate exactly as the generic resolver would', () => {
    const draft = rule({ status: 'DRAFT' });
    const { results } = resolveCandidates([group(StateRuleKey.WITHHOLDING_METHOD, [draft])]);
    expect(results[0]?.status).toBe(ResolutionStatus.NOT_FOUND);
  });
});

describe('Test 8 — provenance survives resolution unchanged (follow-up correction, 2026-09-20)', () => {
  it('preserves jurisdictionCode, sourceIds, verified, detail and verificationStatus on RESOLVED', () => {
    const candidate = rule({
      id: 'rule-provenance',
      ruleKey: StateRuleKey.PIT_RATE_BRACKETS,
      jurisdictionCode: 'US-CA',
      sourceIds: ['source-a', 'source-b'],
      verified: true,
      detail: { brackets: [{ rate: 0.05 }] },
      verificationStatus: 'VERIFIED',
    });
    const { results } = resolveCandidates([group(StateRuleKey.PIT_RATE_BRACKETS, [candidate])]);

    expect(results[0]?.status).toBe(ResolutionStatus.RESOLVED);
    if (results[0]?.status !== ResolutionStatus.RESOLVED) throw new Error('expected RESOLVED');
    expect(results[0].rule.jurisdictionCode).toBe('US-CA');
    expect(results[0].rule.sourceIds).toEqual(['source-a', 'source-b']);
    expect(results[0].rule.verified).toBe(true);
    expect(results[0].rule.detail).toEqual({ brackets: [{ rate: 0.05 }] });
    expect(results[0].rule.verificationStatus).toBe('VERIFIED');
    // Identity, not a copy — the exact same object flows through unmodified.
    expect(results[0].rule).toBe(candidate);
  });

  it('preserves provenance on every candidate in an AMBIGUOUS result', () => {
    const a = rule({ id: 'rule-a', version: 1, sourceIds: ['source-a'], verified: true });
    const b = rule({ id: 'rule-b', version: 2, sourceIds: [], verified: false });
    const { results } = resolveCandidates([group(StateRuleKey.WITHHOLDING_METHOD, [a, b])]);

    expect(results[0]?.status).toBe(ResolutionStatus.AMBIGUOUS);
    if (results[0]?.status !== ResolutionStatus.AMBIGUOUS) throw new Error('expected AMBIGUOUS');
    expect(results[0].candidates).toEqual(expect.arrayContaining([a, b]));
    expect(results[0].candidates.find((c) => c.id === 'rule-a')?.verified).toBe(true);
    expect(results[0].candidates.find((c) => c.id === 'rule-b')?.verified).toBe(false);
  });

  it('does not alter RESOLVED/NOT_FOUND/AMBIGUOUS outcomes because of the enriched type', () => {
    // Same scenarios as Tests 1, 2 and 3 — proving the enrichment changed no
    // resolution semantics, only carried more data through unchanged.
    const resolved = resolveCandidates([
      group(StateRuleKey.PIT_RATE_BRACKETS, [rule({ ruleKey: StateRuleKey.PIT_RATE_BRACKETS })]),
    ]);
    expect(resolved.results[0]?.status).toBe(ResolutionStatus.RESOLVED);

    const notFound = resolveCandidates([group(StateRuleKey.PFML_WAGE_BASE, [])]);
    expect(notFound.results[0]?.status).toBe(ResolutionStatus.NOT_FOUND);

    const ambiguous = resolveCandidates([
      group(StateRuleKey.WITHHOLDING_METHOD, [
        rule({ id: 'rule-a', version: 1 }),
        rule({ id: 'rule-b', version: 2 }),
      ]),
    ]);
    expect(ambiguous.results[0]?.status).toBe(ResolutionStatus.AMBIGUOUS);
  });
});

describe('duplicate rule keys are never silently merged', () => {
  it('resolves each supplied group independently, even with a repeated key', () => {
    const { results } = resolveCandidates([
      group(StateRuleKey.SUTA_PROGRAM, [rule({ ruleKey: StateRuleKey.SUTA_PROGRAM })]),
      group(StateRuleKey.SUTA_PROGRAM, []),
    ]);

    expect(results).toHaveLength(2);
    expect(results[0]?.ruleKey).toBe(StateRuleKey.SUTA_PROGRAM);
    expect(results[1]?.ruleKey).toBe(StateRuleKey.SUTA_PROGRAM);
    expect(results[0]?.status).toBe(ResolutionStatus.RESOLVED);
    expect(results[1]?.status).toBe(ResolutionStatus.NOT_FOUND);
  });
});

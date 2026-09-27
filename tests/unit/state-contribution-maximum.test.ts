import { describe, expect, it } from 'vitest';

import { equals, money, type Money } from '@/lib/core/money';
import type { RuleReference } from '@/lib/calculator/types/rules';
import {
  applyStateContributionMaximum,
  type StateContributionMaximumRuleKey,
} from '@/lib/tax/state/rules/contributionMaximum';
import {
  freezeStateRuleSet,
  stateRule,
  type ResolvedStateRule,
  type ResolvedStateRuleSet,
  type StateRuleEntry,
} from '@/lib/tax/state/rules/stateRuleSet';
import { StateRuleKey } from '@/lib/tax/state/ruleKeys';

/**
 * State maximum-contribution primitive.
 *
 * Fixtures use RESERVED TEST jurisdiction/source ids and no real tax value,
 * mirroring `state-wage-base.test.ts`'s own conventions exactly.
 * `applyStateContributionMaximum` delegates existence/verification/schema
 * handling entirely to `read-detail.ts` — these tests prove that delegation
 * holds for maximum-contribution keys, plus the two things this module
 * actually adds: the APPLIES/NOT_APPLICABLE cap semantics (YTD-aware, same
 * convention as the wage-base YTD wiring) and the owner-locked preservation
 * of `inclusive` without ever inferring or converting it.
 */

const JURISDICTION_CODE = 'TEST-CONTRIBUTION-MAX';
const JURISDICTION_ID = 'test-contribution-max-jurisdiction-id';
const TAX_YEAR = 2099;
const EFFECTIVE = '2099-06-15T00:00:00.000Z';

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

function thresholdDetail(
  amount: string | null,
  applicability: 'APPLIES' | 'NOT_APPLICABLE' = 'APPLIES',
  inclusive: boolean | null = null,
) {
  return { shape: 'THRESHOLD', amount, basis: 'ANNUAL_YTD', inclusive, applicability };
}

const KEYS: readonly StateContributionMaximumRuleKey[] = [
  StateRuleKey.SDI_MAX_CONTRIBUTION,
  StateRuleKey.PFML_MAX_CONTRIBUTION,
];

describe('applyStateContributionMaximum — YTD-aware capping', () => {
  function baseRuleSet(amount: string, inclusive: boolean | null = null): ResolvedStateRuleSet {
    return buildRuleSet({
      [StateRuleKey.SDI_MAX_CONTRIBUTION]: availableEntry(
        StateRuleKey.SDI_MAX_CONTRIBUTION,
        thresholdDetail(amount, 'APPLIES', inclusive),
      ),
    });
  }

  it('no YTD contribution: full period contribution allowed up to the max', () => {
    const ruleSet = baseRuleSet('1000');
    const result = applyStateContributionMaximum(
      ruleSet,
      StateRuleKey.SDI_MAX_CONTRIBUTION,
      money('300'),
      money('0'),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    // remaining = max(1000 - 0, 0) = 1000; capped = min(300, 1000) = 300
    expect(equals(result.value.cappedContribution, money('300'))).toBe(true);
    expect(result.value.maximum).not.toBeNull();
    if (result.value.maximum === null) throw new Error('expected a maximum');
    expect(equals(result.value.maximum, money('1000'))).toBe(true);
  });

  it('YTD below max: only the remaining contribution is allowed', () => {
    const ruleSet = baseRuleSet('1000');
    const result = applyStateContributionMaximum(
      ruleSet,
      StateRuleKey.SDI_MAX_CONTRIBUTION,
      money('300'),
      money('900'),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    // remaining = max(1000 - 900, 0) = 100; capped = min(300, 100) = 100
    expect(equals(result.value.cappedContribution, money('100'))).toBe(true);
  });

  it('YTD exactly at max: current contribution becomes zero', () => {
    const ruleSet = baseRuleSet('1000');
    const result = applyStateContributionMaximum(
      ruleSet,
      StateRuleKey.SDI_MAX_CONTRIBUTION,
      money('300'),
      money('1000'),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    // remaining = max(1000 - 1000, 0) = 0; capped = min(300, 0) = 0
    expect(equals(result.value.cappedContribution, money('0'))).toBe(true);
  });

  it('YTD above max: current contribution becomes zero, remaining floors at zero (never negative)', () => {
    const ruleSet = baseRuleSet('1000');
    const result = applyStateContributionMaximum(
      ruleSet,
      StateRuleKey.SDI_MAX_CONTRIBUTION,
      money('300'),
      money('1200'),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    // remaining = max(1000 - 1200, 0) = 0; capped = min(300, 0) = 0
    expect(equals(result.value.cappedContribution, money('0'))).toBe(true);
  });

  it('period contribution below the remaining cap: contribution is unchanged', () => {
    const ruleSet = baseRuleSet('1000');
    const result = applyStateContributionMaximum(
      ruleSet,
      StateRuleKey.SDI_MAX_CONTRIBUTION,
      money('50'),
      money('200'),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    // remaining = max(1000 - 200, 0) = 800; capped = min(50, 800) = 50
    expect(equals(result.value.cappedContribution, money('50'))).toBe(true);
  });

  it('zero YTD reduces to a plain single-period clamp against the maximum', () => {
    const ruleSet = baseRuleSet('100');
    const result = applyStateContributionMaximum(
      ruleSet,
      StateRuleKey.SDI_MAX_CONTRIBUTION,
      money('150'),
      money('0'),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(equals(result.value.cappedContribution, money('100'))).toBe(true);
  });
});

describe('applyStateContributionMaximum — no cap (NOT_APPLICABLE)', () => {
  it('returns the contribution unchanged and maximum: null, ignoring YTD entirely', () => {
    const ruleSet = buildRuleSet({
      [StateRuleKey.PFML_MAX_CONTRIBUTION]: availableEntry(
        StateRuleKey.PFML_MAX_CONTRIBUTION,
        thresholdDetail(null, 'NOT_APPLICABLE'),
      ),
    });

    const result = applyStateContributionMaximum(
      ruleSet,
      StateRuleKey.PFML_MAX_CONTRIBUTION,
      money('999999.99'),
      money('500000'),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(equals(result.value.cappedContribution, money('999999.99'))).toBe(true);
    expect(result.value.maximum).toBeNull();
    expect(result.value.inclusive).toBeNull();
  });

  it('does not confuse a stated-applicable-but-not-yet-quantified maximum with "no cap"', () => {
    // applicability: APPLIES, but amount is null — a genuine gap, not "unlimited".
    const ruleSet = buildRuleSet({
      [StateRuleKey.SDI_MAX_CONTRIBUTION]: availableEntry(
        StateRuleKey.SDI_MAX_CONTRIBUTION,
        thresholdDetail(null),
      ),
    });

    const result = applyStateContributionMaximum(
      ruleSet,
      StateRuleKey.SDI_MAX_CONTRIBUTION,
      money('50'),
      money('0'),
    );

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.problem.reason).toBe('COMPONENT_NOT_STATED');
  });
});

describe('applyStateContributionMaximum — missing rule', () => {
  it('reports RULE_MISSING and never assumes zero or unlimited contribution', () => {
    const ruleSet = buildRuleSet({});

    const result = applyStateContributionMaximum(
      ruleSet,
      StateRuleKey.SDI_MAX_CONTRIBUTION,
      money('50'),
      money('0'),
    );

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.problem.reason).toBe('RULE_MISSING');
    expect(result.problem.ruleKey).toBe(StateRuleKey.SDI_MAX_CONTRIBUTION);
  });
});

describe('applyStateContributionMaximum — invalid detail', () => {
  it('reports RULE_DETAIL_INVALID for a malformed threshold detail', () => {
    const ruleSet = buildRuleSet({
      [StateRuleKey.SDI_MAX_CONTRIBUTION]: availableEntry(StateRuleKey.SDI_MAX_CONTRIBUTION, {
        shape: 'THRESHOLD',
        amount: 'not-a-number',
        basis: 'ANNUAL_YTD',
        inclusive: null,
        applicability: 'APPLIES',
      }),
    });

    const result = applyStateContributionMaximum(
      ruleSet,
      StateRuleKey.SDI_MAX_CONTRIBUTION,
      money('50'),
      money('0'),
    );

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.problem.reason).toBe('RULE_DETAIL_INVALID');
  });

  it('reports RULE_DETAIL_INVALID for a detail shape mismatched to a threshold key', () => {
    const ruleSet = buildRuleSet({
      [StateRuleKey.SDI_MAX_CONTRIBUTION]: availableEntry(StateRuleKey.SDI_MAX_CONTRIBUTION, {
        shape: 'WAGE_BASE',
        amount: '1000',
        basis: 'ANNUAL',
        applicability: 'APPLIES',
      }),
    });

    const result = applyStateContributionMaximum(
      ruleSet,
      StateRuleKey.SDI_MAX_CONTRIBUTION,
      money('50'),
      money('0'),
    );

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.problem.reason).toBe('RULE_DETAIL_INVALID');
  });
});

describe('applyStateContributionMaximum — unverified rule', () => {
  it('reports RULE_UNVERIFIED for a PENDING rule, never treating it as verified', () => {
    const ruleSet = buildRuleSet({
      [StateRuleKey.SDI_MAX_CONTRIBUTION]: availableEntry(
        StateRuleKey.SDI_MAX_CONTRIBUTION,
        thresholdDetail('1000'),
        { verificationStatus: 'PENDING' },
      ),
    });

    const result = applyStateContributionMaximum(
      ruleSet,
      StateRuleKey.SDI_MAX_CONTRIBUTION,
      money('50'),
      money('0'),
    );

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.problem.reason).toBe('RULE_UNVERIFIED');
  });
});

describe('applyStateContributionMaximum — inclusive: owner-locked, never inferred', () => {
  it('inclusive: true is preserved verbatim', () => {
    const ruleSet = buildRuleSet({
      [StateRuleKey.SDI_MAX_CONTRIBUTION]: availableEntry(
        StateRuleKey.SDI_MAX_CONTRIBUTION,
        thresholdDetail('1000', 'APPLIES', true),
      ),
    });
    const result = applyStateContributionMaximum(
      ruleSet,
      StateRuleKey.SDI_MAX_CONTRIBUTION,
      money('300'),
      money('900'),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.value.inclusive).toBe(true);
    // The cap arithmetic itself is identical regardless of inclusive's value.
    expect(equals(result.value.cappedContribution, money('100'))).toBe(true);
  });

  it('inclusive: false is preserved verbatim', () => {
    const ruleSet = buildRuleSet({
      [StateRuleKey.SDI_MAX_CONTRIBUTION]: availableEntry(
        StateRuleKey.SDI_MAX_CONTRIBUTION,
        thresholdDetail('1000', 'APPLIES', false),
      ),
    });
    const result = applyStateContributionMaximum(
      ruleSet,
      StateRuleKey.SDI_MAX_CONTRIBUTION,
      money('300'),
      money('900'),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.value.inclusive).toBe(false);
    expect(equals(result.value.cappedContribution, money('100'))).toBe(true);
  });

  it('inclusive: null is preserved as unresolved — never silently converted to true or false', () => {
    const ruleSet = buildRuleSet({
      [StateRuleKey.SDI_MAX_CONTRIBUTION]: availableEntry(
        StateRuleKey.SDI_MAX_CONTRIBUTION,
        thresholdDetail('1000', 'APPLIES', null),
      ),
    });
    const result = applyStateContributionMaximum(
      ruleSet,
      StateRuleKey.SDI_MAX_CONTRIBUTION,
      money('300'),
      money('900'),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.value.inclusive).toBeNull();
    // Identical cap arithmetic to the true/false cases above — null never
    // changes the computed amount, proving it is not defaulted to a boundary.
    expect(equals(result.value.cappedContribution, money('100'))).toBe(true);
  });

  it('true, false, and null all produce the identical capped amount — inclusive never changes arithmetic', () => {
    function cappedFor(inclusive: boolean | null): Money {
      const ruleSet = buildRuleSet({
        [StateRuleKey.SDI_MAX_CONTRIBUTION]: availableEntry(
          StateRuleKey.SDI_MAX_CONTRIBUTION,
          thresholdDetail('1000', 'APPLIES', inclusive),
        ),
      });
      const result = applyStateContributionMaximum(
        ruleSet,
        StateRuleKey.SDI_MAX_CONTRIBUTION,
        money('300'),
        money('900'),
      );
      if (!result.ok) throw new Error('expected ok');
      return result.value.cappedContribution;
    }

    const whenTrue = cappedFor(true);
    const whenFalse = cappedFor(false);
    const whenNull = cappedFor(null);

    expect(equals(whenTrue, whenFalse)).toBe(true);
    expect(equals(whenFalse, whenNull)).toBe(true);
  });
});

describe('applyStateContributionMaximum — every supported maximum-contribution key', () => {
  it('is consumable through the same API for SDI and PFML', () => {
    const ruleSet = buildRuleSet(
      Object.fromEntries(
        KEYS.map((key) => [key, availableEntry(key, thresholdDetail('700'))]),
      ) as Partial<Record<StateRuleKey, StateRuleEntry>>,
    );

    for (const key of KEYS) {
      const result = applyStateContributionMaximum(ruleSet, key, money('800'), money('0'));
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error('expected ok');
      expect(equals(result.value.cappedContribution, money('700'))).toBe(true);
    }
  });
});

describe('applyStateContributionMaximum — exact Money behavior', () => {
  it('caps with exact decimal precision, no floating-point drift', () => {
    const ruleSet = buildRuleSet({
      [StateRuleKey.PFML_MAX_CONTRIBUTION]: availableEntry(
        StateRuleKey.PFML_MAX_CONTRIBUTION,
        thresholdDetail('700.01'),
      ),
    });

    const exact = applyStateContributionMaximum(
      ruleSet,
      StateRuleKey.PFML_MAX_CONTRIBUTION,
      money('700.02'),
      money('0'),
    );

    expect(exact.ok).toBe(true);
    if (!exact.ok) throw new Error('expected ok');
    expect(equals(exact.value.cappedContribution, money('700.01'))).toBe(true);
  });
});

describe('purity', () => {
  it('does not mutate the supplied ResolvedStateRuleSet', () => {
    const entry = availableEntry(StateRuleKey.SDI_MAX_CONTRIBUTION, thresholdDetail('1000'));
    const ruleSet = buildRuleSet({ [StateRuleKey.SDI_MAX_CONTRIBUTION]: entry });

    const before = stateRule(ruleSet, StateRuleKey.SDI_MAX_CONTRIBUTION);
    applyStateContributionMaximum(
      ruleSet,
      StateRuleKey.SDI_MAX_CONTRIBUTION,
      money('50'),
      money('0'),
    );
    const after = stateRule(ruleSet, StateRuleKey.SDI_MAX_CONTRIBUTION);

    expect(after).toBe(before);
    if (!after.available) throw new Error('expected available');
    expect(after.rule.reference).toEqual(entry.rule.reference);
    expect(Object.isFrozen(ruleSet)).toBe(true);
  });

  it('is synchronous — no awaited call, no Promise return', () => {
    const ruleSet = buildRuleSet({
      [StateRuleKey.SDI_MAX_CONTRIBUTION]: availableEntry(
        StateRuleKey.SDI_MAX_CONTRIBUTION,
        thresholdDetail('1000'),
      ),
    });
    const result = applyStateContributionMaximum(
      ruleSet,
      StateRuleKey.SDI_MAX_CONTRIBUTION,
      money('50'),
      money('0'),
    );
    expect(result).not.toBeInstanceOf(Promise);
  });
});

describe('no forbidden responsibilities', () => {
  it('imports no database client, Prisma, or state pipeline module beyond read-detail/stateRuleSet/detailSchemas', async () => {
    const fs = await import('node:fs');
    const source = fs.readFileSync(
      new URL('../../lib/tax/state/rules/contributionMaximum.ts', import.meta.url),
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

  it('computes no rate and reads no wage base — only a contribution-dollar clamp', async () => {
    const fs = await import('node:fs');
    const source = fs
      .readFileSync(
        new URL('../../lib/tax/state/rules/contributionMaximum.ts', import.meta.url),
        'utf8',
      )
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    expect(source).not.toMatch(/\bmultiply\(/);
    expect(source).not.toMatch(/WAGE_BASE/);
    expect(source).not.toMatch(/\b\d+\.\d+\b/);
  });

  it('implements no strict/inclusive comparison behavior anywhere in its source', async () => {
    const fs = await import('node:fs');
    const source = fs
      .readFileSync(
        new URL('../../lib/tax/state/rules/contributionMaximum.ts', import.meta.url),
        'utf8',
      )
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    // `inclusive` is read and returned, never branched on: every occurrence
    // is a declaration or a plain passthrough assignment, never a condition.
    const inclusiveUses = source.match(/inclusive/g) ?? [];
    expect(inclusiveUses.length).toBe(4); // interface field, NOT_APPLICABLE's `inclusive: null`,
    // and the APPLIES branch's `inclusive: detail.inclusive` (two occurrences)
    expect(source).not.toMatch(/inclusive\s*\?/);
    expect(source).not.toMatch(/inclusive\s*===?\s*(true|false)/);
    expect(source).not.toMatch(/if\s*\(\s*.*inclusive/);
  });
});

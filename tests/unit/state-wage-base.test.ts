import { describe, expect, it } from 'vitest';

import { equals, money } from '@/lib/core/money';
import type { RuleReference } from '@/lib/calculator/types/rules';
import { applyStateWageBase, type StateWageBaseRuleKey } from '@/lib/tax/state/rules/wageBase';
import {
  freezeStateRuleSet,
  stateRule,
  type ResolvedStateRule,
  type ResolvedStateRuleSet,
  type StateRuleEntry,
} from '@/lib/tax/state/rules/stateRuleSet';
import { StateRuleKey } from '@/lib/tax/state/ruleKeys';

/**
 * State wage-base / cap primitive.
 *
 * Fixtures use RESERVED TEST jurisdiction/source ids and no real tax value.
 * `applyStateWageBase` delegates existence/verification/schema handling
 * entirely to `read-detail.ts` — these tests prove that delegation holds for
 * wage-base keys, plus the two things this module actually adds: the
 * APPLIES/NOT_APPLICABLE clamp semantics and exact `Money` arithmetic.
 */

const JURISDICTION_CODE = 'TEST-WAGE-BASE';
const JURISDICTION_ID = 'test-wage-base-jurisdiction-id';
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

function wageBaseDetail(
  amount: string | null,
  applicability: 'APPLIES' | 'NOT_APPLICABLE' = 'APPLIES',
) {
  return { shape: 'WAGE_BASE', amount, basis: 'ANNUAL', applicability };
}

const KEYS: readonly StateWageBaseRuleKey[] = [
  StateRuleKey.SDI_WAGE_BASE,
  StateRuleKey.PFML_WAGE_BASE,
  StateRuleKey.SUTA_WAGE_BASE,
];

describe('applyStateWageBase — finite base', () => {
  it('returns the input wages unchanged when they are below the base', () => {
    const ruleSet = buildRuleSet({
      [StateRuleKey.SDI_WAGE_BASE]: availableEntry(
        StateRuleKey.SDI_WAGE_BASE,
        wageBaseDetail('1000'),
      ),
    });

    const result = applyStateWageBase(ruleSet, StateRuleKey.SDI_WAGE_BASE, money('500'));

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(equals(result.value.applicableWages, money('500'))).toBe(true);
    expect(result.value.wageBase).not.toBeNull();
    if (result.value.wageBase === null) throw new Error('expected a wage base');
    expect(equals(result.value.wageBase, money('1000'))).toBe(true);
  });

  it('returns the base exactly when wages equal the base', () => {
    const ruleSet = buildRuleSet({
      [StateRuleKey.SDI_WAGE_BASE]: availableEntry(
        StateRuleKey.SDI_WAGE_BASE,
        wageBaseDetail('1000'),
      ),
    });

    const result = applyStateWageBase(ruleSet, StateRuleKey.SDI_WAGE_BASE, money('1000'));

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(equals(result.value.applicableWages, money('1000'))).toBe(true);
  });

  it('caps wages at the base when wages exceed it', () => {
    const ruleSet = buildRuleSet({
      [StateRuleKey.SDI_WAGE_BASE]: availableEntry(
        StateRuleKey.SDI_WAGE_BASE,
        wageBaseDetail('1000'),
      ),
    });

    const result = applyStateWageBase(ruleSet, StateRuleKey.SDI_WAGE_BASE, money('1500'));

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(equals(result.value.applicableWages, money('1000'))).toBe(true);
  });
});

describe('applyStateWageBase — no cap (NOT_APPLICABLE)', () => {
  it('returns wages unchanged and wageBase: null when the jurisdiction states no cap applies', () => {
    const ruleSet = buildRuleSet({
      [StateRuleKey.PFML_WAGE_BASE]: availableEntry(
        StateRuleKey.PFML_WAGE_BASE,
        wageBaseDetail(null, 'NOT_APPLICABLE'),
      ),
    });

    const result = applyStateWageBase(ruleSet, StateRuleKey.PFML_WAGE_BASE, money('999999.99'));

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(equals(result.value.applicableWages, money('999999.99'))).toBe(true);
    expect(result.value.wageBase).toBeNull();
  });

  it('does not confuse a stated-applicable-but-not-yet-quantified base with "no cap"', () => {
    // applicability: APPLIES, but amount is null — a genuine gap, not "unlimited".
    const ruleSet = buildRuleSet({
      [StateRuleKey.SDI_WAGE_BASE]: availableEntry(
        StateRuleKey.SDI_WAGE_BASE,
        wageBaseDetail(null),
      ),
    });

    const result = applyStateWageBase(ruleSet, StateRuleKey.SDI_WAGE_BASE, money('500'));

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.problem.reason).toBe('COMPONENT_NOT_STATED');
  });
});

describe('applyStateWageBase — missing rule', () => {
  it('reports RULE_MISSING and never assumes zero or unlimited wages', () => {
    const ruleSet = buildRuleSet({});

    const result = applyStateWageBase(ruleSet, StateRuleKey.SDI_WAGE_BASE, money('500'));

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.problem.reason).toBe('RULE_MISSING');
    expect(result.problem.ruleKey).toBe(StateRuleKey.SDI_WAGE_BASE);
  });
});

describe('applyStateWageBase — invalid detail', () => {
  it('reports RULE_DETAIL_INVALID for a malformed wage-base detail', () => {
    const ruleSet = buildRuleSet({
      [StateRuleKey.SDI_WAGE_BASE]: availableEntry(StateRuleKey.SDI_WAGE_BASE, {
        shape: 'WAGE_BASE',
        amount: 'not-a-number',
        basis: 'ANNUAL',
        applicability: 'APPLIES',
      }),
    });

    const result = applyStateWageBase(ruleSet, StateRuleKey.SDI_WAGE_BASE, money('500'));

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.problem.reason).toBe('RULE_DETAIL_INVALID');
  });

  it('reports RULE_DETAIL_INVALID for a detail shape mismatched to a wage-base key', () => {
    const ruleSet = buildRuleSet({
      [StateRuleKey.SDI_WAGE_BASE]: availableEntry(StateRuleKey.SDI_WAGE_BASE, {
        shape: 'RATE',
        rate: '0.5',
        unit: 'PERCENT',
        appliesTo: 'EMPLOYEE',
        applicability: 'APPLIES',
      }),
    });

    const result = applyStateWageBase(ruleSet, StateRuleKey.SDI_WAGE_BASE, money('500'));

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.problem.reason).toBe('RULE_DETAIL_INVALID');
  });
});

describe('applyStateWageBase — unverified rule', () => {
  it('reports RULE_UNVERIFIED for a PENDING rule, never treating it as verified', () => {
    const ruleSet = buildRuleSet({
      [StateRuleKey.SDI_WAGE_BASE]: availableEntry(
        StateRuleKey.SDI_WAGE_BASE,
        wageBaseDetail('1000'),
        { verificationStatus: 'PENDING' },
      ),
    });

    const result = applyStateWageBase(ruleSet, StateRuleKey.SDI_WAGE_BASE, money('500'));

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.problem.reason).toBe('RULE_UNVERIFIED');
  });
});

describe('applyStateWageBase — every supported wage-base key', () => {
  it('is consumable through the same API for SDI, PFML and SUTA', () => {
    const ruleSet = buildRuleSet(
      Object.fromEntries(
        KEYS.map((key) => [key, availableEntry(key, wageBaseDetail('7000'))]),
      ) as Partial<Record<StateRuleKey, StateRuleEntry>>,
    );

    for (const key of KEYS) {
      const result = applyStateWageBase(ruleSet, key, money('8000'));
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error('expected ok');
      expect(equals(result.value.applicableWages, money('7000'))).toBe(true);
    }
  });
});

describe('applyStateWageBase — exact Money behavior', () => {
  it('caps with exact decimal precision, no floating-point drift', () => {
    const ruleSet = buildRuleSet({
      [StateRuleKey.SUTA_WAGE_BASE]: availableEntry(
        StateRuleKey.SUTA_WAGE_BASE,
        wageBaseDetail('7000.01'),
      ),
    });

    const exact = applyStateWageBase(ruleSet, StateRuleKey.SUTA_WAGE_BASE, money('7000.02'));

    expect(exact.ok).toBe(true);
    if (!exact.ok) throw new Error('expected ok');
    expect(equals(exact.value.applicableWages, money('7000.01'))).toBe(true);
  });
});

describe('purity', () => {
  it('does not mutate the supplied ResolvedStateRuleSet', () => {
    const entry = availableEntry(StateRuleKey.SDI_WAGE_BASE, wageBaseDetail('1000'));
    const ruleSet = buildRuleSet({ [StateRuleKey.SDI_WAGE_BASE]: entry });

    const before = stateRule(ruleSet, StateRuleKey.SDI_WAGE_BASE);
    applyStateWageBase(ruleSet, StateRuleKey.SDI_WAGE_BASE, money('500'));
    const after = stateRule(ruleSet, StateRuleKey.SDI_WAGE_BASE);

    expect(after).toBe(before);
    if (!after.available) throw new Error('expected available');
    expect(after.rule.reference).toEqual(entry.rule.reference);
    expect(Object.isFrozen(ruleSet)).toBe(true);
  });

  it('is synchronous — no awaited call, no Promise return', () => {
    const ruleSet = buildRuleSet({
      [StateRuleKey.SDI_WAGE_BASE]: availableEntry(
        StateRuleKey.SDI_WAGE_BASE,
        wageBaseDetail('1000'),
      ),
    });
    const result = applyStateWageBase(ruleSet, StateRuleKey.SDI_WAGE_BASE, money('500'));
    expect(result).not.toBeInstanceOf(Promise);
  });
});

describe('no forbidden responsibilities', () => {
  it('imports no database client, Prisma, or state pipeline module beyond read-detail/stateRuleSet/detailSchemas', async () => {
    const fs = await import('node:fs');
    const source = fs.readFileSync(
      new URL('../../lib/tax/state/rules/wageBase.ts', import.meta.url),
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

  it('computes no rate and no contribution — only a wage clamp', async () => {
    const fs = await import('node:fs');
    const source = fs
      .readFileSync(new URL('../../lib/tax/state/rules/wageBase.ts', import.meta.url), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    expect(source).not.toMatch(/\bmultiply\(/);
    expect(source).not.toMatch(/MAX_CONTRIBUTION/);
    expect(source).not.toMatch(/\b\d+\.\d+\b/);
  });
});

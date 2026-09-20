import { describe, expect, it } from 'vitest';

import { equals, money } from '@/lib/core/money';
import type { RuleReference } from '@/lib/calculator/types/rules';
import { StateReason } from '@/lib/tax/state/errors/stateErrors';
import {
  readDetail,
  readRate,
  requireComponent,
  requireForFilingStatus,
} from '@/lib/tax/state/rules/read-detail';
import {
  freezeStateRuleSet,
  stateRule,
  type ResolvedStateRule,
  type ResolvedStateRuleSet,
  type StateRuleEntry,
} from '@/lib/tax/state/rules/stateRuleSet';
import { StateRuleKey } from '@/lib/tax/state/ruleKeys';

/**
 * State rule detail reader — the first concrete module of the State Tax
 * Calculation stage.
 *
 * Fixtures use RESERVED TEST jurisdiction/source ids and no real tax value.
 * This module is not a calculation engine — these tests prove existence,
 * verification and schema-validity handling, and provenance preservation,
 * not any tax arithmetic.
 */

const JURISDICTION_CODE = 'TEST-READ-DETAIL';
const JURISDICTION_ID = 'test-read-detail-jurisdiction-id';
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

const VALID_RATE_DETAIL = {
  shape: 'RATE',
  rate: '0.9',
  unit: 'PERCENT',
  appliesTo: 'EMPLOYEE',
  applicability: 'APPLIES',
};

describe('readDetail — available, verified, schema-valid rule', () => {
  it('returns the detail, rule key and verification status', () => {
    const ruleSet = buildRuleSet({
      [StateRuleKey.SDI_EMPLOYEE_RATE]: availableEntry(
        StateRuleKey.SDI_EMPLOYEE_RATE,
        VALID_RATE_DETAIL,
      ),
    });

    const result = readDetail(ruleSet, StateRuleKey.SDI_EMPLOYEE_RATE);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.value.detail).toEqual(VALID_RATE_DETAIL);
    expect(result.value.ruleKey).toBe(StateRuleKey.SDI_EMPLOYEE_RATE);
    expect(result.value.verificationStatus).toBe('VERIFIED');
  });

  it('accepts NOT_APPLICABLE as a usable verification status, same as VERIFIED', () => {
    const detail = {
      shape: 'WAGE_BASE',
      amount: null,
      basis: 'ANNUAL',
      applicability: 'NOT_APPLICABLE',
    };
    const ruleSet = buildRuleSet({
      [StateRuleKey.SDI_WAGE_BASE]: availableEntry(StateRuleKey.SDI_WAGE_BASE, detail, {
        verificationStatus: 'NOT_APPLICABLE',
      }),
    });

    const result = readDetail(ruleSet, StateRuleKey.SDI_WAGE_BASE);
    expect(result.ok).toBe(true);
  });
});

describe('readDetail — missing rule', () => {
  it('reports RULE_MISSING for a key with no entry at all, never fabricating one', () => {
    const ruleSet = buildRuleSet({});

    const result = readDetail(ruleSet, StateRuleKey.SDI_EMPLOYEE_RATE);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.problem.reason).toBe('RULE_MISSING');
    expect(result.problem.ruleKey).toBe(StateRuleKey.SDI_EMPLOYEE_RATE);
  });

  it('propagates an existing unavailable entry verbatim, without reinterpreting its reason', () => {
    const ruleSet = buildRuleSet({
      [StateRuleKey.SDI_EMPLOYEE_RATE]: {
        available: false,
        problem: {
          reason: StateReason.RULE_CONFLICT,
          ruleKey: StateRuleKey.SDI_EMPLOYEE_RATE,
          detail: 'two ACTIVE rules apply simultaneously',
        },
      },
    });

    const result = readDetail(ruleSet, StateRuleKey.SDI_EMPLOYEE_RATE);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.problem.reason).toBe('RULE_CONFLICT');
  });
});

describe('readDetail — invalid detail', () => {
  it('reports RULE_DETAIL_INVALID when a field fails its schema', () => {
    const detail = {
      shape: 'RATE',
      rate: 'not-a-number',
      unit: 'PERCENT',
      appliesTo: 'EMPLOYEE',
      applicability: 'APPLIES',
    };
    const ruleSet = buildRuleSet({
      [StateRuleKey.SDI_EMPLOYEE_RATE]: availableEntry(StateRuleKey.SDI_EMPLOYEE_RATE, detail),
    });

    const result = readDetail(ruleSet, StateRuleKey.SDI_EMPLOYEE_RATE);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.problem.reason).toBe('RULE_DETAIL_INVALID');
  });

  it('reports RULE_DETAIL_INVALID for a detail shape mismatched to its rule key', () => {
    // A WAGE_BASE-shaped payload stored under a RATE-shaped key.
    const detail = {
      shape: 'WAGE_BASE',
      amount: '7000',
      basis: 'ANNUAL',
      applicability: 'APPLIES',
    };
    const ruleSet = buildRuleSet({
      [StateRuleKey.SDI_EMPLOYEE_RATE]: availableEntry(StateRuleKey.SDI_EMPLOYEE_RATE, detail),
    });

    const result = readDetail(ruleSet, StateRuleKey.SDI_EMPLOYEE_RATE);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.problem.reason).toBe('RULE_DETAIL_INVALID');
  });
});

describe('readDetail — unverified rule', () => {
  it('reports RULE_UNVERIFIED for a PENDING rule, never treating it as verified', () => {
    const ruleSet = buildRuleSet({
      [StateRuleKey.SDI_EMPLOYEE_RATE]: availableEntry(
        StateRuleKey.SDI_EMPLOYEE_RATE,
        VALID_RATE_DETAIL,
        { verificationStatus: 'PENDING' },
      ),
    });

    const result = readDetail(ruleSet, StateRuleKey.SDI_EMPLOYEE_RATE);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.problem.reason).toBe('RULE_UNVERIFIED');
  });

  it('checks verification before schema validity — an unverified AND malformed rule still reports RULE_UNVERIFIED', () => {
    const malformed = { shape: 'RATE', rate: 'garbage' };
    const ruleSet = buildRuleSet({
      [StateRuleKey.SDI_EMPLOYEE_RATE]: availableEntry(StateRuleKey.SDI_EMPLOYEE_RATE, malformed, {
        verificationStatus: 'CONFLICT',
      }),
    });

    const result = readDetail(ruleSet, StateRuleKey.SDI_EMPLOYEE_RATE);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.problem.reason).toBe('RULE_UNVERIFIED');
  });
});

describe('requireComponent', () => {
  it('converts a stated decimal string to Money', () => {
    const result = requireComponent('123.45', 'SOME.KEY', 'amount');
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(equals(result.value, money('123.45'))).toBe(true);
  });

  it('reports COMPONENT_NOT_STATED for null, never treating it as zero', () => {
    const result = requireComponent(null, 'SOME.KEY', 'amount');
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.problem.reason).toBe('COMPONENT_NOT_STATED');
    expect(result.problem.component).toBe('amount');
  });

  it('reports COMPONENT_NOT_STATED for undefined', () => {
    const result = requireComponent(undefined, 'SOME.KEY', 'amount');
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.problem.reason).toBe('COMPONENT_NOT_STATED');
  });
});

describe('readRate', () => {
  it('passes a DECIMAL_FRACTION rate through unchanged', () => {
    const result = readRate('0.05', 'DECIMAL_FRACTION', 'SOME.KEY');
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(equals(result.value, money('0.05'))).toBe(true);
  });

  it('converts a PERCENT rate to a decimal fraction exactly once', () => {
    const result = readRate('9.5', 'PERCENT', 'SOME.KEY');
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(equals(result.value, money('0.095'))).toBe(true);
  });

  it('propagates COMPONENT_NOT_STATED when the underlying rate is null', () => {
    const result = readRate(null, 'PERCENT', 'SOME.KEY');
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.problem.reason).toBe('COMPONENT_NOT_STATED');
  });
});

describe('requireForFilingStatus', () => {
  const rows = [
    { filingStatus: 'SINGLE', amount: '1000' },
    { filingStatus: 'MARRIED', amount: null },
  ];

  it('finds the row for the requested filing status', () => {
    const result = requireForFilingStatus(rows, 'SINGLE', 'SOME.KEY', 'standardDeduction');
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(equals(result.value, money('1000'))).toBe(true);
  });

  it('reports COMPONENT_NOT_STATED when no row matches the filing status', () => {
    const result = requireForFilingStatus(
      rows,
      'HEAD_OF_HOUSEHOLD',
      'SOME.KEY',
      'standardDeduction',
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.problem.reason).toBe('COMPONENT_NOT_STATED');
  });

  it('reports COMPONENT_NOT_STATED, not zero, when the matched row states no amount', () => {
    const result = requireForFilingStatus(rows, 'MARRIED', 'SOME.KEY', 'standardDeduction');
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.problem.reason).toBe('COMPONENT_NOT_STATED');
  });
});

describe('provenance is preserved, never re-derived', () => {
  it('leaves the resolved entry, its reference and the frozen rule set untouched', () => {
    const entry = availableEntry(StateRuleKey.SDI_EMPLOYEE_RATE, VALID_RATE_DETAIL);
    const ruleSet = buildRuleSet({ [StateRuleKey.SDI_EMPLOYEE_RATE]: entry });

    const before = stateRule(ruleSet, StateRuleKey.SDI_EMPLOYEE_RATE);
    readDetail(ruleSet, StateRuleKey.SDI_EMPLOYEE_RATE);
    const after = stateRule(ruleSet, StateRuleKey.SDI_EMPLOYEE_RATE);

    // Same object identity: reading detail neither reconstructs nor copies the entry.
    expect(after).toBe(before);
    if (!after.available) throw new Error('expected available');
    expect(after.rule.reference).toEqual(entry.rule.reference);
    expect(after.rule.reference.verified).toBe(true);
    expect(after.rule.reference.sourceIds).toEqual(entry.rule.reference.sourceIds);
    expect(Object.isFrozen(ruleSet)).toBe(true);
  });
});

describe('purity / no forbidden responsibilities', () => {
  it('imports no database client, Prisma, or state pipeline module beyond stateRuleSet/detailSchemas/errors', async () => {
    const fs = await import('node:fs');
    const source = fs.readFileSync(
      new URL('../../lib/tax/state/rules/read-detail.ts', import.meta.url),
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
  });

  it('performs no tax calculation and touches no tax value', async () => {
    const fs = await import('node:fs');
    const source = fs
      .readFileSync(new URL('../../lib/tax/state/rules/read-detail.ts', import.meta.url), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    expect(source).not.toMatch(/\b\d+\.\d+\b/);
  });
});

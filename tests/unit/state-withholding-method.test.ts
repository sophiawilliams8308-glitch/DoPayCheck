import { describe, expect, it } from 'vitest';

import type { RuleReference } from '@/lib/calculator/types/rules';
import { readWithholdingMethod } from '@/lib/tax/state/rules/withholdingMethod';
import {
  freezeStateRuleSet,
  stateRule,
  type ResolvedStateRule,
  type ResolvedStateRuleSet,
  type StateRuleEntry,
} from '@/lib/tax/state/rules/stateRuleSet';
import { StateRuleKey } from '@/lib/tax/state/ruleKeys';

/**
 * State withholding-method reader (Task 4J).
 *
 * ===========================================================================
 * SCOPE NOTE — this tests the READER ONLY.
 *
 * Dispatching on `structure`, reading `WITHHOLDING_TABLE`/`WITHHOLDING_FORMULA`,
 * selecting a table row, interpreting a formula step, and computing any
 * withholding amount are NOT implemented and therefore not tested here — see
 * `withholdingMethod.ts`'s own doc comment. These tests cover exactly what IS
 * implemented: reading and exact-preserving the one resolvable
 * `WITHHOLDING_METHOD` rule.
 * ===========================================================================
 *
 * Fixtures use RESERVED TEST jurisdiction/source ids and no real tax value.
 */

const JURISDICTION_CODE = 'TEST-WITHHOLDING-METHOD';
const JURISDICTION_ID = 'test-withholding-method-jurisdiction-id';
const TAX_YEAR = 2099;
const EFFECTIVE = '2099-06-15T00:00:00.000Z';
const KEY = StateRuleKey.WITHHOLDING_METHOD;

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

function methodDetail(structure: string): Record<string, unknown> {
  return {
    shape: 'METHOD_DESCRIPTOR',
    structure,
    methodName: `Synthetic ${structure} method`,
    usesAllowances: true,
    usesStandardDeduction: true,
    usesExemptions: false,
    startsFromFederalTaxableWages: false,
  };
}

describe('readWithholdingMethod — valid structures', () => {
  it.each(['NONE', 'FLAT', 'PROGRESSIVE', 'TABLE', 'FORMULA', 'HYBRID'])(
    'returns OK and preserves the full detail exactly for structure=%s',
    (structure) => {
      const detail = methodDetail(structure);
      const ruleSet = buildRuleSet({ [KEY]: availableEntry(KEY, detail) });

      const result = readWithholdingMethod(ruleSet);

      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error('expected ok');
      expect(result.value).toEqual(detail);
      expect(result.value.structure).toBe(structure);
    },
  );

  it('preserves every scalar field independently, not just structure', () => {
    const detail = {
      shape: 'METHOD_DESCRIPTOR',
      structure: 'FORMULA',
      methodName: 'Percentage Method',
      usesAllowances: false,
      usesStandardDeduction: true,
      usesExemptions: true,
      startsFromFederalTaxableWages: true,
    };
    const ruleSet = buildRuleSet({ [KEY]: availableEntry(KEY, detail) });

    const result = readWithholdingMethod(ruleSet);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.value.methodName).toBe('Percentage Method');
    expect(result.value.usesAllowances).toBe(false);
    expect(result.value.usesStandardDeduction).toBe(true);
    expect(result.value.usesExemptions).toBe(true);
    expect(result.value.startsFromFederalTaxableWages).toBe(true);
  });
});

describe('readWithholdingMethod — missing method', () => {
  it('reports RULE_MISSING, never assuming a method', () => {
    const ruleSet = buildRuleSet({});

    const result = readWithholdingMethod(ruleSet);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.problem.reason).toBe('RULE_MISSING');
    expect(result.problem.ruleKey).toBe(KEY);
  });
});

describe('readWithholdingMethod — invalid method', () => {
  it('reports RULE_DETAIL_INVALID for a structure value outside the schema enum', () => {
    const detail = { ...methodDetail('FLAT'), structure: 'MYSTERY' };
    const ruleSet = buildRuleSet({ [KEY]: availableEntry(KEY, detail) });

    const result = readWithholdingMethod(ruleSet);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.problem.reason).toBe('RULE_DETAIL_INVALID');
  });

  it('reports RULE_DETAIL_INVALID when a required field is missing', () => {
    const { methodName: _methodName, ...rest } = methodDetail('TABLE');
    const ruleSet = buildRuleSet({ [KEY]: availableEntry(KEY, rest) });

    const result = readWithholdingMethod(ruleSet);

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

    const result = readWithholdingMethod(ruleSet);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.problem.reason).toBe('RULE_DETAIL_INVALID');
  });
});

describe('readWithholdingMethod — unverified method', () => {
  it('reports RULE_UNVERIFIED for a PENDING rule, never treating it as verified', () => {
    const ruleSet = buildRuleSet({
      [KEY]: availableEntry(KEY, methodDetail('TABLE'), { verificationStatus: 'PENDING' }),
    });

    const result = readWithholdingMethod(ruleSet);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.problem.reason).toBe('RULE_UNVERIFIED');
  });

  it('checks verification before schema validity, identical to read-detail.ts ordering', () => {
    const malformed = { shape: 'METHOD_DESCRIPTOR' };
    const ruleSet = buildRuleSet({
      [KEY]: availableEntry(KEY, malformed, { verificationStatus: 'CONFLICT' }),
    });

    const result = readWithholdingMethod(ruleSet);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.problem.reason).toBe('RULE_UNVERIFIED');
  });
});

describe('readWithholdingMethod — delegation to readDetail()', () => {
  it('treats NOT_APPLICABLE as usable, exactly as readDetail() does for every rule key', () => {
    const ruleSet = buildRuleSet({
      [KEY]: availableEntry(KEY, methodDetail('NONE'), { verificationStatus: 'NOT_APPLICABLE' }),
    });

    const result = readWithholdingMethod(ruleSet);

    expect(result.ok).toBe(true);
  });

  it('produces the identical problem readDetail() itself would for the same input', () => {
    const ruleSet = buildRuleSet({});

    const result = readWithholdingMethod(ruleSet);
    const direct = stateRule(ruleSet, KEY);

    expect(result.ok).toBe(false);
    if (result.ok || direct.available) throw new Error('expected both to report unavailable');
    expect(result.problem).toEqual(direct.problem);
  });
});

describe('purity', () => {
  it('does not mutate the supplied ResolvedStateRuleSet', () => {
    const entry = availableEntry(KEY, methodDetail('PROGRESSIVE'));
    const ruleSet = buildRuleSet({ [KEY]: entry });

    const before = stateRule(ruleSet, KEY);
    readWithholdingMethod(ruleSet);
    const after = stateRule(ruleSet, KEY);

    expect(after).toBe(before);
    if (!after.available) throw new Error('expected available');
    expect(after.rule.reference).toEqual(entry.rule.reference);
    expect(Object.isFrozen(ruleSet)).toBe(true);
  });

  it('is synchronous — no awaited call, no Promise return', () => {
    const ruleSet = buildRuleSet({ [KEY]: availableEntry(KEY, methodDetail('FLAT')) });
    const result = readWithholdingMethod(ruleSet);
    expect(result).not.toBeInstanceOf(Promise);
  });
});

describe('no forbidden responsibilities', () => {
  it('imports no database client, Prisma, or state pipeline module beyond read-detail/stateRuleSet/detailSchemas', async () => {
    const fs = await import('node:fs');
    const source = fs.readFileSync(
      new URL('../../lib/tax/state/rules/withholdingMethod.ts', import.meta.url),
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
  });

  it('performs no dispatch, table selection, formula interpretation, or tax calculation', async () => {
    const fs = await import('node:fs');
    const source = fs
      .readFileSync(
        new URL('../../lib/tax/state/rules/withholdingMethod.ts', import.meta.url),
        'utf8',
      )
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    expect(source).not.toMatch(/\bsubtract\(|\bsum\(|\bmultiply\(|\bmoney\(/);
    expect(source).not.toMatch(/WITHHOLDING_TABLE|WITHHOLDING_FORMULA|WITHHOLDING_SUPPLEMENTAL/);
    expect(source).not.toMatch(/switch\s*\(|if\s*\(.*structure/);
    expect(source).not.toMatch(/\b\d+\.\d+\b/);
  });
});

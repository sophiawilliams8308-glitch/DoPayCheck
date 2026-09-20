import { describe, expect, it } from 'vitest';

import type { RuleReference } from '@/lib/calculator/types/rules';
import { readTaxabilityProfile } from '@/lib/tax/state/rules/taxabilityProfile';
import {
  freezeStateRuleSet,
  stateRule,
  type ResolvedStateRule,
  type ResolvedStateRuleSet,
  type StateRuleEntry,
} from '@/lib/tax/state/rules/stateRuleSet';
import { StateRuleKey } from '@/lib/tax/state/ruleKeys';

/**
 * State taxability-profile reader.
 *
 * ===========================================================================
 * SCOPE NOTE — this tests the READER ONLY.
 *
 * "Wage-bucket derivation" (computing `StateWageBuckets` from a
 * `TAXABILITY_PROFILE` plus calculation-context wages) is NOT implemented
 * and therefore not tested here — see `taxabilityProfile.ts`'s own doc
 * comment for the disclosed contract gap (no `deductions` list on
 * `StateCalculationContext`; the schema profiles one `deductionTypeKey` per
 * row, which the one-active-row-per-`ruleKey` resolver architecture cannot
 * multiplex). These tests cover exactly what IS implemented: reading and
 * exact-preserving the one resolvable `TAXABILITY_PROFILE` rule.
 * ===========================================================================
 *
 * Fixtures use RESERVED TEST jurisdiction/source ids and no real tax value.
 */

const JURISDICTION_CODE = 'TEST-TAXABILITY';
const JURISDICTION_ID = 'test-taxability-jurisdiction-id';
const TAX_YEAR = 2099;
const EFFECTIVE = '2099-06-15T00:00:00.000Z';
const KEY = StateRuleKey.TAXABILITY_PROFILE;

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

const VALID_PROFILE = {
  shape: 'TAXABILITY_PROFILE',
  deductionTypeKey: 'TRADITIONAL_401K',
  reducesStateIncomeTaxWages: 'TRUE',
  reducesSdiWages: 'FALSE',
  reducesPfmlWages: 'FALSE',
  reducesSutaWages: 'NOT_STATED',
};

describe('readTaxabilityProfile — valid profile', () => {
  it('returns the profile exactly as stored, with every tri-state flag intact', () => {
    const ruleSet = buildRuleSet({ [KEY]: availableEntry(KEY, VALID_PROFILE) });

    const result = readTaxabilityProfile(ruleSet);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.value).toEqual(VALID_PROFILE);
  });

  it('preserves an explicitly taxable classification (TRUE)', () => {
    const ruleSet = buildRuleSet({
      [KEY]: availableEntry(KEY, { ...VALID_PROFILE, reducesStateIncomeTaxWages: 'TRUE' }),
    });

    const result = readTaxabilityProfile(ruleSet);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.value.reducesStateIncomeTaxWages).toBe('TRUE');
  });

  it('preserves an explicitly non-taxable classification (FALSE)', () => {
    const ruleSet = buildRuleSet({
      [KEY]: availableEntry(KEY, { ...VALID_PROFILE, reducesSdiWages: 'FALSE' }),
    });

    const result = readTaxabilityProfile(ruleSet);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.value.reducesSdiWages).toBe('FALSE');
  });

  it('preserves NOT_STATED distinctly from FALSE, never coercing it', () => {
    const ruleSet = buildRuleSet({
      [KEY]: availableEntry(KEY, { ...VALID_PROFILE, reducesSutaWages: 'NOT_STATED' }),
    });

    const result = readTaxabilityProfile(ruleSet);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.value.reducesSutaWages).toBe('NOT_STATED');
    expect(result.value.reducesSutaWages).not.toBe('FALSE');
  });

  it('preserves each of the four independent bucket dimensions without collapsing them', () => {
    const detail = {
      ...VALID_PROFILE,
      reducesStateIncomeTaxWages: 'TRUE',
      reducesSdiWages: 'FALSE',
      reducesPfmlWages: 'TRUE',
      reducesSutaWages: 'NOT_STATED',
    };
    const ruleSet = buildRuleSet({ [KEY]: availableEntry(KEY, detail) });

    const result = readTaxabilityProfile(ruleSet);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.value.reducesStateIncomeTaxWages).toBe('TRUE');
    expect(result.value.reducesSdiWages).toBe('FALSE');
    expect(result.value.reducesPfmlWages).toBe('TRUE');
    expect(result.value.reducesSutaWages).toBe('NOT_STATED');
  });

  it('preserves the deductionTypeKey exactly', () => {
    const ruleSet = buildRuleSet({
      [KEY]: availableEntry(KEY, { ...VALID_PROFILE, deductionTypeKey: 'SECTION_125_HEALTH' }),
    });

    const result = readTaxabilityProfile(ruleSet);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.value.deductionTypeKey).toBe('SECTION_125_HEALTH');
  });
});

describe('readTaxabilityProfile — missing profile', () => {
  it('reports RULE_MISSING, never assuming taxable or non-taxable', () => {
    const ruleSet = buildRuleSet({});

    const result = readTaxabilityProfile(ruleSet);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.problem.reason).toBe('RULE_MISSING');
    expect(result.problem.ruleKey).toBe(KEY);
  });
});

describe('readTaxabilityProfile — invalid profile', () => {
  it('reports RULE_DETAIL_INVALID for a tri-state field outside the schema enum', () => {
    const detail = { ...VALID_PROFILE, reducesStateIncomeTaxWages: 'MAYBE' };
    const ruleSet = buildRuleSet({ [KEY]: availableEntry(KEY, detail) });

    const result = readTaxabilityProfile(ruleSet);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.problem.reason).toBe('RULE_DETAIL_INVALID');
  });

  it('reports RULE_DETAIL_INVALID when deductionTypeKey is missing', () => {
    const { deductionTypeKey: _deductionTypeKey, ...rest } = VALID_PROFILE;
    const ruleSet = buildRuleSet({ [KEY]: availableEntry(KEY, rest) });

    const result = readTaxabilityProfile(ruleSet);

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

    const result = readTaxabilityProfile(ruleSet);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.problem.reason).toBe('RULE_DETAIL_INVALID');
  });
});

describe('readTaxabilityProfile — unverified profile', () => {
  it('reports RULE_UNVERIFIED for a PENDING rule, never treating it as verified', () => {
    const ruleSet = buildRuleSet({
      [KEY]: availableEntry(KEY, VALID_PROFILE, { verificationStatus: 'PENDING' }),
    });

    const result = readTaxabilityProfile(ruleSet);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.problem.reason).toBe('RULE_UNVERIFIED');
  });

  it('checks verification before schema validity, identical to read-detail.ts ordering', () => {
    const malformed = { shape: 'TAXABILITY_PROFILE' };
    const ruleSet = buildRuleSet({
      [KEY]: availableEntry(KEY, malformed, { verificationStatus: 'CONFLICT' }),
    });

    const result = readTaxabilityProfile(ruleSet);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.problem.reason).toBe('RULE_UNVERIFIED');
  });
});

describe('purity', () => {
  it('does not mutate the supplied ResolvedStateRuleSet', () => {
    const entry = availableEntry(KEY, VALID_PROFILE);
    const ruleSet = buildRuleSet({ [KEY]: entry });

    const before = stateRule(ruleSet, KEY);
    readTaxabilityProfile(ruleSet);
    const after = stateRule(ruleSet, KEY);

    expect(after).toBe(before);
    if (!after.available) throw new Error('expected available');
    expect(after.rule.reference).toEqual(entry.rule.reference);
    expect(Object.isFrozen(ruleSet)).toBe(true);
  });

  it('is synchronous — no awaited call, no Promise return', () => {
    const ruleSet = buildRuleSet({ [KEY]: availableEntry(KEY, VALID_PROFILE) });
    const result = readTaxabilityProfile(ruleSet);
    expect(result).not.toBeInstanceOf(Promise);
  });
});

describe('no forbidden responsibilities', () => {
  it('imports no database client, Prisma, or state pipeline module beyond read-detail/stateRuleSet/detailSchemas', async () => {
    const fs = await import('node:fs');
    const source = fs.readFileSync(
      new URL('../../lib/tax/state/rules/taxabilityProfile.ts', import.meta.url),
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

  it('performs no wage-bucket computation and no tax calculation', async () => {
    const fs = await import('node:fs');
    const source = fs
      .readFileSync(
        new URL('../../lib/tax/state/rules/taxabilityProfile.ts', import.meta.url),
        'utf8',
      )
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    expect(source).not.toMatch(/\bsubtract\(|\bsum\(|\bmultiply\(|\bmoney\(/);
    expect(source).not.toMatch(/StateWageBuckets/);
    expect(source).not.toMatch(/\b\d+\.\d+\b/);
  });
});

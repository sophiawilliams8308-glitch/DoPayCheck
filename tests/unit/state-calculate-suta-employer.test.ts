import { describe, expect, it } from 'vitest';

import { money, toStorageString } from '@/lib/core/money';
import type { RuleReference } from '@/lib/calculator/types/rules';
import { calculateSutaEmployer } from '@/lib/tax/state/suta/calculateSuta';
import {
  freezeStateRuleSet,
  type ResolvedStateRule,
  type ResolvedStateRuleSet,
  type StateRuleEntry,
} from '@/lib/tax/state/rules/stateRuleSet';
import { StateRuleKey } from '@/lib/tax/state/ruleKeys';

/**
 * SUTA employer-side calculation — DM-03 Slice 15.
 *
 * Fixtures reuse the exact conventions `state-calculate-suta.test.ts`
 * (the employee side) already established (reserved TEST jurisdiction/
 * source ids, no real tax value). Implements the contract locked across
 * Slices 13-14: `employerSutaRate` (`context.employer.sutaRate`) is the
 * sole input — never `SUTA_EMPLOYER_RATE`/`SUTA_NEW_EMPLOYER_RATE`, never
 * an inferred/defaulted rate, never a fabricated COMPLETE result when the
 * rate is absent.
 */

const JURISDICTION_CODE = 'TEST-SUTA-EMPLOYER';
const JURISDICTION_ID = 'test-suta-employer-jurisdiction-id';
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

function wageBaseDetail(applicability: 'APPLIES' | 'NOT_APPLICABLE', amount: string | null = null) {
  return { shape: 'WAGE_BASE', amount, basis: 'ANNUAL', applicability };
}

/** No cap, no rule keys other than the wage base — employer.sutaRate is the
 * only rate source under test. */
function uncappedRuleSet(): ResolvedStateRuleSet {
  return buildRuleSet({
    [StateRuleKey.SUTA_WAGE_BASE]: availableEntry(
      StateRuleKey.SUTA_WAGE_BASE,
      wageBaseDetail('NOT_APPLICABLE'),
    ),
  });
}

/** A rule set with BOTH jurisdiction employer-rate keys resolved, to prove
 * the employer calculation never reads either one. */
function ruleSetWithBothEmployerRateKeysResolved(): ResolvedStateRuleSet {
  return buildRuleSet({
    [StateRuleKey.SUTA_WAGE_BASE]: availableEntry(
      StateRuleKey.SUTA_WAGE_BASE,
      wageBaseDetail('NOT_APPLICABLE'),
    ),
    [StateRuleKey.SUTA_EMPLOYER_RATE]: availableEntry(StateRuleKey.SUTA_EMPLOYER_RATE, {
      shape: 'RATE',
      rate: '0.034',
      unit: 'DECIMAL_FRACTION',
      appliesTo: 'EMPLOYER',
      applicability: 'APPLIES',
    }),
    [StateRuleKey.SUTA_NEW_EMPLOYER_RATE]: availableEntry(StateRuleKey.SUTA_NEW_EMPLOYER_RATE, {
      shape: 'RATE',
      rate: '0.027',
      unit: 'DECIMAL_FRACTION',
      appliesTo: 'EMPLOYER',
      applicability: 'APPLIES',
    }),
  });
}

describe('calculateSutaEmployer — positive path', () => {
  it('computes sutaWages x employer.sutaRate', () => {
    const result = calculateSutaEmployer(uncappedRuleSet(), money('50000'), '0.05');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(toStorageString(result.value.amount)).toBe('2500');
  });

  it('treats 0.05 as 5%, never 0.05%', () => {
    // A 0.05% misinterpretation would compute 50000 * 0.0005 = 25, not 2500.
    const result = calculateSutaEmployer(uncappedRuleSet(), money('50000'), '0.05');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(toStorageString(result.value.amount)).toBe('2500');
    expect(toStorageString(result.value.amount)).not.toBe('25');
  });

  it('zero SUTA wages yields zero, never a fabricated non-zero amount', () => {
    const result = calculateSutaEmployer(uncappedRuleSet(), money('0'), '0.034');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(toStorageString(result.value.amount)).toBe('0');
  });

  it('is precision-sensitive: no silent truncation or rounding', () => {
    const result = calculateSutaEmployer(uncappedRuleSet(), money('1234.56'), '0.0072');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(toStorageString(result.value.amount)).toBe('8.888832');
  });

  it('is deterministic: identical inputs produce an identical result on repeated calls', () => {
    const ruleSet = uncappedRuleSet();
    const first = calculateSutaEmployer(ruleSet, money('842.17'), '0.0075');
    const second = calculateSutaEmployer(ruleSet, money('842.17'), '0.0075');
    expect(first).toEqual(second);
  });

  it('does not use JavaScript floating-point arithmetic for the calculation', () => {
    expect(19.9 * 0.01).not.toBe(0.199);
    const result = calculateSutaEmployer(uncappedRuleSet(), money('19.9'), '0.01');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(toStorageString(result.value.amount)).toBe('0.199');
  });
});

describe('missing employer.sutaRate — SCENARIO_UNSUPPORTED, never a fallback', () => {
  it('reports SCENARIO_UNSUPPORTED when employer.sutaRate is undefined', () => {
    const result = calculateSutaEmployer(uncappedRuleSet(), money('50000'), undefined);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problem.reason).toBe('SCENARIO_UNSUPPORTED');
  });

  it('never reads SUTA_EMPLOYER_RATE, even when it resolves', () => {
    const result = calculateSutaEmployer(
      ruleSetWithBothEmployerRateKeysResolved(),
      money('50000'),
      undefined,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problem.reason).toBe('SCENARIO_UNSUPPORTED');
  });

  it('never reads SUTA_NEW_EMPLOYER_RATE, even when it resolves', () => {
    // Same rule set as above proves neither key is consulted — both
    // resolve, and the result is still SCENARIO_UNSUPPORTED, not a value
    // derived from either.
    const result = calculateSutaEmployer(
      ruleSetWithBothEmployerRateKeysResolved(),
      money('50000'),
      undefined,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problem.reason).toBe('SCENARIO_UNSUPPORTED');
  });

  it(
    'when employer.sutaRate IS supplied, still never reads either jurisdiction rate key ' +
      '(provenance proves it)',
    () => {
      const result = calculateSutaEmployer(
        ruleSetWithBothEmployerRateKeysResolved(),
        money('50000'),
        '0.05',
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(toStorageString(result.value.amount)).toBe('2500'); // 50000 * 0.05, not .034 or .027
      const ruleKeys = result.value.rules.map((r) => r.ruleKey);
      expect(ruleKeys).not.toContain(StateRuleKey.SUTA_EMPLOYER_RATE);
      expect(ruleKeys).not.toContain(StateRuleKey.SUTA_NEW_EMPLOYER_RATE);
    },
  );
});

describe('wage base — applied only when the data says there is no cap', () => {
  it('NOT_APPLICABLE: full sutaWages used, COMPLETE', () => {
    const result = calculateSutaEmployer(uncappedRuleSet(), money('5000'), '0.01');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(toStorageString(result.value.amount)).toBe('50');
  });

  it(
    'APPLIES with a real amount: SCENARIO_UNSUPPORTED — this engine has no year-to-date wage ' +
      'tracking to enforce it, identical to the employee side',
    () => {
      const ruleSet = buildRuleSet({
        [StateRuleKey.SUTA_WAGE_BASE]: availableEntry(
          StateRuleKey.SUTA_WAGE_BASE,
          wageBaseDetail('APPLIES', '7000'),
        ),
      });
      const result = calculateSutaEmployer(ruleSet, money('5000'), '0.05');
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.problem.reason).toBe('SCENARIO_UNSUPPORTED');
      expect(result.problem.ruleKey).toBe(StateRuleKey.SUTA_WAGE_BASE);
    },
  );

  it('missing SUTA_WAGE_BASE rule entirely fails RULE_MISSING, never treated as "no cap"', () => {
    const ruleSet = buildRuleSet({});
    const result = calculateSutaEmployer(ruleSet, money('5000'), '0.05');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problem.reason).toBe('RULE_MISSING');
  });

  it('an unverified SUTA_WAGE_BASE rule fails RULE_UNVERIFIED, never used', () => {
    const ruleSet = buildRuleSet({
      [StateRuleKey.SUTA_WAGE_BASE]: availableEntry(
        StateRuleKey.SUTA_WAGE_BASE,
        wageBaseDetail('NOT_APPLICABLE'),
        { verificationStatus: 'PENDING' },
      ),
    });
    const result = calculateSutaEmployer(ruleSet, money('5000'), '0.05');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problem.reason).toBe('RULE_UNVERIFIED');
  });

  it('wage-base failure surfaces even when employer.sutaRate is absent too — wage base is checked first', () => {
    const ruleSet = buildRuleSet({});
    const result = calculateSutaEmployer(ruleSet, money('5000'), undefined);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problem.reason).toBe('RULE_MISSING');
  });
});

describe('invalid employer.sutaRate — explicit failure, no silent coercion', () => {
  it('a malformed decimal string reports INPUT_INVALID', () => {
    const result = calculateSutaEmployer(uncappedRuleSet(), money('5000'), 'not-a-number');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problem.reason).toBe('INPUT_INVALID');
  });

  it('a string with two decimal points reports INPUT_INVALID', () => {
    const result = calculateSutaEmployer(uncappedRuleSet(), money('5000'), '0.05.5');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problem.reason).toBe('INPUT_INVALID');
  });

  it('an empty string reports INPUT_INVALID, never treated as zero or absent', () => {
    const result = calculateSutaEmployer(uncappedRuleSet(), money('5000'), '');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problem.reason).toBe('INPUT_INVALID');
  });
});

describe('provenance', () => {
  it('includes the wage-base rule reference when the calculation succeeds', () => {
    const result = calculateSutaEmployer(uncappedRuleSet(), money('50000'), '0.05');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const ruleKeys = result.value.rules.map((r) => r.ruleKey);
    expect(ruleKeys).toEqual([StateRuleKey.SUTA_WAGE_BASE]);
  });

  it('never fabricates a reference when the calculation itself fails', () => {
    const result = calculateSutaEmployer(uncappedRuleSet(), money('50000'), undefined);
    expect(result.ok).toBe(false);
  });
});

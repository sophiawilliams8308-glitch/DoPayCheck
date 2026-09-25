import { describe, expect, it } from 'vitest';

import { money, toStorageString } from '@/lib/core/money';
import type { RuleReference } from '@/lib/calculator/types/rules';
import { calculateSutaEmployee } from '@/lib/tax/state/suta/calculateSuta';
import {
  freezeStateRuleSet,
  type ResolvedStateRule,
  type ResolvedStateRuleSet,
  type StateRuleEntry,
} from '@/lib/tax/state/rules/stateRuleSet';
import { StateRuleKey } from '@/lib/tax/state/ruleKeys';

/**
 * SUTA employee-side calculation — DM-03 Slice 12.
 *
 * Fixtures reuse the exact conventions `state-calculate-sdi.test.ts`/
 * `state-calculate-pfml.test.ts` already established (reserved TEST
 * jurisdiction/source ids, no real tax value). Only established repository
 * behavior is asserted.
 *
 * There is no `calculateSutaEmployer()` to test — the employer side is a
 * disclosed, unimplemented contract gap (no rate-selection discriminator
 * between SUTA_EMPLOYER_RATE/SUTA_NEW_EMPLOYER_RATE, and no documented unit
 * for `StateEmployerProfile.sutaRate`) — see `calculateSuta.ts`'s own doc
 * comment. No speculative employer-side tests are written here.
 */

const JURISDICTION_CODE = 'TEST-SUTA';
const JURISDICTION_ID = 'test-suta-jurisdiction-id';
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

function rateDetail(
  rate: string | null,
  unit: 'PERCENT' | 'DECIMAL_FRACTION',
  appliesTo: 'EMPLOYEE' | 'EMPLOYER',
  applicability: 'APPLIES' | 'NOT_APPLICABLE' = 'APPLIES',
) {
  return { shape: 'RATE', rate, unit, appliesTo, applicability };
}

/** No cap, employee rate present as a DECIMAL_FRACTION — the baseline COMPLETE case. */
function uncappedEmployeeRuleSet(rate = '0.006'): ResolvedStateRuleSet {
  return buildRuleSet({
    [StateRuleKey.SUTA_WAGE_BASE]: availableEntry(
      StateRuleKey.SUTA_WAGE_BASE,
      wageBaseDetail('NOT_APPLICABLE'),
    ),
    [StateRuleKey.SUTA_EMPLOYEE_RATE]: availableEntry(
      StateRuleKey.SUTA_EMPLOYEE_RATE,
      rateDetail(rate, 'DECIMAL_FRACTION', 'EMPLOYEE'),
    ),
  });
}

describe('calculateSutaEmployee — positive path', () => {
  it('computes taxable SUTA wages x resolved SUTA employee rate', () => {
    const result = calculateSutaEmployee(uncappedEmployeeRuleSet('0.006'), money('50000'));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(toStorageString(result.value.amount)).toBe('300');
  });

  it('zero SUTA wages yields zero, never a fabricated non-zero amount', () => {
    const result = calculateSutaEmployee(uncappedEmployeeRuleSet('0.006'), money('0'));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(toStorageString(result.value.amount)).toBe('0');
  });

  it('normalizes a PERCENT-unit rate through the existing readRate() boundary', () => {
    const ruleSet = buildRuleSet({
      [StateRuleKey.SUTA_WAGE_BASE]: availableEntry(
        StateRuleKey.SUTA_WAGE_BASE,
        wageBaseDetail('NOT_APPLICABLE'),
      ),
      [StateRuleKey.SUTA_EMPLOYEE_RATE]: availableEntry(
        StateRuleKey.SUTA_EMPLOYEE_RATE,
        rateDetail('0.6', 'PERCENT', 'EMPLOYEE'),
      ),
    });
    const result = calculateSutaEmployee(ruleSet, money('50000'));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(toStorageString(result.value.amount)).toBe('300');
  });

  it('is precision-sensitive: no silent truncation or rounding', () => {
    const result = calculateSutaEmployee(uncappedEmployeeRuleSet('0.0072'), money('1234.56'));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(toStorageString(result.value.amount)).toBe('8.888832');
  });

  it('is deterministic: identical inputs produce an identical result on repeated calls', () => {
    const ruleSet = uncappedEmployeeRuleSet('0.0075');
    const first = calculateSutaEmployee(ruleSet, money('842.17'));
    const second = calculateSutaEmployee(ruleSet, money('842.17'));
    expect(first).toEqual(second);
  });

  it('does not use JavaScript floating-point arithmetic for the calculation', () => {
    expect(19.9 * 0.01).not.toBe(0.199);
    const result = calculateSutaEmployee(uncappedEmployeeRuleSet('0.01'), money('19.9'));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(toStorageString(result.value.amount)).toBe('0.199');
  });
});

describe('wage base — applied only when the data says there is no cap', () => {
  it('NOT_APPLICABLE: proceeds uncapped, COMPLETE', () => {
    const result = calculateSutaEmployee(uncappedEmployeeRuleSet('0.01'), money('5000'));
    expect(result.ok).toBe(true);
  });

  it(
    'APPLIES with a real amount: SCENARIO_UNSUPPORTED, never a silently-capped or ' +
      'silently-ignored amount — this engine has no year-to-date wage tracking to enforce it',
    () => {
      const ruleSet = buildRuleSet({
        [StateRuleKey.SUTA_WAGE_BASE]: availableEntry(
          StateRuleKey.SUTA_WAGE_BASE,
          wageBaseDetail('APPLIES', '7000'),
        ),
        [StateRuleKey.SUTA_EMPLOYEE_RATE]: availableEntry(
          StateRuleKey.SUTA_EMPLOYEE_RATE,
          rateDetail('0.006', 'DECIMAL_FRACTION', 'EMPLOYEE'),
        ),
      });
      const result = calculateSutaEmployee(ruleSet, money('5000'));
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.problem.reason).toBe('SCENARIO_UNSUPPORTED');
      expect(result.problem.ruleKey).toBe(StateRuleKey.SUTA_WAGE_BASE);
    },
  );

  it('missing SUTA_WAGE_BASE rule entirely fails RULE_MISSING, never treated as "no cap"', () => {
    const ruleSet = buildRuleSet({
      [StateRuleKey.SUTA_EMPLOYEE_RATE]: availableEntry(
        StateRuleKey.SUTA_EMPLOYEE_RATE,
        rateDetail('0.006', 'DECIMAL_FRACTION', 'EMPLOYEE'),
      ),
    });
    const result = calculateSutaEmployee(ruleSet, money('5000'));
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
      [StateRuleKey.SUTA_EMPLOYEE_RATE]: availableEntry(
        StateRuleKey.SUTA_EMPLOYEE_RATE,
        rateDetail('0.006', 'DECIMAL_FRACTION', 'EMPLOYEE'),
      ),
    });
    const result = calculateSutaEmployee(ruleSet, money('5000'));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problem.reason).toBe('RULE_UNVERIFIED');
  });
});

describe('rate applicability and appliesTo — consulted, never assumed', () => {
  it('SUTA_EMPLOYEE_RATE resolving NOT_APPLICABLE reports SCENARIO_UNSUPPORTED, no rate assumed', () => {
    const ruleSet = buildRuleSet({
      [StateRuleKey.SUTA_WAGE_BASE]: availableEntry(
        StateRuleKey.SUTA_WAGE_BASE,
        wageBaseDetail('NOT_APPLICABLE'),
      ),
      [StateRuleKey.SUTA_EMPLOYEE_RATE]: availableEntry(
        StateRuleKey.SUTA_EMPLOYEE_RATE,
        rateDetail(null, 'DECIMAL_FRACTION', 'EMPLOYEE', 'NOT_APPLICABLE'),
      ),
    });
    const result = calculateSutaEmployee(ruleSet, money('5000'));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problem.reason).toBe('SCENARIO_UNSUPPORTED');
  });

  it(
    'a rate recorded appliesTo EMPLOYER under the SUTA_EMPLOYEE_RATE key is a data ' +
      'inconsistency, not silently used — this engine never falls back to a candidate ' +
      'employer rate for the employee calculation',
    () => {
      const ruleSet = buildRuleSet({
        [StateRuleKey.SUTA_WAGE_BASE]: availableEntry(
          StateRuleKey.SUTA_WAGE_BASE,
          wageBaseDetail('NOT_APPLICABLE'),
        ),
        [StateRuleKey.SUTA_EMPLOYEE_RATE]: availableEntry(
          StateRuleKey.SUTA_EMPLOYEE_RATE,
          rateDetail('0.006', 'DECIMAL_FRACTION', 'EMPLOYER'),
        ),
      });
      const result = calculateSutaEmployee(ruleSet, money('5000'));
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.problem.reason).toBe('SCENARIO_UNSUPPORTED');
    },
  );

  it('a null rate amount (source has not stated it) reports COMPONENT_NOT_STATED, never zero', () => {
    const ruleSet = buildRuleSet({
      [StateRuleKey.SUTA_WAGE_BASE]: availableEntry(
        StateRuleKey.SUTA_WAGE_BASE,
        wageBaseDetail('NOT_APPLICABLE'),
      ),
      [StateRuleKey.SUTA_EMPLOYEE_RATE]: availableEntry(
        StateRuleKey.SUTA_EMPLOYEE_RATE,
        rateDetail(null, 'DECIMAL_FRACTION', 'EMPLOYEE'),
      ),
    });
    const result = calculateSutaEmployee(ruleSet, money('5000'));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problem.reason).toBe('COMPONENT_NOT_STATED');
  });

  it(
    'never reads SUTA_NEW_EMPLOYER_RATE or SUTA_EMPLOYER_RATE for the employee calculation ' +
      '— only SUTA_EMPLOYEE_RATE is consulted, even when both employer-side keys resolve',
    () => {
      const ruleSet = buildRuleSet({
        [StateRuleKey.SUTA_WAGE_BASE]: availableEntry(
          StateRuleKey.SUTA_WAGE_BASE,
          wageBaseDetail('NOT_APPLICABLE'),
        ),
        [StateRuleKey.SUTA_EMPLOYEE_RATE]: availableEntry(
          StateRuleKey.SUTA_EMPLOYEE_RATE,
          rateDetail('0.006', 'DECIMAL_FRACTION', 'EMPLOYEE'),
        ),
        [StateRuleKey.SUTA_EMPLOYER_RATE]: availableEntry(
          StateRuleKey.SUTA_EMPLOYER_RATE,
          rateDetail('0.034', 'DECIMAL_FRACTION', 'EMPLOYER'),
        ),
        [StateRuleKey.SUTA_NEW_EMPLOYER_RATE]: availableEntry(
          StateRuleKey.SUTA_NEW_EMPLOYER_RATE,
          rateDetail('0.027', 'DECIMAL_FRACTION', 'EMPLOYER'),
        ),
      });
      const result = calculateSutaEmployee(ruleSet, money('50000'));
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      // 50000 * 0.006 = 300, never the employer-side 0.034/0.027 rates.
      expect(toStorageString(result.value.amount)).toBe('300');
      const ruleKeys = result.value.rules.map((r) => r.ruleKey);
      expect(ruleKeys).not.toContain(StateRuleKey.SUTA_EMPLOYER_RATE);
      expect(ruleKeys).not.toContain(StateRuleKey.SUTA_NEW_EMPLOYER_RATE);
    },
  );
});

describe('missing/unverified/invalid SUTA_EMPLOYEE_RATE — established readDetail() behavior', () => {
  it('the rate rule missing entirely fails RULE_MISSING', () => {
    const ruleSet = buildRuleSet({
      [StateRuleKey.SUTA_WAGE_BASE]: availableEntry(
        StateRuleKey.SUTA_WAGE_BASE,
        wageBaseDetail('NOT_APPLICABLE'),
      ),
    });
    const result = calculateSutaEmployee(ruleSet, money('5000'));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problem.reason).toBe('RULE_MISSING');
  });

  it('an unverified rate rule fails RULE_UNVERIFIED, never used', () => {
    const ruleSet = buildRuleSet({
      [StateRuleKey.SUTA_WAGE_BASE]: availableEntry(
        StateRuleKey.SUTA_WAGE_BASE,
        wageBaseDetail('NOT_APPLICABLE'),
      ),
      [StateRuleKey.SUTA_EMPLOYEE_RATE]: availableEntry(
        StateRuleKey.SUTA_EMPLOYEE_RATE,
        rateDetail('0.006', 'DECIMAL_FRACTION', 'EMPLOYEE'),
        { verificationStatus: 'PENDING' },
      ),
    });
    const result = calculateSutaEmployee(ruleSet, money('5000'));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problem.reason).toBe('RULE_UNVERIFIED');
  });

  it('an invalid detail shape under the rate key fails RULE_DETAIL_INVALID', () => {
    const ruleSet = buildRuleSet({
      [StateRuleKey.SUTA_WAGE_BASE]: availableEntry(
        StateRuleKey.SUTA_WAGE_BASE,
        wageBaseDetail('NOT_APPLICABLE'),
      ),
      [StateRuleKey.SUTA_EMPLOYEE_RATE]: availableEntry(StateRuleKey.SUTA_EMPLOYEE_RATE, {
        shape: 'WAGE_BASE',
        amount: '1',
        basis: 'ANNUAL',
        applicability: 'APPLIES',
      }),
    });
    const result = calculateSutaEmployee(ruleSet, money('5000'));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problem.reason).toBe('RULE_DETAIL_INVALID');
  });
});

describe('provenance', () => {
  it('merges the wage-base and rate rule references, deduplicated', () => {
    const ruleSet = uncappedEmployeeRuleSet('0.006');
    const result = calculateSutaEmployee(ruleSet, money('50000'));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const ruleKeys = result.value.rules.map((r) => r.ruleKey).sort();
    expect(ruleKeys).toEqual(
      [StateRuleKey.SUTA_EMPLOYEE_RATE, StateRuleKey.SUTA_WAGE_BASE].slice().sort(),
    );
  });

  it('never fabricates a reference when the calculation itself fails', () => {
    const ruleSet = buildRuleSet({});
    const result = calculateSutaEmployee(ruleSet, money('5000'));
    expect(result.ok).toBe(false);
  });
});

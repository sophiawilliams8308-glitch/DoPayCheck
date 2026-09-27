import { describe, expect, it } from 'vitest';

import { money, toStorageString } from '@/lib/core/money';
import type { RuleReference } from '@/lib/calculator/types/rules';
import { calculatePfmlEmployee, calculatePfmlEmployer } from '@/lib/tax/state/pfml/calculatePfml';
import {
  freezeStateRuleSet,
  type ResolvedStateRule,
  type ResolvedStateRuleSet,
  type StateRuleEntry,
} from '@/lib/tax/state/rules/stateRuleSet';
import { StateRuleKey } from '@/lib/tax/state/ruleKeys';

/**
 * PFML calculation — DM-03 Slice 11.
 *
 * Fixtures reuse the exact conventions `state-wage-base.test.ts`/
 * `state-calculate-sdi.test.ts` already established (reserved TEST
 * jurisdiction/source ids, no real tax value). Only established repository
 * behavior is asserted: the wage base IS applied when NOT_APPLICABLE (no
 * cap), and — since the DM-03 wage-base YTD wiring — is now correctly
 * capped against the remaining annual base (`remaining = max(base -
 * ytdWages, 0)`) when a real cap resolves APPLIES, using the caller-supplied
 * `ytdWages` (this employer's `StateYtd.pfmlWages`, excluding the current
 * period). Tests not specifically about YTD pass `money('0')` for
 * `ytdWages`, which reduces to the original single-period clamp.
 */

const JURISDICTION_CODE = 'TEST-PFML';
const JURISDICTION_ID = 'test-pfml-jurisdiction-id';
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
    [StateRuleKey.PFML_WAGE_BASE]: availableEntry(
      StateRuleKey.PFML_WAGE_BASE,
      wageBaseDetail('NOT_APPLICABLE'),
    ),
    [StateRuleKey.PFML_EMPLOYEE_RATE]: availableEntry(
      StateRuleKey.PFML_EMPLOYEE_RATE,
      rateDetail(rate, 'DECIMAL_FRACTION', 'EMPLOYEE'),
    ),
  });
}

function uncappedEmployerRuleSet(rate = '0.006'): ResolvedStateRuleSet {
  return buildRuleSet({
    [StateRuleKey.PFML_WAGE_BASE]: availableEntry(
      StateRuleKey.PFML_WAGE_BASE,
      wageBaseDetail('NOT_APPLICABLE'),
    ),
    [StateRuleKey.PFML_EMPLOYER_RATE]: availableEntry(
      StateRuleKey.PFML_EMPLOYER_RATE,
      rateDetail(rate, 'DECIMAL_FRACTION', 'EMPLOYER'),
    ),
  });
}

describe('calculatePfmlEmployee — positive path', () => {
  it('computes taxable PFML wages x resolved PFML employee rate', () => {
    const result = calculatePfmlEmployee(
      uncappedEmployeeRuleSet('0.006'),
      money('50000'),
      money('0'),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(toStorageString(result.value.amount)).toBe('300');
  });

  it('zero PFML wages yields zero, never a fabricated non-zero amount', () => {
    const result = calculatePfmlEmployee(uncappedEmployeeRuleSet('0.006'), money('0'), money('0'));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(toStorageString(result.value.amount)).toBe('0');
  });

  it('normalizes a PERCENT-unit rate through the existing readRate() boundary', () => {
    const ruleSet = buildRuleSet({
      [StateRuleKey.PFML_WAGE_BASE]: availableEntry(
        StateRuleKey.PFML_WAGE_BASE,
        wageBaseDetail('NOT_APPLICABLE'),
      ),
      [StateRuleKey.PFML_EMPLOYEE_RATE]: availableEntry(
        StateRuleKey.PFML_EMPLOYEE_RATE,
        rateDetail('0.6', 'PERCENT', 'EMPLOYEE'),
      ),
    });
    const result = calculatePfmlEmployee(ruleSet, money('50000'), money('0'));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // 0.6% == 0.006 as a decimal fraction, same as the DECIMAL_FRACTION case.
    expect(toStorageString(result.value.amount)).toBe('300');
  });

  it('is precision-sensitive: no silent truncation or rounding', () => {
    const result = calculatePfmlEmployee(
      uncappedEmployeeRuleSet('0.0072'),
      money('1234.56'),
      money('0'),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(toStorageString(result.value.amount)).toBe('8.888832');
  });

  it('is deterministic: identical inputs produce an identical result on repeated calls', () => {
    const ruleSet = uncappedEmployeeRuleSet('0.0075');
    const first = calculatePfmlEmployee(ruleSet, money('842.17'), money('0'));
    const second = calculatePfmlEmployee(ruleSet, money('842.17'), money('0'));
    expect(first).toEqual(second);
  });

  it('does not use JavaScript floating-point arithmetic for the calculation', () => {
    expect(19.9 * 0.01).not.toBe(0.199);
    const result = calculatePfmlEmployee(
      uncappedEmployeeRuleSet('0.01'),
      money('19.9'),
      money('0'),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(toStorageString(result.value.amount)).toBe('0.199');
  });
});

describe('calculatePfmlEmployer — mirrors the employee path on the employer rate', () => {
  it('computes taxable PFML wages x resolved PFML employer rate', () => {
    const result = calculatePfmlEmployer(
      uncappedEmployerRuleSet('0.014'),
      money('2000'),
      money('0'),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(toStorageString(result.value.amount)).toBe('28');
  });

  it('an employee-only rule set has no employer rate, so the employer side fails RULE_MISSING', () => {
    const result = calculatePfmlEmployer(uncappedEmployeeRuleSet(), money('2000'), money('0'));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problem.reason).toBe('RULE_MISSING');
  });
});

describe('wage base — YTD-aware capping (DM-03 wage-base YTD wiring)', () => {
  it('NOT_APPLICABLE: proceeds uncapped, COMPLETE', () => {
    const result = calculatePfmlEmployee(
      uncappedEmployeeRuleSet('0.01'),
      money('5000'),
      money('0'),
    );
    expect(result.ok).toBe(true);
  });

  it('APPLIES with zero YTD: capped against the full annual base, never SCENARIO_UNSUPPORTED', () => {
    const ruleSet = buildRuleSet({
      [StateRuleKey.PFML_WAGE_BASE]: availableEntry(
        StateRuleKey.PFML_WAGE_BASE,
        wageBaseDetail('APPLIES', '1000'),
      ),
      [StateRuleKey.PFML_EMPLOYEE_RATE]: availableEntry(
        StateRuleKey.PFML_EMPLOYEE_RATE,
        rateDetail('0.006', 'DECIMAL_FRACTION', 'EMPLOYEE'),
      ),
    });
    const result = calculatePfmlEmployee(ruleSet, money('5000'), money('0'));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // remaining = max(1000 - 0, 0) = 1000; taxable = min(5000, 1000) = 1000.
    expect(toStorageString(result.value.amount)).toBe('6');
  });

  it(
    'APPLIES with YTD PFML wages (StateYtd.pfmlWages) already consuming most of the base: ' +
      'only the remaining base is taxed this period',
    () => {
      const ruleSet = buildRuleSet({
        [StateRuleKey.PFML_WAGE_BASE]: availableEntry(
          StateRuleKey.PFML_WAGE_BASE,
          wageBaseDetail('APPLIES', '1000'),
        ),
        [StateRuleKey.PFML_EMPLOYEE_RATE]: availableEntry(
          StateRuleKey.PFML_EMPLOYEE_RATE,
          rateDetail('0.01', 'DECIMAL_FRACTION', 'EMPLOYEE'),
        ),
      });
      const result = calculatePfmlEmployee(ruleSet, money('5000'), money('900'));
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      // remaining = max(1000 - 900, 0) = 100; taxable = min(5000, 100) = 100.
      expect(toStorageString(result.value.amount)).toBe('1');
    },
  );

  it('APPLIES with YTD already at or above the base: taxable wages floor at zero, never negative', () => {
    const ruleSet = buildRuleSet({
      [StateRuleKey.PFML_WAGE_BASE]: availableEntry(
        StateRuleKey.PFML_WAGE_BASE,
        wageBaseDetail('APPLIES', '1000'),
      ),
      [StateRuleKey.PFML_EMPLOYEE_RATE]: availableEntry(
        StateRuleKey.PFML_EMPLOYEE_RATE,
        rateDetail('0.01', 'DECIMAL_FRACTION', 'EMPLOYEE'),
      ),
    });
    const result = calculatePfmlEmployee(ruleSet, money('5000'), money('1500'));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(toStorageString(result.value.amount)).toBe('0');
  });

  it('missing PFML_WAGE_BASE rule entirely fails RULE_MISSING, never treated as "no cap"', () => {
    const ruleSet = buildRuleSet({
      [StateRuleKey.PFML_EMPLOYEE_RATE]: availableEntry(
        StateRuleKey.PFML_EMPLOYEE_RATE,
        rateDetail('0.006', 'DECIMAL_FRACTION', 'EMPLOYEE'),
      ),
    });
    const result = calculatePfmlEmployee(ruleSet, money('5000'), money('0'));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problem.reason).toBe('RULE_MISSING');
  });

  it('an unverified PFML_WAGE_BASE rule fails RULE_UNVERIFIED, never used', () => {
    const ruleSet = buildRuleSet({
      [StateRuleKey.PFML_WAGE_BASE]: availableEntry(
        StateRuleKey.PFML_WAGE_BASE,
        wageBaseDetail('NOT_APPLICABLE'),
        { verificationStatus: 'PENDING' },
      ),
      [StateRuleKey.PFML_EMPLOYEE_RATE]: availableEntry(
        StateRuleKey.PFML_EMPLOYEE_RATE,
        rateDetail('0.006', 'DECIMAL_FRACTION', 'EMPLOYEE'),
      ),
    });
    const result = calculatePfmlEmployee(ruleSet, money('5000'), money('0'));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problem.reason).toBe('RULE_UNVERIFIED');
  });
});

describe('rate applicability and appliesTo — consulted, never assumed', () => {
  it('PFML_EMPLOYEE_RATE resolving NOT_APPLICABLE reports SCENARIO_UNSUPPORTED, no rate assumed', () => {
    const ruleSet = buildRuleSet({
      [StateRuleKey.PFML_WAGE_BASE]: availableEntry(
        StateRuleKey.PFML_WAGE_BASE,
        wageBaseDetail('NOT_APPLICABLE'),
      ),
      [StateRuleKey.PFML_EMPLOYEE_RATE]: availableEntry(
        StateRuleKey.PFML_EMPLOYEE_RATE,
        rateDetail(null, 'DECIMAL_FRACTION', 'EMPLOYEE', 'NOT_APPLICABLE'),
      ),
    });
    const result = calculatePfmlEmployee(ruleSet, money('5000'), money('0'));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problem.reason).toBe('SCENARIO_UNSUPPORTED');
  });

  it(
    'a rate recorded appliesTo EMPLOYER under the PFML_EMPLOYEE_RATE key is a data ' +
      'inconsistency, not silently used',
    () => {
      const ruleSet = buildRuleSet({
        [StateRuleKey.PFML_WAGE_BASE]: availableEntry(
          StateRuleKey.PFML_WAGE_BASE,
          wageBaseDetail('NOT_APPLICABLE'),
        ),
        [StateRuleKey.PFML_EMPLOYEE_RATE]: availableEntry(
          StateRuleKey.PFML_EMPLOYEE_RATE,
          rateDetail('0.006', 'DECIMAL_FRACTION', 'EMPLOYER'),
        ),
      });
      const result = calculatePfmlEmployee(ruleSet, money('5000'), money('0'));
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.problem.reason).toBe('SCENARIO_UNSUPPORTED');
    },
  );

  it('a null rate amount (source has not stated it) reports COMPONENT_NOT_STATED, never zero', () => {
    const ruleSet = buildRuleSet({
      [StateRuleKey.PFML_WAGE_BASE]: availableEntry(
        StateRuleKey.PFML_WAGE_BASE,
        wageBaseDetail('NOT_APPLICABLE'),
      ),
      [StateRuleKey.PFML_EMPLOYEE_RATE]: availableEntry(
        StateRuleKey.PFML_EMPLOYEE_RATE,
        rateDetail(null, 'DECIMAL_FRACTION', 'EMPLOYEE'),
      ),
    });
    const result = calculatePfmlEmployee(ruleSet, money('5000'), money('0'));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problem.reason).toBe('COMPONENT_NOT_STATED');
  });
});

describe('missing/unverified/invalid PFML_EMPLOYEE_RATE — established readDetail() behavior', () => {
  it('the rate rule missing entirely fails RULE_MISSING', () => {
    const ruleSet = buildRuleSet({
      [StateRuleKey.PFML_WAGE_BASE]: availableEntry(
        StateRuleKey.PFML_WAGE_BASE,
        wageBaseDetail('NOT_APPLICABLE'),
      ),
    });
    const result = calculatePfmlEmployee(ruleSet, money('5000'), money('0'));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problem.reason).toBe('RULE_MISSING');
  });

  it('an unverified rate rule fails RULE_UNVERIFIED, never used', () => {
    const ruleSet = buildRuleSet({
      [StateRuleKey.PFML_WAGE_BASE]: availableEntry(
        StateRuleKey.PFML_WAGE_BASE,
        wageBaseDetail('NOT_APPLICABLE'),
      ),
      [StateRuleKey.PFML_EMPLOYEE_RATE]: availableEntry(
        StateRuleKey.PFML_EMPLOYEE_RATE,
        rateDetail('0.006', 'DECIMAL_FRACTION', 'EMPLOYEE'),
        { verificationStatus: 'PENDING' },
      ),
    });
    const result = calculatePfmlEmployee(ruleSet, money('5000'), money('0'));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problem.reason).toBe('RULE_UNVERIFIED');
  });

  it('an invalid detail shape under the rate key fails RULE_DETAIL_INVALID', () => {
    const ruleSet = buildRuleSet({
      [StateRuleKey.PFML_WAGE_BASE]: availableEntry(
        StateRuleKey.PFML_WAGE_BASE,
        wageBaseDetail('NOT_APPLICABLE'),
      ),
      [StateRuleKey.PFML_EMPLOYEE_RATE]: availableEntry(StateRuleKey.PFML_EMPLOYEE_RATE, {
        shape: 'WAGE_BASE',
        amount: '1',
        basis: 'ANNUAL',
        applicability: 'APPLIES',
      }),
    });
    const result = calculatePfmlEmployee(ruleSet, money('5000'), money('0'));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problem.reason).toBe('RULE_DETAIL_INVALID');
  });
});

describe('provenance', () => {
  it('merges the wage-base and rate rule references, deduplicated', () => {
    const ruleSet = uncappedEmployeeRuleSet('0.006');
    const result = calculatePfmlEmployee(ruleSet, money('50000'), money('0'));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const ruleKeys = result.value.rules.map((r) => r.ruleKey).sort();
    expect(ruleKeys).toEqual(
      [StateRuleKey.PFML_EMPLOYEE_RATE, StateRuleKey.PFML_WAGE_BASE].slice().sort(),
    );
  });

  it('never fabricates a reference when the calculation itself fails', () => {
    const ruleSet = buildRuleSet({});
    const result = calculatePfmlEmployee(ruleSet, money('5000'), money('0'));
    expect(result.ok).toBe(false);
  });
});

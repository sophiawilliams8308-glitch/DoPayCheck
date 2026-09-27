import { describe, expect, it } from 'vitest';

import { money, toStorageString } from '@/lib/core/money';
import type { RuleReference } from '@/lib/calculator/types/rules';
import { calculateSdiEmployee, calculateSdiEmployer } from '@/lib/tax/state/sdi/calculateSdi';
import {
  freezeStateRuleSet,
  type ResolvedStateRule,
  type ResolvedStateRuleSet,
  type StateRuleEntry,
} from '@/lib/tax/state/rules/stateRuleSet';
import { StateRuleKey } from '@/lib/tax/state/ruleKeys';

/**
 * SDI calculation — DM-03 Slice 10.
 *
 * Fixtures reuse the exact conventions `tests/unit/state-wage-base.test.ts`
 * already established (reserved TEST jurisdiction/source ids, no real tax
 * value). Only established repository behavior is asserted: the wage base
 * IS applied when NOT_APPLICABLE (no cap), and — since the DM-03 wage-base
 * YTD wiring — is now correctly capped against the remaining annual base
 * (`remaining = max(base - ytdWages, 0)`) when a real cap resolves APPLIES,
 * using the caller-supplied `ytdWages` (this employer's `StateYtd.sdiWages`,
 * excluding the current period). Tests not specifically about YTD pass
 * `money('0')` for `ytdWages`, which reduces to the original single-period
 * clamp.
 *
 * Since the DM-03 SDI/PFML contribution-maximum wiring, `SDI_MAX_CONTRIBUTION`
 * is also read on every call (mirroring the wage base's own mandatory-read
 * pattern) — every fixture below that expects a COMPLETE result now includes
 * `SDI_MAX_CONTRIBUTION: NOT_APPLICABLE` unless the test is specifically
 * about maximum-contribution behavior, in which case it is provided
 * explicitly. Tests asserting a failure that already occurs before the
 * maximum-contribution step is reached (a missing/unverified/invalid wage
 * base or rate) are unaffected and unchanged.
 */

const JURISDICTION_CODE = 'TEST-SDI';
const JURISDICTION_ID = 'test-sdi-jurisdiction-id';
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

function maxContributionDetail(
  applicability: 'APPLIES' | 'NOT_APPLICABLE',
  amount: string | null = null,
  inclusive: boolean | null = null,
) {
  return { shape: 'THRESHOLD', amount, basis: 'ANNUAL_YTD', inclusive, applicability };
}

/** No cap, no contribution maximum, employee rate present as a
 * DECIMAL_FRACTION — the baseline COMPLETE case. */
function uncappedEmployeeRuleSet(rate = '0.009'): ResolvedStateRuleSet {
  return buildRuleSet({
    [StateRuleKey.SDI_WAGE_BASE]: availableEntry(
      StateRuleKey.SDI_WAGE_BASE,
      wageBaseDetail('NOT_APPLICABLE'),
    ),
    [StateRuleKey.SDI_EMPLOYEE_RATE]: availableEntry(
      StateRuleKey.SDI_EMPLOYEE_RATE,
      rateDetail(rate, 'DECIMAL_FRACTION', 'EMPLOYEE'),
    ),
    [StateRuleKey.SDI_MAX_CONTRIBUTION]: availableEntry(
      StateRuleKey.SDI_MAX_CONTRIBUTION,
      maxContributionDetail('NOT_APPLICABLE'),
    ),
  });
}

function uncappedEmployerRuleSet(rate = '0.009'): ResolvedStateRuleSet {
  return buildRuleSet({
    [StateRuleKey.SDI_WAGE_BASE]: availableEntry(
      StateRuleKey.SDI_WAGE_BASE,
      wageBaseDetail('NOT_APPLICABLE'),
    ),
    [StateRuleKey.SDI_EMPLOYER_RATE]: availableEntry(
      StateRuleKey.SDI_EMPLOYER_RATE,
      rateDetail(rate, 'DECIMAL_FRACTION', 'EMPLOYER'),
    ),
    [StateRuleKey.SDI_MAX_CONTRIBUTION]: availableEntry(
      StateRuleKey.SDI_MAX_CONTRIBUTION,
      maxContributionDetail('NOT_APPLICABLE'),
    ),
  });
}

describe('calculateSdiEmployee — positive path', () => {
  it('computes taxable SDI wages x resolved SDI employee rate', () => {
    const result = calculateSdiEmployee(
      uncappedEmployeeRuleSet('0.009'),
      money('50000'),
      money('0'),
      money('0'),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(toStorageString(result.value.amount)).toBe('450');
  });

  it('zero SDI wages yields zero, never a fabricated non-zero amount', () => {
    const result = calculateSdiEmployee(
      uncappedEmployeeRuleSet('0.009'),
      money('0'),
      money('0'),
      money('0'),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(toStorageString(result.value.amount)).toBe('0');
  });

  it('normalizes a PERCENT-unit rate through the existing readRate() boundary', () => {
    const ruleSet = buildRuleSet({
      [StateRuleKey.SDI_WAGE_BASE]: availableEntry(
        StateRuleKey.SDI_WAGE_BASE,
        wageBaseDetail('NOT_APPLICABLE'),
      ),
      [StateRuleKey.SDI_EMPLOYEE_RATE]: availableEntry(
        StateRuleKey.SDI_EMPLOYEE_RATE,
        rateDetail('0.9', 'PERCENT', 'EMPLOYEE'),
      ),
      [StateRuleKey.SDI_MAX_CONTRIBUTION]: availableEntry(
        StateRuleKey.SDI_MAX_CONTRIBUTION,
        maxContributionDetail('NOT_APPLICABLE'),
      ),
    });
    const result = calculateSdiEmployee(ruleSet, money('50000'), money('0'), money('0'));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // 0.9% == 0.009 as a decimal fraction, same as the DECIMAL_FRACTION case.
    expect(toStorageString(result.value.amount)).toBe('450');
  });

  it('is precision-sensitive: no silent truncation or rounding', () => {
    const result = calculateSdiEmployee(
      uncappedEmployeeRuleSet('0.0086'),
      money('1234.56'),
      money('0'),
      money('0'),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(toStorageString(result.value.amount)).toBe('10.617216');
  });

  it('is deterministic: identical inputs produce an identical result on repeated calls', () => {
    const ruleSet = uncappedEmployeeRuleSet('0.0075');
    const first = calculateSdiEmployee(ruleSet, money('842.17'), money('0'), money('0'));
    const second = calculateSdiEmployee(ruleSet, money('842.17'), money('0'), money('0'));
    expect(first).toEqual(second);
  });

  it('does not use JavaScript floating-point arithmetic for the calculation', () => {
    expect(19.9 * 0.01).not.toBe(0.199);
    const result = calculateSdiEmployee(
      uncappedEmployeeRuleSet('0.01'),
      money('19.9'),
      money('0'),
      money('0'),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(toStorageString(result.value.amount)).toBe('0.199');
  });
});

describe('calculateSdiEmployer — mirrors the employee path on the employer rate', () => {
  it('computes taxable SDI wages x resolved SDI employer rate', () => {
    const result = calculateSdiEmployer(
      uncappedEmployerRuleSet('0.012'),
      money('2000'),
      money('0'),
      money('0'),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(toStorageString(result.value.amount)).toBe('24');
  });

  it('an employee-only rule set has no employer rate, so the employer side fails RULE_MISSING', () => {
    const result = calculateSdiEmployer(
      uncappedEmployeeRuleSet(),
      money('2000'),
      money('0'),
      money('0'),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problem.reason).toBe('RULE_MISSING');
  });
});

describe('wage base — YTD-aware capping (DM-03 wage-base YTD wiring)', () => {
  it('NOT_APPLICABLE: proceeds uncapped, COMPLETE', () => {
    const result = calculateSdiEmployee(
      uncappedEmployeeRuleSet('0.01'),
      money('5000'),
      money('0'),
      money('0'),
    );
    expect(result.ok).toBe(true);
  });

  it('APPLIES with zero YTD: capped against the full annual base, never SCENARIO_UNSUPPORTED', () => {
    const ruleSet = buildRuleSet({
      [StateRuleKey.SDI_WAGE_BASE]: availableEntry(
        StateRuleKey.SDI_WAGE_BASE,
        wageBaseDetail('APPLIES', '1000'),
      ),
      [StateRuleKey.SDI_EMPLOYEE_RATE]: availableEntry(
        StateRuleKey.SDI_EMPLOYEE_RATE,
        rateDetail('0.009', 'DECIMAL_FRACTION', 'EMPLOYEE'),
      ),
      [StateRuleKey.SDI_MAX_CONTRIBUTION]: availableEntry(
        StateRuleKey.SDI_MAX_CONTRIBUTION,
        maxContributionDetail('NOT_APPLICABLE'),
      ),
    });
    const result = calculateSdiEmployee(ruleSet, money('5000'), money('0'), money('0'));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // remaining = max(1000 - 0, 0) = 1000; taxable = min(5000, 1000) = 1000.
    expect(toStorageString(result.value.amount)).toBe('9');
  });

  it(
    'APPLIES with YTD SDI wages (StateYtd.sdiWages) already consuming most of the base: ' +
      'only the remaining base is taxed this period',
    () => {
      const ruleSet = buildRuleSet({
        [StateRuleKey.SDI_WAGE_BASE]: availableEntry(
          StateRuleKey.SDI_WAGE_BASE,
          wageBaseDetail('APPLIES', '1000'),
        ),
        [StateRuleKey.SDI_EMPLOYEE_RATE]: availableEntry(
          StateRuleKey.SDI_EMPLOYEE_RATE,
          rateDetail('0.01', 'DECIMAL_FRACTION', 'EMPLOYEE'),
        ),
        [StateRuleKey.SDI_MAX_CONTRIBUTION]: availableEntry(
          StateRuleKey.SDI_MAX_CONTRIBUTION,
          maxContributionDetail('NOT_APPLICABLE'),
        ),
      });
      const result = calculateSdiEmployee(ruleSet, money('5000'), money('900'), money('0'));
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      // remaining = max(1000 - 900, 0) = 100; taxable = min(5000, 100) = 100.
      expect(toStorageString(result.value.amount)).toBe('1');
    },
  );

  it('APPLIES with YTD already at or above the base: taxable wages floor at zero, never negative', () => {
    const ruleSet = buildRuleSet({
      [StateRuleKey.SDI_WAGE_BASE]: availableEntry(
        StateRuleKey.SDI_WAGE_BASE,
        wageBaseDetail('APPLIES', '1000'),
      ),
      [StateRuleKey.SDI_EMPLOYEE_RATE]: availableEntry(
        StateRuleKey.SDI_EMPLOYEE_RATE,
        rateDetail('0.01', 'DECIMAL_FRACTION', 'EMPLOYEE'),
      ),
      [StateRuleKey.SDI_MAX_CONTRIBUTION]: availableEntry(
        StateRuleKey.SDI_MAX_CONTRIBUTION,
        maxContributionDetail('NOT_APPLICABLE'),
      ),
    });
    const result = calculateSdiEmployee(ruleSet, money('5000'), money('1500'), money('0'));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(toStorageString(result.value.amount)).toBe('0');
  });

  it('missing SDI_WAGE_BASE rule entirely fails RULE_MISSING, never treated as "no cap"', () => {
    const ruleSet = buildRuleSet({
      [StateRuleKey.SDI_EMPLOYEE_RATE]: availableEntry(
        StateRuleKey.SDI_EMPLOYEE_RATE,
        rateDetail('0.009', 'DECIMAL_FRACTION', 'EMPLOYEE'),
      ),
    });
    const result = calculateSdiEmployee(ruleSet, money('5000'), money('0'), money('0'));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problem.reason).toBe('RULE_MISSING');
  });

  it('an unverified SDI_WAGE_BASE rule fails RULE_UNVERIFIED, never used', () => {
    const ruleSet = buildRuleSet({
      [StateRuleKey.SDI_WAGE_BASE]: availableEntry(
        StateRuleKey.SDI_WAGE_BASE,
        wageBaseDetail('NOT_APPLICABLE'),
        { verificationStatus: 'PENDING' },
      ),
      [StateRuleKey.SDI_EMPLOYEE_RATE]: availableEntry(
        StateRuleKey.SDI_EMPLOYEE_RATE,
        rateDetail('0.009', 'DECIMAL_FRACTION', 'EMPLOYEE'),
      ),
    });
    const result = calculateSdiEmployee(ruleSet, money('5000'), money('0'), money('0'));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problem.reason).toBe('RULE_UNVERIFIED');
  });
});

describe('maximum contribution — YTD-aware capping (DM-03 SDI/PFML contribution-maximum wiring)', () => {
  function maxRuleSet(
    amount: string,
    inclusive: boolean | null = null,
    rate = '0.01',
  ): ResolvedStateRuleSet {
    return buildRuleSet({
      [StateRuleKey.SDI_WAGE_BASE]: availableEntry(
        StateRuleKey.SDI_WAGE_BASE,
        wageBaseDetail('NOT_APPLICABLE'),
      ),
      [StateRuleKey.SDI_EMPLOYEE_RATE]: availableEntry(
        StateRuleKey.SDI_EMPLOYEE_RATE,
        rateDetail(rate, 'DECIMAL_FRACTION', 'EMPLOYEE'),
      ),
      [StateRuleKey.SDI_MAX_CONTRIBUTION]: availableEntry(
        StateRuleKey.SDI_MAX_CONTRIBUTION,
        maxContributionDetail('APPLIES', amount, inclusive),
      ),
    });
  }

  it('no YTD contribution: full period contribution allowed up to the max', () => {
    const ruleSet = maxRuleSet('1000');
    // period contribution = 5000 * 0.01 = 50; remaining = max(1000 - 0, 0) = 1000.
    const result = calculateSdiEmployee(ruleSet, money('5000'), money('0'), money('0'));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(toStorageString(result.value.amount)).toBe('50');
  });

  it('YTD contribution below max: only the remaining contribution is allowed', () => {
    const ruleSet = maxRuleSet('60');
    // period contribution = 5000 * 0.01 = 50; remaining = max(60 - 30, 0) = 30.
    const result = calculateSdiEmployee(ruleSet, money('5000'), money('0'), money('30'));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(toStorageString(result.value.amount)).toBe('30');
  });

  it('YTD contribution exactly at max: current contribution becomes zero', () => {
    const ruleSet = maxRuleSet('60');
    const result = calculateSdiEmployee(ruleSet, money('5000'), money('0'), money('60'));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(toStorageString(result.value.amount)).toBe('0');
  });

  it('YTD contribution above max: current contribution becomes zero, never negative', () => {
    const ruleSet = maxRuleSet('60');
    const result = calculateSdiEmployee(ruleSet, money('5000'), money('0'), money('75'));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(toStorageString(result.value.amount)).toBe('0');
  });

  it('period contribution itself is below the remaining cap: unchanged', () => {
    const ruleSet = maxRuleSet('1000', null, '0.001');
    // period contribution = 5000 * 0.001 = 5; remaining = max(1000 - 200, 0) = 800.
    const result = calculateSdiEmployee(ruleSet, money('5000'), money('0'), money('200'));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(toStorageString(result.value.amount)).toBe('5');
  });

  it('SDI_MAX_CONTRIBUTION NOT_APPLICABLE: preserves existing uncapped semantics', () => {
    const ruleSet = uncappedEmployeeRuleSet('0.01');
    const result = calculateSdiEmployee(ruleSet, money('5000'), money('0'), money('0'));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(toStorageString(result.value.amount)).toBe('50');
  });

  it('missing SDI_MAX_CONTRIBUTION rule fails RULE_MISSING, never treated as "no cap"', () => {
    const ruleSet = buildRuleSet({
      [StateRuleKey.SDI_WAGE_BASE]: availableEntry(
        StateRuleKey.SDI_WAGE_BASE,
        wageBaseDetail('NOT_APPLICABLE'),
      ),
      [StateRuleKey.SDI_EMPLOYEE_RATE]: availableEntry(
        StateRuleKey.SDI_EMPLOYEE_RATE,
        rateDetail('0.01', 'DECIMAL_FRACTION', 'EMPLOYEE'),
      ),
    });
    const result = calculateSdiEmployee(ruleSet, money('5000'), money('0'), money('0'));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problem.reason).toBe('RULE_MISSING');
    expect(result.problem.ruleKey).toBe(StateRuleKey.SDI_MAX_CONTRIBUTION);
  });

  it('an unverified SDI_MAX_CONTRIBUTION rule fails RULE_UNVERIFIED, never used', () => {
    const ruleSet = buildRuleSet({
      [StateRuleKey.SDI_WAGE_BASE]: availableEntry(
        StateRuleKey.SDI_WAGE_BASE,
        wageBaseDetail('NOT_APPLICABLE'),
      ),
      [StateRuleKey.SDI_EMPLOYEE_RATE]: availableEntry(
        StateRuleKey.SDI_EMPLOYEE_RATE,
        rateDetail('0.01', 'DECIMAL_FRACTION', 'EMPLOYEE'),
      ),
      [StateRuleKey.SDI_MAX_CONTRIBUTION]: availableEntry(
        StateRuleKey.SDI_MAX_CONTRIBUTION,
        maxContributionDetail('APPLIES', '1000'),
        { verificationStatus: 'PENDING' },
      ),
    });
    const result = calculateSdiEmployee(ruleSet, money('5000'), money('0'), money('0'));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problem.reason).toBe('RULE_UNVERIFIED');
  });

  it('inclusive: true is preserved — never inferred, never changes the capped amount', () => {
    const ruleSet = maxRuleSet('60', true);
    const result = calculateSdiEmployee(ruleSet, money('5000'), money('0'), money('30'));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(toStorageString(result.value.amount)).toBe('30');
  });

  it('inclusive: false is preserved — never inferred, never changes the capped amount', () => {
    const ruleSet = maxRuleSet('60', false);
    const result = calculateSdiEmployee(ruleSet, money('5000'), money('0'), money('30'));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(toStorageString(result.value.amount)).toBe('30');
  });

  it('inclusive: null is preserved as unresolved — never silently converted to true or false', () => {
    const ruleSet = maxRuleSet('60', null);
    const result = calculateSdiEmployee(ruleSet, money('5000'), money('0'), money('30'));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Identical result to the true/false cases above: inclusive never changes arithmetic.
    expect(toStorageString(result.value.amount)).toBe('30');
  });
});

describe('rate applicability and appliesTo — consulted, never assumed', () => {
  it('SDI_EMPLOYEE_RATE resolving NOT_APPLICABLE reports SCENARIO_UNSUPPORTED, no rate assumed', () => {
    const ruleSet = buildRuleSet({
      [StateRuleKey.SDI_WAGE_BASE]: availableEntry(
        StateRuleKey.SDI_WAGE_BASE,
        wageBaseDetail('NOT_APPLICABLE'),
      ),
      [StateRuleKey.SDI_EMPLOYEE_RATE]: availableEntry(
        StateRuleKey.SDI_EMPLOYEE_RATE,
        rateDetail(null, 'DECIMAL_FRACTION', 'EMPLOYEE', 'NOT_APPLICABLE'),
      ),
    });
    const result = calculateSdiEmployee(ruleSet, money('5000'), money('0'), money('0'));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problem.reason).toBe('SCENARIO_UNSUPPORTED');
  });

  it(
    'a rate recorded appliesTo EMPLOYER under the SDI_EMPLOYEE_RATE key is a data ' +
      'inconsistency, not silently used',
    () => {
      const ruleSet = buildRuleSet({
        [StateRuleKey.SDI_WAGE_BASE]: availableEntry(
          StateRuleKey.SDI_WAGE_BASE,
          wageBaseDetail('NOT_APPLICABLE'),
        ),
        [StateRuleKey.SDI_EMPLOYEE_RATE]: availableEntry(
          StateRuleKey.SDI_EMPLOYEE_RATE,
          rateDetail('0.009', 'DECIMAL_FRACTION', 'EMPLOYER'),
        ),
      });
      const result = calculateSdiEmployee(ruleSet, money('5000'), money('0'), money('0'));
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.problem.reason).toBe('SCENARIO_UNSUPPORTED');
    },
  );

  it('a null rate amount (source has not stated it) reports COMPONENT_NOT_STATED, never zero', () => {
    const ruleSet = buildRuleSet({
      [StateRuleKey.SDI_WAGE_BASE]: availableEntry(
        StateRuleKey.SDI_WAGE_BASE,
        wageBaseDetail('NOT_APPLICABLE'),
      ),
      [StateRuleKey.SDI_EMPLOYEE_RATE]: availableEntry(
        StateRuleKey.SDI_EMPLOYEE_RATE,
        rateDetail(null, 'DECIMAL_FRACTION', 'EMPLOYEE'),
      ),
    });
    const result = calculateSdiEmployee(ruleSet, money('5000'), money('0'), money('0'));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problem.reason).toBe('COMPONENT_NOT_STATED');
  });
});

describe('missing/unverified/invalid SDI_EMPLOYEE_RATE — established readDetail() behavior', () => {
  it('the rate rule missing entirely fails RULE_MISSING', () => {
    const ruleSet = buildRuleSet({
      [StateRuleKey.SDI_WAGE_BASE]: availableEntry(
        StateRuleKey.SDI_WAGE_BASE,
        wageBaseDetail('NOT_APPLICABLE'),
      ),
    });
    const result = calculateSdiEmployee(ruleSet, money('5000'), money('0'), money('0'));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problem.reason).toBe('RULE_MISSING');
  });

  it('an unverified rate rule fails RULE_UNVERIFIED, never used', () => {
    const ruleSet = buildRuleSet({
      [StateRuleKey.SDI_WAGE_BASE]: availableEntry(
        StateRuleKey.SDI_WAGE_BASE,
        wageBaseDetail('NOT_APPLICABLE'),
      ),
      [StateRuleKey.SDI_EMPLOYEE_RATE]: availableEntry(
        StateRuleKey.SDI_EMPLOYEE_RATE,
        rateDetail('0.009', 'DECIMAL_FRACTION', 'EMPLOYEE'),
        { verificationStatus: 'PENDING' },
      ),
    });
    const result = calculateSdiEmployee(ruleSet, money('5000'), money('0'), money('0'));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problem.reason).toBe('RULE_UNVERIFIED');
  });

  it('an invalid detail shape under the rate key fails RULE_DETAIL_INVALID', () => {
    const ruleSet = buildRuleSet({
      [StateRuleKey.SDI_WAGE_BASE]: availableEntry(
        StateRuleKey.SDI_WAGE_BASE,
        wageBaseDetail('NOT_APPLICABLE'),
      ),
      [StateRuleKey.SDI_EMPLOYEE_RATE]: availableEntry(StateRuleKey.SDI_EMPLOYEE_RATE, {
        shape: 'WAGE_BASE',
        amount: '1',
        basis: 'ANNUAL',
        applicability: 'APPLIES',
      }),
    });
    const result = calculateSdiEmployee(ruleSet, money('5000'), money('0'), money('0'));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problem.reason).toBe('RULE_DETAIL_INVALID');
  });
});

describe('provenance', () => {
  it('merges the wage-base, rate, and maximum-contribution rule references, deduplicated', () => {
    const ruleSet = uncappedEmployeeRuleSet('0.009');
    const result = calculateSdiEmployee(ruleSet, money('50000'), money('0'), money('0'));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const ruleKeys = result.value.rules.map((r) => r.ruleKey).sort();
    expect(ruleKeys).toEqual(
      [
        StateRuleKey.SDI_EMPLOYEE_RATE,
        StateRuleKey.SDI_WAGE_BASE,
        StateRuleKey.SDI_MAX_CONTRIBUTION,
      ]
        .slice()
        .sort(),
    );
  });

  it('never fabricates a reference when the calculation itself fails', () => {
    const ruleSet = buildRuleSet({});
    const result = calculateSdiEmployee(ruleSet, money('5000'), money('0'), money('0'));
    expect(result.ok).toBe(false);
  });
});

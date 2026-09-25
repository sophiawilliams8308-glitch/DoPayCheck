import { describe, expect, it } from 'vitest';

import { money } from '@/lib/core/money';
import type { RuleReference } from '@/lib/calculator/types/rules';
import {
  deriveResolvedStateWageBuckets,
  type ResolvedStateWageBucketsInput,
} from '@/lib/tax/state/wages/deriveResolvedStateWageBuckets';
import {
  freezeStateRuleSet,
  type ResolvedStateRule,
  type ResolvedStateRuleSet,
  type StateRuleEntry,
} from '@/lib/tax/state/rules/stateRuleSet';
import { StateRuleKey } from '@/lib/tax/state/ruleKeys';
import type { StateDeductionLine } from '@/lib/tax/state/types';

/**
 * Resolver-driven state wage-bucket derivation tests — DM-03 Slice 7.
 *
 * Exercises the REAL `resolveTaxability()` implementation end to end (no
 * mocking), mirroring `state-taxability-resolver.test.ts`'s own fixture
 * conventions. Fixtures use synthetic jurisdiction/deduction identifiers
 * and no real tax value.
 *
 * OWNER-LOCKED DM-03 FORMULA under test (Slice 7): SCOPE GLOBAL, Option B —
 *   taxable = max(gross - totalReduce, 0) + totalIncrease
 */

const JURISDICTION_CODE = 'TEST-DM03-BUCKETS';
const JURISDICTION_ID = 'test-dm03-buckets-jurisdiction-id';
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

function availableEntry(detail: unknown): { available: true; rule: ResolvedStateRule } {
  return {
    available: true,
    rule: { key: KEY, reference: reference(KEY), detail, verificationStatus: 'VERIFIED' },
  };
}

function ruleSetFor(detail: unknown): ResolvedStateRuleSet {
  const entries: Partial<Record<StateRuleKey, StateRuleEntry>> = { [KEY]: availableEntry(detail) };
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

type Effect = 'REDUCE_WAGES' | 'INCREASE_WAGES' | 'NO_CHANGE' | 'NOT_STATED';
type Program = 'INCOME_TAX_WITHHOLDING' | 'SDI' | 'PFML' | 'SUTA';

/** One profile, one program, one unconditional (default) variant, no limit. */
function profile(
  deductionTypeKey: string,
  effect: Effect,
  program: Program = 'INCOME_TAX_WITHHOLDING',
) {
  return {
    deductionTypeKey,
    programTreatments: {
      [program]: { variants: [{ conditions: [], effect, limit: null }] },
    },
  };
}

function profileSet(profiles: readonly unknown[]) {
  return { shape: 'TAXABILITY_PROFILE_SET', profiles };
}

/** One profile, one deductionTypeKey, treatments for SEVERAL programs at
 * once — the schema forbids two profile entries sharing one deductionTypeKey
 * (Slice 1), so a deduction resolving differently per program must be
 * expressed as one profile with multiple `programTreatments` keys. */
function multiProgramProfile(
  deductionTypeKey: string,
  treatments: Partial<Record<Program, Effect>>,
) {
  const programTreatments: Record<string, unknown> = {};
  for (const [program, effect] of Object.entries(treatments)) {
    programTreatments[program] = { variants: [{ conditions: [], effect, limit: null }] };
  }
  return { deductionTypeKey, programTreatments };
}

function deduction(deductionTypeKey: string, amount: string): StateDeductionLine {
  return { deductionTypeKey, amount };
}

function input(
  overrides: Partial<ResolvedStateWageBucketsInput> & { ruleSet: ResolvedStateRuleSet },
): ResolvedStateWageBucketsInput {
  return {
    wages: { regular: money('1000'), supplemental: money('0') },
    deductions: [],
    context: {},
    ...overrides,
  };
}

describe('single deduction, single direction', () => {
  it('REDUCE_WAGES subtracts effectiveAmount from the bucket', () => {
    const ruleSet = ruleSetFor(profileSet([profile('DED_R', 'REDUCE_WAGES')]));
    const result = deriveResolvedStateWageBuckets(
      input({ ruleSet, deductions: [deduction('DED_R', '150')] }),
    );
    expect(result.stateIncomeTaxWages.status).toBe('COMPLETE');
    expect(result.stateIncomeTaxWages.amount).toBe('850');
  });

  it('INCREASE_WAGES adds effectiveAmount to the bucket', () => {
    const ruleSet = ruleSetFor(profileSet([profile('DED_I', 'INCREASE_WAGES')]));
    const result = deriveResolvedStateWageBuckets(
      input({ ruleSet, deductions: [deduction('DED_I', '75')] }),
    );
    expect(result.stateIncomeTaxWages.status).toBe('COMPLETE');
    expect(result.stateIncomeTaxWages.amount).toBe('1075');
  });

  it('NO_CHANGE leaves the bucket at gross', () => {
    const ruleSet = ruleSetFor(profileSet([profile('DED_N', 'NO_CHANGE')]));
    const result = deriveResolvedStateWageBuckets(
      input({ ruleSet, deductions: [deduction('DED_N', '999')] }),
    );
    expect(result.stateIncomeTaxWages.status).toBe('COMPLETE');
    expect(result.stateIncomeTaxWages.amount).toBe('1000');
  });
});

describe('multiple deductions, same direction', () => {
  it('sums multiple REDUCE_WAGES deductions before subtracting once', () => {
    const ruleSet = ruleSetFor(
      profileSet([profile('DED_R1', 'REDUCE_WAGES'), profile('DED_R2', 'REDUCE_WAGES')]),
    );
    const result = deriveResolvedStateWageBuckets(
      input({
        ruleSet,
        deductions: [deduction('DED_R1', '100'), deduction('DED_R2', '50')],
      }),
    );
    expect(result.stateIncomeTaxWages.amount).toBe('850');
  });

  it('sums multiple INCREASE_WAGES deductions before adding once', () => {
    const ruleSet = ruleSetFor(
      profileSet([profile('DED_I1', 'INCREASE_WAGES'), profile('DED_I2', 'INCREASE_WAGES')]),
    );
    const result = deriveResolvedStateWageBuckets(
      input({
        ruleSet,
        deductions: [deduction('DED_I1', '40'), deduction('DED_I2', '60')],
      }),
    );
    expect(result.stateIncomeTaxWages.amount).toBe('1100');
  });
});

describe('mixed REDUCE_WAGES + INCREASE_WAGES — owner-locked formula B', () => {
  it('applies the floor to the reduction only, then adds the increase on top', () => {
    // gross = 1000, totalReduce = 1500, totalIncrease = 200
    // Formula B: max(1000 - 1500, 0) + 200 = 0 + 200 = 200
    // (Formula A would give max(1000 - 1500 + 200, 0) = max(-300, 0) = 0 — a
    // DIFFERENT result, which is exactly why this case distinguishes them.)
    const ruleSet = ruleSetFor(
      profileSet([profile('DED_R', 'REDUCE_WAGES'), profile('DED_I', 'INCREASE_WAGES')]),
    );
    const result = deriveResolvedStateWageBuckets(
      input({
        wages: { regular: money('1000'), supplemental: money('0') },
        ruleSet,
        deductions: [deduction('DED_R', '1500'), deduction('DED_I', '200')],
      }),
    );
    expect(result.stateIncomeTaxWages.status).toBe('COMPLETE');
    expect(result.stateIncomeTaxWages.amount).toBe('200');
  });

  it('proves INCREASE_WAGES is never discarded when the reduction reaches the floor', () => {
    // Even a reduction far exceeding gross must not zero out the increase.
    const ruleSet = ruleSetFor(
      profileSet([profile('DED_R', 'REDUCE_WAGES'), profile('DED_I', 'INCREASE_WAGES')]),
    );
    const result = deriveResolvedStateWageBuckets(
      input({
        wages: { regular: money('100'), supplemental: money('0') },
        ruleSet,
        deductions: [deduction('DED_R', '100000'), deduction('DED_I', '333.33')],
      }),
    );
    expect(result.stateIncomeTaxWages.amount).toBe('333.33');
  });

  it('produces the ordinary case where reduction does not exceed gross', () => {
    // gross = 1000, totalReduce = 200, totalIncrease = 50
    // Formula B: max(1000 - 200, 0) + 50 = 800 + 50 = 850 (identical to Formula A here)
    const ruleSet = ruleSetFor(
      profileSet([profile('DED_R', 'REDUCE_WAGES'), profile('DED_I', 'INCREASE_WAGES')]),
    );
    const result = deriveResolvedStateWageBuckets(
      input({
        ruleSet,
        deductions: [deduction('DED_R', '200'), deduction('DED_I', '50')],
      }),
    );
    expect(result.stateIncomeTaxWages.amount).toBe('850');
  });
});

describe('multiple buckets', () => {
  it('derives all four buckets independently from their own mapped program', () => {
    const ruleSet = ruleSetFor(
      profileSet([
        multiProgramProfile('DED', {
          INCOME_TAX_WITHHOLDING: 'REDUCE_WAGES',
          SDI: 'NO_CHANGE',
          PFML: 'INCREASE_WAGES',
          SUTA: 'REDUCE_WAGES',
        }),
      ]),
    );
    const result = deriveResolvedStateWageBuckets(
      input({ ruleSet, deductions: [deduction('DED', '100')] }),
    );
    expect(result.stateIncomeTaxWages.amount).toBe('900');
    expect(result.sdiWages.amount).toBe('1000');
    expect(result.pfmlWages.amount).toBe('1100');
    expect(result.sutaWages.amount).toBe('900');
  });
});

describe('one deduction, multiple programs (Colorado FAMLI-shaped divergence)', () => {
  it('resolves independently per program — reduce for income tax, no-change for PFML', () => {
    const ruleSet = ruleSetFor(
      profileSet([
        multiProgramProfile('PRETAX', {
          INCOME_TAX_WITHHOLDING: 'REDUCE_WAGES',
          PFML: 'NO_CHANGE',
        }),
      ]),
    );
    const result = deriveResolvedStateWageBuckets(
      input({ ruleSet, deductions: [deduction('PRETAX', '75')] }),
    );
    expect(result.stateIncomeTaxWages.amount).toBe('925');
    expect(result.pfmlWages.amount).toBe('1000');
  });
});

describe('resolver effectiveAmount is authoritative, never the raw applicableAmount', () => {
  it('uses the capped effectiveAmount from a limited REDUCE_WAGES variant, not the raw deduction amount', () => {
    const capped = {
      deductionTypeKey: 'CAPPED',
      programTreatments: {
        INCOME_TAX_WITHHOLDING: {
          variants: [
            {
              conditions: [],
              effect: 'REDUCE_WAGES',
              limit: {
                basis: 'PAY_PERIOD',
                amount: '50',
                scope: 'PER_EMPLOYEE',
                variantsByDiscriminator: null,
              },
              excessEffect: 'NO_CHANGE',
            },
          ],
        },
      },
    };
    const ruleSet = ruleSetFor(profileSet([capped]));
    const result = deriveResolvedStateWageBuckets(
      // Raw applicable amount is 300, far above the 50 cap.
      input({ ruleSet, deductions: [deduction('CAPPED', '300')] }),
    );
    // gross 1000 - effectiveAmount 50 (capped, NOT the raw 300) = 950
    expect(result.stateIncomeTaxWages.amount).toBe('950');
  });
});

describe('provenance', () => {
  it('preserves the exact RuleReference from resolveTaxability(), deduplicated across contributing deductions', () => {
    const ruleSet = ruleSetFor(
      profileSet([profile('DED_A', 'REDUCE_WAGES'), profile('DED_B', 'REDUCE_WAGES')]),
    );
    const result = deriveResolvedStateWageBuckets(
      input({
        ruleSet,
        deductions: [deduction('DED_A', '10'), deduction('DED_B', '20')],
      }),
    );
    expect(result.stateIncomeTaxWages.rules).toHaveLength(1);
    expect(result.stateIncomeTaxWages.rules[0]).toEqual(reference(KEY));
  });

  it('never carries a RuleReference on an unavailable bucket', () => {
    const ruleSet = ruleSetFor(profileSet([]));
    const result = deriveResolvedStateWageBuckets(
      input({ ruleSet, deductions: [deduction('UNKNOWN', '10')] }),
    );
    expect(result.stateIncomeTaxWages.status).not.toBe('COMPLETE');
    expect(result.stateIncomeTaxWages.rules).toEqual([]);
  });
});

describe('unavailable / unsupported taxability', () => {
  it('a missing profile makes the bucket unavailable, never zero or NO_CHANGE', () => {
    const ruleSet = ruleSetFor(profileSet([]));
    const result = deriveResolvedStateWageBuckets(
      input({ ruleSet, deductions: [deduction('UNKNOWN', '500')] }),
    );
    expect(result.stateIncomeTaxWages.amount).toBeNull();
    expect(result.stateIncomeTaxWages.status).not.toBe('COMPLETE');
    expect(result.stateIncomeTaxWages.problem?.reason).toBe('RULE_MISSING');
  });

  it('an explicit NOT_STATED effect makes the bucket unavailable, never zero or NO_CHANGE', () => {
    const ruleSet = ruleSetFor(profileSet([profile('DED', 'NOT_STATED')]));
    const result = deriveResolvedStateWageBuckets(
      input({ ruleSet, deductions: [deduction('DED', '500')] }),
    );
    expect(result.stateIncomeTaxWages.amount).toBeNull();
    expect(result.stateIncomeTaxWages.status).toBe('UNSUPPORTED_SCENARIO');
    expect(result.stateIncomeTaxWages.problem?.reason).toBe('SCENARIO_UNSUPPORTED');
  });

  it('an ANNUAL limit with no available prior usage makes the bucket unavailable (priorAppliedAmount is never invented)', () => {
    const annualCapped = {
      deductionTypeKey: 'DEP_CARE',
      programTreatments: {
        INCOME_TAX_WITHHOLDING: {
          variants: [
            {
              conditions: [],
              effect: 'REDUCE_WAGES',
              limit: {
                basis: 'ANNUAL',
                amount: '5000',
                scope: 'PER_EMPLOYEE',
                variantsByDiscriminator: null,
              },
              excessEffect: 'NO_CHANGE',
            },
          ],
        },
      },
    };
    const ruleSet = ruleSetFor(profileSet([annualCapped]));
    const result = deriveResolvedStateWageBuckets(
      input({ ruleSet, deductions: [deduction('DEP_CARE', '200')] }),
    );
    expect(result.stateIncomeTaxWages.amount).toBeNull();
    expect(result.stateIncomeTaxWages.status).toBe('UNSUPPORTED_SCENARIO');
    expect(result.stateIncomeTaxWages.problem?.reason).toBe('SCENARIO_UNSUPPORTED');
  });
});

describe('other buckets unaffected by an unavailable one', () => {
  it('an unresolvable income-tax treatment does not block an independently-resolvable SDI treatment', () => {
    const ruleSet = ruleSetFor(
      profileSet([
        multiProgramProfile('DED', { INCOME_TAX_WITHHOLDING: 'NOT_STATED', SDI: 'NO_CHANGE' }),
        profile('DED2', 'REDUCE_WAGES', 'SDI'),
      ]),
    );
    const result = deriveResolvedStateWageBuckets(
      input({
        ruleSet,
        deductions: [deduction('DED', '10'), deduction('DED2', '10')],
      }),
    );
    expect(result.stateIncomeTaxWages.amount).toBeNull();
    expect(result.sdiWages.status).toBe('COMPLETE');
    expect(result.sdiWages.amount).toBe('990');
  });
});

describe('decimal arithmetic', () => {
  it('produces no floating-point drift on repeating-decimal-prone inputs', () => {
    const ruleSet = ruleSetFor(
      profileSet([profile('DED_R', 'REDUCE_WAGES'), profile('DED_I', 'INCREASE_WAGES')]),
    );
    const result = deriveResolvedStateWageBuckets(
      input({
        wages: { regular: money('100.10'), supplemental: money('0') },
        ruleSet,
        deductions: [deduction('DED_R', '0.30'), deduction('DED_I', '0.20')],
      }),
    );
    // max(100.10 - 0.30, 0) + 0.20 = 99.80 + 0.20 = 100.00
    expect(result.stateIncomeTaxWages.amount).toBe('100');
  });
});

describe('existing null/unresolved bucket semantics preserved', () => {
  it('no deductions at all resolves every bucket at full gross, COMPLETE, no rules', () => {
    const ruleSet = ruleSetFor(profileSet([]));
    const result = deriveResolvedStateWageBuckets(input({ ruleSet, deductions: [] }));
    expect(result.stateIncomeTaxWages.status).toBe('COMPLETE');
    expect(result.stateIncomeTaxWages.amount).toBe('1000');
    expect(result.stateIncomeTaxWages.rules).toEqual([]);
  });
});

describe('regular vs supplemental basis, unchanged from Option A', () => {
  it('excludes supplemental from state income tax wages but includes it in SDI/PFML/SUTA', () => {
    const ruleSet = ruleSetFor(profileSet([]));
    const result = deriveResolvedStateWageBuckets(
      input({
        ruleSet,
        wages: { regular: money('1000'), supplemental: money('250') },
        deductions: [],
      }),
    );
    expect(result.stateIncomeTaxWages.amount).toBe('1000');
    expect(result.sdiWages.amount).toBe('1250');
    expect(result.pfmlWages.amount).toBe('1250');
    expect(result.sutaWages.amount).toBe('1250');
  });
});

describe('purity', () => {
  it('does not mutate the supplied ResolvedStateRuleSet, wages, or deductions', () => {
    const ruleSet = ruleSetFor(profileSet([profile('DED', 'REDUCE_WAGES')]));
    const deductions = [deduction('DED', '10')];
    const wages = { regular: money('1000'), supplemental: money('0') };
    deriveResolvedStateWageBuckets({ ruleSet, wages, deductions, context: {} });
    expect(Object.isFrozen(ruleSet)).toBe(true);
    expect(deductions).toEqual([{ deductionTypeKey: 'DED', amount: '10' }]);
  });
});

import { describe, expect, it } from 'vitest';

import { money } from '@/lib/core/money';
import type { RuleReference } from '@/lib/calculator/types/rules';
import {
  resolveTaxability,
  type TaxabilityResolutionContext,
  type TaxabilityResolutionInput,
} from '@/lib/tax/state/rules/resolveTaxability';
import { readTaxabilityProfileSet } from '@/lib/tax/state/rules/readTaxabilityProfileSet';
import {
  freezeStateRuleSet,
  type ResolvedStateRule,
  type ResolvedStateRuleSet,
  type StateRuleEntry,
} from '@/lib/tax/state/rules/stateRuleSet';
import { StateRuleKey } from '@/lib/tax/state/ruleKeys';

/**
 * DM-03 taxability resolver tests — Slice 2 (Task 4O-6R68).
 *
 * Fixtures use RESERVED TEST jurisdiction/deduction identifiers and no real
 * tax value — mirroring `state-taxability.test.ts`'s own established
 * convention exactly.
 */

const JURISDICTION_CODE = 'TEST-DM03';
const JURISDICTION_ID = 'test-dm03-jurisdiction-id';
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

function availableEntry(
  detail: unknown,
  overrides: { verificationStatus?: string } = {},
): { available: true; rule: ResolvedStateRule } {
  return {
    available: true,
    rule: {
      key: KEY,
      reference: reference(KEY),
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

function ruleSetFor(detail: unknown, verificationStatus = 'VERIFIED'): ResolvedStateRuleSet {
  return buildRuleSet({ [KEY]: availableEntry(detail, { verificationStatus }) });
}

/** One-profile, one-program, one-default-variant DM-03 payload builder. */
function profileSetWith(
  deductionTypeKey: string,
  variants: readonly Record<string, unknown>[],
  program: 'INCOME_TAX_WITHHOLDING' | 'SDI' | 'PFML' | 'SUTA' = 'INCOME_TAX_WITHHOLDING',
) {
  return {
    shape: 'TAXABILITY_PROFILE_SET',
    profiles: [
      {
        deductionTypeKey,
        programTreatments: { [program]: { variants } },
      },
    ],
  };
}

function resolve(
  overrides: Partial<TaxabilityResolutionInput> & { ruleSet: ResolvedStateRuleSet },
) {
  const defaultContext: TaxabilityResolutionContext = {};
  return resolveTaxability({
    deductionTypeKey: 'SYNTHETIC_DEDUCTION',
    program: 'INCOME_TAX_WITHHOLDING',
    applicableAmount: money('100'),
    context: defaultContext,
    ...overrides,
  });
}

const UNLIMITED_REDUCE = profileSetWith('SYNTHETIC_DEDUCTION', [
  { conditions: [], effect: 'REDUCE_WAGES', limit: null },
]);

describe('rule resolution', () => {
  it('reports RULE_MISSING when no TAXABILITY_PROFILE rule resolved at all', () => {
    const ruleSet = buildRuleSet({});
    const outcome = resolve({ ruleSet });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error('expected failure');
    expect(outcome.problem.reason).toBe('RULE_MISSING');
  });

  it('reports RULE_UNVERIFIED for a PENDING rule', () => {
    const ruleSet = ruleSetFor(UNLIMITED_REDUCE, 'PENDING');
    const outcome = resolve({ ruleSet });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error('expected failure');
    expect(outcome.problem.reason).toBe('RULE_UNVERIFIED');
  });

  it('reports RULE_DETAIL_INVALID for a schema-invalid detail', () => {
    const ruleSet = ruleSetFor({ shape: 'TAXABILITY_PROFILE_SET' });
    const outcome = resolve({ ruleSet });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error('expected failure');
    expect(outcome.problem.reason).toBe('RULE_DETAIL_INVALID');
  });

  it('accepts a valid TAXABILITY_PROFILE_SET and proceeds', () => {
    const ruleSet = ruleSetFor(UNLIMITED_REDUCE);
    const outcome = resolve({ ruleSet });
    expect(outcome.ok).toBe(true);
  });
});

describe('deduction selection', () => {
  it('resolves a matching deductionTypeKey', () => {
    const ruleSet = ruleSetFor(UNLIMITED_REDUCE);
    const outcome = resolve({ ruleSet, deductionTypeKey: 'SYNTHETIC_DEDUCTION' });
    expect(outcome.ok).toBe(true);
  });

  it('reports RULE_MISSING for a deductionTypeKey absent from profiles[]', () => {
    const ruleSet = ruleSetFor(UNLIMITED_REDUCE);
    const outcome = resolve({ ruleSet, deductionTypeKey: 'NO_SUCH_DEDUCTION' });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error('expected failure');
    expect(outcome.problem.reason).toBe('RULE_MISSING');
    // Explicitly never NOT_STATED, NO_CHANGE, or SCENARIO_UNSUPPORTED (task §8).
    expect(outcome.problem.reason).not.toBe('SCENARIO_UNSUPPORTED');
  });
});

describe('program selection', () => {
  it('resolves a matching program', () => {
    const ruleSet = ruleSetFor(UNLIMITED_REDUCE);
    const outcome = resolve({ ruleSet, program: 'INCOME_TAX_WITHHOLDING' });
    expect(outcome.ok).toBe(true);
  });

  it('reports SCENARIO_UNSUPPORTED when the program key is absent from programTreatments', () => {
    const ruleSet = ruleSetFor(UNLIMITED_REDUCE);
    const outcome = resolve({ ruleSet, program: 'SDI' });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error('expected failure');
    expect(outcome.problem.reason).toBe('SCENARIO_UNSUPPORTED');
  });

  it('reports SCENARIO_UNSUPPORTED for an explicit NOT_STATED variant, identically to an absent program', () => {
    const detail = profileSetWith(
      'SYNTHETIC_DEDUCTION',
      [{ conditions: [], effect: 'NOT_STATED', limit: null }],
      'PFML',
    );
    const ruleSet = ruleSetFor(detail);
    const outcome = resolve({ ruleSet, program: 'PFML' });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error('expected failure');
    expect(outcome.problem.reason).toBe('SCENARIO_UNSUPPORTED');
  });

  it('never falls back to another program', () => {
    const detail = profileSetWith(
      'SYNTHETIC_DEDUCTION',
      [{ conditions: [], effect: 'REDUCE_WAGES', limit: null }],
      'SUTA',
    );
    const ruleSet = ruleSetFor(detail);
    // Requesting PFML must not silently answer with SUTA's treatment.
    const outcome = resolve({ ruleSet, program: 'PFML' });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error('expected failure');
    expect(outcome.problem.reason).toBe('SCENARIO_UNSUPPORTED');
  });
});

describe('condition resolution', () => {
  const hsaDetail = profileSetWith('HSA', [
    {
      conditions: [
        { dimension: 'DELIVERY_MECHANISM', operator: 'EQUALS', values: ['CAFETERIA_PLAN'] },
      ],
      effect: 'REDUCE_WAGES',
      limit: null,
    },
    { conditions: [], effect: 'NO_CHANGE', limit: null },
  ]);

  it('EQUALS matches the named mechanism', () => {
    const ruleSet = ruleSetFor(hsaDetail);
    const outcome = resolve({
      ruleSet,
      deductionTypeKey: 'HSA',
      context: { deliveryMechanism: 'CAFETERIA_PLAN' },
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) throw new Error('expected ok');
    expect(outcome.resolution.direction).toBe('REDUCE_WAGES');
  });

  it('EQUALS falls through to the default for a different mechanism', () => {
    const ruleSet = ruleSetFor(hsaDetail);
    const outcome = resolve({
      ruleSet,
      deductionTypeKey: 'HSA',
      context: { deliveryMechanism: 'PAYROLL_DEDUCTION' },
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) throw new Error('expected ok');
    expect(outcome.resolution.direction).toBe('NO_CHANGE');
  });

  it('NOT_EQUALS matches every mechanism except the named one', () => {
    const detail = profileSetWith('DED_NE', [
      {
        conditions: [
          {
            dimension: 'DELIVERY_MECHANISM',
            operator: 'NOT_EQUALS',
            values: ['EMPLOYER_PROVIDED'],
          },
        ],
        effect: 'REDUCE_WAGES',
        limit: null,
      },
      { conditions: [], effect: 'NO_CHANGE', limit: null },
    ]);
    const ruleSet = ruleSetFor(detail);
    const matches = resolve({
      ruleSet,
      deductionTypeKey: 'DED_NE',
      context: { deliveryMechanism: 'CAFETERIA_PLAN' },
    });
    expect(matches.ok).toBe(true);
    if (!matches.ok) throw new Error('expected ok');
    expect(matches.resolution.direction).toBe('REDUCE_WAGES');

    const excluded = resolve({
      ruleSet,
      deductionTypeKey: 'DED_NE',
      context: { deliveryMechanism: 'EMPLOYER_PROVIDED' },
    });
    expect(excluded.ok).toBe(true);
    if (!excluded.ok) throw new Error('expected ok');
    expect(excluded.resolution.direction).toBe('NO_CHANGE');
  });

  it('IN matches any listed mechanism', () => {
    const detail = profileSetWith('DED_IN', [
      {
        conditions: [
          {
            dimension: 'DELIVERY_MECHANISM',
            operator: 'IN',
            values: ['CAFETERIA_PLAN', 'PAYROLL_DEDUCTION'],
          },
        ],
        effect: 'REDUCE_WAGES',
        limit: null,
      },
      { conditions: [], effect: 'NO_CHANGE', limit: null },
    ]);
    const ruleSet = ruleSetFor(detail);
    const outcome = resolve({
      ruleSet,
      deductionTypeKey: 'DED_IN',
      context: { deliveryMechanism: 'PAYROLL_DEDUCTION' },
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) throw new Error('expected ok');
    expect(outcome.resolution.direction).toBe('REDUCE_WAGES');
  });

  it('NOT_IN excludes every listed mechanism', () => {
    const detail = profileSetWith('DED_NIN', [
      {
        conditions: [
          {
            dimension: 'DELIVERY_MECHANISM',
            operator: 'NOT_IN',
            values: ['CAFETERIA_PLAN', 'PAYROLL_DEDUCTION'],
          },
        ],
        effect: 'REDUCE_WAGES',
        limit: null,
      },
      { conditions: [], effect: 'NO_CHANGE', limit: null },
    ]);
    const ruleSet = ruleSetFor(detail);
    const outcome = resolve({
      ruleSet,
      deductionTypeKey: 'DED_NIN',
      context: { deliveryMechanism: 'EMPLOYEE_CONTRIBUTION' },
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) throw new Error('expected ok');
    expect(outcome.resolution.direction).toBe('REDUCE_WAGES');
  });

  it('ANDs multiple conditions on one variant', () => {
    // Two conditions on the same dimension: both must hold. IN {CAFETERIA_PLAN,
    // PAYROLL_DEDUCTION} AND NOT_EQUALS PAYROLL_DEDUCTION narrows to CAFETERIA_PLAN only.
    const detail = profileSetWith('DED_AND', [
      {
        conditions: [
          {
            dimension: 'DELIVERY_MECHANISM',
            operator: 'IN',
            values: ['CAFETERIA_PLAN', 'PAYROLL_DEDUCTION'],
          },
          {
            dimension: 'DELIVERY_MECHANISM',
            operator: 'NOT_EQUALS',
            values: ['PAYROLL_DEDUCTION'],
          },
        ],
        effect: 'REDUCE_WAGES',
        limit: null,
      },
      { conditions: [], effect: 'NO_CHANGE', limit: null },
    ]);
    const ruleSet = ruleSetFor(detail);
    const bothMatch = resolve({
      ruleSet,
      deductionTypeKey: 'DED_AND',
      context: { deliveryMechanism: 'CAFETERIA_PLAN' },
    });
    expect(bothMatch.ok).toBe(true);
    if (!bothMatch.ok) throw new Error('expected ok');
    expect(bothMatch.resolution.direction).toBe('REDUCE_WAGES');

    const onlyOneMatches = resolve({
      ruleSet,
      deductionTypeKey: 'DED_AND',
      context: { deliveryMechanism: 'PAYROLL_DEDUCTION' },
    });
    expect(onlyOneMatches.ok).toBe(true);
    if (!onlyOneMatches.ok) throw new Error('expected ok');
    expect(onlyOneMatches.resolution.direction).toBe('NO_CHANGE');
  });

  it('selects the default variant when no non-default variant matches', () => {
    const ruleSet = ruleSetFor(hsaDetail);
    const outcome = resolve({
      ruleSet,
      deductionTypeKey: 'HSA',
      context: { deliveryMechanism: 'EMPLOYER_PROVIDED' },
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) throw new Error('expected ok');
    expect(outcome.resolution.direction).toBe('NO_CHANGE');
  });

  it('reports SCENARIO_UNSUPPORTED with no match and no default', () => {
    const detail = profileSetWith('DED_NO_DEFAULT', [
      {
        conditions: [
          { dimension: 'DELIVERY_MECHANISM', operator: 'EQUALS', values: ['CAFETERIA_PLAN'] },
        ],
        effect: 'REDUCE_WAGES',
        limit: null,
      },
    ]);
    const ruleSet = ruleSetFor(detail);
    const outcome = resolve({
      ruleSet,
      deductionTypeKey: 'DED_NO_DEFAULT',
      context: { deliveryMechanism: 'PAYROLL_DEDUCTION' },
    });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error('expected failure');
    expect(outcome.problem.reason).toBe('SCENARIO_UNSUPPORTED');
  });

  it('reports SCENARIO_UNSUPPORTED when delivery mechanism context is unavailable, never silently using the default', () => {
    const ruleSet = ruleSetFor(hsaDetail);
    const outcome = resolve({ ruleSet, deductionTypeKey: 'HSA', context: {} });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error('expected failure');
    expect(outcome.problem.reason).toBe('SCENARIO_UNSUPPORTED');
  });

  it('rejects overlapping (non-mutually-exclusive) variants before the resolver runs — schema-layer defense-in-depth', () => {
    // The DM-03 schema's mutual-exclusivity check (Slice 1) uses the exact
    // same closed-set arithmetic this resolver's own condition matching
    // does, so any two variants that could both match one DELIVERY_MECHANISM
    // value are already rejected by validateStateDetail() before
    // resolveTaxability() ever runs its own RULE_CONFLICT check (contract
    // step 6). This is disclosed in the Slice 2 report: the resolver's own
    // `matched.length > 1` branch is correct, defense-in-depth code per the
    // contract, but is not reachable via schema-valid data today.
    const overlapping = profileSetWith('DED_OVERLAP', [
      {
        conditions: [
          {
            dimension: 'DELIVERY_MECHANISM',
            operator: 'IN',
            values: ['CAFETERIA_PLAN', 'PAYROLL_DEDUCTION'],
          },
        ],
        effect: 'REDUCE_WAGES',
        limit: null,
      },
      {
        conditions: [
          {
            dimension: 'DELIVERY_MECHANISM',
            operator: 'NOT_EQUALS',
            values: ['EMPLOYER_PROVIDED'],
          },
        ],
        effect: 'NO_CHANGE',
        limit: null,
      },
    ]);
    const ruleSet = ruleSetFor(overlapping);
    const outcome = resolve({
      ruleSet,
      deductionTypeKey: 'DED_OVERLAP',
      context: { deliveryMechanism: 'CAFETERIA_PLAN' },
    });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error('expected failure');
    // Caught by validateStateDetail() (RULE_DETAIL_INVALID), never a silent
    // pick and never surfaced as an unhandled runtime conflict.
    expect(outcome.problem.reason).toBe('RULE_DETAIL_INVALID');
  });
});

describe('effect resolution', () => {
  it('REDUCE_WAGES proceeds to limit handling', () => {
    const ruleSet = ruleSetFor(UNLIMITED_REDUCE);
    const outcome = resolve({ ruleSet, applicableAmount: money('250') });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) throw new Error('expected ok');
    expect(outcome.resolution.direction).toBe('REDUCE_WAGES');
    expect(outcome.resolution.effectiveAmount.toString()).toBe('250');
  });

  it('INCREASE_WAGES returns the full applicable amount immediately and never enters limit logic', () => {
    // A limit is schema-forbidden for INCREASE_WAGES (Slice 1), so a variant
    // that reached limit logic for this effect could not exist as valid
    // data in the first place — this test proves the resolver's own control
    // flow returns before step 12 regardless, using an amount that would
    // fail the (skipped) negative-amount check if step 11 ran on it. Using a
    // large positive amount and asserting the full, unmodified figure comes
    // back with no cap applied is the direct, positive proof.
    const detail = profileSetWith('GTL_EXCESS', [
      { conditions: [], effect: 'INCREASE_WAGES', limit: null },
    ]);
    const ruleSet = ruleSetFor(detail);
    const outcome = resolve({
      ruleSet,
      deductionTypeKey: 'GTL_EXCESS',
      applicableAmount: money('9999999'),
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) throw new Error('expected ok');
    expect(outcome.resolution.direction).toBe('INCREASE_WAGES');
    expect(outcome.resolution.effectiveAmount.toString()).toBe('9999999');
  });

  it('NO_CHANGE returns zero and never processes a limit', () => {
    const detail = profileSetWith('DED_NC', [{ conditions: [], effect: 'NO_CHANGE', limit: null }]);
    const ruleSet = ruleSetFor(detail);
    const outcome = resolve({
      ruleSet,
      deductionTypeKey: 'DED_NC',
      applicableAmount: money('500'),
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) throw new Error('expected ok');
    expect(outcome.resolution.direction).toBe('NO_CHANGE');
    expect(outcome.resolution.effectiveAmount.toString()).toBe('0');
  });

  it('NOT_STATED reports SCENARIO_UNSUPPORTED, never zero and never unlimited', () => {
    const detail = profileSetWith('DED_NS', [
      { conditions: [], effect: 'NOT_STATED', limit: null },
    ]);
    const ruleSet = ruleSetFor(detail);
    const outcome = resolve({ ruleSet, deductionTypeKey: 'DED_NS' });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error('expected failure');
    expect(outcome.problem.reason).toBe('SCENARIO_UNSUPPORTED');
  });
});

describe('limits', () => {
  it('limit: null is unlimited — the full applicable amount reduces wages', () => {
    const ruleSet = ruleSetFor(UNLIMITED_REDUCE);
    const outcome = resolve({ ruleSet, applicableAmount: money('12345.67') });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) throw new Error('expected ok');
    expect(outcome.resolution.effectiveAmount.toString()).toBe('12345.67');
  });

  it('PAY_PERIOD applies its cap directly, with no prior usage required', () => {
    const detail = profileSetWith('DED_PP', [
      {
        conditions: [],
        effect: 'REDUCE_WAGES',
        limit: {
          basis: 'PAY_PERIOD',
          amount: '100',
          scope: 'PER_EMPLOYEE',
          variantsByDiscriminator: null,
        },
        excessEffect: 'NO_CHANGE',
      },
    ]);
    const ruleSet = ruleSetFor(detail);
    const belowCap = resolve({
      ruleSet,
      deductionTypeKey: 'DED_PP',
      applicableAmount: money('60'),
    });
    expect(belowCap.ok).toBe(true);
    if (!belowCap.ok) throw new Error('expected ok');
    expect(belowCap.resolution.effectiveAmount.toString()).toBe('60');

    const aboveCap = resolve({
      ruleSet,
      deductionTypeKey: 'DED_PP',
      applicableAmount: money('150'),
    });
    expect(aboveCap.ok).toBe(true);
    if (!aboveCap.ok) throw new Error('expected ok');
    expect(aboveCap.resolution.effectiveAmount.toString()).toBe('100');
  });

  describe('MONTHLY (DM-03 Slice 3 — resolved via context.payPeriodIsSubMonthly)', () => {
    const monthlyCapped = profileSetWith('TRANSIT', [
      {
        conditions: [],
        effect: 'REDUCE_WAGES',
        limit: {
          basis: 'MONTHLY',
          amount: '315',
          scope: 'PER_EMPLOYEE',
          variantsByDiscriminator: null,
        },
        excessEffect: 'NO_CHANGE',
      },
    ]);

    it('reports SCENARIO_UNSUPPORTED when payPeriodIsSubMonthly is not supplied at all', () => {
      const ruleSet = ruleSetFor(monthlyCapped);
      const outcome = resolve({
        ruleSet,
        deductionTypeKey: 'TRANSIT',
        applicableAmount: money('200'),
      });
      expect(outcome.ok).toBe(false);
      if (outcome.ok) throw new Error('expected failure');
      expect(outcome.problem.reason).toBe('SCENARIO_UNSUPPORTED');
    });

    it('sub-monthly (true) without priorAppliedAmount reports SCENARIO_UNSUPPORTED, mirroring ANNUAL', () => {
      const ruleSet = ruleSetFor(monthlyCapped);
      const outcome = resolve({
        ruleSet,
        deductionTypeKey: 'TRANSIT',
        applicableAmount: money('200'),
        context: { payPeriodIsSubMonthly: true },
      });
      expect(outcome.ok).toBe(false);
      if (outcome.ok) throw new Error('expected failure');
      expect(outcome.problem.reason).toBe('SCENARIO_UNSUPPORTED');
    });

    it('sub-monthly (true) with a known priorAppliedAmount is supported and applies remaining cap', () => {
      const ruleSet = ruleSetFor(monthlyCapped);
      const outcome = resolve({
        ruleSet,
        deductionTypeKey: 'TRANSIT',
        applicableAmount: money('200'),
        context: { payPeriodIsSubMonthly: true },
        priorAppliedAmount: money('150'),
      });
      expect(outcome.ok).toBe(true);
      if (!outcome.ok) throw new Error('expected ok');
      // remaining = max(315 - 150, 0) = 165; effective = min(200, 165)
      expect(outcome.resolution.effectiveAmount.toString()).toBe('165');
    });

    it('monthly-or-less-frequent (false) needs no priorAppliedAmount and applies the cap directly', () => {
      const ruleSet = ruleSetFor(monthlyCapped);
      const belowCap = resolve({
        ruleSet,
        deductionTypeKey: 'TRANSIT',
        applicableAmount: money('200'),
        context: { payPeriodIsSubMonthly: false },
      });
      expect(belowCap.ok).toBe(true);
      if (!belowCap.ok) throw new Error('expected ok');
      expect(belowCap.resolution.effectiveAmount.toString()).toBe('200');

      const aboveCap = resolve({
        ruleSet,
        deductionTypeKey: 'TRANSIT',
        applicableAmount: money('400'),
        context: { payPeriodIsSubMonthly: false },
      });
      expect(aboveCap.ok).toBe(true);
      if (!aboveCap.ok) throw new Error('expected ok');
      expect(aboveCap.resolution.effectiveAmount.toString()).toBe('315');
    });

    it('monthly-or-less-frequent (false) ignores a supplied priorAppliedAmount — it is not needed for this basis', () => {
      const ruleSet = ruleSetFor(monthlyCapped);
      // A caller supplying a prior amount anyway (e.g. a generic pipeline
      // that always tracks it) must not have it wrongly subtracted from a
      // basis that contract §9 says needs no tracking at all.
      const outcome = resolve({
        ruleSet,
        deductionTypeKey: 'TRANSIT',
        applicableAmount: money('200'),
        context: { payPeriodIsSubMonthly: false },
        priorAppliedAmount: money('999'),
      });
      expect(outcome.ok).toBe(true);
      if (!outcome.ok) throw new Error('expected ok');
      expect(outcome.resolution.effectiveAmount.toString()).toBe('200');
    });
  });

  it('ANNUAL without prior usage is unsupported', () => {
    const detail = profileSetWith('DED_ANNUAL', [
      {
        conditions: [],
        effect: 'REDUCE_WAGES',
        limit: {
          basis: 'ANNUAL',
          amount: '3000',
          scope: 'PER_EMPLOYEE',
          variantsByDiscriminator: null,
        },
        excessEffect: 'NO_CHANGE',
      },
    ]);
    const ruleSet = ruleSetFor(detail);
    const outcome = resolve({
      ruleSet,
      deductionTypeKey: 'DED_ANNUAL',
      applicableAmount: money('500'),
    });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error('expected failure');
    expect(outcome.problem.reason).toBe('SCENARIO_UNSUPPORTED');
  });

  it('PLAN_YEAR is unsupported even when priorAppliedAmount is supplied (no plan-year start date, OD-3)', () => {
    const detail = profileSetWith('FSA', [
      {
        conditions: [],
        effect: 'REDUCE_WAGES',
        limit: {
          basis: 'PLAN_YEAR',
          amount: '3050',
          scope: 'PER_EMPLOYEE',
          variantsByDiscriminator: null,
        },
        excessEffect: 'NO_CHANGE',
      },
    ]);
    const ruleSet = ruleSetFor(detail);
    const outcome = resolve({
      ruleSet,
      deductionTypeKey: 'FSA',
      applicableAmount: money('200'),
      priorAppliedAmount: money('0'),
    });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error('expected failure');
    expect(outcome.problem.reason).toBe('SCENARIO_UNSUPPORTED');
  });

  it('explicit zero priorAppliedAmount is known usage, distinct from undefined', () => {
    const detail = profileSetWith('DED_ANNUAL', [
      {
        conditions: [],
        effect: 'REDUCE_WAGES',
        limit: {
          basis: 'ANNUAL',
          amount: '1000',
          scope: 'PER_EMPLOYEE',
          variantsByDiscriminator: null,
        },
        excessEffect: 'NO_CHANGE',
      },
    ]);
    const ruleSet = ruleSetFor(detail);
    const zeroPrior = resolve({
      ruleSet,
      deductionTypeKey: 'DED_ANNUAL',
      applicableAmount: money('400'),
      priorAppliedAmount: money('0'),
    });
    expect(zeroPrior.ok).toBe(true);
    if (!zeroPrior.ok) throw new Error('expected ok');
    expect(zeroPrior.resolution.effectiveAmount.toString()).toBe('400');
  });

  it('undefined priorAppliedAmount is unavailable, never treated as zero', () => {
    const detail = profileSetWith('DED_ANNUAL', [
      {
        conditions: [],
        effect: 'REDUCE_WAGES',
        limit: {
          basis: 'ANNUAL',
          amount: '1000',
          scope: 'PER_EMPLOYEE',
          variantsByDiscriminator: null,
        },
        excessEffect: 'NO_CHANGE',
      },
    ]);
    const ruleSet = ruleSetFor(detail);
    const undefinedPrior = resolve({
      ruleSet,
      deductionTypeKey: 'DED_ANNUAL',
      applicableAmount: money('400'),
    });
    expect(undefinedPrior.ok).toBe(false);
    if (undefinedPrior.ok) throw new Error('expected failure');
    expect(undefinedPrior.problem.reason).toBe('SCENARIO_UNSUPPORTED');
  });

  it('applies non-zero prior usage against the cap (remaining = cap - prior)', () => {
    const detail = profileSetWith('DED_ANNUAL', [
      {
        conditions: [],
        effect: 'REDUCE_WAGES',
        limit: {
          basis: 'ANNUAL',
          amount: '1000',
          scope: 'PER_EMPLOYEE',
          variantsByDiscriminator: null,
        },
        excessEffect: 'NO_CHANGE',
      },
    ]);
    const ruleSet = ruleSetFor(detail);
    const outcome = resolve({
      ruleSet,
      deductionTypeKey: 'DED_ANNUAL',
      applicableAmount: money('300'),
      priorAppliedAmount: money('800'),
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) throw new Error('expected ok');
    // remaining = max(1000 - 800, 0) = 200; effective = min(300, 200) = 200
    expect(outcome.resolution.effectiveAmount.toString()).toBe('200');
  });

  it('cap below the applicable amount produces a split (effective < applicable)', () => {
    const detail = profileSetWith('DED_PP', [
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
    ]);
    const ruleSet = ruleSetFor(detail);
    const outcome = resolve({ ruleSet, deductionTypeKey: 'DED_PP', applicableAmount: money('80') });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) throw new Error('expected ok');
    expect(outcome.resolution.effectiveAmount.toString()).toBe('50');
  });

  it('cap above the applicable amount passes the full amount through', () => {
    const detail = profileSetWith('DED_PP', [
      {
        conditions: [],
        effect: 'REDUCE_WAGES',
        limit: {
          basis: 'PAY_PERIOD',
          amount: '500',
          scope: 'PER_EMPLOYEE',
          variantsByDiscriminator: null,
        },
        excessEffect: 'NO_CHANGE',
      },
    ]);
    const ruleSet = ruleSetFor(detail);
    const outcome = resolve({ ruleSet, deductionTypeKey: 'DED_PP', applicableAmount: money('80') });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) throw new Error('expected ok');
    expect(outcome.resolution.effectiveAmount.toString()).toBe('80');
  });

  it('excessEffect NO_CHANGE returns the capped amount, leaving the excess in wages', () => {
    const detail = profileSetWith('DED_PP', [
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
    ]);
    const ruleSet = ruleSetFor(detail);
    const outcome = resolve({ ruleSet, deductionTypeKey: 'DED_PP', applicableAmount: money('90') });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) throw new Error('expected ok');
    expect(outcome.resolution.direction).toBe('REDUCE_WAGES');
    expect(outcome.resolution.effectiveAmount.toString()).toBe('50');
  });

  it('excessEffect NOT_STATED with an excess reports SCENARIO_UNSUPPORTED, never processing the excess', () => {
    const detail = profileSetWith('DED_PP', [
      {
        conditions: [],
        effect: 'REDUCE_WAGES',
        limit: {
          basis: 'PAY_PERIOD',
          amount: '50',
          scope: 'PER_EMPLOYEE',
          variantsByDiscriminator: null,
        },
        excessEffect: 'NOT_STATED',
      },
    ]);
    const ruleSet = ruleSetFor(detail);
    const outcome = resolve({ ruleSet, deductionTypeKey: 'DED_PP', applicableAmount: money('90') });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error('expected failure');
    expect(outcome.problem.reason).toBe('SCENARIO_UNSUPPORTED');
  });

  it('negative applicableAmount is rejected, never clamped to zero', () => {
    const ruleSet = ruleSetFor(UNLIMITED_REDUCE);
    const outcome = resolve({ ruleSet, applicableAmount: money('-25') });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error('expected failure');
    expect(outcome.problem.reason).toBe('INPUT_INVALID');
  });
});

describe('variantsByDiscriminator', () => {
  const discriminatedDetail = profileSetWith('DCFSA', [
    {
      conditions: [],
      effect: 'REDUCE_WAGES',
      limit: {
        basis: 'PAY_PERIOD',
        amount: '5000',
        scope: 'PER_EMPLOYEE',
        variantsByDiscriminator: [{ discriminator: 'MARRIED_FILING_SEPARATELY', amount: '2500' }],
      },
      excessEffect: 'NO_CHANGE',
    },
  ]);

  it('reports SCENARIO_UNSUPPORTED when no discriminator context is supplied — never inventing a source', () => {
    const ruleSet = ruleSetFor(discriminatedDetail);
    const outcome = resolve({ ruleSet, deductionTypeKey: 'DCFSA', applicableAmount: money('100') });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error('expected failure');
    expect(outcome.problem.reason).toBe('SCENARIO_UNSUPPORTED');
  });

  it('reports SCENARIO_UNSUPPORTED when the supplied discriminator matches no entry', () => {
    const ruleSet = ruleSetFor(discriminatedDetail);
    const outcome = resolve({
      ruleSet,
      deductionTypeKey: 'DCFSA',
      applicableAmount: money('100'),
      context: { limitDiscriminator: 'SINGLE' },
    });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error('expected failure');
    expect(outcome.problem.reason).toBe('SCENARIO_UNSUPPORTED');
  });

  it("uses the matching entry's amount when exactly one discriminator matches", () => {
    const ruleSet = ruleSetFor(discriminatedDetail);
    const outcome = resolve({
      ruleSet,
      deductionTypeKey: 'DCFSA',
      applicableAmount: money('3000'),
      context: { limitDiscriminator: 'MARRIED_FILING_SEPARATELY' },
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) throw new Error('expected ok');
    // cap = 2500 (discriminator override, not the base 5000); effective = min(3000, 2500)
    expect(outcome.resolution.effectiveAmount.toString()).toBe('2500');
  });

  it('rejects a duplicate discriminator entry before the resolver runs — schema-layer defense-in-depth', () => {
    // A production rule with two entries for the SAME discriminator (which
    // is what would be needed to exercise the resolver's own >1-match
    // RULE_CONFLICT branch for variantsByDiscriminator) is already rejected
    // by Slice 1's schema ("Duplicate variantsByDiscriminator entry")
    // before validateStateDetail() ever succeeds — disclosed in the Slice 2
    // report alongside the identical finding for variant matching above.
    const duplicated = profileSetWith('DCFSA_DUP', [
      {
        conditions: [],
        effect: 'REDUCE_WAGES',
        limit: {
          basis: 'PAY_PERIOD',
          amount: '5000',
          scope: 'PER_EMPLOYEE',
          variantsByDiscriminator: [
            { discriminator: 'MARRIED_FILING_SEPARATELY', amount: '2500' },
            { discriminator: 'MARRIED_FILING_SEPARATELY', amount: '2600' },
          ],
        },
        excessEffect: 'NO_CHANGE',
      },
    ]);
    const ruleSet = ruleSetFor(duplicated);
    const outcome = resolve({
      ruleSet,
      deductionTypeKey: 'DCFSA_DUP',
      applicableAmount: money('100'),
      context: { limitDiscriminator: 'MARRIED_FILING_SEPARATELY' },
    });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error('expected failure');
    expect(outcome.problem.reason).toBe('RULE_DETAIL_INVALID');
  });
});

describe('legacy compatibility', () => {
  const legacyDetail = {
    shape: 'TAXABILITY_PROFILE',
    deductionTypeKey: 'SYNTHETIC_DEDUCTION',
    reducesStateIncomeTaxWages: 'TRUE',
    reducesSdiWages: 'FALSE',
    reducesPfmlWages: 'FALSE',
    reducesSutaWages: 'NOT_STATED',
  };

  it('rejects the legacy TAXABILITY_PROFILE shape with RULE_DETAIL_INVALID', () => {
    const ruleSet = ruleSetFor(legacyDetail);
    const outcome = resolve({ ruleSet });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error('expected failure');
    expect(outcome.problem.reason).toBe('RULE_DETAIL_INVALID');
  });

  it('readTaxabilityProfileSet() also rejects the legacy shape directly', () => {
    const ruleSet = ruleSetFor(legacyDetail);
    const result = readTaxabilityProfileSet(ruleSet);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.problem.reason).toBe('RULE_DETAIL_INVALID');
  });

  it('accepts the new TAXABILITY_PROFILE_SET shape', () => {
    const ruleSet = ruleSetFor(UNLIMITED_REDUCE);
    const outcome = resolve({ ruleSet });
    expect(outcome.ok).toBe(true);
  });

  it("rejects a hybrid legacy+new payload upstream, at schema validation — never reaching the resolver's own shape check", () => {
    const hybrid = { ...legacyDetail, profiles: UNLIMITED_REDUCE.profiles };
    const ruleSet = ruleSetFor(hybrid);
    const outcome = resolve({ ruleSet });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error('expected failure');
    expect(outcome.problem.reason).toBe('RULE_DETAIL_INVALID');
  });
});

describe('provenance', () => {
  it('a successful resolution retains the exact RuleReference of the resolved rule', () => {
    const ruleSet = ruleSetFor(UNLIMITED_REDUCE);
    const outcome = resolve({ ruleSet });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) throw new Error('expected ok');
    expect(outcome.resolution.rules).toHaveLength(1);
    expect(outcome.resolution.rules[0]).toEqual(reference(KEY));
  });

  it('failures never fabricate a RuleReference', () => {
    const ruleSet = buildRuleSet({});
    const outcome = resolve({ ruleSet });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error('expected failure');
    expect('rules' in outcome).toBe(false);
  });
});

describe('purity and boundaries', () => {
  it('does not mutate the supplied ResolvedStateRuleSet', () => {
    const ruleSet = ruleSetFor(UNLIMITED_REDUCE);
    const before = ruleSet.entries[KEY];
    resolve({ ruleSet });
    expect(ruleSet.entries[KEY]).toBe(before);
    expect(Object.isFrozen(ruleSet)).toBe(true);
  });

  it('is synchronous', () => {
    const ruleSet = ruleSetFor(UNLIMITED_REDUCE);
    const outcome = resolve({ ruleSet });
    expect(outcome).not.toBeInstanceOf(Promise);
  });

  it('imports no database client, Prisma, or Option A taxabilityProfiles path', async () => {
    const fs = await import('node:fs');
    const source = fs.readFileSync(
      new URL('../../lib/tax/state/rules/resolveTaxability.ts', import.meta.url),
      'utf8',
    );
    const importLines = source
      .split('\n')
      .filter((line) => /^import\b/.test(line.trim()))
      .join('\n');
    expect(importLines).not.toMatch(/getPrisma|PrismaClient|from '@\/lib\/db\//);
    expect(importLines).not.toMatch(/candidateRetrieval|resolveCandidates|assembleStateRuleSet/);
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(code).not.toMatch(/\btaxabilityProfiles\b/);
    expect(code).not.toMatch(/deriveStateWageBuckets/);
  });
});

describe('boundary and edge cases (code review follow-up)', () => {
  const cappedNotStated = profileSetWith('DED_CAP', [
    {
      conditions: [],
      effect: 'REDUCE_WAGES',
      limit: {
        basis: 'PAY_PERIOD',
        amount: '100',
        scope: 'PER_EMPLOYEE',
        variantsByDiscriminator: null,
      },
      excessEffect: 'NOT_STATED',
    },
  ]);

  const cappedNoChange = profileSetWith('DED_CAP', [
    {
      conditions: [],
      effect: 'REDUCE_WAGES',
      limit: {
        basis: 'PAY_PERIOD',
        amount: '100',
        scope: 'PER_EMPLOYEE',
        variantsByDiscriminator: null,
      },
      excessEffect: 'NO_CHANGE',
    },
  ]);

  it('applicableAmount === cap: full amount passes through, no excess behavior triggers even with excessEffect NOT_STATED', () => {
    const ruleSet = ruleSetFor(cappedNotStated);
    const outcome = resolve({
      ruleSet,
      deductionTypeKey: 'DED_CAP',
      applicableAmount: money('100'),
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) throw new Error('expected ok');
    expect(outcome.resolution.direction).toBe('REDUCE_WAGES');
    expect(outcome.resolution.effectiveAmount.toString()).toBe('100');
  });

  it('applicableAmount exactly $0.01 below cap passes through in full', () => {
    const ruleSet = ruleSetFor(cappedNotStated);
    const outcome = resolve({
      ruleSet,
      deductionTypeKey: 'DED_CAP',
      applicableAmount: money('99.99'),
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) throw new Error('expected ok');
    expect(outcome.resolution.effectiveAmount.toString()).toBe('99.99');
  });

  it('applicableAmount exactly $0.01 above cap with excessEffect NOT_STATED reports SCENARIO_UNSUPPORTED', () => {
    const ruleSet = ruleSetFor(cappedNotStated);
    const outcome = resolve({
      ruleSet,
      deductionTypeKey: 'DED_CAP',
      applicableAmount: money('100.01'),
    });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error('expected failure');
    expect(outcome.problem.reason).toBe('SCENARIO_UNSUPPORTED');
  });

  it('applicableAmount exactly $0.01 above cap with excessEffect NO_CHANGE returns the capped amount', () => {
    const ruleSet = ruleSetFor(cappedNoChange);
    const outcome = resolve({
      ruleSet,
      deductionTypeKey: 'DED_CAP',
      applicableAmount: money('100.01'),
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) throw new Error('expected ok');
    expect(outcome.resolution.direction).toBe('REDUCE_WAGES');
    expect(outcome.resolution.effectiveAmount.toString()).toBe('100');
  });

  const annualCap = profileSetWith('DED_ANNUAL_CAP', [
    {
      conditions: [],
      effect: 'REDUCE_WAGES',
      limit: {
        basis: 'ANNUAL',
        amount: '1000',
        scope: 'PER_EMPLOYEE',
        variantsByDiscriminator: null,
      },
      excessEffect: 'NO_CHANGE',
    },
  ]);

  it('priorAppliedAmount === cap: remaining is exactly zero, effective amount is zero', () => {
    const ruleSet = ruleSetFor(annualCap);
    const outcome = resolve({
      ruleSet,
      deductionTypeKey: 'DED_ANNUAL_CAP',
      applicableAmount: money('50'),
      priorAppliedAmount: money('1000'),
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) throw new Error('expected ok');
    expect(outcome.resolution.effectiveAmount.toString()).toBe('0');
  });

  it('priorAppliedAmount > cap: remaining clamps to zero, never negative', () => {
    const ruleSet = ruleSetFor(annualCap);
    const outcome = resolve({
      ruleSet,
      deductionTypeKey: 'DED_ANNUAL_CAP',
      applicableAmount: money('50'),
      priorAppliedAmount: money('1500'),
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) throw new Error('expected ok');
    expect(outcome.resolution.effectiveAmount.toString()).toBe('0');
    expect(outcome.resolution.effectiveAmount.isNegative()).toBe(false);
  });

  it('applicableAmount === 0 is valid input, never an INPUT_INVALID error', () => {
    const ruleSet = ruleSetFor(UNLIMITED_REDUCE);
    const outcome = resolve({ ruleSet, applicableAmount: money('0') });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) throw new Error('expected ok');
    expect(outcome.resolution.direction).toBe('REDUCE_WAGES');
    expect(outcome.resolution.effectiveAmount.toString()).toBe('0');
  });

  it('empty-string deductionTypeKey reports RULE_MISSING without throwing', () => {
    const ruleSet = ruleSetFor(UNLIMITED_REDUCE);
    expect(() => resolve({ ruleSet, deductionTypeKey: '' })).not.toThrow();
    const outcome = resolve({ ruleSet, deductionTypeKey: '' });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error('expected failure');
    expect(outcome.problem.reason).toBe('RULE_MISSING');
  });

  it('variantsByDiscriminator: [] (empty, non-null) bypasses discriminator selection and uses the base cap', () => {
    const detail = profileSetWith('DED_EMPTY_DISC', [
      {
        conditions: [],
        effect: 'REDUCE_WAGES',
        limit: {
          basis: 'PAY_PERIOD',
          amount: '75',
          scope: 'PER_EMPLOYEE',
          variantsByDiscriminator: [],
        },
        excessEffect: 'NO_CHANGE',
      },
    ]);
    const ruleSet = ruleSetFor(detail);
    // No context.limitDiscriminator supplied at all -- if the empty array
    // wrongly triggered discriminator-matching, this would fail as
    // SCENARIO_UNSUPPORTED (no discriminator context). It must instead use
    // the base cap of 75 directly.
    const belowCap = resolve({
      ruleSet,
      deductionTypeKey: 'DED_EMPTY_DISC',
      applicableAmount: money('50'),
    });
    expect(belowCap.ok).toBe(true);
    if (!belowCap.ok) throw new Error('expected ok');
    expect(belowCap.resolution.effectiveAmount.toString()).toBe('50');

    const aboveCap = resolve({
      ruleSet,
      deductionTypeKey: 'DED_EMPTY_DISC',
      applicableAmount: money('100'),
    });
    expect(aboveCap.ok).toBe(true);
    if (!aboveCap.ok) throw new Error('expected ok');
    expect(aboveCap.resolution.effectiveAmount.toString()).toBe('75');
  });
});

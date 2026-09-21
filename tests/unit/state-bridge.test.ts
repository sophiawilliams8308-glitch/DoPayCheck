import { describe, expect, it } from 'vitest';

import { money } from '@/lib/core/money';
import type { RuleReference } from '@/lib/calculator/types/rules';
import type { DeductionResult } from '@/lib/calculator/pipeline/deductions';
import type { DeductionInput } from '@/lib/calculator/types/input';
import { toStateDeductions, type StateOptions } from '@/lib/calculator/state-bridge';
import { StateRuleKey } from '@/lib/tax/state/ruleKeys';
import {
  freezeStateRuleSet,
  stateRule,
  type ResolvedStateRuleSet,
} from '@/lib/tax/state/rules/stateRuleSet';

/**
 * State deduction bridge (Task 4H, implementing the Task 4G lock).
 *
 * `toStateDeductions()` is tested in isolation from `calculateDeductions()`:
 * `DeductionResult` is a plain interface, so fixtures below construct it
 * directly rather than running the full Phase 3 pipeline, exactly as
 * `state-wage-buckets.test.ts` constructs its own minimal inputs.
 */

const TEST_WORK = 'TEST-WORK';

function deductionInput(overrides: Partial<DeductionInput> = {}): DeductionInput {
  return {
    id: 'synthetic-deduction',
    basis: 'FIXED_AMOUNT',
    amount: '0',
    taxability: {},
    ...overrides,
  };
}

function deductionResult(overrides: {
  id?: string;
  label?: string;
  amount: string;
  input?: Partial<DeductionInput>;
}): DeductionResult {
  const input = deductionInput({ id: overrides.id ?? 'synthetic-deduction', ...overrides.input });
  return {
    id: overrides.id ?? input.id,
    label: overrides.label ?? input.id,
    amount: money(overrides.amount),
    input,
  };
}

function reference(ruleKey: string): RuleReference {
  return {
    ruleId: `synthetic-${ruleKey}`,
    ruleKey,
    version: 1,
    category: 'STATE_WITHHOLDING',
    taxYear: 2099,
    jurisdictionId: 'synthetic-jurisdiction',
    jurisdictionCode: TEST_WORK,
    effectiveFrom: new Date('2099-01-01T00:00:00.000Z'),
    effectiveTo: null,
    sourceIds: [`synthetic-source-${ruleKey}`],
    verified: true,
  };
}

function syntheticStateRuleSet(): ResolvedStateRuleSet {
  const key = StateRuleKey.WITHHOLDING_METHOD;
  return freezeStateRuleSet({
    taxYear: 2099,
    effectiveDate: '2099-06-15T00:00:00.000Z',
    jurisdictionCode: TEST_WORK,
    engineVersion: 'test-engine',
    resolvedAt: '2099-06-15T00:00:00.000Z',
    missing: [],
    entries: {
      [key]: {
        available: true,
        rule: { key, reference: reference(key), detail: null, verificationStatus: 'VERIFIED' },
      },
    },
    ruleReferences: [reference(key)],
    sourceIds: [`synthetic-source-${key}`],
  });
}

describe('toStateDeductions — basic mapping', () => {
  it('maps deductionTypeKey and amount from a single DeductionResult', () => {
    const result = deductionResult({
      amount: '42.50',
      input: { deductionTypeKey: 'TRADITIONAL_401K' },
    });

    const [line] = toStateDeductions([result]);
    expect(line).toEqual({ deductionTypeKey: 'TRADITIONAL_401K', amount: '42.5' });
  });
});

describe('toStateDeductions — deductionTypeKey fallback', () => {
  it('uses the explicit deductionTypeKey when present', () => {
    const result = deductionResult({
      id: 'retirement',
      amount: '10',
      input: { deductionTypeKey: 'SECTION125_HEALTH' },
    });

    const [line] = toStateDeductions([result]);
    expect(line?.deductionTypeKey).toBe('SECTION125_HEALTH');
  });

  it('falls back to the deduction id when deductionTypeKey is absent', () => {
    const result = deductionResult({ id: 'health-insurance', amount: '10' });

    const [line] = toStateDeductions([result]);
    expect(line?.deductionTypeKey).toBe('health-insurance');
  });
});

describe('toStateDeductions — amount conversion', () => {
  it('re-expresses Money as an exact DecimalString with no floating-point loss', () => {
    // More significant digits than a JS `number` can represent exactly — if the
    // bridge ever routed this through `Number(...)`, this value would be the
    // first thing to visibly corrupt.
    const result = deductionResult({ amount: '100000000000000.03' });

    const [line] = toStateDeductions([result]);
    expect(line?.amount).toBe('100000000000000.03');
  });

  it('preserves zero', () => {
    const result = deductionResult({ amount: '0' });

    const [line] = toStateDeductions([result]);
    expect(line?.amount).toBe('0');
  });

  it('performs no rounding of its own', () => {
    const result = deductionResult({ amount: '12.3456789' });

    const [line] = toStateDeductions([result]);
    expect(line?.amount).toBe('12.3456789');
  });
});

describe('toStateDeductions — ordering, aggregation, and multiplicity', () => {
  it('returns one output per input, in source order, without aggregating', () => {
    const results = [
      deductionResult({ id: 'a', amount: '10', input: { deductionTypeKey: 'TYPE_A' } }),
      deductionResult({ id: 'b', amount: '20', input: { deductionTypeKey: 'TYPE_A' } }),
      deductionResult({ id: 'c', amount: '30', input: { deductionTypeKey: 'TYPE_B' } }),
    ];

    const lines = toStateDeductions(results);

    expect(lines).toHaveLength(3);
    expect(lines).toEqual([
      { deductionTypeKey: 'TYPE_A', amount: '10' },
      { deductionTypeKey: 'TYPE_A', amount: '20' },
      { deductionTypeKey: 'TYPE_B', amount: '30' },
    ]);
  });
});

describe('toStateDeductions — empty input', () => {
  it('returns an empty array, never null or a synthetic entry', () => {
    expect(toStateDeductions([])).toEqual([]);
  });
});

describe('toStateDeductions — purity', () => {
  it('does not mutate its input', () => {
    const results = [
      deductionResult({ id: 'a', amount: '10', input: { deductionTypeKey: 'TYPE_A' } }),
      deductionResult({ id: 'b', amount: '20' }),
    ];
    const before = JSON.stringify(
      results.map((r) => ({
        id: r.id,
        label: r.label,
        amount: r.amount.toFixed(),
        input: r.input,
      })),
    );

    toStateDeductions(results);

    const after = JSON.stringify(
      results.map((r) => ({
        id: r.id,
        label: r.label,
        amount: r.amount.toFixed(),
        input: r.input,
      })),
    );
    expect(after).toBe(before);
  });
});

describe('toStateDeductions — no taxability-based filtering', () => {
  it('returns every supplied item regardless of federal or state taxability flags', () => {
    const results = [
      deductionResult({
        id: 'reduces-nothing',
        amount: '5',
        input: { taxability: { federalIncomeTax: false, stateIncomeTax: false } },
      }),
      deductionResult({
        id: 'reduces-everything',
        amount: '15',
        input: { taxability: { federalIncomeTax: true, stateIncomeTax: true, suta: true } },
      }),
      deductionResult({
        id: 'no-taxability-stated',
        amount: '25',
        input: { taxability: {} },
      }),
    ];

    const lines = toStateDeductions(results);

    expect(lines).toHaveLength(3);
    expect(lines.map((line) => line.amount)).toEqual(['5', '15', '25']);
  });

  it('never reads a StateOptions/taxabilityProfiles value — the function takes none', () => {
    // Structural proof, not just a doc comment: the function's own arity is 1.
    expect(toStateDeductions.length).toBe(1);
  });
});

describe('StateOptions — type contract', () => {
  it('requires ruleSet and makes taxabilityProfiles optional', () => {
    const withoutProfiles: StateOptions = { ruleSet: syntheticStateRuleSet() };
    expect(withoutProfiles.taxabilityProfiles).toBeUndefined();

    const withProfiles: StateOptions = {
      ruleSet: syntheticStateRuleSet(),
      taxabilityProfiles: {
        TRADITIONAL_401K: {
          shape: 'TAXABILITY_PROFILE',
          deductionTypeKey: 'TRADITIONAL_401K',
          reducesStateIncomeTaxWages: 'TRUE',
          reducesSdiWages: 'FALSE',
          reducesPfmlWages: 'FALSE',
          reducesSutaWages: 'FALSE',
        },
      },
    };
    expect(withProfiles.taxabilityProfiles?.TRADITIONAL_401K?.reducesStateIncomeTaxWages).toBe(
      'TRUE',
    );

    // @ts-expect-error ruleSet is required — StateOptions cannot omit it.
    const missingRuleSet: StateOptions = {};
    void missingRuleSet;
  });

  it('does not accept StateInput-shaped fields', () => {
    // @ts-expect-error StateOptions carries no jurisdiction/election facts — those stay on
    // StateInput, per the Task 4G/4F boundary.
    const wrong: StateOptions = { ruleSet: syntheticStateRuleSet(), workState: TEST_WORK };
    void wrong;
  });

  it('is exposed only as its own module — resolved without going through the rule pipeline', () => {
    // stateRule() is Step 3's own reader; StateOptions.taxabilityProfiles bypasses it entirely
    // (Task 4B Option A). This just proves the two are unrelated APIs.
    const entry = stateRule(syntheticStateRuleSet(), StateRuleKey.WITHHOLDING_METHOD);
    expect(entry.available).toBe(true);
  });
});

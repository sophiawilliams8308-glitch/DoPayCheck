import { describe, expect, it } from 'vitest';

import { money } from '@/lib/core/money';
import type { RuleReference } from '@/lib/calculator/types/rules';
import type { DeductionResult } from '@/lib/calculator/pipeline/deductions';
import type { CalculationInput, DeductionInput } from '@/lib/calculator/types/input';
import { toStateDeductions, type StateOptions } from '@/lib/calculator/state-bridge';
import { buildStateCalculationContext } from '@/lib/calculator/state-context';
import { StateRuleKey } from '@/lib/tax/state/ruleKeys';
import { freezeStateRuleSet, type ResolvedStateRuleSet } from '@/lib/tax/state/rules/stateRuleSet';
import { ResidencyStatus } from '@/lib/tax/state/types';

/**
 * `buildStateCalculationContext()` (Task 4I, implementing the Task 4G/4H
 * locked architecture).
 *
 * Requires no Prisma, no PostgreSQL, no network, no filesystem: every fixture
 * below is constructed directly, exactly as `state-bridge.test.ts` and
 * `state-wage-buckets.test.ts` already do.
 */

const TEST_WORK = 'TEST-WORK';
const TEST_YEAR = 2099;
const TEST_INSTANT = new Date('2099-06-15T00:00:00.000Z');

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
  amount: string;
  input?: Partial<DeductionInput>;
}): DeductionResult {
  const input = deductionInput({ id: overrides.id ?? 'synthetic-deduction', ...overrides.input });
  return { id: overrides.id ?? input.id, label: input.id, amount: money(overrides.amount), input };
}

function reference(ruleKey: string, jurisdictionCode: string): RuleReference {
  return {
    ruleId: `synthetic-${ruleKey}`,
    ruleKey,
    version: 1,
    category: 'STATE_WITHHOLDING',
    taxYear: TEST_YEAR,
    jurisdictionId: `synthetic-${jurisdictionCode}`,
    jurisdictionCode,
    effectiveFrom: new Date('2099-01-01T00:00:00.000Z'),
    effectiveTo: null,
    sourceIds: [`synthetic-source-${ruleKey}`],
    verified: true,
  };
}

function syntheticStateRuleSet(jurisdictionCode: string = TEST_WORK): ResolvedStateRuleSet {
  const key = StateRuleKey.WITHHOLDING_METHOD;
  return freezeStateRuleSet({
    taxYear: TEST_YEAR,
    effectiveDate: TEST_INSTANT.toISOString(),
    jurisdictionCode,
    engineVersion: 'test-engine',
    resolvedAt: TEST_INSTANT.toISOString(),
    missing: [],
    entries: {
      [key]: {
        available: true,
        rule: {
          key,
          reference: reference(key, jurisdictionCode),
          detail: null,
          verificationStatus: 'VERIFIED',
        },
      },
    },
    ruleReferences: [reference(key, jurisdictionCode)],
    sourceIds: [`synthetic-source-${key}`],
  });
}

function baseInput(overrides: Partial<CalculationInput> = {}): CalculationInput {
  return {
    taxYear: TEST_YEAR,
    effectiveDate: TEST_INSTANT,
    employee: { workLocation: { stateCode: TEST_WORK } },
    pay: { basis: 'SALARY', payFrequency: 'BIWEEKLY', annualSalary: '130000' },
    w4: { filingStatus: 'SINGLE_OR_MFS' },
    state: { workState: TEST_WORK, residencyStatus: ResidencyStatus.RESIDENT },
    ...overrides,
  };
}

function baseOptions(overrides: Partial<StateOptions> = {}): StateOptions {
  return { ruleSet: syntheticStateRuleSet(), ...overrides };
}

describe('buildStateCalculationContext — basic construction', () => {
  it('produces a valid StateCalculationContext from valid inputs', () => {
    const context = buildStateCalculationContext(baseInput(), '2000', '0', [], baseOptions());

    expect(context.taxYear).toBe(TEST_YEAR);
    expect(context.effectiveDate).toBe(TEST_INSTANT.toISOString());
    expect(context.payFrequency).toBe('BIWEEKLY');
    expect(context.wages).toEqual({ regular: '2000', supplemental: '0' });
    expect(context.workJurisdictions).toEqual([{ jurisdictionCode: TEST_WORK, allocation: '1' }]);
    expect(context.residenceJurisdictionCode).toBe(TEST_WORK);
    expect(context.residencyStatus).toBe(ResidencyStatus.RESIDENT);
  });
});

describe('buildStateCalculationContext — rule set', () => {
  it('carries options.ruleSet into workRuleSet exactly', () => {
    const options = baseOptions();
    const context = buildStateCalculationContext(baseInput(), '2000', '0', [], options);
    expect(context.workRuleSet).toBe(options.ruleSet);
  });

  it('sets residenceRuleSet to null when residence and work are the same jurisdiction', () => {
    const context = buildStateCalculationContext(baseInput(), '2000', '0', [], baseOptions());
    expect(context.residenceRuleSet).toBeNull();
  });
});

describe('buildStateCalculationContext — taxability profiles', () => {
  const profile = {
    shape: 'TAXABILITY_PROFILE' as const,
    deductionTypeKey: 'TRADITIONAL_401K',
    reducesStateIncomeTaxWages: 'TRUE' as const,
    reducesSdiWages: 'FALSE' as const,
    reducesPfmlWages: 'FALSE' as const,
    reducesSutaWages: 'FALSE' as const,
  };

  it('carries a supplied profile map through exactly', () => {
    const context = buildStateCalculationContext(
      baseInput(),
      '2000',
      '0',
      [],
      baseOptions({ taxabilityProfiles: { TRADITIONAL_401K: profile } }),
    );
    expect(context.taxabilityProfiles).toEqual({ TRADITIONAL_401K: profile });
  });

  it('normalizes an omitted profile map to {}, never undefined', () => {
    const options = baseOptions();
    expect(options.taxabilityProfiles).toBeUndefined();

    const context = buildStateCalculationContext(baseInput(), '2000', '0', [], options);
    expect(context.taxabilityProfiles).toEqual({});
  });
});

describe('buildStateCalculationContext — deduction transformation', () => {
  it('matches toStateDeductions(deductionResults) exactly', () => {
    const results = [
      deductionResult({ id: 'a', amount: '10', input: { deductionTypeKey: 'TYPE_A' } }),
      deductionResult({ id: 'b', amount: '20' }),
    ];

    const context = buildStateCalculationContext(baseInput(), '2000', '0', results, baseOptions());

    expect(context.deductions).toEqual(toStateDeductions(results));
  });

  it('preserves deduction order', () => {
    const results = [
      deductionResult({ id: 'a', amount: '10', input: { deductionTypeKey: 'TYPE_A' } }),
      deductionResult({ id: 'b', amount: '20', input: { deductionTypeKey: 'TYPE_B' } }),
      deductionResult({ id: 'c', amount: '30', input: { deductionTypeKey: 'TYPE_C' } }),
    ];

    const context = buildStateCalculationContext(baseInput(), '2000', '0', results, baseOptions());

    expect(context.deductions.map((line) => line.deductionTypeKey)).toEqual([
      'TYPE_A',
      'TYPE_B',
      'TYPE_C',
    ]);
  });

  it('preserves the deductionTypeKey ?? id fallback through the builder', () => {
    const results = [deductionResult({ id: 'health-insurance', amount: '10' })];

    const context = buildStateCalculationContext(baseInput(), '2000', '0', results, baseOptions());

    expect(context.deductions[0]?.deductionTypeKey).toBe('health-insurance');
  });

  it('preserves a zero deduction amount', () => {
    const results = [deductionResult({ id: 'zero', amount: '0' })];

    const context = buildStateCalculationContext(baseInput(), '2000', '0', results, baseOptions());

    expect(context.deductions[0]?.amount).toBe('0');
  });
});

describe('buildStateCalculationContext — purity', () => {
  it('does not mutate input, options, deduction results, profiles, or the rule set', () => {
    const input = baseInput();
    const options = baseOptions({
      taxabilityProfiles: {
        TRADITIONAL_401K: {
          shape: 'TAXABILITY_PROFILE',
          deductionTypeKey: 'TRADITIONAL_401K',
          reducesStateIncomeTaxWages: 'TRUE',
          reducesSdiWages: 'NOT_STATED',
          reducesPfmlWages: 'NOT_STATED',
          reducesSutaWages: 'NOT_STATED',
        },
      },
    });
    const results = [deductionResult({ id: 'a', amount: '10' })];

    const inputBefore = JSON.stringify(input);
    const optionsBefore = JSON.stringify(options);
    const resultsBefore = JSON.stringify(
      results.map((r) => ({ id: r.id, amount: r.amount.toFixed(), input: r.input })),
    );
    const ruleSetBefore = JSON.stringify(options.ruleSet);

    buildStateCalculationContext(input, '2000', '0', results, options);

    expect(JSON.stringify(input)).toBe(inputBefore);
    expect(JSON.stringify(options)).toBe(optionsBefore);
    expect(
      JSON.stringify(
        results.map((r) => ({ id: r.id, amount: r.amount.toFixed(), input: r.input })),
      ),
    ).toBe(resultsBefore);
    expect(JSON.stringify(options.ruleSet)).toBe(ruleSetBefore);
  });

  it('produces an equivalent context on repeated calls with identical inputs', () => {
    const input = baseInput();
    const options = baseOptions();
    const results = [deductionResult({ id: 'a', amount: '10' })];

    const first = buildStateCalculationContext(input, '2000', '0', results, options);
    const second = buildStateCalculationContext(input, '2000', '0', results, options);

    expect(second).toEqual(first);
  });
});

describe('buildStateCalculationContext — jurisdiction fallback and defaults', () => {
  it('falls back to employee.workLocation.stateCode when state.workState is absent', () => {
    const input = baseInput({
      employee: { workLocation: { stateCode: TEST_WORK } },
      state: { residencyStatus: ResidencyStatus.RESIDENT },
    });

    const context = buildStateCalculationContext(input, '2000', '0', [], baseOptions());
    expect(context.workJurisdictions).toEqual([{ jurisdictionCode: TEST_WORK, allocation: '1' }]);
    expect(context.residenceJurisdictionCode).toBe(TEST_WORK);
  });

  it('discloses an assumed-zero YTD rather than fabricating figures', () => {
    const context = buildStateCalculationContext(baseInput(), '2000', '0', [], baseOptions());
    expect(context.ytd.assumedZero).toBe(true);
    expect(context.ytd.stateIncomeTaxWages).toBe('0');
  });

  it('defaults reciprocityCertificateFiled to false when absent', () => {
    const context = buildStateCalculationContext(baseInput(), '2000', '0', [], baseOptions());
    expect(context.reciprocityCertificateFiled).toBe(false);
  });

  it('preserves an explicit reciprocityCertificateFiled of true', () => {
    const input = baseInput({
      state: {
        workState: TEST_WORK,
        residencyStatus: ResidencyStatus.RESIDENT,
        reciprocityCertificateFiled: true,
      },
    });
    const context = buildStateCalculationContext(input, '2000', '0', [], baseOptions());
    expect(context.reciprocityCertificateFiled).toBe(true);
  });

  it('maps employer facts only when supplied', () => {
    const context = buildStateCalculationContext(baseInput(), '2000', '0', [], baseOptions());
    expect(context.employer).toEqual({});

    const withEmployer = buildStateCalculationContext(
      baseInput({
        state: {
          workState: TEST_WORK,
          residencyStatus: ResidencyStatus.RESIDENT,
          employerEmployeeCount: 25,
          employerSutaRate: '0.034',
          employerPlanElection: true,
        },
      }),
      '2000',
      '0',
      [],
      baseOptions(),
    );
    expect(withEmployer.employer).toEqual({
      employeeCount: 25,
      sutaRate: '0.034',
      privatePlanElected: true,
    });
  });

  it('maps state elections, defaulting an absent filingStatus to null and values to []', () => {
    const input = baseInput({
      state: {
        workState: TEST_WORK,
        residencyStatus: ResidencyStatus.RESIDENT,
        stateElections: { [TEST_WORK]: { formCode: 'SYNTHETIC-FORM' } },
      },
    });
    const context = buildStateCalculationContext(input, '2000', '0', [], baseOptions());
    expect(context.elections).toEqual({
      [TEST_WORK]: { formCode: 'SYNTHETIC-FORM', filingStatus: null, values: [] },
    });
  });
});

describe('buildStateCalculationContext — refuses to invent required data', () => {
  it('throws when residencyStatus is absent', () => {
    const input = baseInput({ state: { workState: TEST_WORK } });
    expect(() => buildStateCalculationContext(input, '2000', '0', [], baseOptions())).toThrow(
      /residencyStatus/,
    );
  });

  it('throws when no work or residence jurisdiction is resolvable at all', () => {
    const input = baseInput({
      employee: { workLocation: {} },
      state: { residencyStatus: ResidencyStatus.RESIDENT },
    });
    expect(() => buildStateCalculationContext(input, '2000', '0', [], baseOptions())).toThrow(
      /no residence jurisdiction is available/,
    );
  });

  it('throws when the residence jurisdiction differs from the resolved rule set jurisdiction', () => {
    const input = baseInput({
      state: {
        workState: TEST_WORK,
        residenceState: 'TEST-OTHER',
        residencyStatus: ResidencyStatus.RESIDENT,
      },
    });
    expect(() => buildStateCalculationContext(input, '2000', '0', [], baseOptions())).toThrow(
      /differs from the jurisdiction options\.ruleSet was resolved for/,
    );
  });
});

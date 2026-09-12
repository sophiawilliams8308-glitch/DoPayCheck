import { describe, expect, it } from 'vitest';

import { PayFrequency, RuleCategory } from '@/lib/db/generated/client';
import {
  CalculationStatus,
  ENGINE_VERSION,
  GENERIC_CURRENCY_POLICY,
  calculatePaycheck,
} from '@/lib/calculator';
import { IncompleteReason, combineStatuses } from '@/lib/calculator/types/status';
import { buildSnapshot, resultsMatch } from '@/lib/calculator/snapshot/snapshot';
import type { CalculationInput } from '@/lib/calculator/types/input';
import type { ResolvedRuleSet, RuleReference } from '@/lib/calculator/types/rules';

/**
 * End-to-end calculation engine (spec §4, §16, §17, §40).
 *
 * ===========================================================================
 * NO TAX VALUES. The rule fixtures below carry invented IDENTIFIERS (rule keys, versions,
 * source IDs) to exercise provenance plumbing — they contain no rate, bracket, threshold or
 * wage base, and are never presented as official tax rules.
 * ===========================================================================
 */

const policy = GENERIC_CURRENCY_POLICY;

const baseInput: CalculationInput = {
  taxYear: 2099,
  effectiveDate: new Date('2099-06-15T00:00:00.000Z'),
  employee: { workLocation: { stateCode: 'US-ZZ' } },
  pay: {
    basis: 'SALARY',
    payFrequency: PayFrequency.BIWEEKLY,
    annualSalary: '52000.00',
  },
  w4: { filingStatus: 'TEST_STATUS' },
};

const emptyRules: ResolvedRuleSet = { byCategory: {} };

function reference(category: RuleCategory, verified: boolean): RuleReference {
  return {
    ruleId: `rule-${category}`,
    ruleKey: `test.${category.toLowerCase()}`,
    version: 1,
    category,
    taxYear: 2099,
    jurisdictionId: 'jur-test',
    jurisdictionCode: 'US',
    effectiveFrom: new Date('2099-01-01T00:00:00.000Z'),
    effectiveTo: null,
    sourceIds: verified ? ['src-test'] : [],
    verified,
  };
}

/** A rule whose values are present and verified — identifiers only, no tax figures. */
function usableRuleSet(category: RuleCategory): ResolvedRuleSet {
  return {
    byCategory: {
      [category]: {
        found: true,
        rule: {
          reference: reference(category, true),
          values: [{ key: 'someComponent', groupKey: '', ordinal: 0, value: '1', verified: true }],
          payload: null,
        },
      },
    },
  };
}

describe('status folding', () => {
  it('returns COMPLETE for an empty set and the worst status otherwise', () => {
    expect(combineStatuses([])).toBe(CalculationStatus.COMPLETE);
    expect(combineStatuses([CalculationStatus.COMPLETE, CalculationStatus.INCOMPLETE])).toBe(
      CalculationStatus.INCOMPLETE,
    );
    expect(combineStatuses([CalculationStatus.INCOMPLETE, CalculationStatus.RULE_CONFLICT])).toBe(
      CalculationStatus.RULE_CONFLICT,
    );
    expect(
      combineStatuses([CalculationStatus.RULE_CONFLICT, CalculationStatus.CALCULATION_ERROR]),
    ).toBe(CalculationStatus.CALCULATION_ERROR);
  });
});

describe('invalid input', () => {
  it('returns INVALID_INPUT, not a tax-data status', () => {
    const result = calculatePaycheck(
      { ...baseInput, pay: { basis: 'SALARY', payFrequency: PayFrequency.WEEKLY } },
      { rounding: policy, rules: emptyRules },
    );
    expect(result.status).toBe(CalculationStatus.INVALID_INPUT);
    expect(result.issues.length).toBeGreaterThan(0);
  });

  it('rejects a negative salary', () => {
    const result = calculatePaycheck(
      { ...baseInput, pay: { ...baseInput.pay, annualSalary: '-100' } },
      { rounding: policy, rules: emptyRules },
    );
    expect(result.status).toBe(CalculationStatus.INVALID_INPUT);
  });

  it('refuses overtime hours without an explicit multiplier', () => {
    const result = calculatePaycheck(
      {
        ...baseInput,
        pay: {
          basis: 'HOURLY',
          payFrequency: PayFrequency.WEEKLY,
          hourlyRate: '20',
          regularHours: '40',
          overtimeHours: '5',
        },
      },
      { rounding: policy, rules: emptyRules },
    );
    expect(result.status).toBe(CalculationStatus.INVALID_INPUT);
    expect(result.issues.some((i) => i.path.includes('overtimeMultiplier'))).toBe(true);
  });
});

describe('missing rules', () => {
  const result = calculatePaycheck(baseInput, { rounding: policy, rules: emptyRules });

  it('computes gross pay even when no tax rule exists', () => {
    expect(result.grossPay.total).toBe('2000');
  });

  it('reports INCOMPLETE rather than calculating with defaults', () => {
    expect(result.status).toBe(CalculationStatus.INCOMPLETE);
  });

  it('sets every tax amount to null, NEVER zero', () => {
    const all = [...result.federal, ...result.fica, ...result.state, ...result.local];
    expect(all.length).toBeGreaterThan(0);
    for (const component of all) {
      expect(component.amount).toBeNull();
      expect(component.amount).not.toBe('0');
      expect(component.reason).toBe(IncompleteReason.NO_APPLICABLE_RULE);
    }
  });

  it('leaves net pay undetermined rather than overstating take-home pay', () => {
    expect(result.netPay).toBeNull();
    expect(result.totalEmployeeTaxes).toBeNull();
    expect(result.effectiveTaxRate).toBeNull();
  });
});

describe('rule conflicts', () => {
  it('reports RULE_CONFLICT without arbitrating', () => {
    const conflicting: ResolvedRuleSet = {
      byCategory: {
        [RuleCategory.SOCIAL_SECURITY]: {
          found: false,
          reason: IncompleteReason.AMBIGUOUS_RULE,
          detail: '2 ACTIVE rules apply',
        },
      },
    };
    const result = calculatePaycheck(baseInput, { rounding: policy, rules: conflicting });
    expect(result.status).toBe(CalculationStatus.RULE_CONFLICT);
    const ss = result.fica.find((c) => c.code === 'SOCIAL_SECURITY_EMPLOYEE');
    expect(ss?.amount).toBeNull();
    expect(ss?.reason).toBe(IncompleteReason.AMBIGUOUS_RULE);
  });
});

describe('unverified rules and pending values', () => {
  it('refuses to use a rule with no verified source', () => {
    const unverified: ResolvedRuleSet = {
      byCategory: {
        [RuleCategory.MEDICARE]: {
          found: true,
          rule: {
            reference: reference(RuleCategory.MEDICARE, false),
            values: [{ key: 'x', groupKey: '', ordinal: 0, value: '1', verified: true }],
            payload: null,
          },
        },
      },
    };
    const result = calculatePaycheck(baseInput, { rounding: policy, rules: unverified });
    const medicare = result.fica.find((c) => c.code === 'MEDICARE_EMPLOYEE');
    expect(medicare?.reason).toBe(IncompleteReason.RULE_UNVERIFIED);
    expect(medicare?.amount).toBeNull();
  });

  it('refuses to use a rule whose values are not stated', () => {
    const pending: ResolvedRuleSet = {
      byCategory: {
        [RuleCategory.MEDICARE]: {
          found: true,
          rule: {
            reference: reference(RuleCategory.MEDICARE, true),
            // value null = NOT_STATED. Must never become zero (spec §19).
            values: [{ key: 'rate', groupKey: '', ordinal: 0, value: null, verified: false }],
            payload: null,
          },
        },
      },
    };
    const result = calculatePaycheck(baseInput, { rounding: policy, rules: pending });
    const medicare = result.fica.find((c) => c.code === 'MEDICARE_EMPLOYEE');
    expect(medicare?.reason).toBe(IncompleteReason.RULE_VALUES_PENDING);
    expect(medicare?.amount).toBeNull();
  });

  it('reports UNSUPPORTED_SCENARIO when a usable rule exists but methodology is later', () => {
    const result = calculatePaycheck(baseInput, {
      rounding: policy,
      rules: usableRuleSet(RuleCategory.SOCIAL_SECURITY),
    });
    const ss = result.fica.find((c) => c.code === 'SOCIAL_SECURITY_EMPLOYEE');
    expect(ss?.reason).toBe(IncompleteReason.METHOD_NOT_IMPLEMENTED);
    expect(ss?.amount).toBeNull();
  });
});

describe('rule version and source attachment', () => {
  const result = calculatePaycheck(baseInput, {
    rounding: policy,
    rules: usableRuleSet(RuleCategory.SOCIAL_SECURITY),
  });

  it('retains rule identity and version on the component', () => {
    const ss = result.fica.find((c) => c.code === 'SOCIAL_SECURITY_EMPLOYEE');
    expect(ss?.rules[0]?.ruleId).toBe('rule-SOCIAL_SECURITY');
    expect(ss?.rules[0]?.version).toBe(1);
    expect(ss?.rules[0]?.effectiveFrom).toBeInstanceOf(Date);
  });

  it('collects rule references and source IDs at result level, de-duplicated', () => {
    expect(result.ruleReferences.length).toBeGreaterThan(0);
    expect(result.sourceIds).toContain('src-test');
    expect(new Set(result.sourceIds).size).toBe(result.sourceIds.length);
  });
});

describe('employer / employee separation', () => {
  const result = calculatePaycheck(baseInput, { rounding: policy, rules: emptyRules });

  it('reports employer liabilities separately', () => {
    expect(result.employerTaxes.length).toBeGreaterThan(0);
    const codes = result.employerTaxes.map((c) => c.code);
    expect(codes).toContain('SOCIAL_SECURITY_EMPLOYER');
    expect(codes).toContain('FUTA_EMPLOYER');
    expect(codes).toContain('SUTA_EMPLOYER');
  });

  it('never mixes employer components into employee tax lists', () => {
    const employeeCodes = [...result.federal, ...result.fica, ...result.state, ...result.local].map(
      (c) => c.code,
    );
    for (const code of employeeCodes) {
      expect(code).not.toContain('EMPLOYER');
    }
  });
});

describe('calculation trace', () => {
  const result = calculatePaycheck(baseInput, { rounding: policy, rules: emptyRules });

  it('records the pipeline in order', () => {
    const steps = result.trace.map((entry) => entry.step);
    expect(steps).toContain('VALIDATE_INPUT');
    expect(steps).toContain('GROSS_PAY');
    expect(steps).toContain('TAXABLE_WAGES');
    expect(steps).toContain('NET_PAY');
    expect(steps.indexOf('GROSS_PAY')).toBeLessThan(steps.indexOf('TAXABLE_WAGES'));
    expect(steps.indexOf('TAXABLE_WAGES')).toBeLessThan(steps.indexOf('NET_PAY'));
  });

  it('exposes the taxable-wage derivation', () => {
    const entry = result.trace.find((e) => e.step === 'TAXABLE_WAGES');
    expect(entry?.outputs['socialSecurity']).toBe('2000');
    expect(entry?.outputs['federalIncomeTax']).toBe('2000');
  });

  it('explains why net pay is undetermined', () => {
    const entry = result.trace.find((e) => e.step === 'NET_PAY');
    expect(entry?.note).toContain('undetermined');
  });
});

describe('determinism and precision', () => {
  it('produces identical results for identical inputs', () => {
    const a = calculatePaycheck(baseInput, { rounding: policy, rules: emptyRules });
    const b = calculatePaycheck(baseInput, { rounding: policy, rules: emptyRules });
    expect(resultsMatch(a, b)).toBe(true);
  });

  it('emits every monetary value as an exact decimal string, never a number', () => {
    const result = calculatePaycheck(baseInput, { rounding: policy, rules: emptyRules });
    expect(typeof result.grossPay.total).toBe('string');
    expect(typeof result.taxableWages.medicareWages).toBe('string');
    expect(typeof result.totalDeductions).toBe('string');
  });

  it('does not mutate the caller input', () => {
    const input: CalculationInput = { ...baseInput };
    const before = JSON.stringify(input);
    calculatePaycheck(input, { rounding: policy, rules: emptyRules });
    expect(JSON.stringify(input)).toBe(before);
  });

  it('records the engine version', () => {
    const result = calculatePaycheck(baseInput, { rounding: policy, rules: emptyRules });
    expect(result.engineVersion).toBe(ENGINE_VERSION);
  });
});

describe('jurisdiction resolution foundation', () => {
  it('always resolves the federal jurisdiction', () => {
    const result = calculatePaycheck(baseInput, { rounding: policy, rules: emptyRules });
    expect(result.jurisdiction.federalCode).toBe('US');
    expect(result.jurisdiction.stateCode).toBe('US-ZZ');
  });

  it('reports an unresolved jurisdiction rather than assuming one', () => {
    const result = calculatePaycheck(
      { ...baseInput, employee: { workLocation: {} } },
      { rounding: policy, rules: emptyRules },
    );
    expect(result.jurisdiction.resolved).toBe(false);
    expect(result.jurisdiction.stateCode).toBeNull();
  });

  it('does NOT treat a ZIP code as a taxing jurisdiction', () => {
    const result = calculatePaycheck(
      { ...baseInput, employee: { workLocation: { stateCode: 'US-ZZ', zipCode: '00000' } } },
      { rounding: policy, rules: emptyRules },
    );
    // A ZIP alone yields no locality — full resolution is Phase 6 (spec §9).
    expect(result.jurisdiction.localCodes).toEqual([]);
    expect(result.jurisdiction.resolved).toBe(false);
  });
});

describe('calculation snapshot', () => {
  const result = calculatePaycheck(baseInput, {
    rounding: policy,
    rules: usableRuleSet(RuleCategory.SOCIAL_SECURITY),
  });
  const snapshot = buildSnapshot(baseInput, result);

  it('captures everything needed to reproduce the calculation', () => {
    expect(snapshot.engineVersion).toBe(ENGINE_VERSION);
    expect(snapshot.taxYear).toBe(2099);
    expect(snapshot.status).toBe(result.status);
    expect(snapshot.originalInput).toBeDefined();
    expect(snapshot.normalizedInput).toBeDefined();
    expect(snapshot.result).toBeDefined();
    expect(snapshot.ruleReferences.length).toBeGreaterThan(0);
  });

  it('denormalizes rule versions so later archival cannot break it', () => {
    expect(snapshot.ruleReferences[0]?.version).toBe(1);
    expect(snapshot.sourceIds).toContain('src-test');
  });

  it('reproduces the historical result exactly when replayed', () => {
    // Determinism is what makes a snapshot reproducible (spec §40).
    const replayed = calculatePaycheck(baseInput, {
      rounding: policy,
      rules: usableRuleSet(RuleCategory.SOCIAL_SECURITY),
    });
    expect(resultsMatch(result, replayed)).toBe(true);
  });

  it('serializes monetary values as strings in the stored payload', () => {
    const serialized = JSON.stringify(snapshot.result);
    expect(serialized).toContain('"total":"2000"');
  });
});

describe('post-tax deductions', () => {
  it('itemizes post-tax deductions separately from pre-tax', () => {
    const result = calculatePaycheck(
      {
        ...baseInput,
        preTaxDeductions: [
          {
            id: 'pre',
            basis: 'FIXED_AMOUNT',
            amount: '100',
            taxability: { federalIncomeTax: true },
          },
        ],
        postTaxDeductions: [{ id: 'roth', basis: 'FIXED_AMOUNT', amount: '50', taxability: {} }],
      },
      { rounding: policy, rules: emptyRules },
    );
    expect(result.preTaxDeductions.total).toBe('100');
    expect(result.postTaxDeductions.total).toBe('50');
    expect(result.totalDeductions).toBe('150');
    // Post-tax deductions must NOT reduce taxable wages.
    expect(result.taxableWages.federalIncomeTaxWages).toBe('1900');
  });
});

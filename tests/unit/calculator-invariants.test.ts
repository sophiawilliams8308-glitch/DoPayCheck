import { describe, expect, it } from 'vitest';

import { PayFrequency, RuleCategory, RuleStatus } from '@/lib/db/generated/client';
import { GENERIC_CURRENCY_POLICY, calculatePaycheck } from '@/lib/calculator';
import { resolveJurisdiction } from '@/lib/calculator/pipeline/jurisdiction';
import { ResolutionStatus, resolveApplicableRules } from '@/lib/rules/resolution';
import { CalculationStatus } from '@/lib/calculator/types/status';
import { TraceCategory, categoryForStep } from '@/lib/calculator/trace/trace';
import type { CalculationInput, DeductionInput } from '@/lib/calculator/types/input';
import type { ResolvedRuleSet } from '@/lib/calculator/types/rules';

/**
 * Engine invariants, remaining validation cases and trace metadata.
 *
 * NO TAX VALUES. Every number is a generic arithmetic or ordering fixture.
 */

const policy = GENERIC_CURRENCY_POLICY;
const noRules: ResolvedRuleSet = { byCategory: {} };

const base: CalculationInput = {
  taxYear: 2099,
  effectiveDate: new Date('2099-06-15T00:00:00.000Z'),
  employee: { workLocation: { stateCode: 'US-ZZ' } },
  pay: { basis: 'SALARY', payFrequency: PayFrequency.BIWEEKLY, annualSalary: '52000.00' },
  w4: { filingStatus: 'TEST_STATUS' },
};

function run(input: CalculationInput = base) {
  return calculatePaycheck(input, { rounding: policy, rules: noRules });
}

describe('overtime: explicit rate vs multiplier', () => {
  const hourly = {
    basis: 'HOURLY' as const,
    payFrequency: PayFrequency.WEEKLY,
    hourlyRate: '20',
    regularHours: '40',
    overtimeHours: '10',
  };

  it('accepts an explicit overtime rate', () => {
    const result = run({ ...base, pay: { ...hourly, overtimeRate: '30' } });
    expect(result.grossPay.overtime).toBe('300');
    expect(result.grossPay.regular).toBe('800');
  });

  it('accepts an overtime multiplier', () => {
    const result = run({ ...base, pay: { ...hourly, overtimeMultiplier: '1.5' } });
    expect(result.grossPay.overtime).toBe('300');
  });

  it('rejects supplying BOTH rate and multiplier', () => {
    const result = run({
      ...base,
      pay: { ...hourly, overtimeRate: '30', overtimeMultiplier: '1.5' },
    });
    expect(result.status).toBe(CalculationStatus.INVALID_INPUT);
    expect(result.issues.some((i) => i.path.includes('overtimeRate'))).toBe(true);
  });

  it('rejects overtime hours with neither — no premium is ever assumed', () => {
    const result = run({ ...base, pay: hourly });
    expect(result.status).toBe(CalculationStatus.INVALID_INPUT);
  });
});

describe('remaining validation cases', () => {
  it('rejects an invalid pay frequency', () => {
    const result = run({
      ...base,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      pay: { ...base.pay, payFrequency: 'FORTNIGHTLY' as any },
    });
    expect(result.status).toBe(CalculationStatus.INVALID_INPUT);
    expect(result.issues.some((i) => i.path.includes('payFrequency'))).toBe(true);
  });

  it('rejects a negative YTD value', () => {
    const result = run({ ...base, ytd: { socialSecurityWages: '-1' } });
    expect(result.status).toBe(CalculationStatus.INVALID_INPUT);
    expect(result.issues.some((i) => i.path.includes('ytd'))).toBe(true);
  });

  it('accepts valid YTD values', () => {
    const result = run({
      ...base,
      ytd: {
        grossWages: '10000',
        socialSecurityWages: '10000',
        medicareWages: '10000',
        federalWithholding: '1000',
        stateWithholding: '500',
        localWithholding: '100',
      },
    });
    expect(result.status).not.toBe(CalculationStatus.INVALID_INPUT);
  });

  it('rejects a deduction missing its amount', () => {
    const broken: DeductionInput = {
      id: 'broken',
      basis: 'FIXED_AMOUNT',
      taxability: { federalIncomeTax: true },
    };
    const result = run({ ...base, preTaxDeductions: [broken] });
    expect(result.status).toBe(CalculationStatus.INVALID_INPUT);
  });

  it('rejects a negative deduction amount', () => {
    const negative: DeductionInput = {
      id: 'neg',
      basis: 'FIXED_AMOUNT',
      amount: '-50',
      taxability: {},
    };
    expect(run({ ...base, preTaxDeductions: [negative] }).status).toBe(
      CalculationStatus.INVALID_INPUT,
    );
  });

  it('never exposes a stack trace in issues', () => {
    const result = run({ ...base, pay: { ...base.pay, annualSalary: 'abc' } });
    expect(JSON.stringify(result.issues)).not.toContain('at ');
    expect(JSON.stringify(result.issues)).not.toContain('.ts:');
  });
});

describe('rule resolution safety', () => {
  const commonRule = {
    ruleKey: 'test.superseded',
    version: 1,
    category: RuleCategory.SOCIAL_SECURITY,
    jurisdictionId: 'jur-1',
    taxYear: 2099,
    effectiveFrom: new Date('2099-01-01T00:00:00.000Z'),
    effectiveTo: null,
  };
  const query = {
    category: RuleCategory.SOCIAL_SECURITY,
    jurisdictionId: 'jur-1',
    effectiveDate: new Date('2099-06-15T00:00:00.000Z'),
  };

  it('REJECTS a superseded rule even though its tax year matches', () => {
    const result = resolveApplicableRules(
      [{ ...commonRule, id: 'r1', status: RuleStatus.SUPERSEDED }],
      query,
    );
    expect(result.status).toBe(ResolutionStatus.NOT_FOUND);
  });

  it('selects the ACTIVE rule when a superseded one also exists', () => {
    const result = resolveApplicableRules(
      [
        { ...commonRule, id: 'old', version: 1, status: RuleStatus.SUPERSEDED },
        { ...commonRule, id: 'new', version: 2, status: RuleStatus.ACTIVE },
      ],
      query,
    );
    expect(result.status).toBe(ResolutionStatus.RESOLVED);
    if (result.status === 'RESOLVED') {
      expect(result.rule.id).toBe('new');
    }
  });

  it('does not select a rule on tax year alone when the date falls outside', () => {
    const result = resolveApplicableRules(
      [
        {
          ...commonRule,
          id: 'r1',
          status: RuleStatus.ACTIVE,
          effectiveFrom: new Date('2099-09-01T00:00:00.000Z'),
        },
      ],
      query,
    );
    expect(result.status).toBe(ResolutionStatus.NOT_FOUND);
  });
});

describe('jurisdiction: work vs residence', () => {
  it('uses the work location for the primary chain', () => {
    const resolution = resolveJurisdiction({
      workLocation: { stateCode: 'US-AA', cityCode: 'US-AA-CITY' },
      residenceLocation: { stateCode: 'US-BB' },
    });
    expect(resolution.summary.stateCode).toBe('US-AA');
    expect(resolution.summary.localCodes).toContain('US-AA-CITY');
  });

  it('records residence separately without silently substituting it', () => {
    // Residence-based taxation and reciprocity are rule-driven (Phase 5/6). Phase 3 must not
    // quietly fall back to the residence state.
    const resolution = resolveJurisdiction({
      workLocation: {},
      residenceLocation: { stateCode: 'US-BB' },
    });
    expect(resolution.summary.stateCode).toBeNull();
    expect(resolution.summary.resolved).toBe(false);
    expect(resolution.unresolved).toContain('workLocation.stateCode');
  });

  it('reports an unresolved locality rather than deriving one from ZIP', () => {
    const resolution = resolveJurisdiction({
      workLocation: { stateCode: 'US-AA', zipCode: '00000' },
    });
    expect(resolution.summary.localCodes).toEqual([]);
    expect(resolution.unresolved).toContain('workLocation.zipCode');
  });
});

describe('trace metadata', () => {
  const result = run();

  it('assigns a monotonically increasing sequence', () => {
    const sequences = result.trace.map((entry) => entry.sequence);
    expect(sequences).toEqual([...sequences].sort((a, b) => a - b));
    expect(new Set(sequences).size).toBe(sequences.length);
  });

  it('assigns a category to every step', () => {
    for (const entry of result.trace) {
      expect(entry.category).toBe(categoryForStep(entry.step));
    }
    expect(categoryForStep('GROSS_PAY')).toBe(TraceCategory.EARNINGS);
    expect(categoryForStep('FICA')).toBe(TraceCategory.TAX);
  });

  it('carries a status on every entry', () => {
    for (const entry of result.trace) {
      expect(entry.status).toBeDefined();
    }
  });

  it('exposes source IDs on rule-backed steps', () => {
    const withRules: ResolvedRuleSet = {
      byCategory: {
        [RuleCategory.SOCIAL_SECURITY]: {
          found: true,
          rule: {
            reference: {
              ruleId: 'r-1',
              ruleKey: 'test.ss',
              version: 1,
              category: RuleCategory.SOCIAL_SECURITY,
              taxYear: 2099,
              jurisdictionId: 'jur-1',
              jurisdictionCode: 'US',
              effectiveFrom: new Date('2099-01-01T00:00:00.000Z'),
              effectiveTo: null,
              sourceIds: ['src-A', 'src-B'],
              verified: true,
            },
            values: [{ key: 'k', groupKey: '', ordinal: 0, value: '1', verified: true }],
            payload: null,
          },
        },
      },
    };
    const traced = calculatePaycheck(base, { rounding: policy, rules: withRules });
    const ficaEntry = traced.trace.find((e) => e.step === 'FICA' && e.rules.length > 0);
    expect(ficaEntry?.sourceIds).toEqual(['src-A', 'src-B']);
  });
});

describe('engine invariants', () => {
  it('same input + same rules produces the same result', () => {
    expect(JSON.stringify(run())).toBe(JSON.stringify(run()));
  });

  it('zero optional compensation does not change gross pay', () => {
    const withZeros = run({
      ...base,
      pay: { ...base.pay, bonus: '0', commission: '0', tips: '0', otherCompensation: '0' },
    });
    expect(withZeros.grossPay.total).toBe(run().grossPay.total);
  });

  it('a disabled deduction does not affect the result', () => {
    const disabled: DeductionInput = {
      id: 'off',
      basis: 'FIXED_AMOUNT',
      amount: '500',
      enabled: false,
      taxability: { federalIncomeTax: true },
    };
    const withDisabled = run({ ...base, preTaxDeductions: [disabled] });
    expect(withDisabled.preTaxDeductions.total).toBe('0');
    expect(withDisabled.taxableWages.federalIncomeTaxWages).toBe(
      run().taxableWages.federalIncomeTaxWages,
    );
  });

  it('employer taxes never reduce employee net pay or deductions', () => {
    const result = run();
    expect(result.employerTaxes.length).toBeGreaterThan(0);
    // Employer liabilities are reported but excluded from the employee totals.
    expect(result.totalDeductions).toBe('0');
    for (const component of result.employerTaxes) {
      expect(component.code).toContain('EMPLOYER');
    }
  });

  it('keeps the seven wage buckets independently represented', () => {
    const result = run();
    const keys = Object.keys(result.taxableWages);
    expect(keys).toHaveLength(7);
    expect(new Set(keys).size).toBe(7);
  });

  it('does not force an effective tax rate on an incomplete result', () => {
    const result = run();
    expect(result.status).toBe(CalculationStatus.INCOMPLETE);
    expect(result.effectiveTaxRate).toBeNull();
  });

  it('is normalization-deterministic across repeated runs with reordered deductions', () => {
    const a: DeductionInput = {
      id: 'a',
      basis: 'FIXED_AMOUNT',
      amount: '10',
      ordinal: 1,
      taxability: {},
    };
    const b: DeductionInput = {
      id: 'b',
      basis: 'FIXED_AMOUNT',
      amount: '20',
      ordinal: 0,
      taxability: {},
    };
    const first = run({ ...base, preTaxDeductions: [a, b] });
    const second = run({ ...base, preTaxDeductions: [b, a] });
    expect(first.preTaxDeductions.items.map((i) => i.id)).toEqual(['b', 'a']);
    expect(JSON.stringify(first.preTaxDeductions)).toBe(JSON.stringify(second.preTaxDeductions));
  });
});

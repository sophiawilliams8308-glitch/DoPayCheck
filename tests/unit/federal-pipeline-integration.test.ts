import { describe, expect, it } from 'vitest';

import { GENERIC_CURRENCY_POLICY, calculatePaycheck } from '@/lib/calculator';
import type { CalculationInput } from '@/lib/calculator/types/input';
import type { ResolvedRuleSet } from '@/lib/calculator/types/rules';
import { FederalRuleKey } from '@/lib/tax/federal/rule-keys';

import { syntheticRuleSet } from '../fixtures/federal/synthetic-rules';

/**
 * Phase 3 pipeline + Phase 4 federal engine (integration, no database).
 *
 * The point of these: ONE engine, extended. The pipeline keeps its shape, and omitting the
 * federal rule set must leave Phase 3 behaviour untouched.
 */

const noRules: ResolvedRuleSet = { byCategory: {} };

const input: CalculationInput = {
  taxYear: 2099,
  effectiveDate: new Date('2099-06-15T00:00:00.000Z'),
  employee: { workLocation: { stateCode: 'US-ZZ' } },
  pay: { basis: 'SALARY', payFrequency: 'BIWEEKLY', annualSalary: '2600' },
  w4: { filingStatus: 'SYNTHETIC_SINGLE' },
};

describe('without a federal rule set', () => {
  it('behaves exactly as Phase 3 did', () => {
    const result = calculatePaycheck(input, { rounding: GENERIC_CURRENCY_POLICY, rules: noRules });
    expect(result.federalEngine).toBeNull();
    expect(result.federal[0]?.amount).toBeNull();
    expect(result.status).toBe('INCOMPLETE');
  });
});

describe('with a federal rule set', () => {
  const options = {
    rounding: GENERIC_CURRENCY_POLICY,
    rules: noRules,
    federal: { ruleSet: syntheticRuleSet() },
  };

  it('produces federal and FICA amounts through the single entry point', () => {
    const result = calculatePaycheck(input, options);
    expect(result.federalEngine).not.toBeNull();
    // 2600 annual / 26 periods = 100 per period, matching the worksheet unit tests.
    expect(result.federal[0]?.amount).toBe('8.85');
    expect(result.fica[0]?.amount).toBe('10');
    expect(result.fica[1]?.amount).toBe('2');
  });

  it('keeps employer taxes in their own branch, never in the employee components', () => {
    const result = calculatePaycheck(input, options);

    const employerTotal = result.employerTaxes.reduce(
      (total, component) => total + Number(component.amount ?? 0),
      0,
    );
    expect(employerTotal).toBeGreaterThan(0);

    // No employer code leaks into the employee-side arrays.
    const employeeCodes = [...result.federal, ...result.fica].map((c) => c.code);
    expect(employeeCodes.filter((code) => code.includes('EMPLOYER'))).toEqual([]);

    // The federal engine's own employee total excludes every employer figure.
    expect(result.federalEngine?.employer?.total.amount).toBe('12.6');
  });

  it('still withholds the paycheck total while STATE and LOCAL remain unresolved', () => {
    // Federal being complete does not make the paycheck complete. State and local have no
    // rules in Phase 4, so a total would overstate the employee's take-home pay.
    const result = calculatePaycheck(input, options);

    expect(result.federal[0]?.amount).toBe('8.85');
    expect(result.state[0]?.amount).toBeNull();
    expect(result.local[0]?.amount).toBeNull();
    expect(result.totalEmployeeTaxes).toBeNull();
    expect(result.netPay).toBeNull();
    expect(result.status).not.toBe('COMPLETE');
  });

  it('carries federal rule provenance into the result', () => {
    const result = calculatePaycheck(input, options);
    expect(result.federalEngine?.ruleReferences.length).toBeGreaterThan(0);
    expect(result.federalEngine?.sourceIds.length).toBeGreaterThan(0);
  });

  it('reports a missing federal rule as an undetermined component, never zero', () => {
    const result = calculatePaycheck(input, {
      ...options,
      federal: { ruleSet: syntheticRuleSet({ omit: [FederalRuleKey.FICA_MEDICARE] }) },
    });
    expect(result.fica[1]?.amount).toBeNull();
    expect(result.fica[1]?.amount).not.toBe('0');
    expect(result.netPay).toBeNull();
    expect(result.status).toBe('INCOMPLETE');
  });

  it('preserves the Phase 3 pipeline order in the trace', () => {
    const result = calculatePaycheck(input, options);
    const steps = result.trace.map((entry) => entry.step);
    expect(steps.indexOf('GROSS_PAY')).toBeLessThan(steps.indexOf('TAXABLE_WAGES'));
    expect(steps.indexOf('TAXABLE_WAGES')).toBeLessThan(steps.indexOf('FEDERAL'));
    expect(steps.indexOf('FEDERAL')).toBeLessThan(steps.indexOf('NET_PAY'));
  });

  it('reduces the federal income tax bucket by a pre-tax deduction but not FICA', () => {
    const withDeduction = calculatePaycheck(
      {
        ...input,
        preTaxDeductions: [
          {
            id: '401k',
            basis: 'FIXED_AMOUNT',
            amount: '10',
            // Reduces income tax wages only — the classic FICA trap.
            taxability: { federalIncomeTax: true },
          },
        ],
      },
      options,
    );

    expect(withDeduction.taxableWages.federalIncomeTaxWages).toBe('90');
    expect(withDeduction.taxableWages.socialSecurityWages).toBe('100');
    // FICA is unchanged by the deduction; income tax withholding drops.
    expect(withDeduction.fica[0]?.amount).toBe('10');
    expect(Number(withDeduction.federal[0]?.amount)).toBeLessThan(8.85);
  });
});

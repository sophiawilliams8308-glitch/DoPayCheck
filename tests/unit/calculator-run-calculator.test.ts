import { describe, expect, it } from 'vitest';

import { runCalculator } from '@/lib/calculator/server/runCalculator';

/**
 * `runCalculator` shape/consistency validation (SEO-05 contract §10, §13, §39 "Calculator
 * integration"). These cases all return BEFORE any database access (unknown calculator, or a
 * request-shape failure) — no live database is required to exercise them.
 */

describe('runCalculator — request validation (no database access reached)', () => {
  it('rejects an unknown calculator key', async () => {
    const outcome = await runCalculator({
      calculatorKey: 'not-a-real-calculator',
      payBasis: 'SALARY',
      payFrequency: 'BIWEEKLY',
      filingStatus: 'SINGLE_OR_MFS',
      annualSalary: '60000',
    });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.reason).toBe('UNKNOWN_CALCULATOR');
    }
  });

  it('rejects an unrecognized filing status rather than passing it through', async () => {
    const outcome = await runCalculator({
      calculatorKey: 'paycheck',
      payBasis: 'SALARY',
      payFrequency: 'BIWEEKLY',
      filingStatus: 'MARRIED',
      annualSalary: '60000',
    });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.reason).toBe('REQUEST_INVALID');
    }
  });

  it('rejects a non-decimal amount rather than coercing it', async () => {
    const outcome = await runCalculator({
      calculatorKey: 'paycheck',
      payBasis: 'SALARY',
      payFrequency: 'BIWEEKLY',
      filingStatus: 'SINGLE_OR_MFS',
      annualSalary: 'sixty thousand',
    });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.reason).toBe('REQUEST_INVALID');
      expect(outcome.issues?.some((issue) => issue.path === 'annualSalary')).toBe(true);
    }
  });

  it('rejects a pay basis the calculator does not support (salary-only calculator, hourly basis)', async () => {
    const outcome = await runCalculator({
      calculatorKey: 'salary-paycheck',
      payBasis: 'HOURLY',
      payFrequency: 'BIWEEKLY',
      filingStatus: 'SINGLE_OR_MFS',
      hourlyRate: '25',
      regularHours: '80',
    });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.reason).toBe('REQUEST_INVALID');
    }
  });

  it('requires annualSalary for salary pay basis', async () => {
    const outcome = await runCalculator({
      calculatorKey: 'paycheck',
      payBasis: 'SALARY',
      payFrequency: 'BIWEEKLY',
      filingStatus: 'SINGLE_OR_MFS',
    });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.reason).toBe('REQUEST_INVALID');
      expect(outcome.issues?.some((issue) => issue.path === 'annualSalary')).toBe(true);
    }
  });

  it('requires hourlyRate and regularHours for hourly pay basis', async () => {
    const outcome = await runCalculator({
      calculatorKey: 'hourly-paycheck',
      payBasis: 'HOURLY',
      payFrequency: 'BIWEEKLY',
      filingStatus: 'SINGLE_OR_MFS',
    });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.reason).toBe('REQUEST_INVALID');
      expect(outcome.issues?.some((issue) => issue.path === 'hourlyRate')).toBe(true);
    }
  });

  it('rejects an unsupported pay frequency (DAILY is excluded from the UI vocabulary)', async () => {
    const outcome = await runCalculator({
      calculatorKey: 'paycheck',
      payBasis: 'SALARY',
      payFrequency: 'DAILY',
      filingStatus: 'SINGLE_OR_MFS',
      annualSalary: '60000',
    });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.reason).toBe('REQUEST_INVALID');
    }
  });
});

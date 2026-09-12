import { describe, expect, it } from 'vitest';

import { PayFrequency } from '@/lib/db/generated/client';
import { toStorageString } from '@/lib/core/money';
import { annualize, calculateGrossPay } from '@/lib/calculator/pipeline/gross-pay';
import { hasFixedPeriods, periodsPerYear } from '@/lib/calculator/pipeline/pay-frequency';
import { GENERIC_CURRENCY_POLICY } from '@/lib/calculator/rounding/policy';
import type { PayInput } from '@/lib/calculator/types/input';

/**
 * Gross-pay arithmetic (spec §12).
 *
 * ===========================================================================
 * THE NUMBERS BELOW ARE GENERIC ARITHMETIC FIXTURES, NOT TAX DATA.
 *
 * "1200.00" is an arbitrary salary used to check division; "1.5" is an overtime multiplier
 * SUPPLIED BY THE CALLER, not a legal requirement. No rate, bracket or threshold in this file
 * represents an official tax rule.
 * ===========================================================================
 */

const policy = GENERIC_CURRENCY_POLICY;

function salary(overrides: Partial<PayInput> = {}): PayInput {
  return {
    basis: 'SALARY',
    payFrequency: PayFrequency.BIWEEKLY,
    annualSalary: '52000.00',
    ...overrides,
  };
}

describe('pay frequency periods', () => {
  it('uses unambiguous calendar counts', () => {
    const expected: [PayFrequency, number][] = [
      [PayFrequency.WEEKLY, 52],
      [PayFrequency.BIWEEKLY, 26],
      [PayFrequency.SEMIMONTHLY, 24],
      [PayFrequency.MONTHLY, 12],
      [PayFrequency.QUARTERLY, 4],
      [PayFrequency.ANNUAL, 1],
    ];
    for (const [frequency, periods] of expected) {
      const result = periodsPerYear(frequency);
      expect(result.known).toBe(true);
      if (result.known) {
        expect(result.periods).toBe(periods);
      }
    }
  });

  it('REFUSES to assume paid days per year for DAILY', () => {
    // Payroll policy, not a calendar fact — the engine will not guess (PENDING DECISION).
    const result = periodsPerYear(PayFrequency.DAILY);
    expect(result.known).toBe(false);
    expect(hasFixedPeriods(PayFrequency.DAILY)).toBe(false);
  });

  it('accepts an explicit periodsPerYear for DAILY', () => {
    const result = periodsPerYear(PayFrequency.DAILY, 260);
    expect(result.known).toBe(true);
    if (result.known) {
      expect(result.periods).toBe(260);
    }
  });

  it('rejects a non-positive explicit override', () => {
    expect(periodsPerYear(PayFrequency.WEEKLY, 0).known).toBe(false);
    expect(periodsPerYear(PayFrequency.WEEKLY, 1.5).known).toBe(false);
  });
});

describe('salary gross pay', () => {
  it('divides annual salary by the period count for every fixed frequency', () => {
    const cases: [PayFrequency, string][] = [
      [PayFrequency.WEEKLY, '1000'],
      [PayFrequency.BIWEEKLY, '2000'],
      [PayFrequency.SEMIMONTHLY, '2166.67'],
      [PayFrequency.MONTHLY, '4333.33'],
      [PayFrequency.QUARTERLY, '13000'],
      [PayFrequency.ANNUAL, '52000'],
    ];
    for (const [frequency, expected] of cases) {
      const result = calculateGrossPay(salary({ payFrequency: frequency }), policy);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(toStorageString(result.gross.regular)).toBe(expected);
      }
    }
  });

  it('reports DAILY without periodsPerYear as unsupported rather than guessing', () => {
    const result = calculateGrossPay(salary({ payFrequency: PayFrequency.DAILY }), policy);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain('PENDING DECISION');
    }
  });

  it('computes DAILY when periodsPerYear is supplied', () => {
    const result = calculateGrossPay(
      salary({ payFrequency: PayFrequency.DAILY, periodsPerYear: 260 }),
      policy,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(toStorageString(result.gross.regular)).toBe('200');
    }
  });
});

describe('hourly gross pay', () => {
  const hourly: PayInput = {
    basis: 'HOURLY',
    payFrequency: PayFrequency.WEEKLY,
    hourlyRate: '25.50',
    regularHours: '40',
  };

  it('multiplies regular hours by rate', () => {
    const result = calculateGrossPay(hourly, policy);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(toStorageString(result.gross.regular)).toBe('1020');
    }
  });

  it('applies the CALLER-SUPPLIED overtime multiplier', () => {
    // The engine performs arithmetic only; jurisdiction overtime law is Phase 5.
    const result = calculateGrossPay(
      { ...hourly, overtimeHours: '10', overtimeMultiplier: '1.5' },
      policy,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(toStorageString(result.gross.overtime)).toBe('382.5');
      expect(toStorageString(result.gross.total)).toBe('1402.5');
    }
  });

  it('treats absent overtime hours as no overtime, not zero-rate arithmetic', () => {
    const result = calculateGrossPay(hourly, policy);
    if (result.ok) {
      expect(toStorageString(result.gross.overtime)).toBe('0');
    }
  });

  it('handles fractional hours exactly', () => {
    const result = calculateGrossPay({ ...hourly, regularHours: '37.5' }, policy);
    if (result.ok) {
      expect(toStorageString(result.gross.regular)).toBe('956.25');
    }
  });
});

describe('supplemental compensation', () => {
  it('adds bonus, commission, tips and other compensation', () => {
    const result = calculateGrossPay(
      salary({
        payFrequency: PayFrequency.ANNUAL,
        annualSalary: '1000',
        bonus: '100',
        commission: '50',
        tips: '25.50',
        otherCompensation: '10.25',
      }),
      policy,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(toStorageString(result.gross.bonus)).toBe('100');
      expect(toStorageString(result.gross.commission)).toBe('50');
      expect(toStorageString(result.gross.tips)).toBe('25.5');
      expect(toStorageString(result.gross.other)).toBe('10.25');
      expect(toStorageString(result.gross.total)).toBe('1185.75');
    }
  });

  it('sums many fractional amounts without floating-point drift', () => {
    const result = calculateGrossPay(
      salary({
        payFrequency: PayFrequency.ANNUAL,
        annualSalary: '0.10',
        bonus: '0.20',
      }),
      policy,
    );
    // 0.1 + 0.2 is 0.30000000000000004 in IEEE-754.
    if (result.ok) {
      expect(toStorageString(result.gross.total)).toBe('0.3');
    }
  });
});

describe('annualize', () => {
  const monthly = salary({ payFrequency: PayFrequency.MONTHLY, annualSalary: '12000' });

  it('multiplies a per-period amount back up by the period count', () => {
    const gross = calculateGrossPay(monthly, policy);
    expect(gross.ok).toBe(true);
    if (gross.ok) {
      expect(toStorageString(gross.gross.total)).toBe('1000');
      const annual = annualize(gross.gross.total, monthly, policy);
      expect(annual).not.toBeNull();
      expect(toStorageString(annual!)).toBe('12000');
    }
  });

  const daily: PayInput = {
    basis: 'HOURLY',
    payFrequency: PayFrequency.DAILY,
    hourlyRate: '10',
    regularHours: '8',
  };

  it('returns null for DAILY without an explicit period count', () => {
    const gross = calculateGrossPay(daily, policy);
    expect(gross.ok).toBe(true);
    if (gross.ok) {
      // Not zero, not a guess — simply unavailable.
      expect(annualize(gross.gross.total, daily, policy)).toBeNull();
    }
  });

  it('annualizes DAILY once a period count is supplied', () => {
    const withPeriods: PayInput = { ...daily, periodsPerYear: 260 };
    const gross = calculateGrossPay(withPeriods, policy);
    if (gross.ok) {
      const annual = annualize(gross.gross.total, withPeriods, policy);
      expect(toStorageString(annual!)).toBe('20800');
    }
  });
});

import { type Money, sum } from '@/lib/core/money';

/**
 * Employer federal payroll cost aggregation (Phase 4, Track D).
 *
 * ===========================================================================
 * EMPLOYER LIABILITIES NEVER REDUCE EMPLOYEE NET PAY.
 *
 * These are the employer's own taxes. They are reported alongside the payslip so the true
 * cost of employment is visible, and they are kept in their own result branch so they cannot
 * be summed into employee withholding by accident.
 * ===========================================================================
 *
 * Additional Medicare is deliberately absent: it has no employer share at all.
 */

export interface EmployerFederalCosts {
  readonly socialSecurity: Money;
  readonly medicare: Money;
  readonly futa: Money;
  readonly total: Money;
}

export function totalEmployerCosts(parts: {
  readonly socialSecurity: Money;
  readonly medicare: Money;
  readonly futa: Money;
}): EmployerFederalCosts {
  return {
    ...parts,
    total: sum([parts.socialSecurity, parts.medicare, parts.futa]),
  };
}

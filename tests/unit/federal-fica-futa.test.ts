import { describe, expect, it } from 'vitest';

import { money } from '@/lib/core/money';
import { FEDERAL_ROUNDING_V1 } from '@/lib/tax/federal/rounding/federal-rounding';
import {
  calculateSocialSecurity,
  socialSecurityTaxableWages,
} from '@/lib/tax/federal/fica/social-security';
import { calculateMedicare } from '@/lib/tax/federal/fica/medicare';
import {
  additionalMedicareTaxableWages,
  calculateAdditionalMedicare,
} from '@/lib/tax/federal/fica/additional-medicare';
import { calculateFuta, futaTaxableWages } from '@/lib/tax/federal/employer/futa';
import { FederalRuleKey } from '@/lib/tax/federal/rule-keys';

import { syntheticRuleSet } from '../fixtures/federal/synthetic-rules';

/**
 * FICA and FUTA (Phase 4, Tracks C and D).
 *
 * SYNTHETIC RULE DATA ONLY: 10% Social Security to a base of 1000, 2% Medicare uncapped, 1%
 * Additional Medicare over 2000, FUTA 6% less a 5.4% credit to a base of 700. None of these
 * are IRS figures. The assertions are about wage-base mechanics and employee/employer
 * separation, not amounts.
 */

const policy = FEDERAL_ROUNDING_V1;
const rules = syntheticRuleSet();

describe('Social Security wage base', () => {
  it('taxes the whole period when the base is far away', () => {
    const { taxable } = socialSecurityTaxableWages(money('100'), money('0'), money('1000'));
    expect(taxable.toString()).toBe('100');
  });

  it('taxes only the remaining room when the period crosses the base', () => {
    const { taxable, remaining } = socialSecurityTaxableWages(
      money('100'),
      money('950'),
      money('1000'),
    );
    expect(remaining.toString()).toBe('50');
    expect(taxable.toString()).toBe('50');
  });

  it('taxes nothing once the base is reached', () => {
    const { taxable } = socialSecurityTaxableWages(money('100'), money('1000'), money('1000'));
    expect(taxable.toString()).toBe('0');
  });

  it('never returns negative room when YTD exceeds the base', () => {
    const { taxable, remaining } = socialSecurityTaxableWages(
      money('100'),
      money('5000'),
      money('1000'),
    );
    expect(remaining.toString()).toBe('0');
    expect(taxable.toString()).toBe('0');
  });

  it('treats YTD as EXCLUDING the current period (D-SS-1)', () => {
    // With YTD 900 and a 1000 base, a 100 cheque is fully taxable. If YTD included the
    // current period this would wrongly tax 0.
    const { taxable } = socialSecurityTaxableWages(money('100'), money('900'), money('1000'));
    expect(taxable.toString()).toBe('100');
  });

  it('computes employee and employer from SEPARATE rates', () => {
    const result = calculateSocialSecurity(rules, money('100'), money('0'), policy);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.employee.toString()).toBe('10');
    expect(result.value.employer.toString()).toBe('10');
  });

  it('is INCOMPLETE, not zero, when the wage base is not stated', () => {
    const noBase = syntheticRuleSet();
    const entry = noBase.entries[FederalRuleKey.FICA_SOCIAL_SECURITY];
    if (entry === undefined || !entry.available) throw new Error('fixture');
    const patched = {
      ...noBase,
      entries: {
        ...noBase.entries,
        [FederalRuleKey.FICA_SOCIAL_SECURITY]: {
          available: true as const,
          rule: {
            ...entry.rule,
            detail: { employeeRate: '0.1', employerRate: '0.1', wageBase: null },
          },
        },
      },
    };
    const result = calculateSocialSecurity(patched, money('100'), money('0'), policy);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problem.reason).toBe('COMPONENT_NOT_STATED');
    expect(result.problem.component).toBe('wageBase');
  });
});

describe('Medicare', () => {
  it('applies no cap when the source states there is none', () => {
    const result = calculateMedicare(rules, money('100000'), policy);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.capApplied).toBe(false);
    expect(result.value.taxableThisPeriod.toString()).toBe('100000');
  });

  it('separates employee and employer', () => {
    const result = calculateMedicare(rules, money('100'), policy);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.employee.toString()).toBe('2');
    expect(result.value.employer.toString()).toBe('2');
  });

  it('is INCOMPLETE when a stated wage limit has no value', () => {
    const base = syntheticRuleSet();
    const entry = base.entries[FederalRuleKey.FICA_MEDICARE];
    if (entry === undefined || !entry.available) throw new Error('fixture');
    const patched = {
      ...base,
      entries: {
        ...base.entries,
        [FederalRuleKey.FICA_MEDICARE]: {
          available: true as const,
          rule: {
            ...entry.rule,
            // The source says a limit exists but does not state it: incomplete, not uncapped.
            detail: { employeeRate: '0.02', employerRate: '0.02', hasWageLimit: true },
          },
        },
      },
    };
    const result = calculateMedicare(patched, money('100'), policy);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problem.component).toBe('wageLimit');
  });
});

describe('Additional Medicare', () => {
  it('taxes nothing below the threshold', () => {
    const { taxable } = additionalMedicareTaxableWages(money('100'), money('0'), money('2000'));
    expect(taxable.toString()).toBe('0');
  });

  it('taxes only the portion above the threshold in the crossing period', () => {
    const { taxable } = additionalMedicareTaxableWages(money('100'), money('1950'), money('2000'));
    expect(taxable.toString()).toBe('50');
  });

  it('taxes the whole period once the threshold is already passed', () => {
    const { taxable } = additionalMedicareTaxableWages(money('100'), money('5000'), money('2000'));
    expect(taxable.toString()).toBe('100');
  });

  it('uses the threshold for the filing status', () => {
    const single = calculateAdditionalMedicare(
      rules,
      money('100'),
      money('1950'),
      'SYNTHETIC_SINGLE',
      policy,
    );
    const married = calculateAdditionalMedicare(
      rules,
      money('100'),
      money('1950'),
      'SYNTHETIC_MARRIED',
      policy,
    );
    expect(single.ok && married.ok).toBe(true);
    if (!single.ok || !married.ok) return;
    expect(single.value.employee.toString()).toBe('0.5');
    // The married threshold (3000) is not reached, so nothing is taxed.
    expect(married.value.employee.toString()).toBe('0');
  });

  it('reports PENDING_VERIFICATION when threshold semantics are unverified', () => {
    const result = calculateAdditionalMedicare(
      syntheticRuleSet({ additionalMedicarePending: true }),
      money('100'),
      money('1950'),
      'SYNTHETIC_SINGLE',
      policy,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problem.reason).toBe('PENDING_VERIFICATION');
    expect(result.problem.component).toBe('thresholdInclusive');
  });

  it('exposes no employer figure at all', () => {
    const result = calculateAdditionalMedicare(
      rules,
      money('100'),
      money('5000'),
      'SYNTHETIC_SINGLE',
      policy,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(Object.keys(result.value)).not.toContain('employer');
  });
});

describe('FUTA', () => {
  it('caps at the wage base', () => {
    const { taxable } = futaTaxableWages(money('100'), money('650'), money('700'));
    expect(taxable.toString()).toBe('50');
  });

  it('computes the effective rate as gross minus credit', () => {
    const result = calculateFuta(rules, money('100'), money('0'), policy);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.grossRate.toString()).toBe('0.06');
    expect(result.value.credit.toString()).toBe('0.054');
    expect(result.value.effectiveRate.toString()).toBe('0.006');
    expect(result.value.employer.toString()).toBe('0.6');
  });

  it('exposes only an employer figure — FUTA is never an employee deduction', () => {
    const result = calculateFuta(rules, money('100'), money('0'), policy);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(Object.keys(result.value)).not.toContain('employee');
  });

  it('is INCOMPLETE when the credit is not stated — it does not assume a full credit', () => {
    const base = syntheticRuleSet();
    const entry = base.entries[FederalRuleKey.FUTA];
    if (entry === undefined || !entry.available) throw new Error('fixture');
    const patched = {
      ...base,
      entries: {
        ...base.entries,
        [FederalRuleKey.FUTA]: {
          available: true as const,
          rule: {
            ...entry.rule,
            detail: { grossRate: '0.06', standardCredit: null, wageBase: '700' },
          },
        },
      },
    };
    const result = calculateFuta(patched, money('100'), money('0'), policy);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problem.component).toBe('standardCredit');
  });
});

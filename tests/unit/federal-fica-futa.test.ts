import { describe, expect, it } from 'vitest';

import { money } from '@/lib/core/money';
import { applyWageBaseCap, calculateSocialSecurity } from '@/lib/tax/federal/fica/social-security';
import { calculateMedicare } from '@/lib/tax/federal/fica/medicare';
import {
  applyThresholdFloor,
  calculateAdditionalMedicare,
} from '@/lib/tax/federal/fica/additional-medicare';
import { calculateFuta } from '@/lib/tax/federal/employer/futa';
import { resolveRoundingPolicy } from '@/lib/tax/federal/rounding/federal-rounding';
import { FederalRuleKey } from '@/lib/tax/federal/rule-keys';

import {
  syntheticMedicareWageBaseCapped,
  syntheticRuleSet,
} from '../fixtures/federal/synthetic-rules';

/**
 * FICA and FUTA — spec §13, §14, §15, §16, §18.
 *
 * SYNTHETIC RULE DATA ONLY. Ten percent Social Security to a base of 1000, two
 * percent Medicare uncapped, one percent Additional Medicare over 2000, FUTA
 * ten percent less a four percent credit to a base of 700. None are IRS
 * figures; the assertions are about mechanics and separation.
 */

const rules = syntheticRuleSet();
const policyRead = resolveRoundingPolicy(rules);
if (!policyRead.ok) throw new Error('fixture: rounding policy');
const policy = policyRead.value;

describe('Social Security wage base (§13)', () => {
  it('taxes the full period below the base', () => {
    expect(applyWageBaseCap(money('100'), money('0'), money('1000')).taxable.toString()).toBe(
      '100',
    );
  });

  it('taxes only the remaining room on the straddling period', () => {
    const { taxable, remaining } = applyWageBaseCap(money('100'), money('950'), money('1000'));
    expect(remaining.toString()).toBe('50');
    expect(taxable.toString()).toBe('50');
  });

  it('taxes nothing once the base is exhausted, and never refunds', () => {
    const { taxable, remaining } = applyWageBaseCap(money('100'), money('5000'), money('1000'));
    expect(remaining.toString()).toBe('0');
    expect(taxable.toString()).toBe('0');
  });

  it('treats YTD as EXCLUDING the current period (D-SS-1)', () => {
    // YTD 900 against a 1000 base leaves a 100 cheque fully taxable. Under the
    // including-convention this would wrongly tax nothing.
    expect(applyWageBaseCap(money('100'), money('900'), money('1000')).taxable.toString()).toBe(
      '100',
    );
  });

  it('zero wages give zero tax and remain COMPLETE', () => {
    const result = calculateSocialSecurity(rules, money('0'), money('0'), policy);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.employee.toString()).toBe('0');
  });

  it('reads SEPARATE employee and employer rate records', () => {
    const asymmetric = syntheticRuleSet({
      overrides: {
        [FederalRuleKey.SS_EMPLOYER_RATE]: {
          shape: 'RATE',
          rate: '20',
          unit: 'PERCENT',
          appliesTo: 'EMPLOYER',
        },
      },
    });
    const result = calculateSocialSecurity(asymmetric, money('100'), money('0'), policy);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.employee.toString()).toBe('10');
    expect(result.value.employer.toString()).toBe('20');
  });

  it('is INCOMPLETE, naming the key, when the wage base is missing', () => {
    const result = calculateSocialSecurity(
      syntheticRuleSet({ omit: [FederalRuleKey.SS_WAGE_BASE] }),
      money('100'),
      money('0'),
      policy,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problem.ruleKey).toBe(FederalRuleKey.SS_WAGE_BASE);
  });

  it('treats a NOT_APPLICABLE Social Security base as a data defect (§13.1)', () => {
    const result = calculateSocialSecurity(
      syntheticRuleSet({
        overrides: {
          [FederalRuleKey.SS_WAGE_BASE]: {
            shape: 'WAGE_BASE',
            amount: null,
            basis: 'ANNUAL',
            applicability: 'NOT_APPLICABLE',
          },
        },
      }),
      money('100'),
      money('0'),
      policy,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problem.reason).toBe('RULE_CONFLICT');
  });
});

describe('Medicare and the NOT_APPLICABLE record (§14.3)', () => {
  it('proceeds uncapped when the wage-base record says NOT_APPLICABLE', () => {
    const result = calculateMedicare(rules, money('100000'), policy);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.capApplied).toBe(false);
    expect(result.value.wageBaseBasis).toBe('NOT_APPLICABLE');
    expect(result.value.taxableThisPeriod.toString()).toBe('100000');
  });

  it('is INCOMPLETE when the wage-base RECORD is absent — not uncapped', () => {
    const result = calculateMedicare(
      syntheticRuleSet({ omit: [FederalRuleKey.MEDICARE_WAGE_BASE] }),
      money('100'),
      policy,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problem.ruleKey).toBe(FederalRuleKey.MEDICARE_WAGE_BASE);
  });

  it('applies a cap when one is stated — proving the path is data-driven', () => {
    const capped = syntheticRuleSet({
      overrides: { [FederalRuleKey.MEDICARE_WAGE_BASE]: syntheticMedicareWageBaseCapped },
    });
    const result = calculateMedicare(capped, money('1000'), policy);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.capApplied).toBe(true);
    expect(result.value.taxableThisPeriod.toString()).toBe('500');
  });

  it('separates employee and employer', () => {
    const result = calculateMedicare(rules, money('100'), policy);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.employee.toString()).toBe('2');
    expect(result.value.employer.toString()).toBe('2');
  });
});

describe('Additional Medicare — employee only, filing-status independent (§15.1)', () => {
  it('taxes nothing below the threshold', () => {
    expect(applyThresholdFloor(money('100'), money('0'), money('2000')).taxable.toString()).toBe(
      '0',
    );
  });

  it('taxes only the excess on the crossing period', () => {
    expect(applyThresholdFloor(money('100'), money('1950'), money('2000')).taxable.toString()).toBe(
      '50',
    );
  });

  it('taxes the whole period once already above the threshold', () => {
    expect(applyThresholdFloor(money('100'), money('5000'), money('2000')).taxable.toString()).toBe(
      '100',
    );
  });

  it('taxes nothing when YTD is exactly at the threshold boundary minus the period', () => {
    expect(applyThresholdFloor(money('100'), money('1900'), money('2000')).taxable.toString()).toBe(
      '0',
    );
  });

  it('THE FUNCTION TAKES NO FILING STATUS — the signature is the enforcement', () => {
    // §15.1(3): the employer threshold is a fixed wage amount, independent of
    // filing status; that dependence belongs on Form 8959, not in payroll.
    expect(calculateAdditionalMedicare.length).toBe(4);
  });

  it('exposes no employer figure at all', () => {
    const result = calculateAdditionalMedicare(rules, money('100'), money('5000'), policy);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(Object.keys(result.value)).not.toContain('employer');
  });

  it('surfaces the unresolved V-02 threshold semantics rather than choosing', () => {
    const result = calculateAdditionalMedicare(rules, money('100'), money('1950'), policy);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.thresholdInclusive).toBeNull();
    expect(result.value.employee.toString()).toBe('0.5');
  });
});

describe('FUTA — employer only (§18)', () => {
  it('caps at the wage base', () => {
    const result = calculateFuta(rules, money('100'), money('650'), true, policy);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.taxableThisPeriod.toString()).toBe('50');
  });

  it('DERIVES the effective rate rather than storing it', () => {
    const result = calculateFuta(rules, money('100'), money('0'), true, policy);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.grossRate.toString()).toBe('0.1');
    expect(result.value.credit.toString()).toBe('0.04');
    expect(result.value.effectiveRate.toString()).toBe('0.06');
    expect(result.value.employer.toString()).toBe('6');
  });

  it('records that credit reduction was not evaluated', () => {
    const result = calculateFuta(rules, money('100'), money('0'), true, policy);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.creditReductionEvaluated).toBe(false);
  });

  it('omits FUTA with a stated reason when the employer is not subject to it', () => {
    const result = calculateFuta(rules, money('100'), money('0'), false, policy);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problem.reason).toBe('SCENARIO_UNSUPPORTED');
  });

  it('exposes no employee figure — FUTA is never a paycheck deduction', () => {
    const result = calculateFuta(rules, money('100'), money('0'), true, policy);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(Object.keys(result.value)).not.toContain('employee');
  });

  it('is INCOMPLETE when the credit is not stated — no full credit is assumed', () => {
    const result = calculateFuta(
      syntheticRuleSet({ omit: [FederalRuleKey.FUTA_STANDARD_CREDIT] }),
      money('100'),
      money('0'),
      true,
      policy,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problem.ruleKey).toBe(FederalRuleKey.FUTA_STANDARD_CREDIT);
  });
});

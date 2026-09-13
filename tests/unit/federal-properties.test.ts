import { describe, expect, it } from 'vitest';

import { compare, money, zero } from '@/lib/core/money';
import { calculateFederalTaxes } from '@/lib/tax/federal';
import { FederalRuleKey } from '@/lib/tax/federal/rule-keys';

import { syntheticRuleSet } from '../fixtures/federal/synthetic-rules';
import { context } from '../fixtures/federal/context';

/**
 * Property tests — spec §33.3.
 *
 * These assert INVARIANTS over many generated inputs rather than checking one
 * worked example. §17.2 calls the first of them the strongest protection
 * against the most damaging class of error in this domain.
 */

/** A deterministic spread of wages, so a failure is always reproducible. */
const WAGES = [
  '0',
  '0.01',
  '1',
  '99.99',
  '100',
  '100.01',
  '250',
  '999.99',
  '1000',
  '5000',
  '123456.78',
];
const FREQUENCIES = ['WEEKLY', 'BIWEEKLY', 'SEMIMONTHLY', 'MONTHLY', 'QUARTERLY'];

describe('§17.2 — employer taxes never reach net pay', () => {
  it('VARYING EVERY EMPLOYER RATE AND THE FUTA WAGE BASE LEAVES THE EMPLOYEE TOTAL IDENTICAL', () => {
    const baseline = calculateFederalTaxes(context({ regular: '500' }));

    const perturbed = calculateFederalTaxes(
      context({
        regular: '500',
        ruleSet: syntheticRuleSet({
          overrides: {
            [FederalRuleKey.SS_EMPLOYER_RATE]: {
              shape: 'RATE',
              rate: '99',
              unit: 'PERCENT',
              appliesTo: 'EMPLOYER',
            },
            [FederalRuleKey.MEDICARE_EMPLOYER_RATE]: {
              shape: 'RATE',
              rate: '77',
              unit: 'PERCENT',
              appliesTo: 'EMPLOYER',
            },
            [FederalRuleKey.FUTA_GROSS_RATE]: {
              shape: 'RATE',
              rate: '55',
              unit: 'PERCENT',
              appliesTo: 'EMPLOYER',
            },
            [FederalRuleKey.FUTA_WAGE_BASE]: {
              shape: 'WAGE_BASE',
              amount: '999999',
              basis: 'ANNUAL',
              applicability: 'APPLIES',
            },
          },
        }),
      }),
    );

    // The employer figures must move...
    expect(perturbed.employer?.totalEmployerFederalTaxes.amount).not.toBe(
      baseline.employer?.totalEmployerFederalTaxes.amount,
    );
    // ...and the employee side must not, bit for bit.
    expect(JSON.stringify(perturbed.employee)).toBe(JSON.stringify(baseline.employee));
  });
});

describe('§15.1 — Additional Medicare is filing-status independent', () => {
  it('varying filing status leaves Additional Medicare bit-identical', () => {
    const statuses = ['SINGLE_OR_MFS', 'MARRIED_FILING_JOINTLY'] as const;
    const results = statuses.map((filingStatus) =>
      calculateFederalTaxes(
        context({ regular: '5000', ytd: { medicareWages: '1990' }, w4: { filingStatus } }),
      ),
    );
    const [first, second] = results;
    expect(first?.employee.additionalMedicareEmployee.amount).toBe(
      second?.employee.additionalMedicareEmployee.amount,
    );
  });
});

describe('every tax amount is non-negative', () => {
  it('holds across the wage spread and every pay frequency', () => {
    for (const wage of WAGES) {
      for (const payFrequency of FREQUENCIES) {
        const result = calculateFederalTaxes(context({ regular: wage, payFrequency }));
        const amounts = [
          result.employee.federalIncomeTaxWithheld,
          result.employee.socialSecurityEmployee,
          result.employee.medicareEmployee,
          result.employee.additionalMedicareEmployee,
          result.employer?.futaEmployer,
        ];
        for (const amount of amounts) {
          if (amount !== undefined && amount.amount !== null) {
            expect(
              compare(money(amount.amount), zero()),
              `${amount.code} at ${wage}/${payFrequency}`,
            ).toBeGreaterThanOrEqual(0);
          }
        }
      }
    }
  });
});

describe('a taxable amount never exceeds its bucket', () => {
  it('holds across the wage spread', () => {
    for (const wage of WAGES) {
      const result = calculateFederalTaxes(context({ regular: wage }));
      const ss = result.employee.socialSecurityEmployee.amount;
      const ssWages = result.buckets.socialSecurityWages;
      if (ss !== null && ssWages !== null) {
        expect(compare(money(ss), money(ssWages))).toBeLessThanOrEqual(0);
      }
      const medicare = result.employee.medicareEmployee.amount;
      const medicareWages = result.buckets.medicareWages;
      if (medicare !== null && medicareWages !== null) {
        expect(compare(money(medicare), money(medicareWages))).toBeLessThanOrEqual(0);
      }
    }
  });
});

describe('recomputation is bit-identical', () => {
  it('holds across the wage spread', () => {
    for (const wage of WAGES) {
      const first = calculateFederalTaxes(context({ regular: wage }));
      const second = calculateFederalTaxes(context({ regular: wage }));
      expect(JSON.stringify(first), `wage ${wage}`).toBe(JSON.stringify(second));
    }
  });
});

describe('withholding is monotonically non-decreasing in wages', () => {
  it('holds with the W-4 held constant', () => {
    let previous = -1;
    for (const wage of WAGES) {
      const result = calculateFederalTaxes(context({ regular: wage }));
      const amount = result.employee.federalIncomeTaxWithheld.amount;
      expect(amount).not.toBeNull();
      const current = Number(amount);
      expect(current, `withholding fell at wage ${wage}`).toBeGreaterThanOrEqual(previous);
      previous = current;
    }
  });

  it('holds for Social Security up to the wage base, then plateaus', () => {
    const low = calculateFederalTaxes(context({ regular: '100' }));
    const mid = calculateFederalTaxes(context({ regular: '900' }));
    const over = calculateFederalTaxes(context({ regular: '5000' }));
    expect(Number(mid.employee.socialSecurityEmployee.amount)).toBeGreaterThan(
      Number(low.employee.socialSecurityEmployee.amount),
    );
    // Capped at the synthetic 1000 base: ten percent of 1000.
    expect(over.employee.socialSecurityEmployee.amount).toBe('100');
  });
});

import { describe, expect, it } from 'vitest';

import { calculateFederalTaxes, FEDERAL_ENGINE_VERSION } from '@/lib/tax/federal';
import { SupplementalMethod } from '@/lib/tax/federal/fit/supplemental';
import { FederalRuleKey, requiredRuleKeys } from '@/lib/tax/federal/rule-keys';
import { deriveScenario, toFederalW4 } from '@/lib/tax/federal/context';

import { syntheticRuleSet } from '../fixtures/federal/synthetic-rules';
import { asPerPeriod, context, deduction } from '../fixtures/federal/context';

/**
 * Federal engine orchestration — spec §2.6, §4.2, §5.5, §17, §28.
 *
 * All rule data synthetic. These assert TRACK SEPARATION, status handling,
 * disclosures and determinism — never an IRS amount.
 */

describe('scenario-dependent required keys (§3.2)', () => {
  const base = toFederalW4({ filingStatus: 'SINGLE_OR_MFS' });
  const opts = {
    hasSupplementalWages: false,
    nraFlagEnabled: false,
    wantsAnnualEstimate: false,
    wantsEmployerTaxes: false,
  };

  it('always requires FICA, pay periods and the rounding policy', () => {
    const keys = requiredRuleKeys(deriveScenario(base, opts));
    for (const key of [
      FederalRuleKey.SS_WAGE_BASE,
      FederalRuleKey.MEDICARE_WAGE_BASE,
      FederalRuleKey.ADDL_MEDICARE_WITHHOLDING_THRESHOLD,
      FederalRuleKey.FIT_PAY_PERIODS_PER_YEAR,
      FederalRuleKey.FIT_ROUNDING_POLICY,
    ]) {
      expect(keys).toContain(key);
    }
  });

  it('does not require rules the scenario will never read', () => {
    const keys = requiredRuleKeys(deriveScenario(base, opts));
    expect(keys).not.toContain(FederalRuleKey.SUPP_MANDATORY_FLAT_RATE);
    expect(keys).not.toContain(FederalRuleKey.FUTA_GROSS_RATE);
    expect(keys).not.toContain(FederalRuleKey.ANNUAL_RATE_BRACKETS);
    expect(keys).not.toContain(FederalRuleKey.FIT_ALLOWANCE_VALUE);
  });

  it('swaps the schedule key when Step 2 is checked, and drops line 1g', () => {
    const checked = toFederalW4({ filingStatus: 'SINGLE_OR_MFS', multipleJobs: true });
    const keys = requiredRuleKeys(deriveScenario(checked, opts));
    expect(keys).toContain(FederalRuleKey.FIT_RATE_SCHEDULE_STEP2);
    expect(keys).not.toContain(FederalRuleKey.FIT_RATE_SCHEDULE_STANDARD);
    expect(keys).not.toContain(FederalRuleKey.FIT_STEP2_UNCHECKED_ADJUSTMENT);
  });

  it('requires the allowance value only for a 2019-or-earlier form', () => {
    const legacy = toFederalW4({ filingStatus: 'SINGLE_OR_MFS', w4Revision: 'PRE_2020' });
    expect(requiredRuleKeys(deriveScenario(legacy, opts))).toContain(
      FederalRuleKey.FIT_ALLOWANCE_VALUE,
    );
  });

  it('does not require the NRA table while the flag is off', () => {
    const nra = toFederalW4({ filingStatus: 'SINGLE_OR_MFS', isNonresidentAlien: true });
    const keys = requiredRuleKeys(deriveScenario(nra, opts));
    expect(keys).not.toContain(FederalRuleKey.FIT_NRA_WAGE_ADDITION_POST2019);
  });
});

describe('four-track separation (§1.2, §17)', () => {
  it('produces employee, employer and estimate branches independently', () => {
    const result = calculateFederalTaxes(context());
    expect(result.employee.federalIncomeTaxWithheld.amount).toBe('8.85');
    expect(result.employee.socialSecurityEmployee.amount).toBe('10');
    expect(result.employee.medicareEmployee.amount).toBe('2');
    expect(result.employer?.futaEmployer.amount).toBe('6');
  });

  it('the employee total is exactly the employee components', () => {
    const result = calculateFederalTaxes(context());
    // 8.85 + 0 supplemental + 10 + 2 + 0 = 20.85
    expect(result.employee.totalEmployeeFederalTaxes.amount).toBe('20.85');
    // 10 + 2 + 6 = 18, deliberately in its own branch.
    expect(result.employer?.totalEmployerFederalTaxes.amount).toBe('18');
  });

  it('omits the employer branch entirely when not requested', () => {
    expect(calculateFederalTaxes(context({ includeEmployerTaxes: false })).employer).toBeNull();
  });

  it('discloses that the employer cost is partial (§17.4)', () => {
    const result = calculateFederalTaxes(context());
    expect(result.employer?.disclosures.some((d) => d.includes('partial'))).toBe(true);
  });
});

describe('Track A never fails the paycheck (§4.2)', () => {
  it('marks the estimate unavailable while the rest stays COMPLETE', () => {
    const result = calculateFederalTaxes(
      context({
        includeAnnualEstimate: true,
        ruleSet: syntheticRuleSet({ omit: [FederalRuleKey.ANNUAL_RATE_BRACKETS] }),
      }),
    );
    expect(result.estimates?.available).toBe(false);
    expect(result.estimates?.annualFederalIncomeTaxEstimate).toBeNull();
    // The decisive assertion: the paycheck is untouched.
    expect(result.status).toBe('COMPLETE');
    expect(result.employee.federalIncomeTaxWithheld.amount).toBe('8.85');
  });

  it('leaves every other output bit-identical when Track A is disabled', () => {
    const withEstimate = calculateFederalTaxes(context({ includeAnnualEstimate: true }));
    const without = calculateFederalTaxes(context({ includeAnnualEstimate: false }));
    expect(JSON.stringify(without.employee)).toBe(JSON.stringify(withEstimate.employee));
    expect(JSON.stringify(without.employer)).toBe(JSON.stringify(withEstimate.employer));
  });

  it('computes the estimate with the personal exemption subtracted', () => {
    const result = calculateFederalTaxes(context({ includeAnnualEstimate: true }));
    // 2600 annual − 500 standard − 100 exemption = 2000 taxable.
    expect(result.estimates?.taxableIncome).toBe('2000');
    // 1000 at 10% + 1000 at 20% = 300.
    expect(result.estimates?.annualFederalIncomeTaxEstimate).toBe('300');
  });

  it('is unavailable for a filing status whose brackets are PENDING DATA (§4.3)', () => {
    const result = calculateFederalTaxes(
      context({ includeAnnualEstimate: true, w4: { filingStatus: 'MARRIED_FILING_JOINTLY' } }),
    );
    expect(result.estimates?.available).toBe(false);
  });

  it('carries the limitation list so the frontend cannot overstate it (§4.4)', () => {
    const result = calculateFederalTaxes(context({ includeAnnualEstimate: true }));
    expect(result.estimates?.isEstimate).toBe(true);
    expect(result.estimates?.limitations.length).toBeGreaterThan(0);
  });
});

describe('exemption from withholding (§5.5)', () => {
  it('withholds no income tax but leaves FICA and FUTA untouched', () => {
    const result = calculateFederalTaxes(context({ w4: { claimsExemption: true } }));
    expect(result.employee.federalIncomeTaxWithheld.amount).toBe('0');
    expect(result.employee.socialSecurityEmployee.amount).toBe('10');
    expect(result.employee.medicareEmployee.amount).toBe('2');
    expect(result.employer?.futaEmployer.amount).toBe('6');
    expect(result.disclosures.map((d) => d.code)).toContain('W4_EXEMPTION_CLAIMED');
  });

  it('preserves a Step 4(c) amount instead of dropping it (D-FIT-2)', () => {
    const result = calculateFederalTaxes(
      context({ w4: { claimsExemption: true, step4cExtraPerPeriod: asPerPeriod('25') } }),
    );
    expect(result.issues.some((i) => i.reason === 'PENDING_VERIFICATION')).toBe(true);
    expect(result.disclosures.map((d) => d.code)).toContain('EXEMPT_WITH_STEP_4C');
  });
});

describe('supplemental wages (§5.6)', () => {
  it('aggregates by default, charging the increment over regular-only withholding', () => {
    const result = calculateFederalTaxes(context({ regular: '100', supplemental: '100' }));
    expect(result.methodology.supplementalMethod).toBe('AGGREGATE');
    expect(result.employee.supplementalWithheld.amount).not.toBeNull();
  });

  it('refuses the optional flat method when the eligibility condition is false', () => {
    const result = calculateFederalTaxes(
      context({
        supplemental: '100',
        supplementalMethod: SupplementalMethod.OPTIONAL_FLAT,
        optionalFlatEligible: false,
      }),
    );
    expect(result.employee.supplementalWithheld.amount).toBeNull();
    expect(result.employee.supplementalWithheld.status).toBe('UNSUPPORTED_SCENARIO');
  });

  it('allows the optional flat method when the condition is met', () => {
    const result = calculateFederalTaxes(
      context({
        supplemental: '100',
        supplementalMethod: SupplementalMethod.OPTIONAL_FLAT,
        optionalFlatEligible: true,
      }),
    );
    // 100 at the synthetic twenty percent optional flat rate.
    expect(result.employee.supplementalWithheld.amount).toBe('20');
  });

  it('applies the mandatory flat rate above the threshold, splitting the payment', () => {
    const result = calculateFederalTaxes(
      context({
        supplemental: '400',
        ytd: { supplementalWages: '800' },
        supplementalMethod: SupplementalMethod.OPTIONAL_FLAT,
        optionalFlatEligible: true,
      }),
    );
    // 1200 cumulative against a 1000 threshold: 200 mandatory at 40%, 200 elected at 20%.
    expect(result.employee.supplementalWithheld.amount).toBe('120');
  });

  it('applies mandatory flat even to an employee claiming exemption (§5.5)', () => {
    const result = calculateFederalTaxes(
      context({
        supplemental: '2000',
        ytd: { supplementalWages: '0' },
        w4: { claimsExemption: true },
      }),
    );
    expect(result.employee.federalIncomeTaxWithheld.amount).toBe('0');
    // 1000 over the threshold at 40 percent.
    expect(result.employee.supplementalWithheld.amount).toBe('400');
  });
});

describe('status and missing data (§28)', () => {
  it('is COMPLETE when everything resolves', () => {
    expect(calculateFederalTaxes(context()).status).toBe('COMPLETE');
  });

  it('is INCOMPLETE with a null amount when a rule is missing — never zero', () => {
    const result = calculateFederalTaxes(
      context({ ruleSet: syntheticRuleSet({ omit: [FederalRuleKey.SS_WAGE_BASE] }) }),
    );
    expect(result.status).toBe('INCOMPLETE');
    expect(result.employee.socialSecurityEmployee.amount).toBeNull();
    expect(result.employee.socialSecurityEmployee.amount).not.toBe('0');
  });

  it('reports RULE_CONFLICT rather than choosing', () => {
    const result = calculateFederalTaxes(
      context({
        ruleSet: syntheticRuleSet({ conflicted: [FederalRuleKey.MEDICARE_EMPLOYEE_RATE] }),
      }),
    );
    expect(result.status).toBe('RULE_CONFLICT');
  });

  it('rejects Head of Household on a 2019-or-earlier form (§8.4)', () => {
    const result = calculateFederalTaxes(
      context({
        w4: { revision: 'PRE_2020', filingStatus: 'HEAD_OF_HOUSEHOLD', pre2020Allowances: 1 },
      }),
    );
    expect(result.status).toBe('INVALID_INPUT');
  });

  it('returns UNSUPPORTED_SCENARIO for a nonresident alien while the flag is off', () => {
    const result = calculateFederalTaxes(context({ w4: { isNonresidentAlien: true } }));
    expect(result.status).toBe('UNSUPPORTED_SCENARIO');
    expect(result.employee.federalIncomeTaxWithheld.amount).toBeNull();
  });

  it('never throws for a domain condition', () => {
    expect(() =>
      calculateFederalTaxes(
        context({
          ruleSet: syntheticRuleSet({
            omit: [FederalRuleKey.FIT_ROUNDING_POLICY, FederalRuleKey.SS_EMPLOYEE_RATE],
          }),
        }),
      ),
    ).not.toThrow();
  });

  it('discloses an assumed-zero YTD (§16.2)', () => {
    const result = calculateFederalTaxes(context({ ytd: { assumedZero: true } }));
    expect(result.disclosures.map((d) => d.code)).toContain('YTD_ASSUMED_ZERO');
  });
});

describe('trace and determinism (§27, §29)', () => {
  it('records the required stages', () => {
    const result = calculateFederalTaxes(context({ includeAnnualEstimate: true }));
    const stages = result.trace.map((entry) => entry.stage);
    for (const stage of [
      'WAGE_BUCKETS',
      'PAY_FREQUENCY',
      'WORKSHEET_1A',
      'SCHEDULE_ROW',
      'SOCIAL_SECURITY',
      'MEDICARE',
      'ADDITIONAL_MEDICARE',
      'FUTA',
      'EMPLOYER_TAXES',
      'ANNUAL_ESTIMATE',
      'DISCLOSURES',
    ]) {
      expect(stages).toContain(stage);
    }
  });

  it('gives every stage a plain-language label for the user projection (§27.4)', () => {
    for (const entry of calculateFederalTaxes(context()).trace) {
      expect(entry.label.length).toBeGreaterThan(0);
    }
  });

  it('carries worksheet intermediates and the rounding policy id', () => {
    const result = calculateFederalTaxes(context());
    const worksheet = result.trace.find((entry) => entry.stage === 'WORKSHEET_1A');
    expect(worksheet?.outputs['1c']).toBe('2600');
    expect(worksheet?.rounding).toBe('synthetic-rounding');
  });

  it('returns an identical result for an identical context', () => {
    expect(JSON.stringify(calculateFederalTaxes(context()))).toBe(
      JSON.stringify(calculateFederalTaxes(context())),
    );
  });

  it('records the engine version and methodology', () => {
    const result = calculateFederalTaxes(context());
    expect(result.engineVersion).toBe(FEDERAL_ENGINE_VERSION);
    expect(result.methodology.fitMethod).toBe('PUB15T_PERCENTAGE_AUTOMATED_WORKSHEET_1A');
  });
});

describe('wage buckets in the engine (§12, §19)', () => {
  it('a deduction reducing only income tax wages leaves FICA untouched', () => {
    const result = calculateFederalTaxes(
      context({ deductions: [deduction('d1', 'SYNTHETIC_DEFERRAL', '10')] }),
    );
    expect(result.buckets.federalIncomeTaxWages).toBe('90');
    expect(result.buckets.socialSecurityWages).toBe('100');
    expect(result.employee.socialSecurityEmployee.amount).toBe('10');
  });

  it('a NOT_STATED treatment makes the result INCOMPLETE, naming the bucket', () => {
    const result = calculateFederalTaxes(
      context({ deductions: [deduction('d1', 'SYNTHETIC_UNSTATED', '10')] }),
    );
    expect(result.status).toBe('INCOMPLETE');
    expect(
      result.issues.some(
        (issue) =>
          issue.reason === 'TAXABILITY_NOT_STATED' &&
          (issue.component ?? '').includes('socialSecurityWages'),
      ),
    ).toBe(true);
  });

  it('an unknown deduction type is UNSUPPORTED_SCENARIO, never guessed', () => {
    const result = calculateFederalTaxes(
      context({ deductions: [deduction('d1', 'SYNTHETIC_UNKNOWN', '10')] }),
    );
    expect(result.issues.some((issue) => issue.reason === 'SCENARIO_UNSUPPORTED')).toBe(true);
  });

  it('OBBBA tips and qualified overtime reduce NO bucket (§7.9, §19.5)', () => {
    const withoutExtras = calculateFederalTaxes(context({ regular: '100' }));
    const withExtras = calculateFederalTaxes(
      context({ regular: '60', tips: '20', qualifiedOvertime: '20' }),
    );
    // Same total wages, so every bucket and every FICA figure must match.
    expect(withExtras.buckets).toEqual(withoutExtras.buckets);
    expect(withExtras.employee.socialSecurityEmployee.amount).toBe(
      withoutExtras.employee.socialSecurityEmployee.amount,
    );
    expect(withExtras.employee.medicareEmployee.amount).toBe(
      withoutExtras.employee.medicareEmployee.amount,
    );
  });

  it('A STEP 4(b) AMOUNT LEAVES FICA AND FUTA BIT-IDENTICAL (§7.9 rule 2)', () => {
    const plain = calculateFederalTaxes(context());
    const withStep4b = calculateFederalTaxes(
      context({ w4: { step4bDeductionsAnnual: '500' as never } }),
    );

    // Income tax withholding drops...
    expect(Number(withStep4b.employee.federalIncomeTaxWithheld.amount)).toBeLessThan(
      Number(plain.employee.federalIncomeTaxWithheld.amount),
    );
    // ...while every FICA and FUTA figure is untouched.
    expect(withStep4b.employee.socialSecurityEmployee.amount).toBe(
      plain.employee.socialSecurityEmployee.amount,
    );
    expect(withStep4b.employee.medicareEmployee.amount).toBe(
      plain.employee.medicareEmployee.amount,
    );
    expect(withStep4b.employee.additionalMedicareEmployee.amount).toBe(
      plain.employee.additionalMedicareEmployee.amount,
    );
    expect(withStep4b.employer?.futaEmployer.amount).toBe(plain.employer?.futaEmployer.amount);
  });
});

import { describe, expect, it } from 'vitest';

import { money } from '@/lib/core/money';
import { FEDERAL_ROUNDING_V1 } from '@/lib/tax/federal/rounding/federal-rounding';
import { runWorksheet1A } from '@/lib/tax/federal/fit/worksheet1A';
import { annualize, deannualize } from '@/lib/tax/federal/fit/pay-periods';
import { FederalRuleKey } from '@/lib/tax/federal/rule-keys';

import { syntheticRuleSet } from '../fixtures/federal/synthetic-rules';
import { syntheticW4 } from '../fixtures/federal/context';

/**
 * Pub. 15-T Worksheet 1A (Phase 4, Track B).
 *
 * NO OFFICIAL TAX VALUES. The rule fixture is synthetic (10% over 100, standard amount 200),
 * so these assert METHODOLOGY — line order, annualization, Step 2/3/4 handling — not IRS
 * amounts. Official worked examples are PENDING_DATA.
 */

const policy = FEDERAL_ROUNDING_V1;

function run(w4Overrides = {}, wages = '100', periods = 26) {
  return runWorksheet1A(
    syntheticRuleSet(),
    { ...syntheticW4, ...w4Overrides },
    money(wages),
    periods,
    policy,
  );
}

describe('pay period conversion', () => {
  it('annualizes and de-annualizes symmetrically', () => {
    const annual = annualize(money('100'), 26);
    expect(annual.toString()).toBe('2600');
    expect(deannualize(annual, 26, policy).toString()).toBe('100');
  });

  it('carries repeating decimals at intermediate precision, not 2dp', () => {
    // 100/3 must not be rounded to 33.33 mid-worksheet; that error would compound.
    const perPeriod = deannualize(money('100'), 3, policy);
    expect(perPeriod.toString().startsWith('33.3333333333')).toBe(true);
  });
});

describe('Worksheet 1A line structure', () => {
  it('records every line of the worksheet, in order', () => {
    const result = run();
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    for (const line of ['1a', '1b', '1c', '1d', '1e', '1f', '1g', '1h', '1i']) {
      expect(Object.keys(result.value.lines)).toContain(line);
    }
    for (const line of ['2a', '2b', '2c', '2d', '2e', '2f', '2g', '2h']) {
      expect(Object.keys(result.value.lines)).toContain(line);
    }
    for (const line of ['3a', '3b', '3c', '4a', '4b']) {
      expect(Object.keys(result.value.lines)).toContain(line);
    }
  });

  it('annualizes the period wage on line 1c', () => {
    const result = run({}, '100', 26);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.lines['1a']).toBe('100');
    expect(result.value.lines['1b']).toBe('26');
    expect(result.value.lines['1c']).toBe('2600');
  });

  it('adds Step 4(a) other income into the annual wage', () => {
    const result = run({ step4aOtherIncomeAnnual: '400' }, '100', 26);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.lines['1d']).toBe('400');
    expect(result.value.lines['1e']).toBe('3000');
  });

  it('subtracts Step 4(b) deductions and the standard amount', () => {
    const result = run({ step4bDeductionsAnnual: '100' }, '100', 26);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.lines['1f']).toBe('100');
    // Synthetic standard amount for SYNTHETIC_SINGLE is 200.
    expect(result.value.lines['1g']).toBe('200');
    expect(result.value.lines['1h']).toBe('300');
    expect(result.value.lines['1i']).toBe('2300');
  });

  it('never lets the adjusted annual wage go negative', () => {
    const result = run({ step4bDeductionsAnnual: '999999' }, '100', 26);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.lines['1i']).toBe('0');
  });

  it('zeroes line 1g when the Step 2 box is checked', () => {
    const result = run({ step2MultipleJobsChecked: true }, '100', 26);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.lines['1g']).toBe('0');
  });

  it('selects a DIFFERENT schedule when Step 2 is checked, not a modified one', () => {
    const unchecked = run({}, '100', 26);
    const checked = run({ step2MultipleJobsChecked: true }, '100', 26);
    expect(unchecked.ok && checked.ok).toBe(true);
    if (!unchecked.ok || !checked.ok) return;
    // Synthetic: unchecked schedule is 10%, checked is 20%.
    expect(unchecked.value.lines['2d']).toBe('0.1');
    expect(checked.value.lines['2d']).toBe('0.2');
  });

  it('uses the schedule for the employee filing status', () => {
    const single = run({}, '100', 26);
    const married = run({ filingStatus: 'SYNTHETIC_MARRIED' }, '100', 26);
    expect(single.ok && married.ok).toBe(true);
    if (!single.ok || !married.ok) return;
    expect(single.value.lines['2d']).toBe('0.1');
    expect(married.value.lines['2d']).toBe('0.05');
  });
});

describe('Worksheet 1A steps 2 to 4', () => {
  it('computes tentative withholding from base + rate x excess', () => {
    // 1i = 2600 - 200 = 2400; excess over 100 = 2300; 10% = 230; /26 periods.
    const result = run({}, '100', 26);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.lines['2e']).toBe('2300');
    expect(result.value.lines['2f']).toBe('230');
    expect(result.value.lines['2g']).toBe('230');
  });

  it('divides Step 3 credits across pay periods and never goes below zero', () => {
    const result = run({ step3CreditsAnnual: '999999' }, '100', 26);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.lines['3c']).toBe('0');
    expect(result.value.beforeExtra.toString()).toBe('0');
  });

  it('ADDS Step 4(c) extra rather than absorbing it into the rate calculation', () => {
    const without = run({}, '100', 26);
    const with4c = run({ step4cExtraPerPeriod: '25' }, '100', 26);
    expect(without.ok && with4c.ok).toBe(true);
    if (!without.ok || !with4c.ok) return;

    expect(with4c.value.extraPerPeriod.toString()).toBe('25');
    expect(with4c.value.beforeExtra.toString()).toBe(without.value.beforeExtra.toString());
    expect(with4c.value.total.minus(without.value.total).toString()).toBe('25');
  });

  it('rounds the tax to cents, half up', () => {
    const result = run({}, '100', 26);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // 230/26 = 8.846153...  -> 8.85
    expect(result.value.beforeExtra.toString()).toBe('8.85');
  });

  it('a blank W-4 line is treated as zero, which is the employee stating "none"', () => {
    const blank = run({}, '100', 26);
    const explicitZero = run(
      { step3CreditsAnnual: '0', step4aOtherIncomeAnnual: '0', step4bDeductionsAnnual: '0' },
      '100',
      26,
    );
    expect(blank.ok && explicitZero.ok).toBe(true);
    if (!blank.ok || !explicitZero.ok) return;
    expect(blank.value.total.toString()).toBe(explicitZero.value.total.toString());
  });
});

describe('pre-2020 W-4 historical path', () => {
  it('is INCOMPLETE without the allowance rule — never reinterpreted as a current form', () => {
    const result = runWorksheet1A(
      syntheticRuleSet(),
      { ...syntheticW4, revision: 'PRE_2020', pre2020Allowances: 2 },
      money('100'),
      26,
      policy,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problem.reason).toBe('RULE_MISSING');
    expect(result.problem.ruleKey).toBe(FederalRuleKey.FIT_PRE2020_ALLOWANCE);
  });

  it('applies lines 1j-1l when the allowance rule is available', () => {
    const result = runWorksheet1A(
      syntheticRuleSet({ includePre2020: true }),
      { ...syntheticW4, revision: 'PRE_2020', pre2020Allowances: 2 },
      money('100'),
      26,
      policy,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.lines['1j']).toBe('2');
    // 2 allowances x synthetic 50 = 100.
    expect(result.value.lines['1k']).toBe('100');
    expect(result.value.lines['1l']).toBe('2300');
  });

  it('refuses to assume an allowance count', () => {
    const result = runWorksheet1A(
      syntheticRuleSet({ includePre2020: true }),
      { ...syntheticW4, revision: 'PRE_2020', pre2020Allowances: null },
      money('100'),
      26,
      policy,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problem.reason).toBe('INPUT_INVALID');
  });

  it('produces a DIFFERENT adjusted wage than the 2020+ path for the same input', () => {
    const modern = run({}, '100', 26);
    const historical = runWorksheet1A(
      syntheticRuleSet({ includePre2020: true }),
      { ...syntheticW4, revision: 'PRE_2020', pre2020Allowances: 2 },
      money('100'),
      26,
      policy,
    );
    expect(modern.ok && historical.ok).toBe(true);
    if (!modern.ok || !historical.ok) return;
    expect(historical.value.lines['2a']).not.toBe(modern.value.lines['2a']);
  });
});

describe('missing rule data', () => {
  it('reports the exact rule key when the worksheet rule is absent', () => {
    const result = runWorksheet1A(
      syntheticRuleSet({ omit: [FederalRuleKey.FIT_WORKSHEET_1A] }),
      syntheticW4,
      money('100'),
      26,
      policy,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problem.ruleKey).toBe(FederalRuleKey.FIT_WORKSHEET_1A);
  });

  it('refuses an unverified rule even when its values are complete', () => {
    const result = runWorksheet1A(
      syntheticRuleSet({ unverified: [FederalRuleKey.FIT_WORKSHEET_1A] }),
      syntheticW4,
      money('100'),
      26,
      policy,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problem.reason).toBe('RULE_UNVERIFIED');
  });

  it('reports a conflict rather than picking a rule', () => {
    const result = runWorksheet1A(
      syntheticRuleSet({ conflicted: [FederalRuleKey.FIT_WORKSHEET_1A] }),
      syntheticW4,
      money('100'),
      26,
      policy,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problem.reason).toBe('RULE_CONFLICT');
  });

  it('names the missing filing status rather than falling back to another', () => {
    const result = run({ filingStatus: 'SYNTHETIC_UNKNOWN' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problem.reason).toBe('COMPONENT_NOT_STATED');
    expect(result.problem.detail).toContain('SYNTHETIC_UNKNOWN');
  });
});

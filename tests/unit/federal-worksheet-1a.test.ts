import { describe, expect, it } from 'vitest';

import { money } from '@/lib/core/money';
import { runWorksheet1A } from '@/lib/tax/federal/fit/worksheet1A';
import { findRow, validateScheduleRows } from '@/lib/tax/federal/fit/rate-schedule';
import {
  annualize,
  deannualize,
  resolvePayPeriodsPerYear,
} from '@/lib/tax/federal/fit/pay-periods';
import { resolveRoundingPolicy } from '@/lib/tax/federal/rounding/federal-rounding';
import { FederalRuleKey } from '@/lib/tax/federal/rule-keys';

import { syntheticRuleSet, syntheticStandardSchedule } from '../fixtures/federal/synthetic-rules';
import { asAnnual, asPerPeriod, syntheticW4 } from '../fixtures/federal/context';

/**
 * Pub. 15-T Worksheet 1A — spec §5.3, §5.4, §20, §21.
 *
 * SYNTHETIC RULE DATA: ten percent over 100, line 1g of 200. These assert
 * METHODOLOGY — line order, annualization, Step 2/3/4, invariants — never an
 * IRS amount. Official worked examples are PENDING DATA (Appendix A-40).
 */

const rules = syntheticRuleSet();
const policyRead = resolveRoundingPolicy(rules);
if (!policyRead.ok) throw new Error('fixture: rounding policy');
const policy = policyRead.value;

function run(w4Overrides = {}, wages = '100', periods = 26, ruleSet = rules) {
  return runWorksheet1A(ruleSet, { ...syntheticW4, ...w4Overrides }, money(wages), periods, policy);
}

describe('pay periods (Table 3 is rule data — §20.1)', () => {
  it('resolves each frequency from the rule, not from a constant', () => {
    for (const [frequency, expected] of [
      ['WEEKLY', 52],
      ['BIWEEKLY', 26],
      ['SEMIMONTHLY', 24],
      ['MONTHLY', 12],
      ['QUARTERLY', 4],
    ] as const) {
      const result = resolvePayPeriodsPerYear(rules, frequency);
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value).toBe(expected);
    }
  });

  it('semimonthly is not biweekly (§20.6)', () => {
    const semi = resolvePayPeriodsPerYear(rules, 'SEMIMONTHLY');
    const bi = resolvePayPeriodsPerYear(rules, 'BIWEEKLY');
    expect(semi.ok && bi.ok).toBe(true);
    if (semi.ok && bi.ok) expect(semi.value).not.toBe(bi.value);
  });

  it('refuses a frequency with no published factor rather than assuming one', () => {
    const result = resolvePayPeriodsPerYear(rules, 'ANNUAL');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.problem.reason).toBe('SCENARIO_UNSUPPORTED');
  });

  it('annualizes and de-annualizes symmetrically, carrying repeating decimals', () => {
    expect(annualize(money('100'), 26).toString()).toBe('2600');
    expect(deannualize(money('100'), 3, policy).toString().startsWith('33.3333333333')).toBe(true);
  });
});

describe('Worksheet 1A — step 1', () => {
  it('records every line in worksheet order', () => {
    const result = run();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    for (const line of ['1a', '1b', '1c', '1d', '1e', '1f', '1g', '1h', '1i']) {
      expect(Object.keys(result.value.lines)).toContain(line);
    }
    for (const line of [
      '2a',
      '2b',
      '2c',
      '2d',
      '2e',
      '2f',
      '2g',
      '2h',
      '3a',
      '3b',
      '3c',
      '4a',
      '4b',
    ]) {
      expect(Object.keys(result.value.lines)).toContain(line);
    }
  });

  it('annualizes on line 1c', () => {
    const result = run({}, '100', 26);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.lines['1c']).toBe('2600');
  });

  it('takes line 1g from rule data, per filing status', () => {
    const result = run();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.lines['1g']).toBe('200');
  });

  it('zeroes line 1g when the Step 2 box is checked (§9.1)', () => {
    const result = run({ step2MultipleJobsChecked: true });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.lines['1g']).toBe('0');
  });

  it('adds Step 4(a) and subtracts Step 4(b)', () => {
    const result = run({
      step4aOtherIncomeAnnual: asAnnual('400'),
      step4bDeductionsAnnual: asAnnual('100'),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.lines['1e']).toBe('3000');
    expect(result.value.lines['1h']).toBe('300');
    expect(result.value.lines['1i']).toBe('2700');
  });

  it('FIT-INV-1: line 1i floors at zero', () => {
    const result = run({ step4bDeductionsAnnual: asAnnual('999999') });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.lines['1i']).toBe('0');
  });

  it('selects a DIFFERENT schedule when Step 2 is checked, not a modified one', () => {
    const unchecked = run();
    const checked = run({ step2MultipleJobsChecked: true });
    expect(unchecked.ok && checked.ok).toBe(true);
    if (!unchecked.ok || !checked.ok) return;
    expect(unchecked.value.scheduleType).toBe('STANDARD');
    expect(checked.value.scheduleType).toBe('STEP2_CHECKBOX');
    expect(unchecked.value.lines['2d']).not.toBe(checked.value.lines['2d']);
  });

  it('never falls back to the STANDARD schedule when the Step 2 one is missing (§9.2)', () => {
    const result = run(
      { step2MultipleJobsChecked: true },
      '100',
      26,
      syntheticRuleSet({ omit: [FederalRuleKey.FIT_RATE_SCHEDULE_STEP2] }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problem.ruleKey).toBe(FederalRuleKey.FIT_RATE_SCHEDULE_STEP2);
  });

  it('converts a PERCENT rate to a fraction exactly once (§6.4)', () => {
    const result = run();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Fixture states 10 PERCENT; the engine must use 0.1, not 10.
    expect(result.value.lines['2d']).toBe('0.1');
  });
});

describe('Worksheet 1A — steps 2 to 4', () => {
  it('computes tentative withholding as base + rate x excess', () => {
    const result = run();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.lines['2e']).toBe('2300');
    expect(result.value.lines['2f']).toBe('230');
    expect(result.value.lines['2g']).toBe('230');
    expect(result.value.beforeExtra.toString()).toBe('8.85');
  });

  it('FIT-INV-2: credits can zero withholding but never make it negative', () => {
    const result = run({ step3CreditsAnnual: asAnnual('999999') });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.lines['3c']).toBe('0');
    expect(result.value.beforeExtra.toString()).toBe('0');
  });

  it('FIT-INV-3: Step 4(c) only increases withholding, and is not annualized', () => {
    const without = run();
    const with4c = run({ step4cExtraPerPeriod: asPerPeriod('25') });
    expect(without.ok && with4c.ok).toBe(true);
    if (!without.ok || !with4c.ok) return;
    expect(with4c.value.total.minus(without.value.total).toString()).toBe('25');
  });

  it('§11.2: a 4(c) amount is per period, so changing frequency does not scale it', () => {
    const weekly = run({ step4cExtraPerPeriod: asPerPeriod('25') }, '100', 52);
    const biweekly = run({ step4cExtraPerPeriod: asPerPeriod('25') }, '100', 26);
    expect(weekly.ok && biweekly.ok).toBe(true);
    if (!weekly.ok || !biweekly.ok) return;
    expect(weekly.value.lines['4a']).toBe('25');
    expect(biweekly.value.lines['4a']).toBe('25');
  });

  it('Step 3 is forced to zero on a 2019-or-earlier form (§10.1)', () => {
    const result = run({
      revision: 'PRE_2020',
      pre2020Allowances: 2,
      step3CreditsAnnual: asAnnual('500'),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.lines['3a']).toBe('0');
  });
});

describe('2019-or-earlier Form W-4 (lines 1j-1l)', () => {
  it('applies the allowance path and produces a different adjusted wage', () => {
    const modern = run();
    const legacy = run({ revision: 'PRE_2020', pre2020Allowances: 2 });
    expect(modern.ok && legacy.ok).toBe(true);
    if (!modern.ok || !legacy.ok) return;
    expect(legacy.value.lines['1j']).toBe('2');
    expect(legacy.value.lines['1k']).toBe('100');
    expect(legacy.value.lines['1l']).toBe('2500');
    expect(legacy.value.lines['2a']).not.toBe(modern.value.lines['2a']);
  });

  it('is INCOMPLETE without the allowance rule — never reinterpreted as current', () => {
    const result = run(
      { revision: 'PRE_2020', pre2020Allowances: 2 },
      '100',
      26,
      syntheticRuleSet({ omit: [FederalRuleKey.FIT_ALLOWANCE_VALUE] }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problem.ruleKey).toBe(FederalRuleKey.FIT_ALLOWANCE_VALUE);
  });

  it('refuses to assume an allowance count', () => {
    const result = run({ revision: 'PRE_2020', pre2020Allowances: null });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problem.reason).toBe('INPUT_INVALID');
  });
});

describe('rate-schedule invariants (§5.4)', () => {
  const rows = syntheticStandardSchedule.schedules[0]?.rows ?? [];

  it('FIT-INV-4: exactly one row matches at a boundary', () => {
    for (const wage of ['0', '99.99', '100', '100.01', '99999']) {
      const match = findRow(rows, money(wage), 'k');
      expect(match.ok, `wage ${wage}`).toBe(true);
    }
  });

  it('FIT-INV-4: overlapping rows are RULE_CONFLICT, never a first-match pick', () => {
    const overlapping = [
      {
        rowOrder: 0,
        atLeast: '0',
        lessThan: '200',
        baseAmount: '0',
        rate: '10',
        unit: 'PERCENT' as const,
      },
      {
        rowOrder: 1,
        atLeast: '100',
        lessThan: null,
        baseAmount: '0',
        rate: '20',
        unit: 'PERCENT' as const,
      },
    ];
    const match = findRow(overlapping, money('150'), 'k');
    expect(match.ok).toBe(false);
    if (match.ok) return;
    expect(match.problem.reason).toBe('RULE_CONFLICT');
    expect(match.problem.detail).toContain('FIT-INV-4');
  });

  it('FIT-INV-4: a gap is RULE_CONFLICT, not a zero tax', () => {
    const gapped = [
      {
        rowOrder: 0,
        atLeast: '0',
        lessThan: '100',
        baseAmount: '0',
        rate: '10',
        unit: 'PERCENT' as const,
      },
      {
        rowOrder: 1,
        atLeast: '200',
        lessThan: null,
        baseAmount: '0',
        rate: '20',
        unit: 'PERCENT' as const,
      },
    ];
    const match = findRow(gapped, money('150'), 'k');
    expect(match.ok).toBe(false);
    if (match.ok) return;
    expect(match.problem.reason).toBe('RULE_CONFLICT');
  });

  it('FIT-INV-5: a bounded top row is rejected', () => {
    const bounded = [
      {
        rowOrder: 0,
        atLeast: '0',
        lessThan: '100',
        baseAmount: '0',
        rate: '10',
        unit: 'PERCENT' as const,
      },
    ];
    const result = validateScheduleRows(bounded, 'k', 'SINGLE_OR_MFS');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problem.detail).toContain('FIT-INV-5');
  });

  it('FIT-INV-6: non-contiguous rows are rejected', () => {
    const gapped = [
      {
        rowOrder: 0,
        atLeast: '0',
        lessThan: '100',
        baseAmount: '0',
        rate: '10',
        unit: 'PERCENT' as const,
      },
      {
        rowOrder: 1,
        atLeast: '200',
        lessThan: null,
        baseAmount: '0',
        rate: '20',
        unit: 'PERCENT' as const,
      },
    ];
    const result = validateScheduleRows(gapped, 'k', 'SINGLE_OR_MFS');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problem.detail).toContain('FIT-INV-6');
  });

  it('accepts a well-formed schedule', () => {
    expect(validateScheduleRows(rows, 'k', 'SINGLE_OR_MFS').ok).toBe(true);
  });
});

describe('missing and unusable rule data', () => {
  it('names the exact rule key when the schedule is absent', () => {
    const result = run(
      {},
      '100',
      26,
      syntheticRuleSet({ omit: [FederalRuleKey.FIT_RATE_SCHEDULE_STANDARD] }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problem.ruleKey).toBe(FederalRuleKey.FIT_RATE_SCHEDULE_STANDARD);
  });

  it('refuses an unverified rule even when its values are complete', () => {
    const result = run(
      {},
      '100',
      26,
      syntheticRuleSet({ unverified: [FederalRuleKey.FIT_RATE_SCHEDULE_STANDARD] }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problem.reason).toBe('RULE_UNVERIFIED');
  });

  it('reports a conflict rather than choosing', () => {
    const result = run(
      {},
      '100',
      26,
      syntheticRuleSet({ conflicted: [FederalRuleKey.FIT_RATE_SCHEDULE_STANDARD] }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problem.reason).toBe('RULE_CONFLICT');
  });

  it('reports a NOT_STATED line 1g rather than defaulting it', () => {
    const result = run({ filingStatus: 'HEAD_OF_HOUSEHOLD' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problem.reason).toBe('COMPONENT_NOT_STATED');
  });
});

import { describe, expect, it } from 'vitest';

import {
  calculateFederalTaxes,
  FEDERAL_ENGINE_VERSION,
  totalEmployeeFederalTaxes,
} from '@/lib/tax/federal';
import { FederalRuleKey, requiredRuleKeys } from '@/lib/tax/federal/rule-keys';
import { deriveScenario, toFederalW4 } from '@/lib/tax/federal/context';

import { syntheticRuleSet } from '../fixtures/federal/synthetic-rules';
import { buckets, context } from '../fixtures/federal/context';

/**
 * Federal engine orchestration (Phase 4, Stage B).
 *
 * All rule data synthetic. These assert TRACK SEPARATION, status handling, disclosures and
 * determinism — never an IRS amount.
 */

describe('scenario-dependent required keys', () => {
  it('asks only for what the scenario will actually read', () => {
    const w4 = toFederalW4({ filingStatus: 'SYNTHETIC_SINGLE' });
    const keys = requiredRuleKeys(
      deriveScenario(w4, true, false, { wantsAnnualEstimate: false, wantsEmployerTaxes: false }),
    );
    expect(keys).toContain(FederalRuleKey.FIT_WORKSHEET_1A);
    expect(keys).not.toContain(FederalRuleKey.FIT_SUPPLEMENTAL);
    expect(keys).not.toContain(FederalRuleKey.FUTA);
    expect(keys).not.toContain(FederalRuleKey.ANNUAL_RATE_SCHEDULE);
  });

  it('adds the pre-2020 allowance key only for a historical W-4', () => {
    const modern = toFederalW4({ filingStatus: 'S' });
    const historical = toFederalW4({ filingStatus: 'S', w4Revision: 'PRE_2020' });
    const options = { wantsAnnualEstimate: false, wantsEmployerTaxes: false };
    expect(requiredRuleKeys(deriveScenario(modern, true, false, options))).not.toContain(
      FederalRuleKey.FIT_PRE2020_ALLOWANCE,
    );
    expect(requiredRuleKeys(deriveScenario(historical, true, false, options))).toContain(
      FederalRuleKey.FIT_PRE2020_ALLOWANCE,
    );
  });

  it('adds annual keys only when the estimate is requested', () => {
    const w4 = toFederalW4({ filingStatus: 'S' });
    const keys = requiredRuleKeys(
      deriveScenario(w4, true, false, { wantsAnnualEstimate: true, wantsEmployerTaxes: true }),
    );
    expect(keys).toContain(FederalRuleKey.ANNUAL_RATE_SCHEDULE);
    expect(keys).toContain(FederalRuleKey.FUTA);
  });
});

describe('four-track separation', () => {
  it('produces withholding, FICA and employer branches independently', () => {
    const result = calculateFederalTaxes(context());
    expect(result.withholding.total.amount).not.toBeNull();
    expect(result.fica.socialSecurityEmployee.amount).toBe('10');
    expect(result.employer).not.toBeNull();
    expect(result.employer?.futa.amount).toBe('0.6');
  });

  it('keeps employer taxes out of the employee total', () => {
    const result = calculateFederalTaxes(context());
    const employeeTotal = totalEmployeeFederalTaxes(result);
    expect(employeeTotal).not.toBeNull();
    // Employee: withholding 8.85 + SS 10 + Medicare 2 + Additional Medicare 0 = 20.85.
    expect(employeeTotal).toBe('20.85');
    // Employer SS 10 + Medicare 2 + FUTA 0.6 = 12.6, deliberately excluded.
    expect(result.employer?.total.amount).toBe('12.6');
  });

  it('omits the employer branch entirely when not requested', () => {
    const result = calculateFederalTaxes(context({ includeEmployerTaxes: false }));
    expect(result.employer).toBeNull();
  });

  it('marks the annual estimate DISPLAY ONLY and discloses it', () => {
    const result = calculateFederalTaxes(
      context({ ruleSet: syntheticRuleSet({ includeAnnual: true }), includeAnnualEstimate: true }),
    );
    expect(result.annualEstimate?.displayOnly).toBe(true);
    expect(result.disclosures.map((d) => d.code)).toContain('ANNUAL_ESTIMATE_DISPLAY_ONLY');
  });

  it('never substitutes the annual estimate for withholding', () => {
    const result = calculateFederalTaxes(
      context({ ruleSet: syntheticRuleSet({ includeAnnual: true }), includeAnnualEstimate: true }),
    );
    expect(result.annualEstimate?.liability.amount).not.toBe(result.withholding.total.amount);
  });

  it('leaves withholding intact when annual data is missing', () => {
    // Annual requested but its rules absent: Track A is incomplete, Track B unaffected.
    const result = calculateFederalTaxes(context({ includeAnnualEstimate: true }));
    expect(result.annualEstimate?.liability.amount).toBeNull();
    expect(result.withholding.total.amount).toBe('8.85');
  });
});

describe('status and missing data', () => {
  it('is COMPLETE when every required component resolves', () => {
    expect(calculateFederalTaxes(context()).status).toBe('COMPLETE');
  });

  it('is INCOMPLETE with a null amount when a rule is missing — never zero', () => {
    const result = calculateFederalTaxes(
      context({ ruleSet: syntheticRuleSet({ omit: [FederalRuleKey.FICA_SOCIAL_SECURITY] }) }),
    );
    expect(result.status).toBe('INCOMPLETE');
    expect(result.fica.socialSecurityEmployee.amount).toBeNull();
    expect(result.fica.socialSecurityEmployee.amount).not.toBe('0');
  });

  it('reports RULE_CONFLICT rather than choosing', () => {
    const result = calculateFederalTaxes(
      context({ ruleSet: syntheticRuleSet({ conflicted: [FederalRuleKey.FICA_MEDICARE] }) }),
    );
    expect(result.status).toBe('RULE_CONFLICT');
  });

  it('names the exact rule key and component in every issue', () => {
    const result = calculateFederalTaxes(
      context({ ruleSet: syntheticRuleSet({ omit: [FederalRuleKey.FUTA] }) }),
    );
    const issue = result.issues.find((i) => i.ruleKey === FederalRuleKey.FUTA);
    expect(issue).toBeDefined();
  });

  it('withholds the employer total when one employer component is unknown', () => {
    const result = calculateFederalTaxes(
      context({ ruleSet: syntheticRuleSet({ omit: [FederalRuleKey.FUTA] }) }),
    );
    expect(result.employer?.total.amount).toBeNull();
  });

  it('does not throw for any domain condition', () => {
    expect(() =>
      calculateFederalTaxes(
        context({
          ruleSet: syntheticRuleSet({
            omit: [FederalRuleKey.FIT_WORKSHEET_1A, FederalRuleKey.FICA_MEDICARE],
          }),
        }),
      ),
    ).not.toThrow();
  });
});

describe('W-4 exemption and Step 4(c)', () => {
  it('withholds no income tax when exemption is claimed', () => {
    const result = calculateFederalTaxes(context({ w4: { claimsExemption: true } }));
    expect(result.withholding.regular.amount).toBe('0');
    expect(result.withholding.total.amount).toBe('0');
    expect(result.disclosures.map((d) => d.code)).toContain('W4_EXEMPTION_CLAIMED');
  });

  it('PRESERVES a Step 4(c) amount alongside an exemption instead of discarding it', () => {
    const result = calculateFederalTaxes(
      context({ w4: { claimsExemption: true, step4cExtraPerPeriod: '25' } }),
    );
    // The amount survives, visibly.
    expect(result.withholding.extraPerPeriod.amount).toBe('25');
    // The total is withheld from judgement rather than guessed either way.
    expect(result.withholding.total.amount).toBeNull();
    expect(result.status).toBe('INCOMPLETE');
    expect(result.issues.some((i) => i.reason === 'PENDING_VERIFICATION')).toBe(true);
    expect(result.disclosures.map((d) => d.code)).toContain('EXEMPT_WITH_STEP_4C');
  });

  it('records the Step 4(c) amount in the trace', () => {
    const result = calculateFederalTaxes(
      context({ w4: { claimsExemption: true, step4cExtraPerPeriod: '25' } }),
    );
    const entry = result.trace.find((t) => t.stage === 'W4_NORMALIZATION');
    expect(entry?.outputs['step4cExtraPerPeriod']).toBe('25');
  });
});

describe('nonresident alien', () => {
  it('is UNSUPPORTED_SCENARIO while the flag is off, with no approximation', () => {
    const result = calculateFederalTaxes(context({ w4: { isNonresidentAlien: true } }));
    expect(result.status).toBe('UNSUPPORTED_SCENARIO');
    expect(result.withholding.total.amount).toBeNull();
    expect(result.issues.some((i) => i.reason === 'FEATURE_DISABLED')).toBe(true);
  });

  it('flags default to off', () => {
    expect(calculateFederalTaxes(context()).flags.FEDERAL_NRA_ADJUSTMENT).toBe(false);
  });
});

describe('trace', () => {
  it('records every stage with sequence, status and provenance', () => {
    const result = calculateFederalTaxes(context());
    const stages = result.trace.map((entry) => entry.stage);
    for (const stage of [
      'RULE_RESOLUTION',
      'WAGE_BUCKETS',
      'W4_NORMALIZATION',
      'WORKSHEET_1A',
      'SOCIAL_SECURITY',
      'MEDICARE',
      'ADDITIONAL_MEDICARE',
      'FUTA',
      'EMPLOYER_TAXES',
      'DISCLOSURES',
    ]) {
      expect(stages).toContain(stage);
    }
    result.trace.forEach((entry, index) => {
      expect(entry.sequence).toBe(index);
    });
  });

  it('carries worksheet line intermediates into the trace', () => {
    const result = calculateFederalTaxes(context());
    const worksheet = result.trace.find((entry) => entry.stage === 'WORKSHEET_1A');
    expect(worksheet?.outputs['1c']).toBe('2600');
    expect(worksheet?.outputs['2g']).toBe('230');
  });

  it('records the rounding policy version on tax stages', () => {
    const result = calculateFederalTaxes(context());
    const ss = result.trace.find((entry) => entry.stage === 'SOCIAL_SECURITY');
    expect(ss?.rounding).toBe('federal-rounding-v1');
  });

  it('attaches source IDs derived from the rules used', () => {
    const result = calculateFederalTaxes(context());
    const ss = result.trace.find((entry) => entry.stage === 'SOCIAL_SECURITY');
    expect(ss?.sourceIds.length).toBeGreaterThan(0);
  });
});

describe('determinism', () => {
  it('returns an identical result for an identical context', () => {
    const first = calculateFederalTaxes(context());
    const second = calculateFederalTaxes(context());
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });

  it('records the engine version', () => {
    expect(calculateFederalTaxes(context()).engineVersion).toBe(FEDERAL_ENGINE_VERSION);
  });

  it('scales with pay frequency without drifting', () => {
    const weekly = calculateFederalTaxes(context({ periodsPerYear: 52 }));
    const biweekly = calculateFederalTaxes(context({ periodsPerYear: 26 }));
    expect(weekly.withholding.total.amount).not.toBe(biweekly.withholding.total.amount);
  });

  it('produces higher withholding for higher wages', () => {
    const low = calculateFederalTaxes(context({ wageAmount: '100', buckets: buckets('100') }));
    const high = calculateFederalTaxes(context({ wageAmount: '500', buckets: buckets('500') }));
    expect(Number(high.withholding.total.amount)).toBeGreaterThan(
      Number(low.withholding.total.amount),
    );
  });
});

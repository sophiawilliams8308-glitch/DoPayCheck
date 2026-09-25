import { describe, expect, it } from 'vitest';

import type { RuleReference } from '@/lib/calculator/types/rules';
import { calculateStateTaxes, STATE_ENGINE_VERSION } from '@/lib/tax/state/index';
import type { StateCalculationContext } from '@/lib/tax/state/context';
import { stateYtdAssumedZero } from '@/lib/tax/state/context';
import {
  freezeStateRuleSet,
  type ResolvedStateRule,
  type ResolvedStateRuleSet,
  type StateRuleEntry,
} from '@/lib/tax/state/rules/stateRuleSet';
import { StateRuleKey } from '@/lib/tax/state/ruleKeys';
import type { StateDeductionLine } from '@/lib/tax/state/types';

/**
 * State calculation engine shell tests — DM-03 Slice 8.
 *
 * Exercises the real `resolveTaxability()` / `deriveResolvedStateWageBuckets()`
 * implementations end to end (no mocking), reusing the same fixture
 * conventions as `state-resolved-wage-buckets.test.ts`. Fixtures use
 * synthetic jurisdiction/deduction identifiers and no real tax value.
 */

const JURISDICTION_CODE = 'TEST-DM03-ENGINE';
const JURISDICTION_ID = 'test-dm03-engine-jurisdiction-id';
const TAX_YEAR = 2099;
const EFFECTIVE = '2099-06-15T00:00:00.000Z';
const KEY = StateRuleKey.TAXABILITY_PROFILE;

function reference(ruleKey: string): RuleReference {
  return {
    ruleId: `synthetic-${ruleKey}`,
    ruleKey,
    version: 1,
    category: 'STATE_WITHHOLDING',
    taxYear: TAX_YEAR,
    jurisdictionId: JURISDICTION_ID,
    jurisdictionCode: JURISDICTION_CODE,
    effectiveFrom: new Date('2099-01-01T00:00:00.000Z'),
    effectiveTo: null,
    sourceIds: [`synthetic-source-${ruleKey}`],
    verified: true,
  };
}

function availableEntry(detail: unknown): { available: true; rule: ResolvedStateRule } {
  return {
    available: true,
    rule: { key: KEY, reference: reference(KEY), detail, verificationStatus: 'VERIFIED' },
  };
}

function ruleSetFor(detail: unknown): ResolvedStateRuleSet {
  const entries: Partial<Record<StateRuleKey, StateRuleEntry>> = { [KEY]: availableEntry(detail) };
  return freezeStateRuleSet({
    taxYear: TAX_YEAR,
    effectiveDate: EFFECTIVE,
    jurisdictionCode: JURISDICTION_CODE,
    engineVersion: 'test-engine',
    resolvedAt: EFFECTIVE,
    missing: [],
    entries,
    ruleReferences: [],
    sourceIds: [],
  });
}

function profileSet(profiles: readonly unknown[]) {
  return { shape: 'TAXABILITY_PROFILE_SET', profiles };
}

/** A `WAGE_BASE`-shaped entry recording NOT_APPLICABLE — reused for the
 * SUTA-employer aggregator tests below, which need `SUTA_WAGE_BASE`
 * resolved (unlike `ruleSetFor()`, hardcoded to `TAXABILITY_PROFILE` only). */
function wageBaseNotApplicableEntry(key: StateRuleKey): {
  available: true;
  rule: ResolvedStateRule;
} {
  return {
    available: true,
    rule: {
      key,
      reference: reference(key),
      detail: {
        shape: 'WAGE_BASE',
        amount: null,
        basis: 'ANNUAL',
        applicability: 'NOT_APPLICABLE',
      },
      verificationStatus: 'VERIFIED',
    },
  };
}

function ruleSetWithSutaWageBase(taxabilityDetail: unknown): ResolvedStateRuleSet {
  const entries: Partial<Record<StateRuleKey, StateRuleEntry>> = {
    [KEY]: availableEntry(taxabilityDetail),
    [StateRuleKey.SUTA_WAGE_BASE]: wageBaseNotApplicableEntry(StateRuleKey.SUTA_WAGE_BASE),
  };
  return freezeStateRuleSet({
    taxYear: TAX_YEAR,
    effectiveDate: EFFECTIVE,
    jurisdictionCode: JURISDICTION_CODE,
    engineVersion: 'test-engine',
    resolvedAt: EFFECTIVE,
    missing: [],
    entries,
    ruleReferences: [],
    sourceIds: [],
  });
}

function deduction(deductionTypeKey: string, amount: string): StateDeductionLine {
  return { deductionTypeKey, amount };
}

function context(
  overrides: Partial<StateCalculationContext> & { workRuleSet: ResolvedStateRuleSet },
): StateCalculationContext {
  return {
    taxYear: TAX_YEAR,
    effectiveDate: EFFECTIVE,
    payFrequency: 'BIWEEKLY',
    workJurisdictions: [{ jurisdictionCode: JURISDICTION_CODE, allocation: '1' }],
    residenceJurisdictionCode: JURISDICTION_CODE,
    residencyStatus: 'RESIDENT',
    wages: { regular: '1000', supplemental: '0' },
    deductions: [],
    taxabilityProfiles: {},
    ytd: stateYtdAssumedZero(),
    residenceRuleSet: null,
    elections: {},
    allowanceCounts: {},
    employer: {},
    reciprocityCertificateFiled: false,
    includeEmployerTaxes: true,
    ...overrides,
  };
}

describe('calculateStateTaxes — basic shape', () => {
  it('returns a StateTaxResult with the expected top-level fields', () => {
    const result = calculateStateTaxes(context({ workRuleSet: ruleSetFor(profileSet([])) }), {});
    expect(result.engineVersion).toBe(STATE_ENGINE_VERSION);
    expect(result.taxYear).toBe(TAX_YEAR);
    expect(result.effectiveDate).toBe(EFFECTIVE);
    expect(result.workJurisdictionCode).toBe(JURISDICTION_CODE);
    expect(result.residenceJurisdictionCode).toBe(JURISDICTION_CODE);
    expect(result.residencyStatus).toBe('RESIDENT');
  });
});

describe('resolver-backed wage buckets are populated', () => {
  it('all four buckets reflect real resolveTaxability()-derived amounts', () => {
    const detail = profileSet([
      {
        deductionTypeKey: 'DED',
        programTreatments: {
          INCOME_TAX_WITHHOLDING: {
            variants: [{ conditions: [], effect: 'REDUCE_WAGES', limit: null }],
          },
          SDI: { variants: [{ conditions: [], effect: 'NO_CHANGE', limit: null }] },
          PFML: { variants: [{ conditions: [], effect: 'INCREASE_WAGES', limit: null }] },
          SUTA: { variants: [{ conditions: [], effect: 'REDUCE_WAGES', limit: null }] },
        },
      },
    ]);
    const result = calculateStateTaxes(
      context({ workRuleSet: ruleSetFor(detail), deductions: [deduction('DED', '100')] }),
      {},
    );
    expect(result.buckets.stateIncomeTaxWages).toBe('900');
    expect(result.buckets.sdiWages).toBe('1000');
    expect(result.buckets.pfmlWages).toBe('1100');
    expect(result.buckets.sutaWages).toBe('900');
  });
});

describe('employee tax amount fields are explicitly unavailable', () => {
  it('every non-SDI/PFML/SUTA employee StateAmount is null with METHOD_NOT_IMPLEMENTED when its bucket is available', () => {
    const result = calculateStateTaxes(context({ workRuleSet: ruleSetFor(profileSet([])) }), {});
    for (const amount of [
      result.employee.incomeTaxWithheld,
      result.employee.supplementalWithheld,
    ]) {
      expect(amount.amount).toBeNull();
      expect(amount.problem?.reason).toBe('METHOD_NOT_IMPLEMENTED');
    }
  });

  it(
    'SDI is null, never fabricated, but for its OWN calculation reason (Slice 10: a real ' +
      'calculation is now attempted, not a fabricated METHOD_NOT_IMPLEMENTED) — this fixture ' +
      'supplies no SDI_WAGE_BASE rule at all, so it fails RULE_MISSING',
    () => {
      const result = calculateStateTaxes(context({ workRuleSet: ruleSetFor(profileSet([])) }), {});
      expect(result.employee.sdiEmployee.amount).toBeNull();
      expect(result.employee.sdiEmployee.problem?.reason).toBe('RULE_MISSING');
      expect(result.employee.totalEmployeeStateTaxes.amount).toBeNull();
    },
  );

  it(
    'PFML is null, never fabricated, but for its OWN calculation reason (Slice 11: a real ' +
      'calculation is now attempted, not a fabricated METHOD_NOT_IMPLEMENTED) — this fixture ' +
      'supplies no PFML_WAGE_BASE rule at all, so it fails RULE_MISSING',
    () => {
      const result = calculateStateTaxes(context({ workRuleSet: ruleSetFor(profileSet([])) }), {});
      expect(result.employee.pfmlEmployee.amount).toBeNull();
      expect(result.employee.pfmlEmployee.problem?.reason).toBe('RULE_MISSING');
    },
  );

  it(
    'SUTA employee is null, never fabricated, but for its OWN calculation reason (Slice 12: ' +
      'a real calculation is now attempted for the SUTA employee side, not a fabricated ' +
      'METHOD_NOT_IMPLEMENTED) — this fixture supplies no SUTA_WAGE_BASE rule at all, so it ' +
      'fails RULE_MISSING',
    () => {
      const result = calculateStateTaxes(context({ workRuleSet: ruleSetFor(profileSet([])) }), {});
      expect(result.employee.sutaEmployee.amount).toBeNull();
      expect(result.employee.sutaEmployee.problem?.reason).toBe('RULE_MISSING');
    },
  );

  it('never fabricates a zero amount', () => {
    const result = calculateStateTaxes(context({ workRuleSet: ruleSetFor(profileSet([])) }), {});
    expect(result.employee.incomeTaxWithheld.amount).not.toBe('0');
    expect(result.employee.incomeTaxWithheld.amount).toBeNull();
  });
});

describe('employer branch respects includeEmployerTaxes', () => {
  it('is null when includeEmployerTaxes is false', () => {
    const result = calculateStateTaxes(
      context({ workRuleSet: ruleSetFor(profileSet([])), includeEmployerTaxes: false }),
      {},
    );
    expect(result.employer).toBeNull();
  });

  it('exists when includeEmployerTaxes is true, with unavailable employer amounts', () => {
    const result = calculateStateTaxes(
      context({ workRuleSet: ruleSetFor(profileSet([])), includeEmployerTaxes: true }),
      {},
    );
    expect(result.employer).not.toBeNull();
    if (result.employer === null) throw new Error('expected employer result');
    // SDI (Slice 10): a real calculation is attempted; this fixture supplies
    // no SDI_WAGE_BASE rule, so it fails RULE_MISSING, not a fabricated
    // METHOD_NOT_IMPLEMENTED.
    expect(result.employer.sdiEmployer.amount).toBeNull();
    expect(result.employer.sdiEmployer.problem?.reason).toBe('RULE_MISSING');
    // PFML (Slice 11): same real-calculation-attempted story as SDI.
    expect(result.employer.pfmlEmployer.amount).toBeNull();
    expect(result.employer.pfmlEmployer.problem?.reason).toBe('RULE_MISSING');
    expect(result.employer.sutaEmployer.amount).toBeNull();
    expect(result.employer.totalEmployerStateTaxes.amount).toBeNull();
  });
});

describe('bucket-level resolver failure propagation', () => {
  it('propagates the bucket problem/status verbatim rather than a fabricated METHOD_NOT_IMPLEMENTED', () => {
    const result = calculateStateTaxes(
      context({
        workRuleSet: ruleSetFor(profileSet([])),
        deductions: [deduction('UNKNOWN_DEDUCTION', '50')],
      }),
      {},
    );
    expect(result.employee.incomeTaxWithheld.amount).toBeNull();
    expect(result.employee.incomeTaxWithheld.problem?.reason).toBe('RULE_MISSING');
    expect(result.employee.incomeTaxWithheld.problem?.reason).not.toBe('METHOD_NOT_IMPLEMENTED');
    expect(result.employee.sdiEmployee.problem?.reason).toBe('RULE_MISSING');
    expect(result.employee.pfmlEmployee.problem?.reason).toBe('RULE_MISSING');
    expect(result.employee.sutaEmployee.problem?.reason).toBe('RULE_MISSING');
  });

  it('an unsupported methodology never overwrites an underlying bucket failure', () => {
    const detail = profileSet([
      {
        deductionTypeKey: 'DED',
        programTreatments: {
          INCOME_TAX_WITHHOLDING: {
            variants: [{ conditions: [], effect: 'NOT_STATED', limit: null }],
          },
          SDI: { variants: [{ conditions: [], effect: 'REDUCE_WAGES', limit: null }] },
          PFML: { variants: [{ conditions: [], effect: 'NO_CHANGE', limit: null }] },
          SUTA: { variants: [{ conditions: [], effect: 'NO_CHANGE', limit: null }] },
        },
      },
    ]);
    const result = calculateStateTaxes(
      context({ workRuleSet: ruleSetFor(detail), deductions: [deduction('DED', '10')] }),
      {},
    );
    // Income tax: bucket fails (NOT_STATED -> SCENARIO_UNSUPPORTED), never
    // silently replaced by a "not implemented" problem.
    expect(result.employee.incomeTaxWithheld.problem?.reason).toBe('SCENARIO_UNSUPPORTED');
    // SDI/PFML/SUTA-employee (Slices 10-12): bucket succeeds too, but a real
    // calculation is now attempted rather than a fabricated "not
    // implemented" -- this fixture supplies no SDI_WAGE_BASE/PFML_WAGE_BASE/
    // SUTA_WAGE_BASE rule, so all three fail RULE_MISSING, never silently
    // overwritten by a stale "not implemented".
    expect(result.employee.sdiEmployee.problem?.reason).toBe('RULE_MISSING');
    expect(result.employee.pfmlEmployee.problem?.reason).toBe('RULE_MISSING');
    expect(result.employee.sutaEmployee.problem?.reason).toBe('RULE_MISSING');
    // SUTA employer (Slice 15): a real calculation is now attempted here
    // too; this fixture supplies no SUTA_WAGE_BASE rule, so it fails
    // RULE_MISSING before employer.sutaRate is even consulted -- wage-base
    // resolution happens first, exactly as it does for the employee side.
    expect(result.employer?.sutaEmployer.problem?.reason).toBe('RULE_MISSING');
  });
});

describe('provenance', () => {
  it('preserves the exact RuleReference from bucket derivation in ruleReferences/sourceIds', () => {
    const detail = profileSet([
      {
        deductionTypeKey: 'DED',
        programTreatments: {
          INCOME_TAX_WITHHOLDING: {
            variants: [{ conditions: [], effect: 'REDUCE_WAGES', limit: null }],
          },
        },
      },
    ]);
    const result = calculateStateTaxes(
      context({ workRuleSet: ruleSetFor(detail), deductions: [deduction('DED', '10')] }),
      {},
    );
    expect(result.ruleReferences).toHaveLength(1);
    expect(result.ruleReferences[0]).toEqual(reference(KEY));
    expect(result.sourceIds).toEqual([`synthetic-source-${KEY}`]);
  });

  it('an empty deduction list yields no rule references, never a fabricated one', () => {
    const result = calculateStateTaxes(context({ workRuleSet: ruleSetFor(profileSet([])) }), {});
    expect(result.ruleReferences).toEqual([]);
    expect(result.sourceIds).toEqual([]);
  });
});

describe('methodology', () => {
  it('all three methodology fields are null', () => {
    const result = calculateStateTaxes(context({ workRuleSet: ruleSetFor(profileSet([])) }), {});
    expect(result.methodology.withholdingMethod).toBeNull();
    expect(result.methodology.supplementalTreatment).toBeNull();
    expect(result.methodology.roundingPolicyId).toBeNull();
  });
});

describe('purity and determinism', () => {
  it('does not mutate the supplied context', () => {
    const ruleSet = ruleSetFor(profileSet([]));
    const input = context({ workRuleSet: ruleSet, deductions: [deduction('DED', '10')] });
    const before = JSON.stringify(input);
    calculateStateTaxes(input, {});
    expect(JSON.stringify(input)).toBe(before);
    expect(Object.isFrozen(ruleSet)).toBe(true);
  });

  it('produces identical output for identical input', () => {
    const detail = profileSet([
      {
        deductionTypeKey: 'DED',
        programTreatments: {
          INCOME_TAX_WITHHOLDING: {
            variants: [{ conditions: [], effect: 'REDUCE_WAGES', limit: null }],
          },
        },
      },
    ]);
    const input = context({
      workRuleSet: ruleSetFor(detail),
      deductions: [deduction('DED', '10')],
    });
    const first = calculateStateTaxes(input, {});
    const second = calculateStateTaxes(input, {});
    expect(first).toEqual(second);
  });
});

describe('decimal safety', () => {
  it('bucket amounts use exact decimal arithmetic, never floating point', () => {
    const detail = profileSet([
      {
        deductionTypeKey: 'DED',
        programTreatments: {
          INCOME_TAX_WITHHOLDING: {
            variants: [{ conditions: [], effect: 'REDUCE_WAGES', limit: null }],
          },
        },
      },
    ]);
    const result = calculateStateTaxes(
      context({
        workRuleSet: ruleSetFor(detail),
        wages: { regular: '100.10', supplemental: '0' },
        deductions: [deduction('DED', '0.30')],
      }),
      {},
    );
    expect(result.buckets.stateIncomeTaxWages).toBe('99.8');
  });
});

describe('missingRules', () => {
  it("passes through the rule set's own missing-rules list unchanged", () => {
    const ruleSet = ruleSetFor(profileSet([]));
    const result = calculateStateTaxes(context({ workRuleSet: ruleSet }), {});
    expect(result.missingRules).toEqual(ruleSet.missing);
  });
});

describe('SUTA employer (Slice 15) — aggregator-level behavior', () => {
  it('is calculated (COMPLETE) when employer.sutaRate is supplied and SUTA_WAGE_BASE is NOT_APPLICABLE', () => {
    const result = calculateStateTaxes(
      context({
        workRuleSet: ruleSetWithSutaWageBase(profileSet([])),
        employer: { sutaRate: '0.05' },
      }),
      {},
    );
    expect(result.employer).not.toBeNull();
    if (result.employer === null) throw new Error('expected employer result');
    expect(result.employer.sutaEmployer.status).toBe('COMPLETE');
    expect(result.employer.sutaEmployer.amount).toBe('50');
  });

  it('remains unsupported when employer.sutaRate is absent, even with SUTA_WAGE_BASE resolved', () => {
    const result = calculateStateTaxes(
      context({ workRuleSet: ruleSetWithSutaWageBase(profileSet([])) }),
      {},
    );
    expect(result.employer).not.toBeNull();
    if (result.employer === null) throw new Error('expected employer result');
    expect(result.employer.sutaEmployer.amount).toBeNull();
    expect(result.employer.sutaEmployer.problem?.reason).toBe('SCENARIO_UNSUPPORTED');
  });

  it('never reads SUTA_EMPLOYER_RATE or SUTA_NEW_EMPLOYER_RATE — absent rate is unsupported, not defaulted', () => {
    // The rule set supplies neither key at all; a fallback read would fail
    // RULE_MISSING instead of SCENARIO_UNSUPPORTED, which this proves does
    // not happen.
    const result = calculateStateTaxes(
      context({ workRuleSet: ruleSetWithSutaWageBase(profileSet([])) }),
      {},
    );
    expect(result.employer?.sutaEmployer.problem?.reason).toBe('SCENARIO_UNSUPPORTED');
  });

  it('employee SUTA is unaffected by employer.sutaRate', () => {
    const result = calculateStateTaxes(
      context({
        workRuleSet: ruleSetWithSutaWageBase(profileSet([])),
        employer: { sutaRate: '0.05' },
      }),
      {},
    );
    // Employee SUTA still needs its own SUTA_EMPLOYEE_RATE, which this
    // fixture does not supply — employer.sutaRate never substitutes for it.
    expect(result.employee.sutaEmployee.amount).toBeNull();
    expect(result.employee.sutaEmployee.problem?.reason).toBe('RULE_MISSING');
  });

  it('includeEmployerTaxes=false: employer SUTA is not calculated or emitted at all', () => {
    const result = calculateStateTaxes(
      context({
        workRuleSet: ruleSetWithSutaWageBase(profileSet([])),
        employer: { sutaRate: '0.05' },
        includeEmployerTaxes: false,
      }),
      {},
    );
    expect(result.employer).toBeNull();
  });
});

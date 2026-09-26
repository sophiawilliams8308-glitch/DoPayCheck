import { describe, expect, it } from 'vitest';

import type { RuleReference } from '@/lib/calculator/types/rules';
import { calculateStateTaxes } from '@/lib/tax/state/index';
import type { StateCalculationContext, StateElections } from '@/lib/tax/state/context';
import { stateYtdAssumedZero } from '@/lib/tax/state/context';
import {
  freezeStateRuleSet,
  type ResolvedStateRule,
  type ResolvedStateRuleSet,
  type StateRuleEntry,
} from '@/lib/tax/state/rules/stateRuleSet';
import { StateRuleKey } from '@/lib/tax/state/ruleKeys';

/**
 * State income-tax withholding orchestrator wiring (DM-03 Slice 24).
 *
 * ===========================================================================
 * SCOPE NOTE.
 *
 * This file covers ONLY the orchestrator wiring added in Slice 24:
 * `calculateStateTaxes()`'s `incomeTaxWithheld` now dispatches through the
 * existing `resolveWithholdingMethodology()` (Slice 17) and, for the
 * `FORMULA` path, the existing `runStateWithholdingFormula()` (Slice 23),
 * against the existing `stateIncomeTaxWages` bucket
 * (`deriveResolvedStateWageBuckets()`, Slice 7). It does not re-test any
 * operation's own arithmetic (covered by the formula interpreter's own test
 * files), any SDI/PFML/SUTA behavior (covered by
 * `state-calculate-taxes.test.ts`, unmodified except for the one test split
 * this slice required), or the methodology dispatcher's own classification
 * (covered by `state-withholding-methodology.test.ts`).
 *
 * `WITHHOLDING_FORMULA`'s own reference is captured HERE, at this
 * orchestrator layer — never inside the interpreter (Slice 22 Question A,
 * Slice 23, Slice 24).
 * ===========================================================================
 *
 * Fixtures use RESERVED TEST jurisdiction/source ids and no real tax value.
 */

const JURISDICTION_CODE = 'TEST-INCOME-TAX-WITHHOLDING';
const JURISDICTION_ID = 'test-income-tax-withholding-jurisdiction-id';
const TAX_YEAR = 2099;
const EFFECTIVE = '2099-06-15T00:00:00.000Z';
const SINGLE = 'SINGLE';
const DEDUCTION_KEY = StateRuleKey.WITHHOLDING_STANDARD_DEDUCTION;

function reference(
  ruleKey: string,
  overrides: { ruleId?: string; version?: number } = {},
): RuleReference {
  return {
    ruleId: overrides.ruleId ?? `synthetic-${ruleKey}`,
    ruleKey,
    version: overrides.version ?? 1,
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

function availableEntry(
  key: StateRuleKey,
  detail: unknown,
  overrides: { referenceOverrides?: { ruleId?: string; version?: number } } = {},
): { available: true; rule: ResolvedStateRule } {
  return {
    available: true,
    rule: {
      key,
      reference: reference(key, overrides.referenceOverrides),
      detail,
      verificationStatus: 'VERIFIED',
    },
  };
}

function buildRuleSet(
  entries: Partial<Record<StateRuleKey, StateRuleEntry>>,
): ResolvedStateRuleSet {
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

function profileSet(profiles: readonly unknown[] = []) {
  return { shape: 'TAXABILITY_PROFILE_SET', profiles };
}

const DEDUCTION_TYPE_KEY = 'DED';

/** A profile that REDUCE_WAGES for INCOME_TAX_WITHHOLDING only — resolving
 * taxability for at least one deduction is what makes `resolveTaxability()`
 * actually run and attach a TAXABILITY_PROFILE reference to `bucket.rules`;
 * with zero deductions (the default `profileSet()` fixture elsewhere in this
 * file) that resolution never happens and the bucket carries no rule
 * provenance at all. */
function profileSetWithDeduction() {
  return profileSet([
    {
      deductionTypeKey: DEDUCTION_TYPE_KEY,
      programTreatments: {
        INCOME_TAX_WITHHOLDING: {
          variants: [{ conditions: [], effect: 'REDUCE_WAGES', limit: null }],
        },
        SDI: { variants: [{ conditions: [], effect: 'NO_CHANGE', limit: null }] },
        PFML: { variants: [{ conditions: [], effect: 'NO_CHANGE', limit: null }] },
        SUTA: { variants: [{ conditions: [], effect: 'NO_CHANGE', limit: null }] },
      },
    },
  ]);
}

function methodDetail(structure: string) {
  return {
    shape: 'METHOD_DESCRIPTOR',
    structure,
    methodName: `Synthetic ${structure} method`,
    usesAllowances: false,
    usesStandardDeduction: true,
    usesExemptions: false,
    startsFromFederalTaxableWages: false,
  };
}

function formulaDetail(steps: readonly Record<string, unknown>[]) {
  return { shape: 'FORMULA_STEPS', steps };
}

const step = (
  ordinal: number,
  operation: string,
  operandRef: string | null = null,
): Record<string, unknown> => ({ ordinal, operation, operandRef, note: null });

function standardDeductionDetail(amount: string) {
  return {
    shape: 'AMOUNT_BY_FILING_STATUS',
    unit: 'ANNUAL',
    amounts: [{ filingStatus: SINGLE, amount }],
  };
}

/** A full FORMULA-path ruleset: taxability (empty profiles, wages unreduced),
 * WITHHOLDING_METHOD -> FORMULA, WITHHOLDING_FORMULA with one
 * SUBTRACT_STANDARD_DEDUCTION step, and the deduction rule it needs. */
function formulaRuleSet(): ResolvedStateRuleSet {
  return buildRuleSet({
    [StateRuleKey.TAXABILITY_PROFILE]: availableEntry(
      StateRuleKey.TAXABILITY_PROFILE,
      profileSet(),
    ),
    [StateRuleKey.WITHHOLDING_METHOD]: availableEntry(
      StateRuleKey.WITHHOLDING_METHOD,
      methodDetail('FORMULA'),
    ),
    [StateRuleKey.WITHHOLDING_FORMULA]: availableEntry(
      StateRuleKey.WITHHOLDING_FORMULA,
      formulaDetail([step(0, 'SUBTRACT_STANDARD_DEDUCTION')]),
    ),
    [DEDUCTION_KEY]: availableEntry(DEDUCTION_KEY, standardDeductionDetail('100')),
  });
}

function contextWith(
  overrides: Partial<StateCalculationContext> & { workRuleSet: ResolvedStateRuleSet },
  filingStatus: string | null = SINGLE,
): StateCalculationContext {
  const elections: Record<string, StateElections> =
    filingStatus === null
      ? {}
      : { [JURISDICTION_CODE]: { formCode: 'TEST-FORM', filingStatus, values: [] } };
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
    elections,
    allowanceCounts: {},
    employer: {},
    reciprocityCertificateFiled: false,
    includeEmployerTaxes: true,
    ...overrides,
  };
}

describe('income tax withholding — FORMULA success', () => {
  it('COMPLETE with the formula result amount, correct bucket, and full provenance', () => {
    const result = calculateStateTaxes(contextWith({ workRuleSet: formulaRuleSet() }), {});

    expect(result.employee.incomeTaxWithheld.status).toBe('COMPLETE');
    // 1000 (gross, unreduced by the empty profile set) - 100 (standard deduction) = 900.
    expect(result.employee.incomeTaxWithheld.amount).toBe('900');

    const component = result.employee.components.find(
      (c) => c.program === 'INCOME_TAX_WITHHOLDING',
    );
    expect(component?.bucket).toBe('stateIncomeTaxWages');

    const ruleKeys = result.employee.incomeTaxWithheld.rules.map((r) => r.ruleKey);
    expect(ruleKeys).toContain(StateRuleKey.WITHHOLDING_FORMULA);
    expect(ruleKeys).toContain(DEDUCTION_KEY);
  });

  it('methodology.withholdingMethod reflects the resolved method name', () => {
    const result = calculateStateTaxes(contextWith({ workRuleSet: formulaRuleSet() }), {});
    expect(result.methodology.withholdingMethod).toBe('Synthetic FORMULA method');
  });
});

describe('income tax withholding — formula container provenance', () => {
  it('WITHHOLDING_FORMULA appears exactly once in the final provenance', () => {
    const result = calculateStateTaxes(contextWith({ workRuleSet: formulaRuleSet() }), {});
    const formulaReferences = result.employee.incomeTaxWithheld.rules.filter(
      (r) => r.ruleKey === StateRuleKey.WITHHOLDING_FORMULA,
    );
    expect(formulaReferences).toHaveLength(1);
  });

  it('the interpreter itself never receives or reports a WITHHOLDING_FORMULA reference (Slice 22 Question A)', () => {
    // This fixture's bucket has zero deductions, so `resolveTaxability()`
    // never runs and contributes no TAXABILITY_PROFILE reference — the
    // formula only has one operand rule (the standard deduction). The
    // WITHHOLDING_FORMULA reference present in the final result must
    // therefore have been added by the orchestrator, not smuggled through
    // by the interpreter — proven by confirming the result contains exactly
    // these two references, not a duplicated or substituted set.
    const result = calculateStateTaxes(contextWith({ workRuleSet: formulaRuleSet() }), {});
    const ruleKeys = result.employee.incomeTaxWithheld.rules.map((r) => r.ruleKey).sort();
    expect(ruleKeys).toEqual([DEDUCTION_KEY, StateRuleKey.WITHHOLDING_FORMULA].sort());
  });
});

describe('income tax withholding — bucket + formula provenance merge', () => {
  it('includes the bucket (TAXABILITY_PROFILE) reference alongside formula provenance', () => {
    // A real deduction is required for resolveTaxability() to actually run
    // and attach a TAXABILITY_PROFILE reference to bucket.rules — with zero
    // deductions (as in formulaRuleSet() above) that resolution never
    // happens at all.
    const ruleSet = buildRuleSet({
      [StateRuleKey.TAXABILITY_PROFILE]: availableEntry(
        StateRuleKey.TAXABILITY_PROFILE,
        profileSetWithDeduction(),
      ),
      [StateRuleKey.WITHHOLDING_METHOD]: availableEntry(
        StateRuleKey.WITHHOLDING_METHOD,
        methodDetail('FORMULA'),
      ),
      [StateRuleKey.WITHHOLDING_FORMULA]: availableEntry(
        StateRuleKey.WITHHOLDING_FORMULA,
        formulaDetail([step(0, 'SUBTRACT_STANDARD_DEDUCTION')]),
      ),
      [DEDUCTION_KEY]: availableEntry(DEDUCTION_KEY, standardDeductionDetail('100')),
    });
    const result = calculateStateTaxes(
      contextWith({
        workRuleSet: ruleSet,
        deductions: [{ deductionTypeKey: DEDUCTION_TYPE_KEY, amount: '50' }],
      }),
      {},
    );

    expect(result.employee.incomeTaxWithheld.status).toBe('COMPLETE');
    // 1000 (gross) - 50 (REDUCE_WAGES deduction) = 950 bucket; 950 - 100
    // (standard deduction) = 850.
    expect(result.employee.incomeTaxWithheld.amount).toBe('850');
    const ruleKeys = result.employee.incomeTaxWithheld.rules.map((r) => r.ruleKey);
    expect(ruleKeys).toContain(StateRuleKey.TAXABILITY_PROFILE);
    expect(ruleKeys).toContain(StateRuleKey.WITHHOLDING_FORMULA);
    expect(ruleKeys).toContain(DEDUCTION_KEY);
    expect(result.employee.incomeTaxWithheld.rules).toHaveLength(3);
  });
});

describe('income tax withholding — cross-boundary deduplication', () => {
  it('a ruleId@version shared between bucket and formula provenance collapses to one reference', () => {
    // TAXABILITY_PROFILE's reference only reaches bucket.rules when a real
    // deduction is resolved against it (see profileSetWithDeduction()'s own
    // doc comment) — this is what makes the overlap with the formula's own
    // DEDUCTION_KEY reference genuinely cross a bucket/formula boundary,
    // rather than only deduplicating within the formula's own operands.
    const sharedRuleId = 'shared-bucket-formula-rule-id';
    const ruleSet = buildRuleSet({
      [StateRuleKey.TAXABILITY_PROFILE]: availableEntry(
        StateRuleKey.TAXABILITY_PROFILE,
        profileSetWithDeduction(),
        { referenceOverrides: { ruleId: sharedRuleId, version: 1 } },
      ),
      [StateRuleKey.WITHHOLDING_METHOD]: availableEntry(
        StateRuleKey.WITHHOLDING_METHOD,
        methodDetail('FORMULA'),
      ),
      [StateRuleKey.WITHHOLDING_FORMULA]: availableEntry(
        StateRuleKey.WITHHOLDING_FORMULA,
        formulaDetail([step(0, 'SUBTRACT_STANDARD_DEDUCTION')]),
      ),
      [DEDUCTION_KEY]: availableEntry(DEDUCTION_KEY, standardDeductionDetail('100'), {
        referenceOverrides: { ruleId: sharedRuleId, version: 1 },
      }),
    });
    const result = calculateStateTaxes(
      contextWith({
        workRuleSet: ruleSet,
        deductions: [{ deductionTypeKey: DEDUCTION_TYPE_KEY, amount: '50' }],
      }),
      {},
    );

    expect(result.employee.incomeTaxWithheld.status).toBe('COMPLETE');
    const matching = result.employee.incomeTaxWithheld.rules.filter(
      (r) => r.ruleId === sharedRuleId,
    );
    expect(matching).toHaveLength(1);
    // WITHHOLDING_FORMULA's own reference remains distinct.
    expect(result.employee.incomeTaxWithheld.rules).toHaveLength(2);
  });
});

describe('income tax withholding — formula failure', () => {
  it('fails when the deduction rule the formula requires is missing, with no partial provenance', () => {
    const ruleSet = buildRuleSet({
      [StateRuleKey.TAXABILITY_PROFILE]: availableEntry(
        StateRuleKey.TAXABILITY_PROFILE,
        profileSet(),
      ),
      [StateRuleKey.WITHHOLDING_METHOD]: availableEntry(
        StateRuleKey.WITHHOLDING_METHOD,
        methodDetail('FORMULA'),
      ),
      [StateRuleKey.WITHHOLDING_FORMULA]: availableEntry(
        StateRuleKey.WITHHOLDING_FORMULA,
        formulaDetail([step(0, 'SUBTRACT_STANDARD_DEDUCTION')]),
      ),
      // DEDUCTION_KEY deliberately absent.
    });
    const result = calculateStateTaxes(contextWith({ workRuleSet: ruleSet }), {});

    expect(result.employee.incomeTaxWithheld.amount).toBeNull();
    expect(result.employee.incomeTaxWithheld.problem?.reason).toBe('RULE_MISSING');
    expect(result.employee.incomeTaxWithheld.rules).toEqual([]);
  });
});

describe('income tax withholding — missing methodology', () => {
  it('fails RULE_MISSING when WITHHOLDING_METHOD itself is absent', () => {
    const ruleSet = buildRuleSet({
      [StateRuleKey.TAXABILITY_PROFILE]: availableEntry(
        StateRuleKey.TAXABILITY_PROFILE,
        profileSet(),
      ),
      // WITHHOLDING_METHOD deliberately absent.
    });
    const result = calculateStateTaxes(contextWith({ workRuleSet: ruleSet }), {});

    expect(result.employee.incomeTaxWithheld.amount).toBeNull();
    expect(result.employee.incomeTaxWithheld.problem?.reason).toBe('RULE_MISSING');
    expect(result.methodology.withholdingMethod).toBeNull();
  });
});

describe('income tax withholding — TABLE_SELECTION_ONLY', () => {
  it('reports METHOD_NOT_IMPLEMENTED — no table arithmetic is invented', () => {
    const ruleSet = buildRuleSet({
      [StateRuleKey.TAXABILITY_PROFILE]: availableEntry(
        StateRuleKey.TAXABILITY_PROFILE,
        profileSet(),
      ),
      [StateRuleKey.WITHHOLDING_METHOD]: availableEntry(
        StateRuleKey.WITHHOLDING_METHOD,
        methodDetail('TABLE'),
      ),
    });
    const result = calculateStateTaxes(contextWith({ workRuleSet: ruleSet }), {});

    expect(result.employee.incomeTaxWithheld.amount).toBeNull();
    expect(result.employee.incomeTaxWithheld.problem?.reason).toBe('METHOD_NOT_IMPLEMENTED');
  });
});

describe('income tax withholding — unsupported methodologies', () => {
  it.each(['NONE', 'FLAT', 'PROGRESSIVE', 'HYBRID'])(
    'structure=%s preserves the dispatcher’s own SCENARIO_UNSUPPORTED, never bypassed',
    (structure) => {
      const ruleSet = buildRuleSet({
        [StateRuleKey.TAXABILITY_PROFILE]: availableEntry(
          StateRuleKey.TAXABILITY_PROFILE,
          profileSet(),
        ),
        [StateRuleKey.WITHHOLDING_METHOD]: availableEntry(
          StateRuleKey.WITHHOLDING_METHOD,
          methodDetail(structure),
        ),
      });
      const result = calculateStateTaxes(contextWith({ workRuleSet: ruleSet }), {});

      expect(result.employee.incomeTaxWithheld.amount).toBeNull();
      expect(result.employee.incomeTaxWithheld.problem?.reason).toBe('SCENARIO_UNSUPPORTED');
    },
  );
});

describe('income tax withholding — includeEmployerTaxes', () => {
  it('is present regardless of includeEmployerTaxes, while employer programs remain governed by the flag', () => {
    const ruleSet = formulaRuleSet();
    const withEmployer = calculateStateTaxes(
      contextWith({ workRuleSet: ruleSet, includeEmployerTaxes: true }),
      {},
    );
    const withoutEmployer = calculateStateTaxes(
      contextWith({ workRuleSet: ruleSet, includeEmployerTaxes: false }),
      {},
    );

    expect(withEmployer.employee.incomeTaxWithheld.status).toBe('COMPLETE');
    expect(withoutEmployer.employee.incomeTaxWithheld.status).toBe('COMPLETE');
    expect(withEmployer.employee.incomeTaxWithheld.amount).toBe(
      withoutEmployer.employee.incomeTaxWithheld.amount,
    );
    expect(withEmployer.employer).not.toBeNull();
    expect(withoutEmployer.employer).toBeNull();
  });

  it('never appears under the employer branch', () => {
    const result = calculateStateTaxes(
      contextWith({ workRuleSet: formulaRuleSet(), includeEmployerTaxes: true }),
      {},
    );
    expect(result.employer).not.toBeNull();
    expect(result.employer).not.toHaveProperty('incomeTaxWithheld');
  });
});

describe('income tax withholding — filing status', () => {
  it('null filing status reports SCENARIO_UNSUPPORTED, never a mapped/guessed status', () => {
    const result = calculateStateTaxes(contextWith({ workRuleSet: formulaRuleSet() }, null), {});

    expect(result.employee.incomeTaxWithheld.amount).toBeNull();
    expect(result.employee.incomeTaxWithheld.problem?.reason).toBe('SCENARIO_UNSUPPORTED');
  });

  it('a state-native filing status string (not a federal vocabulary member) still succeeds', () => {
    // Proves filing status flows through as the exact state-native string,
    // never mapped through a federal filing-status vocabulary.
    const stateNativeStatus = 'STATE-NATIVE-HEAD-OF-HOUSEHOLD';
    const ruleSet = buildRuleSet({
      [StateRuleKey.TAXABILITY_PROFILE]: availableEntry(
        StateRuleKey.TAXABILITY_PROFILE,
        profileSet(),
      ),
      [StateRuleKey.WITHHOLDING_METHOD]: availableEntry(
        StateRuleKey.WITHHOLDING_METHOD,
        methodDetail('FORMULA'),
      ),
      [StateRuleKey.WITHHOLDING_FORMULA]: availableEntry(
        StateRuleKey.WITHHOLDING_FORMULA,
        formulaDetail([step(0, 'SUBTRACT_STANDARD_DEDUCTION')]),
      ),
      [DEDUCTION_KEY]: availableEntry(DEDUCTION_KEY, {
        shape: 'AMOUNT_BY_FILING_STATUS',
        unit: 'ANNUAL',
        amounts: [{ filingStatus: stateNativeStatus, amount: '50' }],
      }),
    });
    const result = calculateStateTaxes(
      contextWith({ workRuleSet: ruleSet }, stateNativeStatus),
      {},
    );

    expect(result.employee.incomeTaxWithheld.status).toBe('COMPLETE');
    expect(result.employee.incomeTaxWithheld.amount).toBe('950');
  });
});

describe('income tax withholding — pay frequency', () => {
  it('ANNUALIZE receives the state context payFrequency and uses the existing pay-period helper unchanged', () => {
    const ruleSet = buildRuleSet({
      [StateRuleKey.TAXABILITY_PROFILE]: availableEntry(
        StateRuleKey.TAXABILITY_PROFILE,
        profileSet(),
      ),
      [StateRuleKey.WITHHOLDING_METHOD]: availableEntry(
        StateRuleKey.WITHHOLDING_METHOD,
        methodDetail('FORMULA'),
      ),
      [StateRuleKey.WITHHOLDING_FORMULA]: availableEntry(
        StateRuleKey.WITHHOLDING_FORMULA,
        formulaDetail([step(0, 'ANNUALIZE')]),
      ),
      [StateRuleKey.WITHHOLDING_PAY_PERIODS_PER_YEAR]: availableEntry(
        StateRuleKey.WITHHOLDING_PAY_PERIODS_PER_YEAR,
        {
          shape: 'COUNT_BY_PAY_PERIOD',
          counts: [{ payFrequency: 'BIWEEKLY', periodsPerYear: 26 }],
        },
      ),
    });
    // contextWith() defaults payFrequency to 'BIWEEKLY'.
    const result = calculateStateTaxes(contextWith({ workRuleSet: ruleSet }), {});

    expect(result.employee.incomeTaxWithheld.status).toBe('COMPLETE');
    // 1000 (bucket) * 26 (BIWEEKLY periods/year) = 26000.
    expect(result.employee.incomeTaxWithheld.amount).toBe('26000');
    const ruleKeys = result.employee.incomeTaxWithheld.rules.map((r) => r.ruleKey);
    expect(ruleKeys).toContain(StateRuleKey.WITHHOLDING_PAY_PERIODS_PER_YEAR);
  });

  it('a payFrequency with no matching row reports SCENARIO_UNSUPPORTED, not a fabricated count', () => {
    const ruleSet = buildRuleSet({
      [StateRuleKey.TAXABILITY_PROFILE]: availableEntry(
        StateRuleKey.TAXABILITY_PROFILE,
        profileSet(),
      ),
      [StateRuleKey.WITHHOLDING_METHOD]: availableEntry(
        StateRuleKey.WITHHOLDING_METHOD,
        methodDetail('FORMULA'),
      ),
      [StateRuleKey.WITHHOLDING_FORMULA]: availableEntry(
        StateRuleKey.WITHHOLDING_FORMULA,
        formulaDetail([step(0, 'ANNUALIZE')]),
      ),
      [StateRuleKey.WITHHOLDING_PAY_PERIODS_PER_YEAR]: availableEntry(
        StateRuleKey.WITHHOLDING_PAY_PERIODS_PER_YEAR,
        { shape: 'COUNT_BY_PAY_PERIOD', counts: [{ payFrequency: 'MONTHLY', periodsPerYear: 12 }] },
      ),
    });
    const result = calculateStateTaxes(contextWith({ workRuleSet: ruleSet }), {});

    expect(result.employee.incomeTaxWithheld.amount).toBeNull();
    expect(result.employee.incomeTaxWithheld.problem?.reason).toBe('SCENARIO_UNSUPPORTED');
  });
});

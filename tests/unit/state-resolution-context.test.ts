import { describe, expect, it } from 'vitest';

import { StateCapability, ALL_STATE_CAPABILITIES } from '@/lib/tax/state/coverage/capabilities';
import type { StateCalculationContext } from '@/lib/tax/state/context';
import { stateYtdAssumedZero } from '@/lib/tax/state/context';
import {
  ALL_WAGE_TYPES,
  CapabilityCode,
  RESOLUTION_CONTEXT_FIELDS,
  RESOLUTION_SCENARIO_FIELDS,
  WageType,
  projectResolutionContext,
} from '@/lib/tax/state/resolutionContext';
import { freezeStateRuleSet, type ResolvedStateRuleSet } from '@/lib/tax/state/rules/stateRuleSet';
import { ResidencyStatus } from '@/lib/tax/state/types';

/**
 * Resolver input projection (Phase 5 Step 3.1, §3).
 *
 * Jurisdiction codes are RESERVED TEST codes. No state tax value appears here.
 */

const TEST_WORK = 'TEST-WORK';
const TEST_RESIDENCE = 'TEST-RESIDENCE';
const TEST_YEAR = 2099;
const TEST_INSTANT = '2099-06-15T00:00:00.000Z';

/**
 * A default, non-empty capability set for tests that exercise fields other
 * than `capabilitiesRequested` itself (Amendment 3 made the argument
 * required). Its content is arbitrary and load-bearing only where a test
 * says otherwise.
 */
function defaultCapabilities(): Set<CapabilityCode> {
  return new Set([StateCapability.WITHHOLDING]);
}

function ruleSet(): ResolvedStateRuleSet {
  return freezeStateRuleSet({
    taxYear: TEST_YEAR,
    effectiveDate: TEST_INSTANT,
    jurisdictionCode: TEST_WORK,
    engineVersion: 'test-engine',
    resolvedAt: TEST_INSTANT,
    missing: [],
    entries: {},
    ruleReferences: [],
    sourceIds: [],
  });
}

function context(overrides: Partial<StateCalculationContext> = {}): StateCalculationContext {
  return {
    taxYear: TEST_YEAR,
    effectiveDate: TEST_INSTANT,
    payFrequency: 'BIWEEKLY',
    workJurisdictions: [{ jurisdictionCode: TEST_WORK, allocation: '1' }],
    residenceJurisdictionCode: TEST_RESIDENCE,
    residencyStatus: ResidencyStatus.NONRESIDENT,
    wages: { regular: '100', supplemental: '50' },
    ytd: stateYtdAssumedZero(),
    workRuleSet: ruleSet(),
    residenceRuleSet: null,
    elections: {
      [TEST_WORK]: {
        formCode: 'SYNTHETIC-FORM',
        filingStatus: 'SYNTHETIC_STATUS',
        values: [{ fieldKey: 'extra', value: '10', unit: 'PER_PERIOD' }],
      },
    },
    employer: { employeeCount: 10 },
    reciprocityCertificateFiled: true,
    includeEmployerTaxes: true,
    ...overrides,
  };
}

describe('§3.2 — exactly eight top-level fields', () => {
  it('projects exactly the eight fields the specification names', () => {
    const projected = projectResolutionContext(context(), defaultCapabilities());
    expect(Object.keys(projected).sort()).toEqual([...RESOLUTION_CONTEXT_FIELDS].sort());
    expect(Object.keys(projected).length).toBe(8);
  });

  it('carries each field from its specified source', () => {
    const projected = projectResolutionContext(context(), defaultCapabilities());
    expect(projected.taxYear).toBe(TEST_YEAR);
    expect(projected.calculationDate).toBe(TEST_INSTANT);
    expect(projected.workJurisdiction).toBe(TEST_WORK);
    expect(projected.residenceJurisdiction).toBe(TEST_RESIDENCE);
    expect(projected.residencyStatus).toBe(ResidencyStatus.NONRESIDENT);
    expect(projected.stateFilingStatus).toBe('SYNTHETIC_STATUS');
    expect(projected.payFrequency).toBe('BIWEEKLY');
  });
});

describe('§3.4 — exactly three scenario fields', () => {
  it('projects exactly the three the specification names', () => {
    const { scenario } = projectResolutionContext(context(), defaultCapabilities());
    expect(Object.keys(scenario).sort()).toEqual([...RESOLUTION_SCENARIO_FIELDS].sort());
    expect(Object.keys(scenario).length).toBe(3);
  });

  it('carries employerSideRequested directly', () => {
    expect(
      projectResolutionContext(context(), defaultCapabilities()).scenario.employerSideRequested,
    ).toBe(true);
    expect(
      projectResolutionContext(context({ includeEmployerTaxes: false }), defaultCapabilities())
        .scenario.employerSideRequested,
    ).toBe(false);
  });
});

describe('forbidden fields are structurally absent', () => {
  it('exposes no money, identity or deferred concept', () => {
    const projected = projectResolutionContext(context(), defaultCapabilities());
    const serialized = JSON.stringify(projected);

    for (const forbidden of [
      'wages',
      'regular',
      'supplemental',
      'ytd',
      'deduction',
      'deductions',
      'employeeCategory',
      'stateElections',
      'elections',
      'reciprocityContext',
      'reciprocityCertificateFiled',
      'localContext',
      'employerJurisdiction',
      'ruleDataVersion',
      'mode',
      'PREVIEW',
      'employeeId',
    ]) {
      expect(serialized, `${forbidden} must not reach the resolver context`).not.toContain(
        forbidden,
      );
    }
  });

  it('leaks no wage amount even when wages are present in the source', () => {
    // The amounts below exist in the calculation context and must not survive.
    const projected = projectResolutionContext(
      context({ wages: { regular: '123456', supplemental: '654321' } }),
      defaultCapabilities(),
    );
    const serialized = JSON.stringify(projected);
    expect(serialized).not.toContain('123456');
    expect(serialized).not.toContain('654321');
  });

  it('has no top-level field outside the specified eight', () => {
    const projected = projectResolutionContext(context(), defaultCapabilities());
    const allowed = new Set<string>(RESOLUTION_CONTEXT_FIELDS);
    for (const key of Object.keys(projected)) {
      expect(allowed.has(key), `${key} is not a specified field`).toBe(true);
    }
  });
});

describe('purity', () => {
  it('returns a deeply equal result for the same input', () => {
    const input = context();
    const caps = defaultCapabilities();
    const first = projectResolutionContext(input, caps);
    const second = projectResolutionContext(input, caps);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });

  it('does not mutate its argument', () => {
    // Deep-frozen: any write attempt throws in strict mode rather than passing silently.
    const input = context();
    Object.freeze(input);
    Object.freeze(input.wages);
    Object.freeze(input.elections);
    expect(() => projectResolutionContext(input, defaultCapabilities())).not.toThrow();
    expect(input.workJurisdictions.length).toBe(1);
    expect(input.wages.regular).toBe('100');
  });

  it('returns a frozen projection', () => {
    const projected = projectResolutionContext(context(), defaultCapabilities());
    expect(Object.isFrozen(projected)).toBe(true);
    expect(Object.isFrozen(projected.scenario)).toBe(true);
  });

  it('returns independent sets per call, even given the SAME caller-supplied set', () => {
    // Amendment 3: the projection defensively copies, so passing the identical
    // caller Set into two calls must still yield two distinct Set instances —
    // neither call's returned set is the caller's own reference.
    const caps = defaultCapabilities();
    const first = projectResolutionContext(context(), caps);
    const second = projectResolutionContext(context(), caps);
    expect(first.scenario.capabilitiesRequested).not.toBe(second.scenario.capabilitiesRequested);
    expect(first.scenario.capabilitiesRequested).not.toBe(caps);
  });

  it('does not mutate the caller-supplied capability set', () => {
    const caps = defaultCapabilities();
    const before = [...caps];
    projectResolutionContext(context(), caps);
    expect([...caps]).toEqual(before);
  });
});

describe('totality', () => {
  const edgeCases: readonly (readonly [string, Partial<StateCalculationContext>])[] = [
    ['no work jurisdictions', { workJurisdictions: [] }],
    ['no elections at all', { elections: {} }],
    [
      'election without a filing status',
      {
        elections: { [TEST_WORK]: { formCode: 'F', filingStatus: null, values: [] } },
      },
    ],
    [
      'election keyed to a different jurisdiction',
      {
        elections: { [TEST_RESIDENCE]: { formCode: 'F', filingStatus: 'X', values: [] } },
      },
    ],
    [
      'multiple work jurisdictions',
      {
        workJurisdictions: [
          { jurisdictionCode: TEST_WORK, allocation: '0.5' },
          { jurisdictionCode: TEST_RESIDENCE, allocation: '0.5' },
        ],
      },
    ],
    ['employer taxes not requested', { includeEmployerTaxes: false }],
    ['resident', { residencyStatus: ResidencyStatus.RESIDENT }],
    ['part-year resident', { residencyStatus: ResidencyStatus.PART_YEAR_RESIDENT }],
    ['zero wages', { wages: { regular: '0', supplemental: '0' } }],
  ];

  for (const [name, overrides] of edgeCases) {
    it(`is defined for: ${name}`, () => {
      const projected = projectResolutionContext(context(overrides), defaultCapabilities());
      expect(Object.keys(projected).length).toBe(8);
      expect(Object.keys(projected.scenario).length).toBe(3);
    });
  }

  it('represents an absent work jurisdiction as null, never a default', () => {
    // Defaulting to a jurisdiction is the one error a state resolver must not make.
    expect(
      projectResolutionContext(context({ workJurisdictions: [] }), defaultCapabilities())
        .workJurisdiction,
    ).toBeNull();
  });

  it('represents a missing filing election as null', () => {
    expect(
      projectResolutionContext(context({ elections: {} }), defaultCapabilities()).stateFilingStatus,
    ).toBeNull();
  });

  it('is defined even when the caller supplies an empty capability set', () => {
    // Totality of the PROJECTION: an empty set is still a valid input to
    // `projectResolutionContext` itself. Step 3.2's validator, not the
    // projection, is what later rejects it as INVALID_CONTEXT.
    const projected = projectResolutionContext(context(), new Set());
    expect(projected.scenario.capabilitiesRequested.size).toBe(0);
  });
});

describe('§3.4.1 — capabilitiesRequested is caller-supplied, never derived (Amendment 3)', () => {
  it('carries the caller-supplied capability set through verbatim', () => {
    const requested = new Set([StateCapability.WITHHOLDING, StateCapability.INCOME_TAX]);
    const { capabilitiesRequested } = projectResolutionContext(context(), requested).scenario;
    expect([...capabilitiesRequested].sort()).toEqual([...requested].sort());
  });

  it('does not invent a capability set when the caller supplies an empty one', () => {
    const { capabilitiesRequested } = projectResolutionContext(context(), new Set()).scenario;
    expect(capabilitiesRequested.size).toBe(0);
  });

  it('does not fabricate all 13 capabilities regardless of what is requested', () => {
    const requested = new Set([StateCapability.WITHHOLDING]);
    const { capabilitiesRequested } = projectResolutionContext(context(), requested).scenario;
    expect(capabilitiesRequested.size).not.toBe(ALL_STATE_CAPABILITIES.length);
  });

  it('does not derive capabilitiesRequested from wages, jurisdiction, filing status, pay frequency, residency status or employerSideRequested', () => {
    const requested = new Set([StateCapability.WITHHOLDING]);
    const variants: readonly Partial<StateCalculationContext>[] = [
      { wages: { regular: '999999', supplemental: '999999' } },
      { wages: { regular: '0', supplemental: '0' } },
      { workJurisdictions: [] },
      { elections: {} },
      { payFrequency: 'MONTHLY' },
      { residencyStatus: ResidencyStatus.RESIDENT },
      { includeEmployerTaxes: false },
    ];
    for (const overrides of variants) {
      const { capabilitiesRequested } = projectResolutionContext(
        context(overrides),
        requested,
      ).scenario;
      expect([...capabilitiesRequested].sort()).toEqual([...requested].sort());
    }
  });
});

describe('deferred §3.3 derivations are empty, not guessed', () => {
  it('emits an empty wage-type set rather than classifying supplemental wages', () => {
    // Six wage types, two source aggregates: nothing distinguishes a bonus from
    // a commission inside `supplemental`, so no member is asserted — including OTHER.
    const { wageTypesPresent } = projectResolutionContext(
      context({ wages: { regular: '100', supplemental: '100' } }),
      defaultCapabilities(),
    ).scenario;
    expect(wageTypesPresent.size).toBe(0);
  });

  it('emits the same empty sets whatever the wages are', () => {
    const withWages = projectResolutionContext(context(), defaultCapabilities()).scenario;
    const withoutWages = projectResolutionContext(
      context({ wages: { regular: '0', supplemental: '0' } }),
      defaultCapabilities(),
    ).scenario;
    expect(withWages.wageTypesPresent.size).toBe(withoutWages.wageTypesPresent.size);
  });
});

describe('vocabularies', () => {
  it('reuses the Step 2 capability vocabulary rather than duplicating it', () => {
    expect(CapabilityCode).toBe(StateCapability);
    const asCapability: CapabilityCode = StateCapability.WITHHOLDING;
    expect(asCapability).toBe('WITHHOLDING');
    expect(Object.keys(CapabilityCode).length).toBe(13);
  });

  it('defines exactly the six specified wage types', () => {
    expect([...ALL_WAGE_TYPES].sort()).toEqual(
      ['REGULAR', 'BONUS', 'COMMISSION', 'TIPS', 'OVERTIME', 'OTHER'].sort(),
    );
    expect(ALL_WAGE_TYPES.length).toBe(6);
    expect(new Set(ALL_WAGE_TYPES).size).toBe(6);
    expect(Object.keys(WageType).length).toBe(6);
  });
});

describe('StateCalculationContext is unchanged', () => {
  it('still carries its Step 1 top-level fields', () => {
    // The projection is additive: Step 1's contract must not have been narrowed
    // or renamed to make it convenient.
    expect(Object.keys(context()).sort()).toEqual(
      [
        'taxYear',
        'effectiveDate',
        'payFrequency',
        'workJurisdictions',
        'residenceJurisdictionCode',
        'residencyStatus',
        'wages',
        'ytd',
        'workRuleSet',
        'residenceRuleSet',
        'elections',
        'employer',
        'reciprocityCertificateFiled',
        'includeEmployerTaxes',
      ].sort(),
    );
  });
});

import { describe, expect, it } from 'vitest';

import { StateCapability } from '@/lib/tax/state/coverage/capabilities';
import type { StateCalculationContext } from '@/lib/tax/state/context';
import { stateYtdAssumedZero } from '@/lib/tax/state/context';
import {
  ResolutionContextOutcome,
  isValidResolutionContext,
  projectResolutionContext,
  validateResolutionContext,
  type StateRuleResolutionContext,
} from '@/lib/tax/state/resolutionContext';
import { freezeStateRuleSet, type ResolvedStateRuleSet } from '@/lib/tax/state/rules/stateRuleSet';
import { ResidencyStatus } from '@/lib/tax/state/types';

/**
 * Step 3.2 — context validation (rows 1-5 only; row 6 / MISSING_REQUIRED_CONTEXT
 * is F-02 and stays deferred, per §3 of this test file's own guard section).
 *
 * Jurisdiction codes are RESERVED TEST codes. No production tax value appears.
 */

const TEST_WORK = 'TEST-WORK';
const TEST_RESIDENCE = 'TEST-RESIDENCE';
const TEST_YEAR = 2099;
const TEST_INSTANT = '2099-06-15T00:00:00.000Z';

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

function calcContext(overrides: Partial<StateCalculationContext> = {}): StateCalculationContext {
  return {
    taxYear: TEST_YEAR,
    effectiveDate: TEST_INSTANT,
    payFrequency: 'BIWEEKLY',
    workJurisdictions: [{ jurisdictionCode: TEST_WORK, allocation: '1' }],
    residenceJurisdictionCode: TEST_RESIDENCE,
    residencyStatus: ResidencyStatus.NONRESIDENT,
    wages: { regular: '100', supplemental: '0' },
    ytd: stateYtdAssumedZero(),
    workRuleSet: ruleSet(),
    residenceRuleSet: null,
    elections: {
      [TEST_WORK]: { formCode: 'SYNTHETIC-FORM', filingStatus: 'SYNTHETIC_STATUS', values: [] },
    },
    employer: {},
    reciprocityCertificateFiled: false,
    includeEmployerTaxes: true,
    ...overrides,
  };
}

/**
 * Builds a resolution context directly rather than via `projectResolutionContext`.
 *
 * `projectResolutionContext` always emits an EMPTY `capabilitiesRequested` today
 * (row 1.5's derivation is deferred, per Step 3.1's own documented decision) —
 * so exercising the "valid capabilities" path requires constructing the context
 * by hand. This is legitimate: the validator's contract is over the TYPE, not
 * over one particular producer of it.
 */
function resolutionContext(
  overrides: Partial<StateRuleResolutionContext> = {},
): StateRuleResolutionContext {
  return {
    taxYear: TEST_YEAR,
    calculationDate: TEST_INSTANT,
    workJurisdiction: TEST_WORK,
    residenceJurisdiction: TEST_RESIDENCE,
    residencyStatus: ResidencyStatus.NONRESIDENT,
    stateFilingStatus: 'SYNTHETIC_STATUS',
    payFrequency: 'BIWEEKLY',
    scenario: {
      capabilitiesRequested: new Set([StateCapability.WITHHOLDING]),
      wageTypesPresent: new Set(),
      employerSideRequested: true,
    },
    ...overrides,
  };
}

function issuePaths(context: StateRuleResolutionContext): string[] {
  return validateResolutionContext(context).map((issue) => issue.path);
}

// ---- Valid contexts ---------------------------------------------------------

describe('valid contexts pass', () => {
  it('accepts a fully valid context', () => {
    expect(validateResolutionContext(resolutionContext())).toEqual([]);
    expect(isValidResolutionContext(resolutionContext())).toBe(true);
  });

  it('accepts workJurisdiction = null', () => {
    expect(issuePaths(resolutionContext({ workJurisdiction: null }))).toEqual([]);
  });

  it('accepts a valid non-null work jurisdiction', () => {
    expect(issuePaths(resolutionContext({ workJurisdiction: 'TEST-ANY-VALUE' }))).toEqual([]);
  });

  it('accepts a valid non-null residence jurisdiction', () => {
    expect(issuePaths(resolutionContext({ residenceJurisdiction: 'TEST-ANY-VALUE' }))).toEqual([]);
  });

  it('accepts stateFilingStatus = null', () => {
    expect(issuePaths(resolutionContext({ stateFilingStatus: null }))).toEqual([]);
  });

  it('accepts every individual Step 2 capability', () => {
    for (const capability of Object.values(StateCapability)) {
      const issues = validateResolutionContext(
        resolutionContext({
          scenario: {
            capabilitiesRequested: new Set([capability]),
            wageTypesPresent: new Set(),
            employerSideRequested: false,
          },
        }),
      );
      expect(issues, `${capability} should be a valid request`).toEqual([]);
    }
  });
});

// ---- Invalid contexts --------------------------------------------------------

describe('invalid taxYear', () => {
  // calculationDate's year is held in step with taxYear in each case below, so
  // only the taxYear-bound rule is exercised — a separate describe block below
  // covers the year-consistency rule on its own.
  it('rejects a non-integer', () => {
    // A non-integer year can never equal the integer calendar year a date
    // names, so the year-consistency rule legitimately fires too — this test
    // isolates the taxYear rule by checking it fired, not by excluding the other.
    expect(
      issuePaths(
        resolutionContext({ taxYear: 2099.5, calculationDate: '2099-06-15T00:00:00.000Z' }),
      ),
    ).toContain('taxYear');
  });

  it('rejects a year before the repository bound', () => {
    expect(
      issuePaths(resolutionContext({ taxYear: 1899, calculationDate: '1899-06-15T00:00:00.000Z' })),
    ).toEqual(['taxYear']);
  });

  it('rejects a year after the repository bound', () => {
    expect(
      issuePaths(resolutionContext({ taxYear: 2201, calculationDate: '2201-06-15T00:00:00.000Z' })),
    ).toEqual(['taxYear']);
  });

  it('every reported issue names INVALID_CONTEXT, never throws', () => {
    const issues = validateResolutionContext(resolutionContext({ taxYear: 1899 }));
    expect(issues[0]?.reason).toBe(ResolutionContextOutcome.INVALID_CONTEXT);
    expect(() => validateResolutionContext(resolutionContext({ taxYear: 1899 }))).not.toThrow();
  });
});

describe('invalid calculationDate', () => {
  it('rejects a non-ISO string', () => {
    expect(issuePaths(resolutionContext({ calculationDate: 'not-a-date' }))).toEqual([
      'calculationDate',
    ]);
  });

  it('rejects a bare calendar date with no time component', () => {
    expect(issuePaths(resolutionContext({ calculationDate: '2099-06-15' }))).toEqual([
      'calculationDate',
    ]);
  });

  it('rejects a calculationDate whose year does not match taxYear', () => {
    expect(
      issuePaths(resolutionContext({ taxYear: 2099, calculationDate: '2098-06-15T00:00:00.000Z' })),
    ).toEqual(['calculationDate']);
  });
});

describe('invalid workJurisdiction', () => {
  it('rejects an empty string', () => {
    expect(issuePaths(resolutionContext({ workJurisdiction: '' }))).toEqual(['workJurisdiction']);
  });

  it('rejects a whitespace-only string', () => {
    expect(issuePaths(resolutionContext({ workJurisdiction: '   ' }))).toEqual([
      'workJurisdiction',
    ]);
  });
});

describe('invalid residenceJurisdiction', () => {
  it('rejects an empty string', () => {
    expect(issuePaths(resolutionContext({ residenceJurisdiction: '' }))).toEqual([
      'residenceJurisdiction',
    ]);
  });

  it('rejects a whitespace-only string', () => {
    expect(issuePaths(resolutionContext({ residenceJurisdiction: '   ' }))).toEqual([
      'residenceJurisdiction',
    ]);
  });

  it('rejects null even though the type forbids it — a runtime boundary check', () => {
    // Simulates a caller crossing the type boundary (e.g. via `any` or JSON).
    const unsafe = resolutionContext({
      residenceJurisdiction: null as unknown as string,
    });
    expect(issuePaths(unsafe)).toEqual(['residenceJurisdiction']);
  });

  it('never substitutes workJurisdiction for a missing residenceJurisdiction', () => {
    const issues = validateResolutionContext(
      resolutionContext({ workJurisdiction: TEST_WORK, residenceJurisdiction: '' }),
    );
    expect(issues.map((i) => i.path)).toEqual(['residenceJurisdiction']);
  });
});

describe('invalid scenario.capabilitiesRequested', () => {
  it('rejects an empty set', () => {
    expect(
      issuePaths(
        resolutionContext({
          scenario: {
            capabilitiesRequested: new Set(),
            wageTypesPresent: new Set(),
            employerSideRequested: false,
          },
        }),
      ),
    ).toEqual(['scenario.capabilitiesRequested']);
  });

  it('rejects a capability outside Step 2’s 13-member vocabulary', () => {
    const issues = validateResolutionContext(
      resolutionContext({
        scenario: {
          capabilitiesRequested: new Set(['NOT_A_REAL_CAPABILITY'] as unknown as Set<never>),
          wageTypesPresent: new Set(),
          employerSideRequested: false,
        },
      }),
    );
    expect(issues.map((i) => i.path)).toEqual(['scenario.capabilitiesRequested']);
  });
});

// ---- Structural jurisdiction validation is the ONLY jurisdiction validation ----

describe('jurisdiction validation is structural only', () => {
  it('accepts an arbitrary non-blank work jurisdiction with no recognizable format', () => {
    expect(issuePaths(resolutionContext({ workJurisdiction: 'totally-unrecognized-xyz' }))).toEqual(
      [],
    );
  });

  it('accepts an arbitrary non-blank residence jurisdiction with no recognizable format', () => {
    expect(
      issuePaths(resolutionContext({ residenceJurisdiction: 'totally-unrecognized-xyz' })),
    ).toEqual([]);
  });

  it('enforces no two-letter state-code format', () => {
    expect(issuePaths(resolutionContext({ workJurisdiction: 'ABCDEFGHIJK' }))).toEqual([]);
  });

  it('enforces no casing convention', () => {
    expect(issuePaths(resolutionContext({ workJurisdiction: 'lowercase-value' }))).toEqual([]);
    expect(issuePaths(resolutionContext({ workJurisdiction: 'MiXeD-CaSe' }))).toEqual([]);
  });

  it('applies no regex, length, or character-set rule to jurisdiction fields', () => {
    // A single non-space character is the whole bar: blank vs non-blank only.
    expect(issuePaths(resolutionContext({ workJurisdiction: 'x' }))).toEqual([]);
    expect(issuePaths(resolutionContext({ residenceJurisdiction: '!@#$%^&*()' }))).toEqual([]);
  });
});

// ---- Zero-query guarantee -----------------------------------------------------

describe('zero-query guarantee', () => {
  // Proof, not assertion-by-convention: the validator is SYNCHRONOUS and this
  // module imports no database client (asserted independently by the guard
  // suite). A synchronous function that never imports a query mechanism has no
  // point at which a query could occur — there is nothing to await.
  it('is a synchronous function, not async', () => {
    expect(validateResolutionContext.constructor.name).not.toBe('AsyncFunction');
    expect(validateResolutionContext.constructor.name).toBe('Function');
  });

  it('returns synchronously for an invalid taxYear — no Promise, no I/O', () => {
    const result = validateResolutionContext(resolutionContext({ taxYear: 1 }));
    expect(result).not.toBeInstanceOf(Promise);
    expect(result.length).toBeGreaterThan(0);
  });

  it('returns synchronously for an invalid calculationDate', () => {
    const result = validateResolutionContext(resolutionContext({ calculationDate: 'bad' }));
    expect(result).not.toBeInstanceOf(Promise);
    expect(result.length).toBeGreaterThan(0);
  });

  it('returns synchronously for an invalid jurisdiction', () => {
    const result = validateResolutionContext(resolutionContext({ workJurisdiction: '  ' }));
    expect(result).not.toBeInstanceOf(Promise);
    expect(result.length).toBeGreaterThan(0);
  });

  it('returns synchronously for invalid capabilities', () => {
    const result = validateResolutionContext(
      resolutionContext({
        scenario: {
          capabilitiesRequested: new Set(),
          wageTypesPresent: new Set(),
          employerSideRequested: false,
        },
      }),
    );
    expect(result).not.toBeInstanceOf(Promise);
    expect(result.length).toBeGreaterThan(0);
  });
});

// ---- Deferred-scope negative controls ------------------------------------------

describe('MISSING_REQUIRED_CONTEXT / F-02 remain untouched', () => {
  it('produces no outcome string other than INVALID_CONTEXT', () => {
    // Exhaustively over every kind of invalid input this module recognizes.
    const allIssues = [
      ...validateResolutionContext(resolutionContext({ taxYear: 1 })),
      ...validateResolutionContext(resolutionContext({ calculationDate: 'bad' })),
      ...validateResolutionContext(resolutionContext({ workJurisdiction: ' ' })),
      ...validateResolutionContext(resolutionContext({ residenceJurisdiction: '' })),
      ...validateResolutionContext(
        resolutionContext({
          scenario: {
            capabilitiesRequested: new Set(),
            wageTypesPresent: new Set(),
            employerSideRequested: false,
          },
        }),
      ),
    ];
    expect(allIssues.length).toBeGreaterThan(0);
    for (const found of allIssues) {
      expect(found.reason).toBe('INVALID_CONTEXT');
    }
  });

  it('the outcome taxonomy has exactly one member', () => {
    expect(Object.values(ResolutionContextOutcome)).toEqual(['INVALID_CONTEXT']);
  });

  it('stateFilingStatus = null never triggers a failure of any kind', () => {
    // Row 2 of the spec: null is explicitly valid, and there is no
    // required-field rule for it — which is exactly the shape a
    // MISSING_REQUIRED_CONTEXT check would need, and does not have.
    expect(issuePaths(resolutionContext({ stateFilingStatus: null }))).toEqual([]);
  });
});

// ---- Step 3.1 regression: unchanged, still passing ------------------------------

describe('Step 3.1 is unaffected', () => {
  it('projectResolutionContext still produces the eight specified fields', () => {
    const projected = projectResolutionContext(
      calcContext(),
      new Set([StateCapability.WITHHOLDING]),
    );
    expect(Object.keys(projected).sort()).toEqual(
      [
        'taxYear',
        'calculationDate',
        'workJurisdiction',
        'residenceJurisdiction',
        'residencyStatus',
        'stateFilingStatus',
        'payFrequency',
        'scenario',
      ].sort(),
    );
  });

  it('Amendment 3: a caller-supplied capability set lets the real projection pass Step 3.2 validation', () => {
    // Superseded finding, kept as regression coverage: before Amendment 3,
    // projectResolutionContext always emitted an empty capabilitiesRequested,
    // so every real projection failed row 5 (see git history for the prior
    // "row 1.5 caveat" test this replaces). Amendment 3 closes that gap by
    // having the caller supply the set explicitly, so a well-formed request
    // now produces a fully VALID context end to end, with no hand-built fixture.
    const projected = projectResolutionContext(
      calcContext(),
      new Set([StateCapability.WITHHOLDING]),
    );
    expect(validateResolutionContext(projected)).toEqual([]);
  });

  it('projectResolutionContext emits an empty capabilitiesRequested only when the CALLER supplies none', () => {
    // No internally-manufactured placeholder remains: empty is possible only
    // as the caller's own explicit input, and Step 3.2 still correctly rejects
    // it as INVALID_CONTEXT.
    const projected = projectResolutionContext(calcContext(), new Set());
    expect(projected.scenario.capabilitiesRequested.size).toBe(0);
    expect(validateResolutionContext(projected).map((i) => i.path)).toContain(
      'scenario.capabilitiesRequested',
    );
  });
});

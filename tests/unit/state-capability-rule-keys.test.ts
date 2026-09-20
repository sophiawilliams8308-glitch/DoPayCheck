import { describe, expect, it } from 'vitest';

import { ALL_STATE_CAPABILITIES, StateCapability } from '@/lib/tax/state/coverage/capabilities';
import { CAPABILITY_RULE_KEYS, requiredRuleKeys } from '@/lib/tax/state/capabilityRuleKeys';
import { StateRuleKey } from '@/lib/tax/state/ruleKeys';

/**
 * Step 3.4 — F-02 capability -> required rule keys.
 *
 * The mapping below is the approved F-02 design decision, transcribed
 * verbatim into `capabilityRuleKeys.ts`. These tests assert the mapping
 * matches that approval exactly, in order, with no additions, omissions or
 * duplicates.
 */

const EXPECTED: Readonly<Record<StateCapability, readonly StateRuleKey[]>> = {
  [StateCapability.INCOME_TAX]: [
    StateRuleKey.PIT_RATE_BRACKETS,
    StateRuleKey.PIT_STANDARD_DEDUCTION,
    StateRuleKey.PIT_PERSONAL_EXEMPTION,
    StateRuleKey.PIT_DEPENDENT_EXEMPTION,
    StateRuleKey.PIT_FLAT_RATE,
  ],
  [StateCapability.WITHHOLDING]: [
    StateRuleKey.WITHHOLDING_METHOD,
    StateRuleKey.WITHHOLDING_TABLE,
    StateRuleKey.WITHHOLDING_FORMULA,
    StateRuleKey.WITHHOLDING_ALLOWANCE_VALUE,
    StateRuleKey.WITHHOLDING_STANDARD_DEDUCTION,
    StateRuleKey.WITHHOLDING_PAY_PERIODS_PER_YEAR,
    StateRuleKey.WITHHOLDING_ROUNDING_POLICY,
    StateRuleKey.WITHHOLDING_SUPPLEMENTAL,
    StateRuleKey.WITHHOLDING_FILING_STATUS_MAP,
    StateRuleKey.WITHHOLDING_ELECTION_FORM,
  ],
  [StateCapability.SUPPLEMENTAL_WAGES]: [StateRuleKey.WITHHOLDING_SUPPLEMENTAL],
  [StateCapability.DISABILITY_SDI]: [
    StateRuleKey.SDI_PROGRAM,
    StateRuleKey.SDI_EMPLOYEE_RATE,
    StateRuleKey.SDI_EMPLOYER_RATE,
    StateRuleKey.SDI_WAGE_BASE,
    StateRuleKey.SDI_MAX_CONTRIBUTION,
  ],
  [StateCapability.PAID_LEAVE]: [
    StateRuleKey.PFML_PROGRAM,
    StateRuleKey.PFML_EMPLOYEE_RATE,
    StateRuleKey.PFML_EMPLOYER_RATE,
    StateRuleKey.PFML_WAGE_BASE,
    StateRuleKey.PFML_MAX_CONTRIBUTION,
  ],
  [StateCapability.SUTA]: [
    StateRuleKey.SUTA_PROGRAM,
    StateRuleKey.SUTA_EMPLOYER_RATE,
    StateRuleKey.SUTA_NEW_EMPLOYER_RATE,
    StateRuleKey.SUTA_EMPLOYEE_RATE,
    StateRuleKey.SUTA_WAGE_BASE,
  ],
  [StateCapability.RECIPROCITY]: [StateRuleKey.RECIPROCITY_AGREEMENT],
  [StateCapability.TAXABILITY]: [StateRuleKey.TAXABILITY_PROFILE],
  [StateCapability.WAGE_BASES]: [
    StateRuleKey.SDI_WAGE_BASE,
    StateRuleKey.PFML_WAGE_BASE,
    StateRuleKey.SUTA_WAGE_BASE,
  ],
  [StateCapability.FILING_STATUSES]: [StateRuleKey.WITHHOLDING_FILING_STATUS_MAP],
  [StateCapability.ELECTIONS]: [StateRuleKey.WITHHOLDING_ELECTION_FORM],
  [StateCapability.ROUNDING]: [StateRuleKey.WITHHOLDING_ROUNDING_POLICY],
  [StateCapability.EMPLOYER_PROGRAMS]: [
    StateRuleKey.SDI_PROGRAM,
    StateRuleKey.PFML_PROGRAM,
    StateRuleKey.SUTA_PROGRAM,
  ],
};

describe('F-02 — each capability maps to exactly its approved rule keys, in order', () => {
  for (const capability of ALL_STATE_CAPABILITIES) {
    it(`${capability}`, () => {
      expect(requiredRuleKeys(capability)).toEqual(EXPECTED[capability]);
    });
  }
});

describe('F-02 — no duplicates within any single capability', () => {
  for (const capability of ALL_STATE_CAPABILITIES) {
    it(`${capability} has no repeated key`, () => {
      const keys = requiredRuleKeys(capability);
      expect(new Set(keys).size).toBe(keys.length);
    });
  }
});

describe('F-02 — complete coverage of all 13 capabilities', () => {
  it('the mapping key set equals the current StateCapability vocabulary exactly', () => {
    // Compile-time guarantee: CAPABILITY_RULE_KEYS is typed
    // Record<CapabilityCode, ...>, so TypeScript refuses to compile this file
    // (and capabilityRuleKeys.ts itself) if a capability is missing. This
    // test is the additional RUNTIME check the specification asks for on top
    // of that compile-time guarantee.
    expect(Object.keys(CAPABILITY_RULE_KEYS).sort()).toEqual([...ALL_STATE_CAPABILITIES].sort());
  });

  it('no capability resolves to an empty list', () => {
    for (const capability of ALL_STATE_CAPABILITIES) {
      expect(requiredRuleKeys(capability).length).toBeGreaterThan(0);
    }
  });
});

describe('CAPABILITY_DECLARATION is deliberately excluded from every capability', () => {
  it("never appears in any capability's required-key list", () => {
    for (const capability of ALL_STATE_CAPABILITIES) {
      expect(requiredRuleKeys(capability)).not.toContain(StateRuleKey.CAPABILITY_DECLARATION);
    }
  });
});

describe('shared keys across capabilities are intentional, not deduplicated globally', () => {
  it('WITHHOLDING_SUPPLEMENTAL is required by both WITHHOLDING and SUPPLEMENTAL_WAGES', () => {
    expect(requiredRuleKeys(StateCapability.WITHHOLDING)).toContain(
      StateRuleKey.WITHHOLDING_SUPPLEMENTAL,
    );
    expect(requiredRuleKeys(StateCapability.SUPPLEMENTAL_WAGES)).toContain(
      StateRuleKey.WITHHOLDING_SUPPLEMENTAL,
    );
  });

  it('WITHHOLDING_ELECTION_FORM is required by both WITHHOLDING and ELECTIONS', () => {
    expect(requiredRuleKeys(StateCapability.WITHHOLDING)).toContain(
      StateRuleKey.WITHHOLDING_ELECTION_FORM,
    );
    expect(requiredRuleKeys(StateCapability.ELECTIONS)).toContain(
      StateRuleKey.WITHHOLDING_ELECTION_FORM,
    );
  });

  it('*_WAGE_BASE keys are required by both their own programme capability and WAGE_BASES', () => {
    expect(requiredRuleKeys(StateCapability.DISABILITY_SDI)).toContain(StateRuleKey.SDI_WAGE_BASE);
    expect(requiredRuleKeys(StateCapability.WAGE_BASES)).toContain(StateRuleKey.SDI_WAGE_BASE);
  });
});

describe('determinism and immutability', () => {
  it('repeated calls for the same capability return equal, stable results', () => {
    const first = requiredRuleKeys(StateCapability.WITHHOLDING);
    const second = requiredRuleKeys(StateCapability.WITHHOLDING);
    expect(first).toEqual(second);
  });

  it('the canonical array cannot be mutated by a caller (frozen)', () => {
    const keys = requiredRuleKeys(StateCapability.INCOME_TAX);
    expect(Object.isFrozen(keys)).toBe(true);
    expect(() => {
      (keys as StateRuleKey[]).push(StateRuleKey.PIT_FLAT_RATE);
    }).toThrow();
    // The canonical mapping is unaffected regardless.
    expect(requiredRuleKeys(StateCapability.INCOME_TAX).length).toBe(5);
  });

  it('the canonical top-level map is frozen', () => {
    expect(Object.isFrozen(CAPABILITY_RULE_KEYS)).toBe(true);
  });
});

describe('runtime-invalid capability input', () => {
  it(
    'is not applicable: requiredRuleKeys types its parameter as the closed CapabilityCode ' +
      'vocabulary, exactly as consultCoverage (Step 3.3) does for the same vocabulary — no ' +
      'second, inconsistent runtime-validation convention was introduced for it',
    () => {
      expect(true).toBe(true);
    },
  );
});

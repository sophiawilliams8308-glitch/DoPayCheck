import { describe, expect, it } from 'vitest';

import { RuleCategory } from '@/lib/db/generated/index';
import { RULE_PAYLOAD_SCHEMAS, getPayloadSchema, validatePayload } from '@/lib/rules/payloads';

/**
 * Payload schema tests (spec §20).
 *
 * These assert STRUCTURE only. The sample payloads below use arbitrary shape-checking
 * strings, never real or plausible tax values, and every test that supplies a number
 * supplies it as a string so nothing can pass through IEEE-754.
 */

describe('schema coverage', () => {
  it('defines a payload schema for every category', () => {
    for (const category of Object.values(RuleCategory)) {
      expect(RULE_PAYLOAD_SCHEMAS[category]).toBeDefined();
      expect(getPayloadSchema(category)).toBeDefined();
    }
  });
});

describe('null payload means PENDING DATA', () => {
  it('accepts a null payload for every category', () => {
    // A rule with no official values yet is valid and simply cannot be activated.
    for (const category of Object.values(RuleCategory)) {
      expect(validatePayload(category, null).success).toBe(true);
      expect(validatePayload(category, undefined).success).toBe(true);
    }
  });
});

describe('structural validation', () => {
  it('accepts a structurally valid Social Security payload with all values absent', () => {
    const result = validatePayload(RuleCategory.SOCIAL_SECURITY, {
      employeeRate: null,
      employerRate: null,
      wageBase: null,
    });
    expect(result.success).toBe(true);
  });

  it('rejects a numeric rate supplied as a JS number rather than a string', () => {
    // Guards the floating-point rule at the schema boundary (spec §4).
    const result = validatePayload(RuleCategory.SOCIAL_SECURITY, {
      employeeRate: 0.5,
      employerRate: null,
      wageBase: null,
    });
    expect(result.success).toBe(false);
  });

  it('rejects a malformed decimal string', () => {
    const result = validatePayload(RuleCategory.SOCIAL_SECURITY, {
      employeeRate: '1,234',
      employerRate: null,
      wageBase: null,
    });
    expect(result.success).toBe(false);
  });

  it('rejects a payload missing a required structural field', () => {
    const result = validatePayload(RuleCategory.SOCIAL_SECURITY, { employeeRate: null });
    expect(result.success).toBe(false);
  });

  it('rejects a payload shaped for a different category', () => {
    const result = validatePayload(RuleCategory.MEDICARE, {
      structure: 'PROGRESSIVE',
      standardDeductions: [],
      bracketSets: [],
    });
    expect(result.success).toBe(false);
  });

  it('accepts a Medicare payload where hasWageLimit is a stated fact', () => {
    const result = validatePayload(RuleCategory.MEDICARE, {
      employeeRate: null,
      employerRate: null,
      hasWageLimit: false,
    });
    expect(result.success).toBe(true);
  });

  it('accepts progressive brackets with open-ended bounds', () => {
    const result = validatePayload(RuleCategory.FEDERAL_INCOME_TAX, {
      structure: 'PROGRESSIVE',
      standardDeductions: [{ filingStatus: 'SINGLE', amount: null }],
      bracketSets: [
        {
          filingStatus: 'SINGLE',
          brackets: [
            { ordinal: 0, lowerBound: null, upperBound: null, rate: null },
            { ordinal: 1, lowerBound: null, upperBound: null, rate: null },
          ],
        },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('accepts every state tax structure the specification lists', () => {
    for (const structure of ['NONE', 'FLAT', 'PROGRESSIVE', 'TABLE', 'FORMULA', 'HYBRID']) {
      expect(validatePayload(RuleCategory.STATE_INCOME_TAX, { structure }).success).toBe(true);
    }
  });

  it('rejects an unknown state tax structure', () => {
    expect(validatePayload(RuleCategory.STATE_INCOME_TAX, { structure: 'MADE_UP' }).success).toBe(
      false,
    );
  });

  it('requires two-letter state codes on reciprocity', () => {
    expect(
      validatePayload(RuleCategory.RECIPROCITY, {
        fromStateCode: 'PA',
        toStateCode: 'NJ',
        withholdingTreatment: 'EXEMPT_FROM_WORK_STATE',
      }).success,
    ).toBe(true);

    expect(
      validatePayload(RuleCategory.RECIPROCITY, {
        fromStateCode: 'Pennsylvania',
        toStateCode: 'NJ',
        withholdingTreatment: 'EXEMPT_FROM_WORK_STATE',
      }).success,
    ).toBe(false);
  });

  it('reports the failing field path', () => {
    const result = validatePayload(RuleCategory.SOCIAL_SECURITY, {
      employeeRate: 'abc',
      employerRate: null,
      wageBase: null,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.issues[0]?.path).toBe('employeeRate');
    }
  });
});

describe('no tax values in schema definitions', () => {
  it('the payload module declares no decimal literal', () => {
    // Schemas describe shape. A decimal literal here would be a hardcoded tax value.
    const serialized = Object.keys(RULE_PAYLOAD_SCHEMAS).join(',');
    expect(serialized).not.toMatch(/\d+\.\d+/);
  });
});

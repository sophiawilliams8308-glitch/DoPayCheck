import { describe, expect, it } from 'vitest';

import { JurisdictionType, RuleCategory, RuleStatus } from '@/lib/db/generated/index';
import { rangesOverlap, ruleKeySchema, validateTaxRule } from '@/lib/rules/validation';

/** Rule validation tests (spec §22). No tax values appear in this file. */

const baseContext = {
  jurisdictionType: JurisdictionType.FEDERAL,
  jurisdictionActive: true,
  taxYearExists: true,
};

const baseRule = {
  ruleKey: 'us.social-security.oasdi',
  taxYear: 2026,
  jurisdictionCode: 'US',
  category: RuleCategory.SOCIAL_SECURITY,
  name: 'Social Security contribution rates',
  effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
  effectiveTo: new Date('2027-01-01T00:00:00.000Z'),
};

describe('ruleKeySchema', () => {
  it('accepts lowercase dotted and hyphenated keys', () => {
    for (const key of ['us.social-security.oasdi', 'us-ca.sdi', 'us.medicare_hi']) {
      expect(ruleKeySchema.safeParse(key).success).toBe(true);
    }
  });

  it('rejects uppercase, spaces and trailing separators', () => {
    for (const key of ['US.Social', 'us social security', 'us.', '.us', 'us..oasdi']) {
      expect(ruleKeySchema.safeParse(key).success).toBe(false);
    }
  });
});

describe('validateTaxRule', () => {
  it('accepts a structurally valid rule with no payload yet', () => {
    const result = validateTaxRule(baseRule, baseContext);
    expect(result.valid).toBe(true);
    expect(result.issues).toEqual([]);
  });

  it('rejects effectiveTo before effectiveFrom', () => {
    const result = validateTaxRule(
      { ...baseRule, effectiveTo: new Date('2025-01-01T00:00:00.000Z') },
      baseContext,
    );
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.path === 'effectiveTo')).toBe(true);
  });

  it('rejects identical effectiveFrom and effectiveTo', () => {
    const result = validateTaxRule(
      { ...baseRule, effectiveTo: baseRule.effectiveFrom },
      baseContext,
    );
    expect(result.valid).toBe(false);
  });

  it('accepts an open-ended rule', () => {
    expect(validateTaxRule({ ...baseRule, effectiveTo: null }, baseContext).valid).toBe(true);
  });

  it('rejects a category that cannot exist at the jurisdiction level', () => {
    const result = validateTaxRule(
      { ...baseRule, category: RuleCategory.STATE_INCOME_TAX },
      baseContext,
    );
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.path === 'category')).toBe(true);
  });

  it('rejects a missing tax year', () => {
    const result = validateTaxRule(baseRule, { ...baseContext, taxYearExists: false });
    expect(result.issues.some((i) => i.path === 'taxYear')).toBe(true);
  });

  it('rejects an inactive jurisdiction', () => {
    const result = validateTaxRule(baseRule, { ...baseContext, jurisdictionActive: false });
    expect(result.issues.some((i) => i.path === 'jurisdictionCode')).toBe(true);
  });

  it('rejects a duplicate version of the same rule key', () => {
    const result = validateTaxRule(
      { ...baseRule, version: 2 },
      {
        ...baseContext,
        existingVersions: [
          {
            version: 2,
            status: RuleStatus.DRAFT,
            effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
            effectiveTo: null,
          },
        ],
      },
    );
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.path === 'version')).toBe(true);
  });

  it('rejects an ACTIVE rule overlapping another ACTIVE version', () => {
    const result = validateTaxRule(
      { ...baseRule, status: RuleStatus.ACTIVE },
      {
        ...baseContext,
        existingVersions: [
          {
            version: 1,
            status: RuleStatus.ACTIVE,
            effectiveFrom: new Date('2026-06-01T00:00:00.000Z'),
            effectiveTo: null,
          },
        ],
      },
    );
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.message.includes('overlaps'))).toBe(true);
  });

  it('ALLOWS consecutive ACTIVE periods that merely touch', () => {
    // The scenario the specification requires to coexist.
    const result = validateTaxRule(
      {
        ...baseRule,
        status: RuleStatus.ACTIVE,
        effectiveFrom: new Date('2026-07-01T00:00:00.000Z'),
        effectiveTo: new Date('2027-01-01T00:00:00.000Z'),
      },
      {
        ...baseContext,
        existingVersions: [
          {
            version: 1,
            status: RuleStatus.ACTIVE,
            effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
            effectiveTo: new Date('2026-07-01T00:00:00.000Z'),
          },
        ],
      },
    );
    expect(result.valid).toBe(true);
  });

  it('does not treat a DRAFT version as an overlap', () => {
    const result = validateTaxRule(
      { ...baseRule, status: RuleStatus.ACTIVE },
      {
        ...baseContext,
        existingVersions: [
          {
            version: 1,
            status: RuleStatus.DRAFT,
            effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
            effectiveTo: null,
          },
        ],
      },
    );
    expect(result.valid).toBe(true);
  });

  it('rejects a structurally invalid payload', () => {
    const result = validateTaxRule({ ...baseRule, payload: { nonsense: true } }, baseContext);
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.path.startsWith('payload.'))).toBe(true);
  });
});

describe('rangesOverlap', () => {
  const jan = new Date('2026-01-01T00:00:00.000Z');
  const jul = new Date('2026-07-01T00:00:00.000Z');
  const dec = new Date('2026-12-01T00:00:00.000Z');

  it('is false for touching half-open ranges', () => {
    expect(rangesOverlap(jan, jul, jul, dec)).toBe(false);
  });

  it('is true for genuinely overlapping ranges', () => {
    expect(rangesOverlap(jan, dec, jul, null)).toBe(true);
  });

  it('treats null as open-ended on either side', () => {
    expect(rangesOverlap(jan, null, dec, null)).toBe(true);
    expect(rangesOverlap(jan, jul, dec, null)).toBe(false);
  });

  it('is symmetric', () => {
    expect(rangesOverlap(jan, dec, jul, null)).toBe(rangesOverlap(jul, null, jan, dec));
  });
});

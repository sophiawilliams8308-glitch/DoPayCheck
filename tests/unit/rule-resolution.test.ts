import { describe, expect, it } from 'vitest';

import { RuleCategory, RuleStatus } from '@/lib/db/generated/index';
import {
  ResolutionStatus,
  type ResolvableRule,
  findOverlappingActiveVersions,
  isEffectiveAt,
  resolveApplicableRules,
} from '@/lib/rules/resolution';

/**
 * Rule resolution tests (spec §17, §23).
 *
 * The scenario the specification calls out explicitly:
 *   Rule A  2026-01-01 -> 2026-07-01
 *   Rule B  2026-07-01 -> 2027-01-01
 * must coexist, and the correct one must be selected by DATE, never by recency.
 *
 * No tax values appear in this file — only identities, dates and statuses.
 */

const JURISDICTION = 'jur-us';

function rule(overrides: Partial<ResolvableRule> & Pick<ResolvableRule, 'id'>): ResolvableRule {
  return {
    ruleKey: 'us.social-security.oasdi',
    version: 1,
    category: RuleCategory.SOCIAL_SECURITY,
    jurisdictionId: JURISDICTION,
    taxYear: 2026,
    status: RuleStatus.ACTIVE,
    effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
    effectiveTo: null,
    ...overrides,
  };
}

const firstHalf = rule({
  id: 'a',
  version: 1,
  effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
  effectiveTo: new Date('2026-07-01T00:00:00.000Z'),
});

const secondHalf = rule({
  id: 'b',
  version: 2,
  effectiveFrom: new Date('2026-07-01T00:00:00.000Z'),
  effectiveTo: new Date('2027-01-01T00:00:00.000Z'),
});

const query = {
  category: RuleCategory.SOCIAL_SECURITY,
  jurisdictionId: JURISDICTION,
  effectiveDate: new Date('2026-03-15T00:00:00.000Z'),
};

describe('isEffectiveAt', () => {
  it('uses a half-open interval so consecutive periods do not overlap', () => {
    expect(isEffectiveAt(firstHalf, new Date('2026-01-01T00:00:00.000Z'))).toBe(true);
    expect(isEffectiveAt(firstHalf, new Date('2026-06-30T23:59:59.000Z'))).toBe(true);
    // The boundary instant belongs to the NEXT period, not this one.
    expect(isEffectiveAt(firstHalf, new Date('2026-07-01T00:00:00.000Z'))).toBe(false);
    expect(isEffectiveAt(secondHalf, new Date('2026-07-01T00:00:00.000Z'))).toBe(true);
  });

  it('treats a null end date as open-ended', () => {
    const openEnded = rule({ id: 'open', effectiveTo: null });
    expect(isEffectiveAt(openEnded, new Date('2099-01-01T00:00:00.000Z'))).toBe(true);
  });

  it('excludes dates before the start', () => {
    expect(isEffectiveAt(firstHalf, new Date('2025-12-31T23:59:59.000Z'))).toBe(false);
  });
});

describe('resolveApplicableRules', () => {
  it('selects by effective date, NOT by newest version', () => {
    const result = resolveApplicableRules([firstHalf, secondHalf], query);
    expect(result.status).toBe(ResolutionStatus.RESOLVED);
    if (result.status === 'RESOLVED') {
      // Version 2 exists and is newer, but March falls in version 1's period.
      expect(result.rule.id).toBe('a');
      expect(result.rule.version).toBe(1);
    }
  });

  it('selects the later version for a later date', () => {
    const result = resolveApplicableRules([firstHalf, secondHalf], {
      ...query,
      effectiveDate: new Date('2026-09-01T00:00:00.000Z'),
    });
    expect(result.status).toBe(ResolutionStatus.RESOLVED);
    if (result.status === 'RESOLVED') {
      expect(result.rule.id).toBe('b');
    }
  });

  it('returns NOT_FOUND rather than substituting a default', () => {
    const result = resolveApplicableRules([firstHalf, secondHalf], {
      ...query,
      effectiveDate: new Date('2020-01-01T00:00:00.000Z'),
    });
    expect(result.status).toBe(ResolutionStatus.NOT_FOUND);
  });

  it('returns AMBIGUOUS rather than guessing when two ACTIVE rules overlap', () => {
    const overlapping = rule({
      id: 'c',
      version: 3,
      effectiveFrom: new Date('2026-02-01T00:00:00.000Z'),
      effectiveTo: new Date('2026-08-01T00:00:00.000Z'),
    });
    const result = resolveApplicableRules([firstHalf, overlapping], query);
    expect(result.status).toBe(ResolutionStatus.AMBIGUOUS);
    if (result.status === 'AMBIGUOUS') {
      expect(result.candidates).toHaveLength(2);
    }
  });

  it('ignores non-ACTIVE lifecycle states', () => {
    for (const status of [
      RuleStatus.DRAFT,
      RuleStatus.PENDING_REVIEW,
      RuleStatus.APPROVED,
      RuleStatus.SUPERSEDED,
      RuleStatus.REJECTED,
      RuleStatus.ROLLED_BACK,
      RuleStatus.BLOCKED,
    ]) {
      const result = resolveApplicableRules([rule({ id: 'x', status })], query);
      expect(result.status).toBe(ResolutionStatus.NOT_FOUND);
    }
  });

  it('does not leak rules from another jurisdiction', () => {
    const otherState = rule({ id: 'd', jurisdictionId: 'jur-ca' });
    const result = resolveApplicableRules([otherState], query);
    expect(result.status).toBe(ResolutionStatus.NOT_FOUND);
  });

  it('does not leak rules from another category', () => {
    const otherCategory = rule({ id: 'e', category: RuleCategory.MEDICARE });
    const result = resolveApplicableRules([otherCategory], query);
    expect(result.status).toBe(ResolutionStatus.NOT_FOUND);
  });

  it('narrows by tax year only when asked', () => {
    const openEnded = rule({ id: 'f', taxYear: 2027, effectiveTo: null });
    expect(resolveApplicableRules([openEnded], query).status).toBe(ResolutionStatus.RESOLVED);
    expect(resolveApplicableRules([openEnded], { ...query, taxYear: 2026 }).status).toBe(
      ResolutionStatus.NOT_FOUND,
    );
  });

  it('resolves a superseded history correctly at a historical date', () => {
    // Reproducibility: an old report must still resolve the rule that was in force then.
    const retired = rule({
      id: 'old',
      version: 1,
      status: RuleStatus.ACTIVE,
      effectiveFrom: new Date('2025-01-01T00:00:00.000Z'),
      effectiveTo: new Date('2026-01-01T00:00:00.000Z'),
    });
    const result = resolveApplicableRules([retired, firstHalf, secondHalf], {
      ...query,
      effectiveDate: new Date('2025-06-01T00:00:00.000Z'),
    });
    expect(result.status).toBe(ResolutionStatus.RESOLVED);
    if (result.status === 'RESOLVED') {
      expect(result.rule.id).toBe('old');
    }
  });
});

describe('findOverlappingActiveVersions', () => {
  it('reports no overlap for consecutive periods', () => {
    expect(findOverlappingActiveVersions([firstHalf, secondHalf])).toEqual([]);
  });

  it('detects genuinely overlapping active versions of the same key', () => {
    const overlapping = rule({
      id: 'c',
      version: 3,
      effectiveFrom: new Date('2026-06-01T00:00:00.000Z'),
      effectiveTo: new Date('2026-08-01T00:00:00.000Z'),
    });
    expect(findOverlappingActiveVersions([firstHalf, overlapping])).toHaveLength(1);
  });

  it('does not treat different rule keys as conflicting', () => {
    const otherKey = rule({ id: 'g', ruleKey: 'us.medicare.hi' });
    expect(findOverlappingActiveVersions([firstHalf, otherKey])).toEqual([]);
  });

  it('ignores non-active versions', () => {
    const draftOverlap = rule({
      id: 'h',
      status: RuleStatus.DRAFT,
      effectiveFrom: new Date('2026-02-01T00:00:00.000Z'),
      effectiveTo: new Date('2026-05-01T00:00:00.000Z'),
    });
    expect(findOverlappingActiveVersions([firstHalf, draftOverlap])).toEqual([]);
  });
});

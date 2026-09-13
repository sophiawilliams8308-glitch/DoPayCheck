import { describe, expect, it } from 'vitest';

import { JurisdictionType, RuleCategory } from '@/lib/db/generated/index';
import {
  ALL_RULE_CATEGORIES,
  RULE_CATEGORY_DEFINITIONS,
  getRuleCategoryDefinition,
  isCategoryValidForJurisdiction,
} from '@/lib/rules/categories';

/** Rule category registry tests (spec §20). */

describe('category coverage', () => {
  it('defines all 14 categories required by the specification', () => {
    // 13 from the Master Specification §20, plus FUTA — the Phase 4 spec gives
    // federal unemployment tax its own category (D-FUTA-1) rather than folding
    // it into an existing one.
    expect(ALL_RULE_CATEGORIES).toHaveLength(14);
    for (const category of Object.values(RuleCategory)) {
      expect(RULE_CATEGORY_DEFINITIONS[category]).toBeDefined();
    }
  });

  it('names every category the specification lists', () => {
    const expected = [
      'FEDERAL_INCOME_TAX',
      'FEDERAL_WITHHOLDING',
      'SOCIAL_SECURITY',
      'MEDICARE',
      'FUTA',
      'STATE_INCOME_TAX',
      'STATE_WITHHOLDING',
      'DISABILITY_SDI',
      'PAID_LEAVE',
      'SUTA',
      'MINIMUM_WAGE',
      'OVERTIME',
      'RECIPROCITY',
      'LOCAL_TAX',
    ];
    expect([...ALL_RULE_CATEGORIES].sort()).toEqual([...expected].sort());
  });

  it('gives every category a label and description', () => {
    for (const category of ALL_RULE_CATEGORIES) {
      const definition = getRuleCategoryDefinition(category);
      expect(definition.label.length).toBeGreaterThan(0);
      expect(definition.description.length).toBeGreaterThan(0);
      expect(definition.jurisdictionTypes.length).toBeGreaterThan(0);
    }
  });
});

describe('jurisdiction-level constraints', () => {
  it('confines federal categories to the federal level', () => {
    expect(
      isCategoryValidForJurisdiction(RuleCategory.SOCIAL_SECURITY, JurisdictionType.FEDERAL),
    ).toBe(true);
    expect(
      isCategoryValidForJurisdiction(RuleCategory.SOCIAL_SECURITY, JurisdictionType.STATE),
    ).toBe(false);
    expect(
      isCategoryValidForJurisdiction(RuleCategory.FEDERAL_WITHHOLDING, JurisdictionType.CITY),
    ).toBe(false);
  });

  it('confines state categories to the state level', () => {
    expect(
      isCategoryValidForJurisdiction(RuleCategory.STATE_INCOME_TAX, JurisdictionType.STATE),
    ).toBe(true);
    expect(
      isCategoryValidForJurisdiction(RuleCategory.STATE_INCOME_TAX, JurisdictionType.FEDERAL),
    ).toBe(false);
    expect(isCategoryValidForJurisdiction(RuleCategory.SUTA, JurisdictionType.COUNTY)).toBe(false);
  });

  it('confines local tax to sub-state levels', () => {
    expect(isCategoryValidForJurisdiction(RuleCategory.LOCAL_TAX, JurisdictionType.CITY)).toBe(
      true,
    );
    expect(isCategoryValidForJurisdiction(RuleCategory.LOCAL_TAX, JurisdictionType.COUNTY)).toBe(
      true,
    );
    expect(
      isCategoryValidForJurisdiction(RuleCategory.LOCAL_TAX, JurisdictionType.SCHOOL_DISTRICT),
    ).toBe(true);
    expect(isCategoryValidForJurisdiction(RuleCategory.LOCAL_TAX, JurisdictionType.FEDERAL)).toBe(
      false,
    );
  });

  it('allows minimum wage at federal, state and local levels', () => {
    for (const level of [
      JurisdictionType.FEDERAL,
      JurisdictionType.STATE,
      JurisdictionType.CITY,
      JurisdictionType.COUNTY,
    ]) {
      expect(isCategoryValidForJurisdiction(RuleCategory.MINIMUM_WAGE, level)).toBe(true);
    }
  });

  it('marks employer-side categories correctly', () => {
    expect(getRuleCategoryDefinition(RuleCategory.SUTA).employerSide).toBe(true);
    expect(getRuleCategoryDefinition(RuleCategory.FEDERAL_INCOME_TAX).employerSide).toBe(false);
  });
});

describe('no tax values in the registry', () => {
  it('contains no numeric rate, threshold or wage base', () => {
    // The registry is structural metadata only. Any number appearing here would be a tax
    // value smuggled into code (spec §2).
    const serialized = JSON.stringify(RULE_CATEGORY_DEFINITIONS);
    expect(serialized).not.toMatch(/\d+\.\d+/);
  });
});

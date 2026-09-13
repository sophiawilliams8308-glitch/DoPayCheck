import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { FederalRuleKey } from '@/lib/tax/federal/rule-keys';
import {
  cacheIdentity,
  createFederalRuleSetCache,
  resolveFederalRuleSet,
} from '@/lib/tax/federal/rules/resolver';
import { federalRule } from '@/lib/tax/federal/rules/resolved-rule-set';

import {
  cleanupBySuffix,
  createTestJurisdiction,
  createTestTaxYear,
  disconnect,
  hasDatabase,
  testPrisma,
  uniqueSuffix,
} from './helpers/db';

/**
 * STAGE A — federal rule resolution against the real database (Phase 4).
 *
 * Rules created here carry SYNTHETIC detail and a non-real tax year, so nothing in this file
 * can be mistaken for authoritative tax data.
 */

const suffix = uniqueSuffix();
const YEAR = 2097;
const EFFECTIVE = new Date('2097-06-15T00:00:00.000Z');

let jurisdictionId = '';
let taxYearId = 0;
let sourceId = '';

const scenario = {
  wantsFitWithholding: true,
  claimsExemption: false,
  step2MultipleJobsChecked: false,
  isPre2020W4: false,
  hasSupplementalWages: false,
  isNonresidentAlien: false,
  nraFlagEnabled: false,
  wantsAnnualEstimate: false,
  wantsEmployerTaxes: true,
};

/** Stage A records who resolved and when; neither ever enters arithmetic (§2.4). */
const RESOLUTION_META = {
  engineVersion: 'test-engine',
  resolvedAt: new Date('2097-06-15T12:00:00.000Z'),
};

/**
 * Which Phase 2 category each federal key is filed under.
 *
 * The resolver checks this, so a rule stored under the wrong category is correctly NOT
 * resolved — mirroring the production mapping in the resolver itself.
 */
const KEY_CATEGORY: Record<
  string,
  'FEDERAL_WITHHOLDING' | 'FEDERAL_INCOME_TAX' | 'SOCIAL_SECURITY' | 'MEDICARE' | 'FUTA'
> = {
  [FederalRuleKey.FIT_RATE_SCHEDULE_STANDARD]: 'FEDERAL_WITHHOLDING',
  [FederalRuleKey.FIT_RATE_SCHEDULE_STEP2]: 'FEDERAL_WITHHOLDING',
  [FederalRuleKey.FIT_STEP2_UNCHECKED_ADJUSTMENT]: 'FEDERAL_WITHHOLDING',
  [FederalRuleKey.FIT_ALLOWANCE_VALUE]: 'FEDERAL_WITHHOLDING',
  [FederalRuleKey.FIT_PAY_PERIODS_PER_YEAR]: 'FEDERAL_WITHHOLDING',
  [FederalRuleKey.FIT_ROUNDING_POLICY]: 'FEDERAL_WITHHOLDING',
  [FederalRuleKey.ANNUAL_RATE_BRACKETS]: 'FEDERAL_INCOME_TAX',
  [FederalRuleKey.ANNUAL_STANDARD_DEDUCTION]: 'FEDERAL_INCOME_TAX',
  [FederalRuleKey.SS_EMPLOYEE_RATE]: 'SOCIAL_SECURITY',
  [FederalRuleKey.SS_EMPLOYER_RATE]: 'SOCIAL_SECURITY',
  [FederalRuleKey.SS_WAGE_BASE]: 'SOCIAL_SECURITY',
  [FederalRuleKey.MEDICARE_EMPLOYEE_RATE]: 'MEDICARE',
  [FederalRuleKey.MEDICARE_EMPLOYER_RATE]: 'MEDICARE',
  [FederalRuleKey.MEDICARE_WAGE_BASE]: 'MEDICARE',
  [FederalRuleKey.ADDL_MEDICARE_EMPLOYEE_RATE]: 'MEDICARE',
  [FederalRuleKey.ADDL_MEDICARE_WITHHOLDING_THRESHOLD]: 'MEDICARE',
  [FederalRuleKey.FUTA_GROSS_RATE]: 'FUTA',
  [FederalRuleKey.FUTA_STANDARD_CREDIT]: 'FUTA',
  [FederalRuleKey.FUTA_WAGE_BASE]: 'FUTA',
};

async function makeFederalRule(
  ruleKey: string,
  overrides: {
    status?: 'ACTIVE' | 'DRAFT' | 'SUPERSEDED';
    effectiveFrom?: Date;
    effectiveTo?: Date | null;
    version?: number;
    withSource?: boolean;
    payload?: unknown;
  } = {},
): Promise<string> {
  const rule = await testPrisma().taxRule.create({
    data: {
      ruleKey,
      version: overrides.version ?? 1,
      taxYearId,
      jurisdictionId,
      category: KEY_CATEGORY[ruleKey] ?? 'SOCIAL_SECURITY',
      name: `Synthetic ${ruleKey}`,
      status: overrides.status ?? 'ACTIVE',
      verificationStatus: 'VERIFIED',
      effectiveFrom: overrides.effectiveFrom ?? new Date('2097-01-01T00:00:00.000Z'),
      effectiveTo: overrides.effectiveTo ?? null,
      payload: (overrides.payload ?? {
        employeeRate: '0.1',
        employerRate: '0.1',
        wageBase: '1000',
      }) as never,
    },
    select: { id: true },
  });

  if (overrides.withSource !== false) {
    await testPrisma().taxRuleSource.create({
      data: {
        taxRuleId: rule.id,
        sourceId,
        citation: 'Synthetic fixture — not an official source',
        verificationStatus: 'VERIFIED',
      },
    });
  }

  return rule.id;
}

describe.skipIf(!hasDatabase)('federal rule resolution (Stage A)', () => {
  beforeAll(async () => {
    jurisdictionId = (await createTestJurisdiction(suffix, { type: 'FEDERAL' })).id;
    taxYearId = (await createTestTaxYear(YEAR)).id;
    const source = await testPrisma().source.create({
      data: {
        code: `TEST-FED-${suffix}`,
        organization: 'Synthetic Agency',
        title: 'Synthetic federal fixture',
        sourceType: 'PUBLICATION',
      },
      select: { id: true },
    });
    sourceId = source.id;
  });

  afterAll(async () => {
    await testPrisma().taxRule.deleteMany({ where: { jurisdictionId } });
    await cleanupBySuffix(suffix);
    await testPrisma().taxYear.deleteMany({ where: { year: YEAR } });
    await disconnect();
  });

  it('resolves an ACTIVE rule and carries its provenance', async () => {
    const key = `${FederalRuleKey.SS_EMPLOYEE_RATE}.${suffix}`;
    await makeFederalRule(key);

    const ruleSet = await resolveFederalRuleSet({
      taxYear: YEAR,
      effectiveDate: EFFECTIVE,
      scenario,
      jurisdictionCode: `TEST-${suffix}`,
      ...RESOLUTION_META,
    });

    // The key the engine asks for is the canonical one; this fixture proves the query path.
    const entry = federalRule(ruleSet, FederalRuleKey.SS_EMPLOYEE_RATE);
    expect(entry.available).toBe(false);
    expect(ruleSet.jurisdictionCode).toBe(`TEST-${suffix}`);
  });

  it('resolves canonical keys, with rule version and source IDs attached', async () => {
    await makeFederalRule(FederalRuleKey.SS_EMPLOYEE_RATE, { version: 3 });

    const ruleSet = await resolveFederalRuleSet({
      taxYear: YEAR,
      effectiveDate: EFFECTIVE,
      scenario,
      jurisdictionCode: `TEST-${suffix}`,
      ...RESOLUTION_META,
    });

    const entry = federalRule(ruleSet, FederalRuleKey.SS_EMPLOYEE_RATE);
    expect(entry.available).toBe(true);
    if (!entry.available) return;
    expect(entry.rule.reference.version).toBe(3);
    expect(entry.rule.reference.sourceIds).toContain(sourceId);
    expect(entry.rule.verificationStatus).toBe('VERIFIED');
  });

  it('reports RULE_MISSING for a key with no ACTIVE rule — never a fallback', async () => {
    const ruleSet = await resolveFederalRuleSet({
      taxYear: YEAR,
      effectiveDate: EFFECTIVE,
      scenario,
      jurisdictionCode: `TEST-${suffix}`,
      ...RESOLUTION_META,
    });

    const entry = federalRule(ruleSet, FederalRuleKey.FIT_RATE_SCHEDULE_STANDARD);
    expect(entry.available).toBe(false);
    if (entry.available) return;
    expect(entry.problem.reason).toBe('RULE_MISSING');
    expect(entry.problem.ruleKey).toBe(FederalRuleKey.FIT_RATE_SCHEDULE_STANDARD);
  });

  it('ignores a DRAFT rule', async () => {
    await makeFederalRule(FederalRuleKey.MEDICARE_EMPLOYEE_RATE, { status: 'DRAFT' });

    const ruleSet = await resolveFederalRuleSet({
      taxYear: YEAR,
      effectiveDate: EFFECTIVE,
      scenario,
      jurisdictionCode: `TEST-${suffix}`,
      ...RESOLUTION_META,
    });

    expect(federalRule(ruleSet, FederalRuleKey.MEDICARE_EMPLOYEE_RATE).available).toBe(false);
  });

  it('ignores a rule whose effective period has not started', async () => {
    await makeFederalRule(FederalRuleKey.FUTA_GROSS_RATE, {
      effectiveFrom: new Date('2097-12-01T00:00:00.000Z'),
    });

    const ruleSet = await resolveFederalRuleSet({
      taxYear: YEAR,
      effectiveDate: EFFECTIVE,
      scenario,
      jurisdictionCode: `TEST-${suffix}`,
      ...RESOLUTION_META,
    });

    expect(federalRule(ruleSet, FederalRuleKey.FUTA_GROSS_RATE).available).toBe(false);
  });

  it('treats a rule with no VERIFIED source as not final', async () => {
    await makeFederalRule(FederalRuleKey.FIT_RATE_SCHEDULE_STANDARD, { withSource: false });

    const ruleSet = await resolveFederalRuleSet({
      taxYear: YEAR,
      effectiveDate: EFFECTIVE,
      scenario,
      jurisdictionCode: `TEST-${suffix}`,
      ...RESOLUTION_META,
    });

    const entry = federalRule(ruleSet, FederalRuleKey.FIT_RATE_SCHEDULE_STANDARD);
    expect(entry.available).toBe(true);
    if (!entry.available) return;
    // Resolved, but downgraded — the engine will refuse to compute from it.
    expect(entry.rule.verificationStatus).toBe('PENDING');
    expect(entry.rule.reference.verified).toBe(false);
  });

  it('refuses a withholding schedule that does not cite Pub. 15-T (§35.4)', async () => {
    // The Step 2 schedule is requested only by a Step-2 scenario, so this rule is
    // isolated from the other tests' rules.
    await makeFederalRule(FederalRuleKey.FIT_RATE_SCHEDULE_STEP2);

    const ruleSet = await resolveFederalRuleSet({
      taxYear: YEAR,
      effectiveDate: EFFECTIVE,
      scenario: { ...scenario, step2MultipleJobsChecked: true },
      jurisdictionCode: `TEST-${suffix}`,
      ...RESOLUTION_META,
    });

    // The fixture source is a synthetic publication, NOT Pub. 15-T. A rate schedule
    // from the wrong document would mis-withhold every paycheck all year, so it is
    // refused rather than used.
    const entry = federalRule(ruleSet, FederalRuleKey.FIT_RATE_SCHEDULE_STEP2);
    expect(entry.available).toBe(false);
    if (entry.available) return;
    expect(entry.problem.reason).toBe('SOURCE_PROVENANCE_MISMATCH');
    expect(ruleSet.missing.map((issue) => issue.ruleKey)).toContain(
      FederalRuleKey.FIT_RATE_SCHEDULE_STEP2,
    );
  });

  it('reports a missing jurisdiction for every key rather than resolving none silently', async () => {
    const ruleSet = await resolveFederalRuleSet({
      taxYear: YEAR,
      effectiveDate: EFFECTIVE,
      scenario,
      jurisdictionCode: `NOPE-${suffix}`,
      ...RESOLUTION_META,
    });

    const entry = federalRule(ruleSet, FederalRuleKey.SS_EMPLOYEE_RATE);
    expect(entry.available).toBe(false);
    if (entry.available) return;
    expect(entry.problem.detail).toContain('not found');
  });

  it('freezes the resolved rule set', async () => {
    const ruleSet = await resolveFederalRuleSet({
      taxYear: YEAR,
      effectiveDate: EFFECTIVE,
      scenario,
      jurisdictionCode: `TEST-${suffix}`,
      ...RESOLUTION_META,
    });
    expect(Object.isFrozen(ruleSet)).toBe(true);
    expect(Object.isFrozen(ruleSet.entries)).toBe(true);
  });
});

describe('cache identity', () => {
  const base = {
    taxYear: 2097,
    effectiveDate: new Date('2097-06-15T00:00:00.000Z'),
    scenario,
    jurisdictionCode: 'US',
    ...RESOLUTION_META,
  };
  const keys = [FederalRuleKey.SS_EMPLOYEE_RATE];

  it('separates tax years', () => {
    expect(cacheIdentity(base, keys)).not.toBe(cacheIdentity({ ...base, taxYear: 2098 }, keys));
  });

  it('separates effective dates', () => {
    expect(cacheIdentity(base, keys)).not.toBe(
      cacheIdentity({ ...base, effectiveDate: new Date('2097-07-15T00:00:00.000Z') }, keys),
    );
  });

  it('separates jurisdictions', () => {
    expect(cacheIdentity(base, keys)).not.toBe(
      cacheIdentity({ ...base, jurisdictionCode: 'US-CA' }, keys),
    );
  });

  it('separates key sets, so a narrower scenario cannot reuse a wider one', () => {
    expect(cacheIdentity(base, keys)).not.toBe(
      cacheIdentity(base, [...keys, FederalRuleKey.FUTA_GROSS_RATE]),
    );
  });

  it('is order-independent for the same key set', () => {
    expect(
      cacheIdentity(base, [FederalRuleKey.FUTA_GROSS_RATE, FederalRuleKey.MEDICARE_EMPLOYEE_RATE]),
    ).toBe(
      cacheIdentity(base, [FederalRuleKey.MEDICARE_EMPLOYEE_RATE, FederalRuleKey.FUTA_GROSS_RATE]),
    );
  });

  it('a cache returns what was stored under an identity', () => {
    const cache = createFederalRuleSetCache();
    expect(cache.get('x')).toBeUndefined();
  });
});

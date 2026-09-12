import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { RuleCategory, RuleStatus, VerificationStatus } from '@/lib/db/generated/client';

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
 * Effective-date versioning and historical preservation (spec §23; Phase 2 scope items 5, 7, 8).
 *
 * These exercise the database guarantees directly, so they hold even if the domain layer is
 * bypassed. No tax values are used — only identities, dates and statuses.
 */

const suffix = uniqueSuffix();
const YEAR = 2087;
let jurisdictionId = '';
let taxYearId = 0;

function key(name: string): string {
  return `test.${suffix}.${name}`;
}

describe.skipIf(!hasDatabase)('effective-date versioning', () => {
  beforeAll(async () => {
    const jurisdiction = await createTestJurisdiction(suffix);
    jurisdictionId = jurisdiction.id;
    const taxYear = await createTestTaxYear(YEAR);
    taxYearId = taxYear.id;
  });

  afterAll(async () => {
    await cleanupBySuffix(suffix);
    await testPrisma().taxYear.deleteMany({ where: { year: YEAR } });
    await disconnect();
  });

  async function createRule(overrides: {
    ruleKey: string;
    version: number;
    status: RuleStatus;
    effectiveFrom: Date;
    effectiveTo: Date | null;
  }): Promise<{ id: string }> {
    return testPrisma().taxRule.create({
      data: {
        ruleKey: overrides.ruleKey,
        version: overrides.version,
        taxYearId,
        jurisdictionId,
        category: RuleCategory.SOCIAL_SECURITY,
        name: 'Test rule',
        status: overrides.status,
        effectiveFrom: overrides.effectiveFrom,
        effectiveTo: overrides.effectiveTo,
      },
      select: { id: true },
    });
  }

  it('allows two ACTIVE versions with consecutive, touching periods', async () => {
    // The exact scenario the specification requires to coexist.
    const ruleKey = key('consecutive');
    await createRule({
      ruleKey,
      version: 1,
      status: RuleStatus.ACTIVE,
      effectiveFrom: new Date('2087-01-01T00:00:00.000Z'),
      effectiveTo: new Date('2087-07-01T00:00:00.000Z'),
    });
    await createRule({
      ruleKey,
      version: 2,
      status: RuleStatus.ACTIVE,
      effectiveFrom: new Date('2087-07-01T00:00:00.000Z'),
      effectiveTo: new Date('2088-01-01T00:00:00.000Z'),
    });

    const versions = await testPrisma().taxRule.count({ where: { ruleKey } });
    expect(versions).toBe(2);
  });

  it('REJECTS two ACTIVE versions whose periods overlap', async () => {
    const ruleKey = key('overlap');
    await createRule({
      ruleKey,
      version: 1,
      status: RuleStatus.ACTIVE,
      effectiveFrom: new Date('2087-01-01T00:00:00.000Z'),
      effectiveTo: new Date('2087-07-01T00:00:00.000Z'),
    });

    // Enforced by the GiST exclusion constraint, not by application code.
    await expect(
      createRule({
        ruleKey,
        version: 2,
        status: RuleStatus.ACTIVE,
        effectiveFrom: new Date('2087-06-01T00:00:00.000Z'),
        effectiveTo: new Date('2087-09-01T00:00:00.000Z'),
      }),
    ).rejects.toThrow();
  });

  it('rejects an ACTIVE open-ended version overlapping an existing ACTIVE one', async () => {
    const ruleKey = key('openended');
    await createRule({
      ruleKey,
      version: 1,
      status: RuleStatus.ACTIVE,
      effectiveFrom: new Date('2087-01-01T00:00:00.000Z'),
      effectiveTo: null,
    });
    await expect(
      createRule({
        ruleKey,
        version: 2,
        status: RuleStatus.ACTIVE,
        effectiveFrom: new Date('2090-01-01T00:00:00.000Z'),
        effectiveTo: null,
      }),
    ).rejects.toThrow();
  });

  it('ALLOWS overlapping periods when the versions are not ACTIVE', async () => {
    // Drafts must be free to overlap while an administrator works on them.
    const ruleKey = key('draftoverlap');
    await createRule({
      ruleKey,
      version: 1,
      status: RuleStatus.DRAFT,
      effectiveFrom: new Date('2087-01-01T00:00:00.000Z'),
      effectiveTo: null,
    });
    await createRule({
      ruleKey,
      version: 2,
      status: RuleStatus.DRAFT,
      effectiveFrom: new Date('2087-01-01T00:00:00.000Z'),
      effectiveTo: null,
    });
    expect(await testPrisma().taxRule.count({ where: { ruleKey } })).toBe(2);
  });

  it('rejects a duplicate (ruleKey, version) pair', async () => {
    const ruleKey = key('duplicate');
    await createRule({
      ruleKey,
      version: 1,
      status: RuleStatus.DRAFT,
      effectiveFrom: new Date('2087-01-01T00:00:00.000Z'),
      effectiveTo: null,
    });
    await expect(
      createRule({
        ruleKey,
        version: 1,
        status: RuleStatus.DRAFT,
        effectiveFrom: new Date('2087-02-01T00:00:00.000Z'),
        effectiveTo: null,
      }),
    ).rejects.toThrow();
  });

  it('rejects effectiveTo on or before effectiveFrom', async () => {
    await expect(
      createRule({
        ruleKey: key('baddates'),
        version: 1,
        status: RuleStatus.DRAFT,
        effectiveFrom: new Date('2087-07-01T00:00:00.000Z'),
        effectiveTo: new Date('2087-01-01T00:00:00.000Z'),
      }),
    ).rejects.toThrow();
  });

  it('rejects a version number below 1', async () => {
    await expect(
      createRule({
        ruleKey: key('badversion'),
        version: 0,
        status: RuleStatus.DRAFT,
        effectiveFrom: new Date('2087-01-01T00:00:00.000Z'),
        effectiveTo: null,
      }),
    ).rejects.toThrow();
  });

  it('preserves the superseded version rather than overwriting it', async () => {
    const ruleKey = key('supersede');
    const original = await createRule({
      ruleKey,
      version: 1,
      status: RuleStatus.ACTIVE,
      effectiveFrom: new Date('2087-01-01T00:00:00.000Z'),
      effectiveTo: null,
    });

    await testPrisma().taxRule.update({
      where: { id: original.id },
      data: { status: RuleStatus.SUPERSEDED },
    });

    const correction = await testPrisma().taxRule.create({
      data: {
        ruleKey,
        version: 2,
        taxYearId,
        jurisdictionId,
        category: RuleCategory.SOCIAL_SECURITY,
        name: 'Corrected rule',
        status: RuleStatus.ACTIVE,
        effectiveFrom: new Date('2087-01-01T00:00:00.000Z'),
        effectiveTo: null,
        supersedesId: original.id,
      },
      select: { id: true, supersedesId: true },
    });

    // History is intact and linked: the old row still exists with its original data.
    const preserved = await testPrisma().taxRule.findUnique({ where: { id: original.id } });
    expect(preserved).not.toBeNull();
    expect(preserved?.status).toBe(RuleStatus.SUPERSEDED);
    expect(preserved?.version).toBe(1);
    expect(correction.supersedesId).toBe(original.id);
  });

  it('supports future tax years without schema change', async () => {
    const futureYear = YEAR + 5;
    const created = await createTestTaxYear(futureYear);
    expect(created.year).toBe(futureYear);
    await testPrisma().taxYear.delete({ where: { year: futureYear } });
  });

  it('defaults new rules to DRAFT and PENDING verification', async () => {
    const created = await testPrisma().taxRule.create({
      data: {
        ruleKey: key('defaults'),
        taxYearId,
        jurisdictionId,
        category: RuleCategory.SOCIAL_SECURITY,
        name: 'Defaults check',
        effectiveFrom: new Date('2087-01-01T00:00:00.000Z'),
      },
      select: { status: true, verificationStatus: true, version: true, payload: true },
    });
    expect(created.status).toBe(RuleStatus.DRAFT);
    expect(created.verificationStatus).toBe(VerificationStatus.PENDING);
    expect(created.version).toBe(1);
    // No payload means PENDING DATA — never an object of zeros.
    expect(created.payload).toBeNull();
  });
});

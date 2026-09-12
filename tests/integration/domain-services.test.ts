import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  JurisdictionType,
  RuleCategory,
  RuleStatus,
  SourceType,
  VerificationStatus,
} from '@/lib/db/generated/client';
import { ResolutionStatus, resolveApplicableRules } from '@/lib/rules/resolution';
import { evaluateActivation, isPublished } from '@/lib/rules/lifecycle';

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
 * Domain service behaviour against the real database.
 * Phase 2 scope items 1, 9, 11, 13, 14, 17.
 *
 * Note: these exercise the domain rules through direct Prisma access rather than importing the
 * per-module repositories, because those resolve configuration through the application
 * environment. The logic under test (activation gate, resolution, deletion policy) is the
 * same pure code the repositories call.
 */

const suffix = uniqueSuffix();
const YEAR = 2095;
let jurisdictionId = '';
let taxYearId = 0;

describe.skipIf(!hasDatabase)('domain services', () => {
  beforeAll(async () => {
    jurisdictionId = (await createTestJurisdiction(suffix, { type: JurisdictionType.FEDERAL })).id;
    taxYearId = (await createTestTaxYear(YEAR)).id;
  });

  afterAll(async () => {
    await cleanupBySuffix(suffix);
    await testPrisma().taxYear.deleteMany({ where: { year: { in: [YEAR, YEAR + 1] } } });
    await disconnect();
  });

  describe('tax years', () => {
    it('rejects a period whose end is not after its start', async () => {
      await expect(
        testPrisma().taxYear.create({
          data: {
            year: YEAR + 1,
            startDate: new Date(Date.UTC(YEAR + 1, 5, 1)),
            endDate: new Date(Date.UTC(YEAR + 1, 0, 1)),
          },
        }),
      ).rejects.toThrow();
    });

    it('permits at most one default tax year', async () => {
      const prisma = testPrisma();
      await prisma.taxYear.updateMany({ where: { isDefault: true }, data: { isDefault: false } });
      await prisma.taxYear.update({ where: { year: YEAR }, data: { isDefault: true } });

      const other = await createTestTaxYear(YEAR + 1);
      // The partial unique index makes a second default year impossible.
      await expect(
        prisma.taxYear.update({ where: { year: other.year }, data: { isDefault: true } }),
      ).rejects.toThrow();

      await prisma.taxYear.update({ where: { year: YEAR }, data: { isDefault: false } });
      await prisma.taxYear.delete({ where: { year: other.year } });
    });

    it('rejects a duplicate year', async () => {
      await expect(createTestTaxYear(YEAR)).rejects.toThrow();
    });
  });

  describe('published-rule deletion protection', () => {
    it('permits deleting a DRAFT rule', async () => {
      const draft = await testPrisma().taxRule.create({
        data: {
          ruleKey: `test.${suffix}.draftdelete`,
          taxYearId,
          jurisdictionId,
          category: RuleCategory.SOCIAL_SECURITY,
          name: 'Deletable draft',
          effectiveFrom: new Date('2095-01-01T00:00:00.000Z'),
        },
        select: { id: true, status: true },
      });
      expect(isPublished(draft.status)).toBe(false);
      await testPrisma().taxRule.delete({ where: { id: draft.id } });
      expect(await testPrisma().taxRule.findUnique({ where: { id: draft.id } })).toBeNull();
    });

    it('classifies ACTIVE, SUPERSEDED and ROLLED_BACK as undeletable history', async () => {
      // The domain policy that `deleteDraftRule` enforces before touching the database.
      expect(isPublished(RuleStatus.ACTIVE)).toBe(true);
      expect(isPublished(RuleStatus.SUPERSEDED)).toBe(true);
      expect(isPublished(RuleStatus.ROLLED_BACK)).toBe(true);
      expect(isPublished(RuleStatus.DRAFT)).toBe(false);
      expect(isPublished(RuleStatus.PENDING_REVIEW)).toBe(false);
    });
  });

  describe('activation gate against real rows', () => {
    it('blocks activation of a rule with no source and no verification', async () => {
      const rule = await testPrisma().taxRule.create({
        data: {
          ruleKey: `test.${suffix}.gate`,
          taxYearId,
          jurisdictionId,
          category: RuleCategory.SOCIAL_SECURITY,
          name: 'Ungated rule',
          effectiveFrom: new Date('2095-01-01T00:00:00.000Z'),
        },
        include: { sources: true, conflicts: true, values: true },
      });

      const evaluation = evaluateActivation({
        status: rule.status,
        verificationStatus: rule.verificationStatus,
        sourceCount: rule.sources.length,
        conflictStatuses: rule.conflicts.map((c) => c.status),
        componentVerificationStatuses: rule.values.map((v) => v.verificationStatus),
        approvedBy: rule.approvedBy,
      });

      expect(evaluation.canActivate).toBe(false);
      expect(evaluation.blockers).toContain('NO_SOURCE');
      expect(evaluation.blockers).toContain('NOT_VERIFIED');
    });

    it('permits activation once approved, verified, sourced and conflict-free', async () => {
      const prisma = testPrisma();
      const source = await prisma.source.create({
        data: {
          code: `TEST-GATE-${suffix}`,
          organization: 'Test Agency',
          title: 'Gate Document',
          sourceType: SourceType.PUBLICATION,
        },
        select: { id: true },
      });

      const rule = await prisma.taxRule.create({
        data: {
          ruleKey: `test.${suffix}.gateok`,
          taxYearId,
          jurisdictionId,
          category: RuleCategory.SOCIAL_SECURITY,
          name: 'Gated rule',
          effectiveFrom: new Date('2095-01-01T00:00:00.000Z'),
          status: RuleStatus.APPROVED,
          verificationStatus: VerificationStatus.VERIFIED,
          approvedBy: 'reviewer@example.com',
          approvedAt: new Date(),
        },
        select: { id: true, status: true, verificationStatus: true, approvedBy: true },
      });

      await prisma.taxRuleSource.create({
        data: { taxRuleId: rule.id, sourceId: source.id, citation: 'Gate Document, p.1' },
      });

      const evaluation = evaluateActivation({
        status: rule.status,
        verificationStatus: rule.verificationStatus,
        sourceCount: 1,
        conflictStatuses: [],
        componentVerificationStatuses: [],
        approvedBy: rule.approvedBy,
      });

      expect(evaluation.canActivate).toBe(true);
    });
  });

  describe('resolution against persisted rules', () => {
    it('resolves the version in force at a date, not the newest row', async () => {
      const prisma = testPrisma();
      const ruleKey = `test.${suffix}.resolve`;

      await prisma.taxRule.create({
        data: {
          ruleKey,
          version: 1,
          taxYearId,
          jurisdictionId,
          category: RuleCategory.MEDICARE,
          name: 'First period',
          status: RuleStatus.ACTIVE,
          effectiveFrom: new Date('2095-01-01T00:00:00.000Z'),
          effectiveTo: new Date('2095-07-01T00:00:00.000Z'),
        },
      });
      await prisma.taxRule.create({
        data: {
          ruleKey,
          version: 2,
          taxYearId,
          jurisdictionId,
          category: RuleCategory.MEDICARE,
          name: 'Second period',
          status: RuleStatus.ACTIVE,
          effectiveFrom: new Date('2095-07-01T00:00:00.000Z'),
          effectiveTo: null,
        },
      });

      const effectiveDate = new Date('2095-03-01T00:00:00.000Z');
      const rows = await prisma.taxRule.findMany({
        where: {
          jurisdictionId,
          category: RuleCategory.MEDICARE,
          status: RuleStatus.ACTIVE,
          effectiveFrom: { lte: effectiveDate },
          OR: [{ effectiveTo: null }, { effectiveTo: { gt: effectiveDate } }],
        },
        include: { taxYear: { select: { year: true } } },
      });

      const result = resolveApplicableRules(
        rows.map((row) => ({
          id: row.id,
          ruleKey: row.ruleKey,
          version: row.version,
          category: row.category,
          jurisdictionId: row.jurisdictionId,
          taxYear: row.taxYear.year,
          status: row.status,
          effectiveFrom: row.effectiveFrom,
          effectiveTo: row.effectiveTo,
        })),
        { category: RuleCategory.MEDICARE, jurisdictionId, effectiveDate },
      );

      expect(result.status).toBe(ResolutionStatus.RESOLVED);
      if (result.status === 'RESOLVED') {
        // Version 2 exists and is newer, but March falls inside version 1's period.
        expect(result.rule.version).toBe(1);
        expect(result.rule.ruleKey).toBe(ruleKey);
      }
    });

    it('returns NOT_FOUND for a date no rule covers', async () => {
      const result = resolveApplicableRules([], {
        category: RuleCategory.MEDICARE,
        jurisdictionId,
        effectiveDate: new Date('1990-01-01T00:00:00.000Z'),
      });
      expect(result.status).toBe(ResolutionStatus.NOT_FOUND);
    });
  });
});

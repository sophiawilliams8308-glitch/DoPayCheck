import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  AuditAction,
  ConflictStatus,
  JurisdictionType,
  RuleCategory,
  SourceType,
  ValueType,
  VerificationStatus,
} from '@/lib/db/generated/client';
import { money, toStorageString } from '@/lib/core/money';
import { fromPrismaDecimal } from '@/lib/db/decimal';

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
 * Source traceability, verification, conflicts, NUMERIC handling and audit immutability.
 * Phase 2 scope items 1, 2, 5, 6, 8, 10, 11, 12, 17, 18.
 *
 * NO TAX VALUES. The numbers here are arbitrary precision-test values chosen to expose
 * floating-point error (e.g. 0.1/0.2, a 12-decimal fraction) — they are not rates.
 */

const suffix = uniqueSuffix();
const YEAR = 2091;
let jurisdictionId = '';
let taxYearId = 0;

describe.skipIf(!hasDatabase)('rule data, sources and audit', () => {
  beforeAll(async () => {
    jurisdictionId = (await createTestJurisdiction(suffix)).id;
    taxYearId = (await createTestTaxYear(YEAR)).id;
  });

  afterAll(async () => {
    await cleanupBySuffix(suffix);
    await testPrisma().taxYear.deleteMany({ where: { year: YEAR } });
    await disconnect();
  });

  async function makeRule(name: string): Promise<string> {
    const created = await testPrisma().taxRule.create({
      data: {
        ruleKey: `test.${suffix}.${name}`,
        taxYearId,
        jurisdictionId,
        category: RuleCategory.SOCIAL_SECURITY,
        name: `Rule ${name}`,
        effectiveFrom: new Date('2091-01-01T00:00:00.000Z'),
      },
      select: { id: true },
    });
    return created.id;
  }

  describe('jurisdiction relationships', () => {
    it('links a child jurisdiction to its parent', async () => {
      const child = await createTestJurisdiction(`${suffix}child`, {
        type: JurisdictionType.STATE,
        parentId: jurisdictionId,
        stateCode: 'ZZ',
      });
      const loaded = await testPrisma().jurisdiction.findUnique({
        where: { id: child.id },
        include: { parent: true },
      });
      expect(loaded?.parent?.id).toBe(jurisdictionId);
      await testPrisma().jurisdiction.delete({ where: { id: child.id } });
    });

    it('refuses to delete a jurisdiction that rules reference', async () => {
      // onDelete: Restrict — deactivate instead of deleting (spec §29).
      await makeRule('jurisdiction-guard');
      await expect(
        testPrisma().jurisdiction.delete({ where: { id: jurisdictionId } }),
      ).rejects.toThrow();
    });
  });

  describe('source traceability', () => {
    it('links a rule to a source with a precise locator', async () => {
      const ruleId = await makeRule('traceable');
      const source = await testPrisma().source.create({
        data: {
          code: `TEST-SRC-${suffix}`,
          organization: 'Test Agency',
          title: 'Test Document',
          sourceType: SourceType.PUBLICATION,
          // url intentionally omitted — a fabricated URL is worse than none (spec §21).
        },
        select: { id: true, url: true },
      });
      expect(source.url).toBeNull();

      await testPrisma().taxRuleSource.create({
        data: {
          taxRuleId: ruleId,
          sourceId: source.id,
          page: '12',
          section: '3',
          table: 'Table 1',
          citation: 'Test Document, p.12, Table 1',
          excerpt: 'Verbatim excerpt recorded from the document.',
          verificationStatus: VerificationStatus.VERIFIED,
          verifiedBy: 'reviewer@example.com',
          verifiedAt: new Date(),
        },
      });

      const withSources = await testPrisma().taxRule.findUnique({
        where: { id: ruleId },
        include: { sources: { include: { source: true } } },
      });

      // The full traceability chain: rule -> link -> source, with a locator.
      expect(withSources?.sources).toHaveLength(1);
      expect(withSources?.sources[0]?.table).toBe('Table 1');
      expect(withSources?.sources[0]?.source.organization).toBe('Test Agency');
      expect(withSources?.sources[0]?.verificationStatus).toBe(VerificationStatus.VERIFIED);
    });

    it('supports multiple sources and locators for one rule', async () => {
      const ruleId = await makeRule('multisource');
      for (const n of [1, 2]) {
        const source = await testPrisma().source.create({
          data: {
            code: `TEST-SRC-${suffix}-${String(n)}`,
            organization: 'Test Agency',
            title: `Document ${String(n)}`,
            sourceType: SourceType.INSTRUCTIONS,
          },
          select: { id: true },
        });
        await testPrisma().taxRuleSource.create({
          data: { taxRuleId: ruleId, sourceId: source.id, citation: `Doc ${String(n)}` },
        });
      }
      const loaded = await testPrisma().taxRule.findUnique({
        where: { id: ruleId },
        include: { sources: true },
      });
      expect(loaded?.sources).toHaveLength(2);
    });

    it('refuses to delete a source a rule still cites', async () => {
      const ruleId = await makeRule('sourceguard');
      const source = await testPrisma().source.create({
        data: {
          code: `TEST-SRC-GUARD-${suffix}`,
          organization: 'Test Agency',
          title: 'Guarded',
          sourceType: SourceType.PUBLICATION,
        },
        select: { id: true },
      });
      await testPrisma().taxRuleSource.create({
        data: { taxRuleId: ruleId, sourceId: source.id },
      });
      await expect(testPrisma().source.delete({ where: { id: source.id } })).rejects.toThrow();
    });
  });

  describe('NUMERIC / decimal handling', () => {
    it('round-trips an exact decimal without floating-point drift', async () => {
      const ruleId = await makeRule('decimal');
      // 0.1 + 0.2 in IEEE-754 is 0.30000000000000004. Stored exactly, it must come back 0.3.
      await testPrisma().taxRuleValue.create({
        data: {
          taxRuleId: ruleId,
          key: 'precisionProbe',
          valueType: ValueType.RATE,
          numericValue: '0.300000000000',
          verificationStatus: VerificationStatus.VERIFIED,
        },
      });
      const loaded = await testPrisma().taxRuleValue.findFirst({
        where: { taxRuleId: ruleId, key: 'precisionProbe' },
      });
      const asMoney = fromPrismaDecimal(loaded?.numericValue ?? null);
      expect(asMoney).not.toBeNull();
      expect(toStorageString(asMoney!)).toBe('0.3');
      expect(toStorageString(money('0.1').plus(money('0.2')))).toBe('0.3');
    });

    it('preserves all 12 fractional digits', async () => {
      const ruleId = await makeRule('precision12');
      await testPrisma().taxRuleValue.create({
        data: {
          taxRuleId: ruleId,
          key: 'twelveDigits',
          valueType: ValueType.RATE,
          numericValue: '0.123456789012',
          verificationStatus: VerificationStatus.VERIFIED,
        },
      });
      const loaded = await testPrisma().taxRuleValue.findFirst({
        where: { taxRuleId: ruleId, key: 'twelveDigits' },
      });
      expect(toStorageString(fromPrismaDecimal(loaded?.numericValue ?? null)!)).toBe(
        '0.123456789012',
      );
    });

    it('preserves a large integer value without loss', async () => {
      const ruleId = await makeRule('largevalue');
      await testPrisma().taxRuleValue.create({
        data: {
          taxRuleId: ruleId,
          key: 'largeProbe',
          valueType: ValueType.MONEY,
          numericValue: '9999999999999999',
          verificationStatus: VerificationStatus.VERIFIED,
        },
      });
      const loaded = await testPrisma().taxRuleValue.findFirst({
        where: { taxRuleId: ruleId, key: 'largeProbe' },
      });
      expect(toStorageString(fromPrismaDecimal(loaded?.numericValue ?? null)!)).toBe(
        '9999999999999999',
      );
    });

    it('stores NOT_STATED as NULL, never as zero', async () => {
      const ruleId = await makeRule('notstated');
      await testPrisma().taxRuleValue.create({
        data: {
          taxRuleId: ruleId,
          key: 'unstatedComponent',
          valueType: ValueType.RATE,
          numericValue: null,
          verificationStatus: VerificationStatus.NOT_STATED,
        },
      });
      const loaded = await testPrisma().taxRuleValue.findFirst({
        where: { taxRuleId: ruleId, key: 'unstatedComponent' },
      });
      expect(loaded?.numericValue).toBeNull();
      // The critical assertion: reading it back never produces 0.
      expect(fromPrismaDecimal(loaded?.numericValue ?? null)).toBeNull();
      expect(loaded?.verificationStatus).toBe(VerificationStatus.NOT_STATED);
    });

    it('distinguishes NOT_APPLICABLE from NOT_STATED in storage', async () => {
      const ruleId = await makeRule('naVsNs');
      await testPrisma().taxRuleValue.createMany({
        data: [
          {
            taxRuleId: ruleId,
            key: 'inapplicable',
            valueType: ValueType.RATE,
            verificationStatus: VerificationStatus.NOT_APPLICABLE,
          },
          {
            taxRuleId: ruleId,
            key: 'silentSource',
            valueType: ValueType.RATE,
            verificationStatus: VerificationStatus.NOT_STATED,
          },
        ],
      });
      const values = await testPrisma().taxRuleValue.findMany({
        where: { taxRuleId: ruleId },
        orderBy: { key: 'asc' },
      });
      expect(values.map((v) => v.verificationStatus)).toEqual([
        VerificationStatus.NOT_APPLICABLE,
        VerificationStatus.NOT_STATED,
      ]);
      expect(values.every((v) => v.numericValue === null)).toBe(true);
    });

    it('rejects duplicate component keys within the same group and ordinal', async () => {
      const ruleId = await makeRule('dupvalue');
      await testPrisma().taxRuleValue.create({
        data: { taxRuleId: ruleId, key: 'rate', valueType: ValueType.RATE },
      });
      await expect(
        testPrisma().taxRuleValue.create({
          data: { taxRuleId: ruleId, key: 'rate', valueType: ValueType.RATE },
        }),
      ).rejects.toThrow();
    });
  });

  describe('conflicts', () => {
    it('records a conflict between two sources without resolving it', async () => {
      const ruleId = await makeRule('conflict');
      const [a, b] = await Promise.all([
        testPrisma().source.create({
          data: {
            code: `TEST-CONFLICT-A-${suffix}`,
            organization: 'Agency A',
            title: 'Doc A',
            sourceType: SourceType.PUBLICATION,
          },
          select: { id: true },
        }),
        testPrisma().source.create({
          data: {
            code: `TEST-CONFLICT-B-${suffix}`,
            organization: 'Agency B',
            title: 'Doc B',
            sourceType: SourceType.BULLETIN,
          },
          select: { id: true },
        }),
      ]);

      const conflict = await testPrisma().ruleConflict.create({
        data: {
          taxRuleId: ruleId,
          sourceAId: a.id,
          sourceBId: b.id,
          description: 'The two documents state different values for the same component.',
        },
      });

      // Default OPEN and unresolved: the system records disagreement, never arbitrates it.
      expect(conflict.status).toBe(ConflictStatus.OPEN);
      expect(conflict.resolvedAt).toBeNull();
      expect(conflict.resolutionNotes).toBeNull();
    });
  });

  describe('audit log immutability', () => {
    it('records an audit entry', async () => {
      const entry = await testPrisma().auditLog.create({
        data: {
          action: AuditAction.CREATE,
          entityType: 'TaxRule',
          entityId: `test-${suffix}`,
          actor: 'tester@example.com',
        },
        select: { id: true },
      });
      expect(entry.id).toBeTruthy();
    });

    it('REFUSES to update an audit entry', async () => {
      const entry = await testPrisma().auditLog.create({
        data: {
          action: AuditAction.PUBLISH,
          entityType: 'TaxRule',
          entityId: `test-update-${suffix}`,
          actor: 'tester@example.com',
        },
        select: { id: true },
      });
      // Enforced by a database trigger, so no code path can rewrite history (spec §31).
      await expect(
        testPrisma().auditLog.update({ where: { id: entry.id }, data: { actor: 'someone-else' } }),
      ).rejects.toThrow();
    });

    it('REFUSES to delete an audit entry', async () => {
      const entry = await testPrisma().auditLog.create({
        data: {
          action: AuditAction.DELETE,
          entityType: 'TaxRule',
          entityId: `test-delete-${suffix}`,
          actor: 'tester@example.com',
        },
        select: { id: true },
      });
      await expect(testPrisma().auditLog.delete({ where: { id: entry.id } })).rejects.toThrow();
    });
  });
});

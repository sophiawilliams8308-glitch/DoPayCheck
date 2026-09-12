import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  JurisdictionType,
  PayFrequency,
  RuleCategory,
  SourceType,
  VerificationStatus,
} from '@/lib/db/generated/client';
import { toStorageString } from '@/lib/core/money';
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
 * Structured rule detail tables: TaxBracket, WithholdingTable(+Row), ReciprocityRule,
 * LocalTaxRule (Phase 2 extension).
 *
 * NO TAX VALUES. Bounds such as "100"/"200" are ordering fixtures; precision fixtures are
 * chosen to expose floating-point error. None is a real rate, bracket or wage base.
 */

const suffix = uniqueSuffix();
const YEAR = 2093;
let federalId = '';
let stateId = '';
let cityId = '';
let otherStateId = '';
let taxYearId = 0;

describe.skipIf(!hasDatabase)('rule detail tables', () => {
  beforeAll(async () => {
    federalId = (await createTestJurisdiction(suffix, { type: JurisdictionType.FEDERAL })).id;
    stateId = (
      await createTestJurisdiction(`${suffix}st`, {
        type: JurisdictionType.STATE,
        parentId: federalId,
        stateCode: 'ZA',
      })
    ).id;
    otherStateId = (
      await createTestJurisdiction(`${suffix}st2`, {
        type: JurisdictionType.STATE,
        parentId: federalId,
        stateCode: 'ZB',
      })
    ).id;
    cityId = (
      await createTestJurisdiction(`${suffix}city`, {
        type: JurisdictionType.CITY,
        parentId: stateId,
      })
    ).id;
    taxYearId = (await createTestTaxYear(YEAR)).id;
  });

  afterAll(async () => {
    await cleanupBySuffix(suffix);
    await testPrisma().taxYear.deleteMany({ where: { year: YEAR } });
    await disconnect();
  });

  async function makeRule(name: string, category: RuleCategory, jurisdictionId: string) {
    return testPrisma().taxRule.create({
      data: {
        ruleKey: `test.${suffix}.${name}`,
        taxYearId,
        jurisdictionId,
        category,
        name: `Rule ${name}`,
        effectiveFrom: new Date('2093-01-01T00:00:00.000Z'),
      },
      select: { id: true },
    });
  }

  describe('TaxBracket', () => {
    it('stores an ordered bracket schedule with exact NUMERIC bounds', async () => {
      const rule = await makeRule('brackets', RuleCategory.FEDERAL_INCOME_TAX, federalId);
      await testPrisma().taxBracket.createMany({
        data: [
          {
            taxRuleId: rule.id,
            filingStatus: 'TEST_STATUS',
            ordinal: 0,
            lowerBound: '0',
            upperBound: '100.000000000001',
            rate: null,
            verificationStatus: VerificationStatus.NOT_STATED,
          },
          {
            taxRuleId: rule.id,
            filingStatus: 'TEST_STATUS',
            ordinal: 1,
            lowerBound: '100.000000000001',
            upperBound: null,
            rate: null,
            verificationStatus: VerificationStatus.NOT_STATED,
          },
        ],
      });

      const stored = await testPrisma().taxBracket.findMany({
        where: { taxRuleId: rule.id },
        orderBy: { ordinal: 'asc' },
      });

      expect(stored).toHaveLength(2);
      // 12 fractional digits survive the round-trip exactly.
      expect(toStorageString(fromPrismaDecimal(stored[0]?.upperBound ?? null)!)).toBe(
        '100.000000000001',
      );
      // An unstated rate stays NULL — never 0 (spec §19).
      expect(stored[0]?.rate).toBeNull();
      expect(fromPrismaDecimal(stored[0]?.rate ?? null)).toBeNull();
      // The top bracket is open-ended.
      expect(stored[1]?.upperBound).toBeNull();
    });

    it('rejects a duplicate ordinal within one filing status', async () => {
      const rule = await makeRule('bracketdup', RuleCategory.FEDERAL_INCOME_TAX, federalId);
      await testPrisma().taxBracket.create({
        data: { taxRuleId: rule.id, filingStatus: 'S', ordinal: 0 },
      });
      await expect(
        testPrisma().taxBracket.create({
          data: { taxRuleId: rule.id, filingStatus: 'S', ordinal: 0 },
        }),
      ).rejects.toThrow();
    });

    it('allows the same ordinal under a different filing status', async () => {
      const rule = await makeRule('bracketfs', RuleCategory.FEDERAL_INCOME_TAX, federalId);
      await testPrisma().taxBracket.create({
        data: { taxRuleId: rule.id, filingStatus: 'A', ordinal: 0 },
      });
      await testPrisma().taxBracket.create({
        data: { taxRuleId: rule.id, filingStatus: 'B', ordinal: 0 },
      });
      expect(await testPrisma().taxBracket.count({ where: { taxRuleId: rule.id } })).toBe(2);
    });

    it('cascades when its parent rule is deleted', async () => {
      const rule = await makeRule('bracketcascade', RuleCategory.FEDERAL_INCOME_TAX, federalId);
      await testPrisma().taxBracket.create({
        data: { taxRuleId: rule.id, filingStatus: 'S', ordinal: 0 },
      });
      await testPrisma().taxRule.delete({ where: { id: rule.id } });
      expect(await testPrisma().taxBracket.count({ where: { taxRuleId: rule.id } })).toBe(0);
    });
  });

  describe('WithholdingTable', () => {
    it('stores a table with pay frequency and ordered wage rows', async () => {
      const rule = await makeRule('withholding', RuleCategory.FEDERAL_WITHHOLDING, federalId);
      const table = await testPrisma().withholdingTable.create({
        data: {
          taxRuleId: rule.id,
          tableCode: 'TEST-TABLE-1',
          method: 'TEST_METHOD',
          filingStatus: 'TEST_STATUS',
          payFrequency: PayFrequency.BIWEEKLY,
          rows: {
            create: [
              { ordinal: 0, wageFrom: '0', wageTo: '500', baseWithholding: null },
              { ordinal: 1, wageFrom: '500', wageTo: null, baseWithholding: null },
            ],
          },
        },
        include: { rows: { orderBy: { ordinal: 'asc' } } },
      });

      expect(table.payFrequency).toBe(PayFrequency.BIWEEKLY);
      expect(table.rows).toHaveLength(2);
      // Unstated withholding stays NULL.
      expect(table.rows[0]?.baseWithholding).toBeNull();
      expect(table.rows[1]?.wageTo).toBeNull();
    });

    it('is distinct from TaxBracket — a withholding table carries pay frequency', async () => {
      // Spec §6 forbids substituting annual brackets for withholding tables; the schema
      // makes the substitution impossible because the dimensions differ.
      const columns = await testPrisma().$queryRaw<{ column_name: string }[]>`
        SELECT column_name FROM information_schema.columns WHERE table_name = 'TaxBracket'
      `;
      expect(columns.map((c) => c.column_name)).not.toContain('payFrequency');
    });

    it('rejects a duplicate table identity', async () => {
      const rule = await makeRule('whdup', RuleCategory.FEDERAL_WITHHOLDING, federalId);
      const payload = {
        taxRuleId: rule.id,
        tableCode: 'T1',
        method: 'M',
        filingStatus: 'S',
        payFrequency: PayFrequency.WEEKLY,
      };
      await testPrisma().withholdingTable.create({ data: payload });
      await expect(testPrisma().withholdingTable.create({ data: payload })).rejects.toThrow();
    });

    it('rejects a duplicate row ordinal within one table', async () => {
      const rule = await makeRule('whrowdup', RuleCategory.FEDERAL_WITHHOLDING, federalId);
      const table = await testPrisma().withholdingTable.create({
        data: {
          taxRuleId: rule.id,
          tableCode: 'T2',
          method: 'M',
          filingStatus: 'S',
          payFrequency: PayFrequency.MONTHLY,
        },
        select: { id: true },
      });
      await testPrisma().withholdingTableRow.create({
        data: { withholdingTableId: table.id, ordinal: 0 },
      });
      await expect(
        testPrisma().withholdingTableRow.create({
          data: { withholdingTableId: table.id, ordinal: 0 },
        }),
      ).rejects.toThrow();
    });
  });

  describe('ReciprocityRule', () => {
    it('references states by foreign key, never by name string', async () => {
      const rule = await makeRule('reciprocity', RuleCategory.RECIPROCITY, stateId);
      const reciprocity = await testPrisma().reciprocityRule.create({
        data: {
          taxRuleId: rule.id,
          fromJurisdictionId: stateId,
          toJurisdictionId: otherStateId,
          withholdingTreatment: 'TEST_TREATMENT',
        },
        include: { fromJurisdiction: true, toJurisdiction: true },
      });

      expect(reciprocity.fromJurisdiction.id).toBe(stateId);
      expect(reciprocity.toJurisdiction.id).toBe(otherStateId);
    });

    it('permits at most one reciprocity detail per rule', async () => {
      const rule = await makeRule('recipdup', RuleCategory.RECIPROCITY, stateId);
      const payload = {
        taxRuleId: rule.id,
        fromJurisdictionId: stateId,
        toJurisdictionId: otherStateId,
        withholdingTreatment: 'T',
      };
      await testPrisma().reciprocityRule.create({ data: payload });
      await expect(testPrisma().reciprocityRule.create({ data: payload })).rejects.toThrow();
    });

    it('refuses to delete a jurisdiction referenced by a reciprocity agreement', async () => {
      const rule = await makeRule('recipguard', RuleCategory.RECIPROCITY, stateId);
      await testPrisma().reciprocityRule.create({
        data: {
          taxRuleId: rule.id,
          fromJurisdictionId: stateId,
          toJurisdictionId: otherStateId,
          withholdingTreatment: 'T',
        },
      });
      await expect(
        testPrisma().jurisdiction.delete({ where: { id: otherStateId } }),
      ).rejects.toThrow();
    });
  });

  describe('LocalTaxRule', () => {
    it('attaches a local tax to a specific local jurisdiction', async () => {
      const rule = await makeRule('localtax', RuleCategory.LOCAL_TAX, cityId);
      const local = await testPrisma().localTaxRule.create({
        data: {
          taxRuleId: rule.id,
          localJurisdictionId: cityId,
          taxType: 'TEST_LOCAL_TAX',
          appliesToEmployee: true,
          appliesToEmployer: false,
          employeeRate: null,
          wageBase: null,
        },
        include: { localJurisdiction: { include: { parent: true } } },
      });

      expect(local.localJurisdiction.id).toBe(cityId);
      // The city's parent chain reaches the state — how locality stacking will resolve.
      expect(local.localJurisdiction.parent?.id).toBe(stateId);
      // Unstated rates stay NULL.
      expect(local.employeeRate).toBeNull();
      expect(local.wageBase).toBeNull();
    });

    it('has no ZIP code column — a ZIP is not a taxing jurisdiction', async () => {
      const columns = await testPrisma().$queryRaw<{ column_name: string }[]>`
        SELECT column_name FROM information_schema.columns WHERE table_name = 'LocalTaxRule'
      `;
      const names = columns.map((c) => c.column_name.toLowerCase());
      expect(names.some((n) => n.includes('zip') || n.includes('postal'))).toBe(false);
    });

    it('permits at most one local-tax detail per rule', async () => {
      const rule = await makeRule('localdup', RuleCategory.LOCAL_TAX, cityId);
      const payload = { taxRuleId: rule.id, localJurisdictionId: cityId, taxType: 'T' };
      await testPrisma().localTaxRule.create({ data: payload });
      await expect(testPrisma().localTaxRule.create({ data: payload })).rejects.toThrow();
    });
  });

  describe('Source document-level fields', () => {
    it('links a source to its jurisdiction and tax year', async () => {
      const source = await testPrisma().source.create({
        data: {
          code: `TEST-DOCLEVEL-${suffix}`,
          organization: 'Test Agency',
          title: 'Jurisdiction-scoped document',
          sourceType: SourceType.INSTRUCTIONS,
          jurisdictionId: stateId,
          taxYearId,
          verificationStatus: VerificationStatus.PENDING,
        },
        include: { jurisdiction: true, taxYear: true },
      });
      expect(source.jurisdiction?.id).toBe(stateId);
      expect(source.taxYear?.year).toBe(YEAR);
      expect(source.url).toBeNull();
    });
  });

  describe('TaxYear isDefault', () => {
    it('exposes isDefault and no longer exposes isCurrent', async () => {
      const columns = await testPrisma().$queryRaw<{ column_name: string }[]>`
        SELECT column_name FROM information_schema.columns WHERE table_name = 'TaxYear'
      `;
      const names = columns.map((c) => c.column_name);
      expect(names).toContain('isDefault');
      expect(names).not.toContain('isCurrent');
    });
  });
});

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { getPrisma } from '@/lib/db/client';
import { StateRuleKey } from '@/lib/tax/state/ruleKeys';
import { retrieveCandidates } from '@/lib/tax/state/rules/candidateRetrieval';

import {
  cleanupBySuffix,
  createTestJurisdiction,
  disconnect,
  hasDatabase,
  testPrisma,
  uniqueSuffix,
} from './helpers/db';

/**
 * STAGE A (partial) — state candidate retrieval against the real database
 * (Phase 5 Step 3.5).
 *
 * Rules created here carry SYNTHETIC detail and a non-real jurisdiction, so
 * nothing in this file can be mistaken for authoritative tax data. This
 * module is retrieval only — no rule is ever asserted "resolved" here.
 */

const suffix = uniqueSuffix();
const EFFECTIVE = '2097-06-15T00:00:00.000Z';
const JURISDICTION_CODE = `TEST-${suffix}`;
let jurisdictionId = '';
let taxYearId = 0;
let sourceId = '';

async function makeStateRule(
  ruleKey: string,
  overrides: {
    status?: 'ACTIVE' | 'DRAFT' | 'SUPERSEDED';
    effectiveFrom?: Date;
    effectiveTo?: Date | null;
    version?: number;
    verificationStatus?: 'VERIFIED' | 'PENDING' | 'CONFLICT';
    payload?: unknown;
    withSource?: boolean;
    sourceVerificationStatus?: 'VERIFIED' | 'PENDING' | 'CONFLICT';
  } = {},
): Promise<string> {
  const rule = await testPrisma().taxRule.create({
    data: {
      ruleKey,
      version: overrides.version ?? 1,
      taxYearId,
      jurisdictionId,
      category: 'STATE_WITHHOLDING',
      name: `Synthetic ${ruleKey}`,
      status: overrides.status ?? 'ACTIVE',
      verificationStatus: overrides.verificationStatus ?? 'VERIFIED',
      effectiveFrom: overrides.effectiveFrom ?? new Date('2097-01-01T00:00:00.000Z'),
      effectiveTo: overrides.effectiveTo ?? null,
      payload: (overrides.payload ?? { note: 'synthetic-state-fixture' }) as never,
    },
    select: { id: true },
  });

  if (overrides.withSource !== false) {
    await testPrisma().taxRuleSource.create({
      data: {
        taxRuleId: rule.id,
        sourceId,
        citation: 'Synthetic fixture — not an official source',
        verificationStatus: overrides.sourceVerificationStatus ?? 'VERIFIED',
      },
    });
  }

  return rule.id;
}

describe.skipIf(!hasDatabase)('retrieveCandidates — Step 3.5 candidate retrieval', () => {
  beforeAll(async () => {
    // Deliberately NOT `type: 'STATE'`: state-coverage-matrix.test.ts asserts an
    // exact, UNSCOPED `listByType('STATE')` count as part of proving its own
    // production/test scoping is real (by design, per its own comment: "the
    // race is real"). Running concurrently with a second STATE-type fixture
    // would make that count flaky. This module never reads `jurisdiction.type`,
    // so any valid type is equally correct here — 'OTHER' simply cannot collide.
    jurisdictionId = (await createTestJurisdiction(suffix, { type: 'OTHER' })).id;
    const taxYear = await testPrisma().taxYear.create({
      data: {
        year: 2097,
        status: 'DRAFT',
        startDate: new Date('2097-01-01T00:00:00.000Z'),
        endDate: new Date('2098-01-01T00:00:00.000Z'),
      },
      select: { id: true },
    });
    taxYearId = taxYear.id;
    const source = await testPrisma().source.create({
      data: {
        code: `TEST-STATE-${suffix}`,
        organization: 'Synthetic Agency',
        title: 'Synthetic state fixture',
        sourceType: 'PUBLICATION',
      },
      select: { id: true },
    });
    sourceId = source.id;
  });

  afterAll(async () => {
    await testPrisma().taxRule.deleteMany({ where: { jurisdictionId } });
    await cleanupBySuffix(suffix);
    await testPrisma().taxYear.deleteMany({ where: { id: taxYearId } });
    await disconnect();
  });

  it('retrieves a candidate for an ACTIVE rule matching the requested key', async () => {
    const key = `${StateRuleKey.WITHHOLDING_METHOD}.${suffix}`;
    await makeStateRule(key);

    const [result] = await retrieveCandidates(`TEST-${suffix}`, EFFECTIVE, [key as StateRuleKey]);

    expect(result?.ruleKey).toBe(key);
    expect(result?.candidates).toHaveLength(1);
    expect(result?.candidates[0]?.status).toBe('ACTIVE');
  });

  it('preserves rule-key identity — every requested key is returned, in order', async () => {
    const keyA = `${StateRuleKey.WITHHOLDING_TABLE}.${suffix}`;
    const keyB = `${StateRuleKey.WITHHOLDING_FORMULA}.${suffix}`;
    await makeStateRule(keyA);

    const results = await retrieveCandidates(`TEST-${suffix}`, EFFECTIVE, [
      keyA as StateRuleKey,
      keyB as StateRuleKey,
    ]);

    expect(results.map((r) => r.ruleKey)).toEqual([keyA, keyB]);
    expect(results[0]?.candidates).toHaveLength(1);
    // keyB has no rule at all — explicit empty array, not an omitted entry.
    expect(results[1]?.candidates).toEqual([]);
  });

  it('the database itself excludes two overlapping ACTIVE rows for one key — a real schema finding', async () => {
    // TaxRule_no_overlapping_active_versions (Phase 2 migration
    // 20260912151038) is a Postgres EXCLUDE constraint on (ruleKey,
    // tsrange(effectiveFrom, effectiveTo)) WHERE status = 'ACTIVE', with no
    // jurisdiction term. So two overlapping-window ACTIVE rows for the same
    // ruleKey can never coexist regardless of jurisdiction — retrieval can
    // therefore never observe genuine ACTIVE/ACTIVE ambiguity for one key at
    // one instant; that is enforced at write time, not by this module.
    const key = `${StateRuleKey.SDI_EMPLOYEE_RATE}.${suffix}`;
    await makeStateRule(key, { version: 1 });
    await expect(makeStateRule(key, { version: 2 })).rejects.toThrow(/exclusion constraint/i);
  });

  it('the candidate shape carries no resolution semantics of its own', async () => {
    const key = `${StateRuleKey.SDI_EMPLOYER_RATE}.${suffix}`;
    await makeStateRule(key);

    const [result] = await retrieveCandidates(`TEST-${suffix}`, EFFECTIVE, [key as StateRuleKey]);

    // Whatever candidates come back, nothing claims one is "the" resolved
    // rule — that determination belongs to a later stage.
    for (const candidate of result?.candidates ?? []) {
      expect(candidate).not.toHaveProperty('resolved');
      expect(candidate).not.toHaveProperty('available');
    }
  });

  it('represents "no candidates found" as an explicit empty array', async () => {
    const key = `${StateRuleKey.PFML_WAGE_BASE}.${suffix}`;

    const [result] = await retrieveCandidates(`TEST-${suffix}`, EFFECTIVE, [key as StateRuleKey]);

    expect(result?.ruleKey).toBe(key);
    expect(result?.candidates).toEqual([]);
  });

  it('ignores a DRAFT rule — never a candidate', async () => {
    const key = `${StateRuleKey.SUTA_PROGRAM}.${suffix}`;
    await makeStateRule(key, { status: 'DRAFT' });

    const [result] = await retrieveCandidates(`TEST-${suffix}`, EFFECTIVE, [key as StateRuleKey]);

    expect(result?.candidates).toEqual([]);
  });

  it('ignores a rule whose effective period has not started', async () => {
    const key = `${StateRuleKey.TAXABILITY_PROFILE}.${suffix}`;
    await makeStateRule(key, { effectiveFrom: new Date('2097-12-01T00:00:00.000Z') });

    const [result] = await retrieveCandidates(`TEST-${suffix}`, EFFECTIVE, [key as StateRuleKey]);

    expect(result?.candidates).toEqual([]);
  });

  it('does not substitute another jurisdiction — an unrecognized code yields empty, not a fallback', async () => {
    const key = `${StateRuleKey.RECIPROCITY_AGREEMENT}.${suffix}`;
    await makeStateRule(key);

    const results = await retrieveCandidates(`NOPE-${suffix}`, EFFECTIVE, [key as StateRuleKey]);

    expect(results).toEqual([{ ruleKey: key, candidates: [] }]);
  });

  it('propagates a database failure rather than converting it to an empty result', async () => {
    // getPrisma() is the SAME module-level singleton candidateRetrieval.ts
    // itself calls (both import from '@/lib/db/client') — unlike testPrisma(),
    // which deliberately constructs its own separate client. Spying here
    // intercepts the real call the production code makes.
    const spy = vi
      .spyOn(getPrisma().taxRule, 'findMany')
      .mockRejectedValueOnce(new Error('synthetic connection failure'));

    const key = `${StateRuleKey.CAPABILITY_DECLARATION}.${suffix}`;
    await expect(
      retrieveCandidates(`TEST-${suffix}`, EFFECTIVE, [key as StateRuleKey]),
    ).rejects.toThrow('synthetic connection failure');

    spy.mockRestore();
  });

  it('returns an empty array outright for an empty key list, without querying', async () => {
    const spy = vi.spyOn(getPrisma().taxRule, 'findMany');
    const results = await retrieveCandidates(`TEST-${suffix}`, EFFECTIVE, []);
    expect(results).toEqual([]);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  describe('provenance preservation (follow-up correction, 2026-09-20)', () => {
    it('preserves jurisdictionCode, sourceIds, verified, detail and verificationStatus from the database', async () => {
      const key = `${StateRuleKey.PIT_RATE_BRACKETS}.${suffix}`;
      const payload = { brackets: [{ rate: '0.05' }] };
      await makeStateRule(key, { payload });

      const [result] = await retrieveCandidates(JURISDICTION_CODE, EFFECTIVE, [
        key as StateRuleKey,
      ]);

      expect(result?.candidates).toHaveLength(1);
      const [candidate] = result?.candidates ?? [];
      // These are the REAL seeded values, not fabricated placeholders.
      expect(candidate?.jurisdictionCode).toBe(JURISDICTION_CODE);
      expect(candidate?.sourceIds).toEqual([sourceId]);
      expect(candidate?.verified).toBe(true);
      expect(candidate?.detail).toEqual(payload);
      expect(candidate?.verificationStatus).toBe('VERIFIED');
    });

    it('reports verified: false when the only linked source is not itself VERIFIED', async () => {
      const key = `${StateRuleKey.PIT_STANDARD_DEDUCTION}.${suffix}`;
      await makeStateRule(key, { sourceVerificationStatus: 'PENDING' });

      const [result] = await retrieveCandidates(JURISDICTION_CODE, EFFECTIVE, [
        key as StateRuleKey,
      ]);

      const [candidate] = result?.candidates ?? [];
      expect(candidate?.sourceIds).toEqual([sourceId]);
      expect(candidate?.verified).toBe(false);
    });

    it('reports an empty sourceIds array and verified: false when no source is linked at all', async () => {
      const key = `${StateRuleKey.PIT_PERSONAL_EXEMPTION}.${suffix}`;
      await makeStateRule(key, { withSource: false });

      const [result] = await retrieveCandidates(JURISDICTION_CODE, EFFECTIVE, [
        key as StateRuleKey,
      ]);

      const [candidate] = result?.candidates ?? [];
      expect(candidate?.sourceIds).toEqual([]);
      expect(candidate?.verified).toBe(false);
    });

    it("reports the rule row's own verificationStatus, distinct from per-source verification", async () => {
      const key = `${StateRuleKey.WITHHOLDING_SUPPLEMENTAL}.${suffix}`;
      await makeStateRule(key, { verificationStatus: 'PENDING' });

      const [result] = await retrieveCandidates(JURISDICTION_CODE, EFFECTIVE, [
        key as StateRuleKey,
      ]);

      const [candidate] = result?.candidates ?? [];
      expect(candidate?.verificationStatus).toBe('PENDING');
      // The rule row's own status is PENDING, but its source is still VERIFIED —
      // the two are independent, neither overwrites the other.
      expect(candidate?.verified).toBe(true);
    });
  });
});

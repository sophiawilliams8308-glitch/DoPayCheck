import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { StateRuleKey } from '@/lib/tax/state/ruleKeys';
import { isPublishable } from '@/lib/tax/readiness/coverage';
import {
  findCurrentApproval,
  grantReadinessApproval,
  revokeReadinessApproval,
} from '@/lib/tax/readiness/repository';

import {
  createTestJurisdiction,
  createTestTaxYear,
  disconnect,
  hasDatabase,
  testPrisma,
  uniqueSuffix,
} from './helpers/db';

/**
 * `coverage.isPublishable()` and `TaxDataReadinessApproval` persistence against the real
 * database (SEO-03 contract §E, §F).
 *
 * Rules created here are synthetic fixtures under `TEST-` jurisdictions — nothing here can be
 * mistaken for authoritative tax data, matching the existing Phase 5 integration-test
 * convention.
 *
 * EACH SCENARIO GETS ITS OWN JURISDICTION AND TAX YEAR. `TaxDataReadinessApproval` rows are,
 * by design, never deletable (proven below) and FK-`Restrict` both `Jurisdiction` and
 * `TaxYear` — so once a scenario grants an approval, its jurisdiction/tax year can never be
 * cleaned up, and reusing one context across scenarios would let an earlier scenario's
 * still-valid approval silently become the "current" one for a later scenario. Fresh contexts
 * avoid that coupling; the leaked `TEST-`-prefixed rows are the same accepted trade-off this
 * suite already makes for `AuditLog` (see the note in `afterAll` below).
 */

let suiteSuffix = 0;
function nextSuffix(): string {
  suiteSuffix += 1;
  return `${uniqueSuffix()}-${String(suiteSuffix)}`;
}

// `TaxYear.year` is globally unique, so every scenario needs its own — a shared literal like
// 2098 would collide the second time any test calls `newContext()`. `TaxDataReadinessApproval`
// rows are never deletable (that is this file's own point), so a prior run's tax years persist
// forever and a fixed starting counter would collide across reruns in the same database — the
// process start time keeps each run's range distinct. Kept under 10000 deliberately: a 5-digit
// year round-trips through Postgres as an unparseable date for this driver/client combination.
let nextYear = 2100 + (Date.now() % 7000);
function freshYear(): number {
  nextYear += 1;
  return nextYear;
}

async function newContext(): Promise<{ jurisdictionId: string; taxYearId: number }> {
  // Deliberately NOT `type: 'STATE'` (default type is FEDERAL): readiness logic never reads
  // `Jurisdiction.type`, and `state-coverage-matrix.test.ts` asserts an exact, UNSCOPED
  // `listByType('STATE')` count — the same reason `state-candidate-retrieval.test.ts` avoids
  // it. This test creates several jurisdictions per run; tagging them STATE would race that
  // count far more reliably than the "occasional" flake its own comment describes.
  const jurisdiction = await createTestJurisdiction(nextSuffix());
  const taxYear = await createTestTaxYear(freshYear());
  return { jurisdictionId: jurisdiction.id, taxYearId: taxYear.id };
}

describe.skipIf(!hasDatabase)('coverage.isPublishable — fail-closed by default', () => {
  beforeAll(async () => {
    // `TaxRule_no_overlapping_active_versions` (Phase 2) is scoped to `ruleKey` alone, with no
    // jurisdiction term — a documented, pre-existing schema gap (CLAUDE.md, Phase 5 Step 3.5),
    // not something SEO-04 may fix. It means a bare-literal `WITHHOLDING_METHOD` ACTIVE row
    // left over from an earlier run of THIS file would collide with the one the
    // "STALE_EVIDENCE" test below creates. Nothing else in the suite uses the bare literal
    // (every other fixture suffixes the key, e.g. `state-candidate-retrieval.test.ts`), so
    // clearing it here only ever removes this file's own leftovers.
    await testPrisma().taxRule.deleteMany({ where: { ruleKey: StateRuleKey.WITHHOLDING_METHOD } });
  });

  afterAll(async () => {
    await disconnect();
  });

  it('reports NO_APPROVAL when nothing has ever been granted', async () => {
    const { jurisdictionId, taxYearId } = await newContext();
    const result = await isPublishable(jurisdictionId, taxYearId, ['WITHHOLDING']);
    expect(result.publishable).toBe(false);
    expect(result.reason).toContain('NO_APPROVAL');
    expect(result.stale).toBe(false);
  });

  it('is publishable once a covering, current, non-stale approval exists', async () => {
    const { jurisdictionId, taxYearId } = await newContext();
    await grantReadinessApproval({
      jurisdictionId,
      taxYearId,
      capabilities: ['WITHHOLDING'],
      approvedByUserId: 'tester',
      reason: 'Integration test fixture approval',
    });

    const result = await isPublishable(jurisdictionId, taxYearId, ['WITHHOLDING']);
    expect(result).toEqual({
      publishable: true,
      reason: expect.stringContaining('OK'),
      stale: false,
    });
  });

  it('reports INSUFFICIENT_CAPABILITY even though a valid approval exists', async () => {
    const { jurisdictionId, taxYearId } = await newContext();
    await grantReadinessApproval({
      jurisdictionId,
      taxYearId,
      capabilities: ['WITHHOLDING'],
      approvedByUserId: 'tester',
      reason: 'Covers WITHHOLDING only',
    });

    const result = await isPublishable(jurisdictionId, taxYearId, ['WITHHOLDING', 'INCOME_TAX']);
    expect(result.publishable).toBe(false);
    expect(result.reason).toContain('INSUFFICIENT_CAPABILITY');
    expect(result.stale).toBe(false);
  });

  it('becomes STALE_EVIDENCE once the underlying rule evidence changes after approval', async () => {
    const { jurisdictionId, taxYearId } = await newContext();
    await grantReadinessApproval({
      jurisdictionId,
      taxYearId,
      capabilities: ['WITHHOLDING'],
      approvedByUserId: 'tester',
      reason: 'Approval granted before new evidence arrives',
    });

    const before = await isPublishable(jurisdictionId, taxYearId, ['WITHHOLDING']);
    expect(before.publishable).toBe(true);

    await testPrisma().taxRule.create({
      data: {
        ruleKey: StateRuleKey.WITHHOLDING_METHOD,
        // `(ruleKey, version)` is globally unique across all jurisdictions, and `version` is a
        // 32-bit int — this keeps reruns in the same session from colliding with a leftover
        // row from a prior run without overflowing.
        version: Date.now() % 1000000,
        taxYearId,
        jurisdictionId,
        category: 'STATE_WITHHOLDING',
        name: 'Synthetic evidence-change fixture',
        status: 'ACTIVE',
        verificationStatus: 'VERIFIED',
        effectiveFrom: new Date('2098-01-01T00:00:00.000Z'),
        payload: { note: 'synthetic-readiness-fixture' } as never,
      },
    });

    const after = await isPublishable(jurisdictionId, taxYearId, ['WITHHOLDING']);
    expect(after.publishable).toBe(false);
    expect(after.stale).toBe(true);
    expect(after.reason).toContain('STALE_EVIDENCE');

    // A fresh approval recomputed against the NEW evidence is publishable again.
    await grantReadinessApproval({
      jurisdictionId,
      taxYearId,
      capabilities: ['WITHHOLDING'],
      approvedByUserId: 'tester',
      reason: 'Re-approval after evidence changed',
    });
    const reapproved = await isPublishable(jurisdictionId, taxYearId, ['WITHHOLDING']);
    expect(reapproved.publishable).toBe(true);
  });

  it('reports REVOKED once every approval for the pair has been revoked', async () => {
    const { jurisdictionId, taxYearId } = await newContext();
    await grantReadinessApproval({
      jurisdictionId,
      taxYearId,
      capabilities: ['WITHHOLDING'],
      approvedByUserId: 'tester',
      reason: 'Will be revoked',
    });

    const current = await findCurrentApproval(jurisdictionId, taxYearId);
    expect(current).not.toBeNull();
    await revokeReadinessApproval({
      approvalId: current?.id ?? '',
      revokedByUserId: 'tester',
      revocationReason: 'Testing revocation',
    });

    const result = await isPublishable(jurisdictionId, taxYearId, ['WITHHOLDING']);
    expect(result.publishable).toBe(false);
    expect(result.reason).toContain('REVOKED');
  });

  it('reports EXPIRED once the only approval has passed its expiry', async () => {
    const { jurisdictionId, taxYearId } = await newContext();
    await grantReadinessApproval({
      jurisdictionId,
      taxYearId,
      capabilities: ['SUTA'],
      approvedByUserId: 'tester',
      reason: 'Expiry test fixture',
      expiresAt: new Date('2000-01-01T00:00:00.000Z'),
    });

    const result = await isPublishable(jurisdictionId, taxYearId, ['SUTA']);
    expect(result.publishable).toBe(false);
    expect(result.reason).toContain('EXPIRED');
  });

  it('rejects granting an approval with a blank reason', async () => {
    const { jurisdictionId, taxYearId } = await newContext();
    await expect(
      grantReadinessApproval({
        jurisdictionId,
        taxYearId,
        capabilities: ['ROUNDING'],
        approvedByUserId: 'tester',
        reason: '   ',
      }),
    ).rejects.toThrow();
  });

  it('rejects granting an approval with no capabilities', async () => {
    const { jurisdictionId, taxYearId } = await newContext();
    await expect(
      grantReadinessApproval({
        jurisdictionId,
        taxYearId,
        capabilities: [],
        approvedByUserId: 'tester',
        reason: 'No capabilities',
      }),
    ).rejects.toThrow();
  });

  it('rejects revoking a non-existent approval', async () => {
    await expect(
      revokeReadinessApproval({
        approvalId: 'does-not-exist',
        revokedByUserId: 'tester',
        revocationReason: 'n/a',
      }),
    ).rejects.toThrow();
  });

  it('never throws to the caller on a malformed tax year id — fails closed instead', async () => {
    const { jurisdictionId } = await newContext();
    const result = await isPublishable(jurisdictionId, 'not-a-number', ['WITHHOLDING']);
    expect(result.publishable).toBe(false);
    expect(result.reason).toContain('INVALID_TAX_YEAR');
  });
});

describe.skipIf(!hasDatabase)('TaxDataReadinessApproval — database-enforced immutability', () => {
  let approvalId = '';

  afterAll(async () => {
    // This approval — and therefore its jurisdiction and tax year — is intentionally left in
    // place: the whole point of this describe block is that the row below cannot be deleted
    // even on purpose. Same accepted `TEST-`-prefixed leak `AuditLog` already causes elsewhere
    // in this suite; `productionStateJurisdictions()`-style assertions ignore the prefix.
    await disconnect();
  });

  it('refuses to delete a row, even via a direct Prisma call bypassing the repository', async () => {
    const { jurisdictionId, taxYearId } = await newContext();
    const approval = await grantReadinessApproval({
      jurisdictionId,
      taxYearId,
      capabilities: ['WITHHOLDING'],
      approvedByUserId: 'tester',
      reason: 'DB constraint fixture',
    });
    approvalId = approval.id;

    await expect(
      testPrisma().taxDataReadinessApproval.delete({ where: { id: approvalId } }),
    ).rejects.toThrow();
  });

  it('refuses to update a non-revocation field directly', async () => {
    await expect(
      testPrisma().taxDataReadinessApproval.update({
        where: { id: approvalId },
        data: { reason: 'Tampered reason' },
      }),
    ).rejects.toThrow();
  });

  it('allows updating the revocation fields directly (what the repository itself does)', async () => {
    const updated = await testPrisma().taxDataReadinessApproval.update({
      where: { id: approvalId },
      data: {
        revokedAt: new Date(),
        revokedByUserId: 'tester',
        revocationReason: 'Direct revocation fields update',
      },
    });
    expect(updated.revokedAt).not.toBeNull();
  });
});

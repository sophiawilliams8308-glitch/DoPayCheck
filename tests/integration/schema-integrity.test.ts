import { afterAll, describe, expect, it } from 'vitest';

import { disconnect, hasDatabase, testPrisma } from './helpers/db';

/**
 * Migration and database integrity (Phase 2 scope item 13, 19).
 *
 * Asserts that the guarantees documented in the migration actually exist in the database,
 * rather than only in the Prisma schema.
 */

describe.skipIf(!hasDatabase)('database schema integrity', () => {
  afterAll(async () => {
    await disconnect();
  });

  it('creates every Phase 2 table', async () => {
    const rows = await testPrisma().$queryRaw<{ table_name: string }[]>`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
    `;
    const tables = rows.map((row) => row.table_name);
    for (const expected of [
      'Jurisdiction',
      'TaxYear',
      'Source',
      'TaxRule',
      'TaxRuleValue',
      'TaxRuleSource',
      'RuleConflict',
      'AuditLog',
    ]) {
      expect(tables).toContain(expected);
    }
  });

  it('records the Phase 2 migration as applied', async () => {
    const rows = await testPrisma().$queryRaw<{ migration_name: string; finished: boolean }[]>`
      SELECT migration_name, finished_at IS NOT NULL AS finished FROM _prisma_migrations
    `;
    const phase2 = rows.find((row) => row.migration_name.includes('phase2_rule_and_data_system'));
    expect(phase2).toBeDefined();
    expect(phase2?.finished).toBe(true);
  });

  it('installs the CHECK constraints the migration declares', async () => {
    const rows = await testPrisma().$queryRaw<{ conname: string }[]>`
      SELECT conname FROM pg_constraint
      WHERE contype = 'c' AND connamespace = 'public'::regnamespace
    `;
    const names = rows.map((row) => row.conname);
    for (const expected of [
      'TaxRule_effective_range_valid',
      'TaxRule_version_positive',
      'TaxYear_period_valid',
      'Jurisdiction_effective_range_valid',
      'Jurisdiction_not_self_parent',
    ]) {
      expect(names).toContain(expected);
    }
  });

  it('installs the exclusion constraint preventing overlapping ACTIVE versions', async () => {
    const rows = await testPrisma().$queryRaw<{ conname: string }[]>`
      SELECT conname FROM pg_constraint WHERE contype = 'x'
    `;
    expect(rows.map((row) => row.conname)).toContain('TaxRule_no_overlapping_active_versions');
  });

  it('installs the append-only AuditLog triggers', async () => {
    const rows = await testPrisma().$queryRaw<{ tgname: string }[]>`
      SELECT tgname FROM pg_trigger WHERE NOT tgisinternal
    `;
    const names = rows.map((row) => row.tgname);
    expect(names).toContain('AuditLog_no_update');
    expect(names).toContain('AuditLog_no_delete');
  });

  it('stores authoritative values as NUMERIC(28,12) and allows NULL', async () => {
    const rows = await testPrisma().$queryRaw<
      { data_type: string; numeric_precision: number; numeric_scale: number; is_nullable: string }[]
    >`
      SELECT data_type, numeric_precision, numeric_scale, is_nullable
      FROM information_schema.columns
      WHERE table_name = 'TaxRuleValue' AND column_name = 'numericValue'
    `;
    expect(rows[0]?.data_type).toBe('numeric');
    expect(rows[0]?.numeric_precision).toBe(28);
    expect(rows[0]?.numeric_scale).toBe(12);
    // NULL must remain possible: it is how NOT_STATED is represented (spec §19).
    expect(rows[0]?.is_nullable).toBe('YES');
  });

  it('contains no seeded tax rules — the seed ships zero tax data', async () => {
    // The seed deliberately ships no tax values (spec §2; CLAUDE.md §4).
    //
    // Scoped to exclude fixtures created by other integration suites, which run in parallel
    // against this same database. TWO exclusions are needed, because suites isolate
    // themselves in two different ways:
    //
    //   1. ruleKey `test.*` — the Phase 1–3 convention.
    //   2. a `TEST-` jurisdiction — the convention every suite follows via
    //      `createTestJurisdiction`. The Phase 4 federal suite writes CANONICAL `FED.*` keys
    //      on purpose: the resolver looks rules up by exact key, so a prefixed fixture would
    //      resolve to nothing and the suite would stop testing what it exists to test.
    //
    // The invariant is unchanged: a genuinely seeded rule lands under a REAL jurisdiction
    // (US, US-CA) and is still counted here.
    const nonTestRules = await testPrisma().taxRule.count({
      where: {
        NOT: { ruleKey: { startsWith: 'test.' } },
        jurisdiction: { code: { not: { startsWith: 'TEST-' } } },
      },
    });
    expect(nonTestRules).toBe(0);
  });

  it('seeds jurisdictions and tax years as reference data only', async () => {
    const federal = await testPrisma().jurisdiction.findUnique({ where: { code: 'US' } });
    // A migrated database is not a set-up database: `prisma migrate deploy` applies schema
    // but never runs the seed. Say so, so the remedy is obvious rather than deduced.
    expect(
      federal,
      'Reference geography is missing. Run `npm run db:seed` — it is idempotent and seeds ' +
        'no tax data.',
    ).not.toBeNull();
    // Multiple years prove nothing is pinned to a single tax year (spec §23).
    const years = await testPrisma().taxYear.count({ where: { year: { gte: 2025, lte: 2027 } } });
    expect(years).toBeGreaterThanOrEqual(3);
  });
});

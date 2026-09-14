import { afterAll, describe, expect, it } from 'vitest';

import { listByType } from '@/lib/jurisdictions/repository';
import { STATE_CAPABILITY_COUNT } from '@/lib/tax/state/coverage/capabilities';
import {
  CoverageStatus,
  buildCoverageMatrix,
  coverageCellKey,
  isSupported,
  summarizeCoverage,
} from '@/lib/tax/state/coverage/coverage';

import {
  cleanupBySuffix,
  createTestJurisdiction,
  disconnect,
  hasDatabase,
  uniqueSuffix,
} from './helpers/db';

/**
 * The 51-jurisdiction coverage matrix, against the real seeded jurisdictions.
 *
 * The jurisdiction list is DERIVED from the seeded repository, never duplicated
 * here as a literal. A second copy of the state list in test code is a second
 * thing to keep in step, and the one in `prisma/seed.ts` is authoritative.
 *
 * Reads only, apart from one test that proves the scoping below actually
 * scopes; that test cleans up after itself in a `finally`.
 */

const TAX_YEAR = 2099;

/** Phase 5 scope: 50 states + DC, territories excluded. */
const EXPECTED_JURISDICTIONS = 51;

/**
 * The SEEDED state jurisdictions, excluding temporary fixtures.
 *
 * Integration files run in parallel against one database, and several suites
 * create STATE-typed jurisdictions through `createTestJurisdiction`, which codes
 * them `TEST-<suffix>`. An unscoped `listByType('STATE')` counted those while
 * they were in flight — 54 instead of 51, and 689 cells instead of 663 —
 * depending purely on worker scheduling.
 *
 * Scoping on the `TEST-` code mirrors `schema-integrity.test.ts`, which solved
 * the same problem on the same convention. The invariant is unchanged: a real
 * seeded jurisdiction carries a `US-` code and is still counted.
 */
async function productionStateJurisdictions(): Promise<
  { code: string; name: string; stateCode: string | null }[]
> {
  const states = await listByType('STATE');
  return states.filter((jurisdiction) => !jurisdiction.code.startsWith('TEST-'));
}

describe.skipIf(!hasDatabase)('state coverage matrix (51 x 13)', () => {
  afterAll(async () => {
    await disconnect();
  });

  it('finds exactly 51 seeded STATE jurisdictions', async () => {
    const states = await productionStateJurisdictions();
    expect(states.length).toBe(EXPECTED_JURISDICTIONS);
  });

  it('includes the District of Columbia as the 51st jurisdiction', async () => {
    // Matched on `stateCode` rather than `code`, so this does not depend on the
    // `US-` prefix the seed happens to build.
    const states = await productionStateJurisdictions();
    const dc = states.find((jurisdiction) => jurisdiction.stateCode === 'DC');
    expect(dc, 'DC must be present — it is in Phase 5 scope').toBeDefined();
    expect(dc?.name).toBe('District of Columbia');
  });

  it('excludes US territories', async () => {
    // Territories are out of Phase 5 scope. If one is ever seeded, this fails
    // rather than silently widening the matrix.
    const states = await productionStateJurisdictions();
    const stateCodes = new Set(states.map((jurisdiction) => jurisdiction.stateCode));
    for (const territory of ['PR', 'GU', 'VI', 'AS', 'MP']) {
      expect(stateCodes.has(territory), `${territory} must not be in Phase 5 scope`).toBe(false);
    }
  });

  it('builds exactly 663 cells', async () => {
    const states = await productionStateJurisdictions();
    const matrix = buildCoverageMatrix(
      states.map((jurisdiction) => jurisdiction.code),
      TAX_YEAR,
    );
    expect(STATE_CAPABILITY_COUNT).toBe(13);
    expect(matrix.cells.length).toBe(EXPECTED_JURISDICTIONS * STATE_CAPABILITY_COUNT);
    expect(matrix.cells.length).toBe(663);
  });

  it('leaves every production cell PENDING_RESEARCH', async () => {
    // No state may be marked supported because generic code exists. Every cell
    // starts as an open research question and stays one until a human closes it.
    const states = await productionStateJurisdictions();
    const matrix = buildCoverageMatrix(
      states.map((jurisdiction) => jurisdiction.code),
      TAX_YEAR,
    );
    const summary = summarizeCoverage(matrix);
    expect(summary.PENDING_RESEARCH).toBe(663);
    expect(summary.SUPPORTED).toBe(0);
    expect(matrix.cells.every((cell) => !isSupported(cell))).toBe(true);
  });

  it('contains no duplicate cell across all 663', async () => {
    const states = await productionStateJurisdictions();
    const matrix = buildCoverageMatrix(
      states.map((jurisdiction) => jurisdiction.code),
      TAX_YEAR,
    );
    const keys = matrix.cells.map((cell) =>
      coverageCellKey(cell.jurisdictionCode, cell.capability, cell.taxYear),
    );
    expect(new Set(keys).size).toBe(663);
  });

  it('counts a real jurisdiction and ignores a temporary TEST- one', async () => {
    // Proves the scoping is real rather than incidental: a TEST- jurisdiction is
    // created, the production count must NOT move, and the seeded jurisdictions
    // must still be there. Without this, the filter could exclude everything and
    // the suite would stay green for the wrong reason.
    const suffix = uniqueSuffix();
    try {
      const before = await productionStateJurisdictions();
      expect(before.length).toBe(EXPECTED_JURISDICTIONS);

      await createTestJurisdiction(suffix, { type: 'STATE' });

      // Unscoped, the temporary jurisdiction IS visible — the race is real.
      const unscoped = await listByType('STATE');
      expect(unscoped.some((jurisdiction) => jurisdiction.code === `TEST-${suffix}`)).toBe(true);
      expect(unscoped.length).toBe(EXPECTED_JURISDICTIONS + 1);

      // Scoped, it is excluded and the real jurisdictions still count.
      const after = await productionStateJurisdictions();
      expect(after.length).toBe(EXPECTED_JURISDICTIONS);
      expect(after.some((jurisdiction) => jurisdiction.code === `TEST-${suffix}`)).toBe(false);
      expect(after.some((jurisdiction) => jurisdiction.stateCode === 'DC')).toBe(true);

      // And the matrix built from the scoped list is still exactly 663.
      const matrix = buildCoverageMatrix(
        after.map((jurisdiction) => jurisdiction.code),
        TAX_YEAR,
      );
      expect(matrix.cells.length).toBe(663);
    } finally {
      // No residue, even if an assertion above fails.
      await cleanupBySuffix(suffix);
    }
  });

  it('records no coverage rows in the database — Step 2 persists nothing', async () => {
    // Production coverage records must not be populated in Step 2, and there is
    // no table for them: the model is in-memory only until a later decision.
    const states = await productionStateJurisdictions();
    expect(states.length).toBeGreaterThan(0);
    const matrix = buildCoverageMatrix(
      states.map((jurisdiction) => jurisdiction.code),
      TAX_YEAR,
    );
    expect(matrix.cells.every((cell) => cell.evidence.sourceIds.length === 0)).toBe(true);
    expect(matrix.cells.every((cell) => cell.status === CoverageStatus.PENDING_RESEARCH)).toBe(
      true,
    );
  });
});

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

import { disconnect, hasDatabase } from './helpers/db';

/**
 * The 51-jurisdiction coverage matrix, against the real seeded jurisdictions.
 *
 * The jurisdiction list is DERIVED from the seeded repository, never duplicated
 * here as a literal. A second copy of the state list in test code is a second
 * thing to keep in step, and the one in `prisma/seed.ts` is authoritative.
 *
 * Reads only. This suite creates nothing and writes nothing.
 */

const TAX_YEAR = 2099;

/** Phase 5 scope: 50 states + DC, territories excluded. */
const EXPECTED_JURISDICTIONS = 51;

describe.skipIf(!hasDatabase)('state coverage matrix (51 x 13)', () => {
  afterAll(async () => {
    await disconnect();
  });

  it('finds exactly 51 seeded STATE jurisdictions', async () => {
    const states = await listByType('STATE');
    expect(states.length).toBe(EXPECTED_JURISDICTIONS);
  });

  it('includes the District of Columbia as the 51st jurisdiction', async () => {
    // Matched on `stateCode` rather than `code`, so this does not depend on the
    // `US-` prefix the seed happens to build.
    const states = await listByType('STATE');
    const dc = states.find((jurisdiction) => jurisdiction.stateCode === 'DC');
    expect(dc, 'DC must be present — it is in Phase 5 scope').toBeDefined();
    expect(dc?.name).toBe('District of Columbia');
  });

  it('excludes US territories', async () => {
    // Territories are out of Phase 5 scope. If one is ever seeded, this fails
    // rather than silently widening the matrix.
    const states = await listByType('STATE');
    const stateCodes = new Set(states.map((jurisdiction) => jurisdiction.stateCode));
    for (const territory of ['PR', 'GU', 'VI', 'AS', 'MP']) {
      expect(stateCodes.has(territory), `${territory} must not be in Phase 5 scope`).toBe(false);
    }
  });

  it('builds exactly 663 cells', async () => {
    const states = await listByType('STATE');
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
    const states = await listByType('STATE');
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
    const states = await listByType('STATE');
    const matrix = buildCoverageMatrix(
      states.map((jurisdiction) => jurisdiction.code),
      TAX_YEAR,
    );
    const keys = matrix.cells.map((cell) =>
      coverageCellKey(cell.jurisdictionCode, cell.capability, cell.taxYear),
    );
    expect(new Set(keys).size).toBe(663);
  });

  it('records no coverage rows in the database — Step 2 persists nothing', async () => {
    // Production coverage records must not be populated in Step 2, and there is
    // no table for them: the model is in-memory only until a later decision.
    const states = await listByType('STATE');
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

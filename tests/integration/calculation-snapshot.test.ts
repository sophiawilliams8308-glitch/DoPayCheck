import { afterAll, describe, expect, it } from 'vitest';

import {
  CalculationStatus,
  ENGINE_VERSION,
  GENERIC_CURRENCY_POLICY,
  calculatePaycheck,
} from '@/lib/calculator';
import {
  buildSnapshot,
  resultsMatch,
  toPersistablePayload,
} from '@/lib/calculator/snapshot/snapshot';
import type { CalculationInput } from '@/lib/calculator/types/input';
import type { ResolvedRuleSet } from '@/lib/calculator/types/rules';

import { disconnect, hasDatabase, testPrisma, uniqueSuffix } from './helpers/db';

/**
 * Calculation snapshot persistence and historical reproducibility (spec §40).
 *
 * NO TAX VALUES — the rule fixture carries identifiers only.
 */

const suffix = uniqueSuffix();
const policy = GENERIC_CURRENCY_POLICY;

const input: CalculationInput = {
  taxYear: 2099,
  effectiveDate: new Date('2099-06-15T00:00:00.000Z'),
  employee: { workLocation: { stateCode: 'US-ZZ' } },
  pay: { basis: 'SALARY', payFrequency: 'MONTHLY', annualSalary: '120000.00' },
  w4: { filingStatus: 'TEST_STATUS' },
};

const rules: ResolvedRuleSet = {
  byCategory: {
    ['SOCIAL_SECURITY']: {
      found: true,
      rule: {
        reference: {
          ruleId: `rule-${suffix}`,
          ruleKey: `test.${suffix}.ss`,
          version: 3,
          category: 'SOCIAL_SECURITY',
          taxYear: 2099,
          jurisdictionId: 'jur-test',
          jurisdictionCode: 'US',
          effectiveFrom: new Date('2099-01-01T00:00:00.000Z'),
          effectiveTo: null,
          sourceIds: [`src-${suffix}`],
          verified: true,
        },
        values: [{ key: 'component', groupKey: '', ordinal: 0, value: '1', verified: true }],
        payload: null,
      },
    },
  },
};

describe.skipIf(!hasDatabase)('calculation snapshot persistence', () => {
  afterAll(async () => {
    await testPrisma().calculationSnapshot.deleteMany({
      where: { result: { path: ['engineVersion'], equals: ENGINE_VERSION }, taxYear: 2099 },
    });
    await disconnect();
  });

  it('persists a snapshot with input, result, rule versions and sources', async () => {
    const result = calculatePaycheck(input, { rounding: policy, rules });
    const snapshot = buildSnapshot(input, result);

    const stored = await testPrisma().calculationSnapshot.create({
      data: toPersistablePayload(snapshot) as never,
      select: {
        id: true,
        engineVersion: true,
        taxYear: true,
        status: true,
        sourceIds: true,
        localCodes: true,
      },
    });

    expect(stored.engineVersion).toBe(ENGINE_VERSION);
    expect(stored.taxYear).toBe(2099);
    expect(stored.status).toBe(result.status);
    expect(stored.sourceIds).toEqual([`src-${suffix}`]);
    expect(stored.localCodes).toEqual([]);
  });

  it('REPRODUCES a historical result exactly from the stored snapshot', async () => {
    const original = calculatePaycheck(input, { rounding: policy, rules });
    const snapshot = buildSnapshot(input, original);

    const stored = await testPrisma().calculationSnapshot.create({
      data: toPersistablePayload(snapshot) as never,
      select: { id: true, result: true },
    });

    const readBack = await testPrisma().calculationSnapshot.findUniqueOrThrow({
      where: { id: stored.id },
      select: { result: true },
    });

    // The engine is deterministic, so replaying the same input and rules reproduces the
    // original exactly — this is what keeps an old report explainable.
    const replayed = calculatePaycheck(input, { rounding: policy, rules });
    expect(resultsMatch(original, replayed)).toBe(true);

    // Compared structurally, not as raw JSON text: PostgreSQL JSONB does not preserve key
    // order, so string equality would fail for an identical document.
    expect(readBack.result).toEqual(snapshot.result);
  });

  it('stores monetary values as exact strings, never JSON numbers', async () => {
    const result = calculatePaycheck(input, { rounding: policy, rules });
    const stored = await testPrisma().calculationSnapshot.create({
      data: toPersistablePayload(buildSnapshot(input, result)) as never,
      select: { result: true },
    });
    const serialized = JSON.stringify(stored.result);
    // 120000 / 12 = 10000 monthly, carried as a string.
    expect(serialized).toContain('"total":"10000"');
    expect(serialized).not.toContain('"total":10000');
  });

  it('preserves rule version and provenance in the snapshot', async () => {
    const result = calculatePaycheck(input, { rounding: policy, rules });
    const stored = await testPrisma().calculationSnapshot.create({
      data: toPersistablePayload(buildSnapshot(input, result)) as never,
      select: { ruleReferences: true },
    });
    const serialized = JSON.stringify(stored.ruleReferences);
    expect(serialized).toContain('"version":3');
    expect(serialized).toContain(`src-${suffix}`);
  });

  it('records the status the calculation actually reached', async () => {
    const result = calculatePaycheck(input, { rounding: policy, rules: { byCategory: {} } });
    expect(result.status).toBe(CalculationStatus.INCOMPLETE);
    const stored = await testPrisma().calculationSnapshot.create({
      data: toPersistablePayload(buildSnapshot(input, result)) as never,
      select: { status: true },
    });
    expect(stored.status).toBe(CalculationStatus.INCOMPLETE);
  });
});

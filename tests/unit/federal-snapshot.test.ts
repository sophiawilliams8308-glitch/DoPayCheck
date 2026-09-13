import { describe, expect, it } from 'vitest';

import { calculateFederalTaxes } from '@/lib/tax/federal';
import {
  buildFederalSnapshotBlock,
  hashDetail,
  ruleSetFromSnapshot,
  verifyDetailHashes,
} from '@/lib/tax/federal/snapshot/federal-snapshot';
import { FederalRuleKey } from '@/lib/tax/federal/rule-keys';

import { syntheticRuleSet } from '../fixtures/federal/synthetic-rules';
import { context } from '../fixtures/federal/context';

/**
 * Federal snapshot and reproducibility — spec §29, decision D-SNAP-1.
 *
 * §29.3 calls the last test here the definitive one: publish a new rule
 * version, recompute a stored snapshot, and assert the historical result is
 * unchanged.
 */

describe('snapshot contents (§29.1)', () => {
  it('embeds the resolved rule DETAIL, not just identifiers', () => {
    const ctx = context();
    const block = buildFederalSnapshotBlock(ctx.ruleSet, calculateFederalTaxes(ctx));
    const ss = block.resolvedRuleSet.find((rule) => rule.ruleKey === FederalRuleKey.SS_WAGE_BASE);
    expect(ss?.detail).toMatchObject({ amount: '1000', applicability: 'APPLIES' });
  });

  it('records rule id, version id, verification status and sources for each rule', () => {
    const ctx = context();
    const block = buildFederalSnapshotBlock(ctx.ruleSet, calculateFederalTaxes(ctx));
    for (const rule of block.resolvedRuleSet) {
      expect(rule.ruleId).not.toBe('');
      expect(rule.ruleVersionId).toContain('@');
      expect(rule.sourceIds.length).toBeGreaterThan(0);
      expect(['VERIFIED', 'NOT_APPLICABLE']).toContain(rule.verificationStatus);
    }
  });

  it('carries a detailHash over every embedded detail', () => {
    const ctx = context();
    const block = buildFederalSnapshotBlock(ctx.ruleSet, calculateFederalTaxes(ctx));
    for (const rule of block.resolvedRuleSet) {
      expect(rule.detailHash).toMatch(/^[0-9a-f]{64}$/);
      expect(rule.detailHash).toBe(hashDetail(rule.detail));
    }
    expect(verifyDetailHashes(block)).toEqual([]);
  });

  it('detects tampering with an embedded detail', () => {
    const ctx = context();
    const block = buildFederalSnapshotBlock(ctx.ruleSet, calculateFederalTaxes(ctx));
    const tampered = {
      ...block,
      resolvedRuleSet: block.resolvedRuleSet.map((rule, index) =>
        index === 0 ? { ...rule, detail: { tampered: true } } : rule,
      ),
    };
    expect(verifyDetailHashes(tampered).length).toBe(1);
  });

  it('hashes independently of key order', () => {
    expect(hashDetail({ a: 1, b: 2 })).toBe(hashDetail({ b: 2, a: 1 }));
  });

  it('captures methodology, flags, buckets and worksheet intermediates', () => {
    const ctx = context();
    const block = buildFederalSnapshotBlock(ctx.ruleSet, calculateFederalTaxes(ctx));
    expect(block.engineVersion).toBe('4.1.0-phase4');
    expect(block.methodology.fitMethod).toBe('PUB15T_PERCENTAGE_AUTOMATED_WORKSHEET_1A');
    expect(block.worksheetIntermediates['1c']).toBe('2600');
    expect(block.buckets['socialSecurityWages']).toBe('100');
    expect(block.featureFlags['FEDERAL_NRA_ADJUSTMENT']).toBe(false);
  });

  it('serializes money as strings, never JSON numbers', () => {
    const ctx = context();
    const json = JSON.stringify(buildFederalSnapshotBlock(ctx.ruleSet, calculateFederalTaxes(ctx)));
    expect(json).toContain('"1c":"2600"');
    expect(json).not.toContain('"1c":2600');
  });
});

describe('historical reproducibility (§29.2, §29.3)', () => {
  it('replays a snapshot to the identical result', () => {
    const ctx = context();
    const original = calculateFederalTaxes(ctx);
    const block = buildFederalSnapshotBlock(ctx.ruleSet, original);

    const replayed = calculateFederalTaxes({ ...ctx, ruleSet: ruleSetFromSnapshot(block) });

    expect(JSON.stringify(replayed.employee)).toBe(JSON.stringify(original.employee));
    expect(JSON.stringify(replayed.employer)).toBe(JSON.stringify(original.employer));
    expect(replayed.worksheetLines).toEqual(original.worksheetLines);
  });

  it('PUBLISHING A NEW RULE VERSION CANNOT MUTATE A HISTORICAL RESULT', () => {
    const ctx = context();
    const original = calculateFederalTaxes(ctx);
    const block = buildFederalSnapshotBlock(ctx.ruleSet, original);

    // A later publication raises the Social Security employee rate.
    const laterWorld = syntheticRuleSet({
      overrides: {
        [FederalRuleKey.SS_EMPLOYEE_RATE]: {
          shape: 'RATE',
          rate: '50',
          unit: 'PERCENT',
          appliesTo: 'EMPLOYEE',
        },
      },
    });

    // Today's calculation moves...
    const today = calculateFederalTaxes({ ...ctx, ruleSet: laterWorld });
    expect(today.employee.socialSecurityEmployee.amount).toBe('50');

    // ...and the snapshot does not.
    const replayed = calculateFederalTaxes({ ...ctx, ruleSet: ruleSetFromSnapshot(block) });
    expect(replayed.employee.socialSecurityEmployee.amount).toBe('10');
    expect(replayed.employee.socialSecurityEmployee.amount).toBe(
      original.employee.socialSecurityEmployee.amount,
    );
  });

  it('deep-copies detail so mutating a live rule cannot reach into history', () => {
    const ctx = context();
    const block = buildFederalSnapshotBlock(ctx.ruleSet, calculateFederalTaxes(ctx));
    const snapshotDetail = block.resolvedRuleSet.find(
      (rule) => rule.ruleKey === FederalRuleKey.SS_EMPLOYEE_RATE,
    )?.detail;
    const live = ctx.ruleSet.entries[FederalRuleKey.SS_EMPLOYEE_RATE];
    if (live === undefined || !live.available) throw new Error('fixture');
    expect(snapshotDetail).not.toBe(live.rule.detail);
  });
});

import { describe, expect, it } from 'vitest';

import { calculateFederalTaxes } from '@/lib/tax/federal';
import {
  buildFederalSnapshotBlock,
  ruleSetFromSnapshot,
} from '@/lib/tax/federal/snapshot/federal-snapshot';
import { FEDERAL_ROUNDING_V1 } from '@/lib/tax/federal/rounding/federal-rounding';
import { FederalRuleKey } from '@/lib/tax/federal/rule-keys';

import { syntheticRuleSet } from '../fixtures/federal/synthetic-rules';
import { context } from '../fixtures/federal/context';

/**
 * Federal snapshot and historical reproducibility (Phase 4, D-SNAP-1).
 *
 * The property under test is the one that matters years later: a snapshot must reproduce its
 * original answer even after the rules it used have been superseded.
 */

describe('federal snapshot block', () => {
  it('embeds the resolved rule DETAIL, not just rule IDs', () => {
    const ctx = context();
    const result = calculateFederalTaxes(ctx);
    const block = buildFederalSnapshotBlock(ctx.ruleSet, result, FEDERAL_ROUNDING_V1.version);

    const ss = block.resolvedRules.find((rule) => rule.key === FederalRuleKey.FICA_SOCIAL_SECURITY);
    expect(ss).toBeDefined();
    expect(ss?.detail).toMatchObject({ employeeRate: '0.1', wageBase: '1000' });
  });

  it('records identity, provenance and verification for every rule used', () => {
    const ctx = context();
    const block = buildFederalSnapshotBlock(
      ctx.ruleSet,
      calculateFederalTaxes(ctx),
      FEDERAL_ROUNDING_V1.version,
    );

    for (const rule of block.resolvedRules) {
      expect(rule.ruleId).not.toBe('');
      expect(rule.version).toBeGreaterThan(0);
      expect(rule.sourceIds.length).toBeGreaterThan(0);
      expect(rule.verificationStatus).toBe('VERIFIED');
    }
  });

  it('captures engine version, methodology, rounding policy and feature flags', () => {
    const ctx = context();
    const block = buildFederalSnapshotBlock(
      ctx.ruleSet,
      calculateFederalTaxes(ctx),
      FEDERAL_ROUNDING_V1.version,
    );

    expect(block.engineVersion).toBe('4.0.0-phase4');
    expect(block.methodology).toBe('PUB15T_WORKSHEET_1A+FICA+FUTA');
    expect(block.roundingPolicy).toBe('federal-rounding-v1');
    expect(block.featureFlags['FEDERAL_NRA_ADJUSTMENT']).toBe(false);
  });

  it('captures worksheet intermediates and wage buckets', () => {
    const ctx = context();
    const block = buildFederalSnapshotBlock(
      ctx.ruleSet,
      calculateFederalTaxes(ctx),
      FEDERAL_ROUNDING_V1.version,
    );
    expect(block.worksheetLines['1c']).toBe('2600');
    expect(block.wageBuckets['socialSecurityWages']).toBe('100');
  });

  it('serializes monetary values as strings, never JSON numbers', () => {
    const ctx = context();
    const block = buildFederalSnapshotBlock(
      ctx.ruleSet,
      calculateFederalTaxes(ctx),
      FEDERAL_ROUNDING_V1.version,
    );
    const json = JSON.stringify(block);
    expect(json).toContain('"1c":"2600"');
    expect(json).not.toContain('"1c":2600');
  });
});

describe('historical reproducibility', () => {
  it('replays a snapshot to the identical result', () => {
    const ctx = context();
    const original = calculateFederalTaxes(ctx);
    const block = buildFederalSnapshotBlock(ctx.ruleSet, original, FEDERAL_ROUNDING_V1.version);

    const replayed = calculateFederalTaxes({ ...ctx, ruleSet: ruleSetFromSnapshot(block) });

    expect(replayed.withholding.total.amount).toBe(original.withholding.total.amount);
    expect(replayed.fica.socialSecurityEmployee.amount).toBe(
      original.fica.socialSecurityEmployee.amount,
    );
    expect(replayed.employer?.total.amount).toBe(original.employer?.total.amount);
  });

  it('PUBLISHING A LATER RULE CANNOT MOVE A HISTORICAL RESULT', () => {
    const ctx = context();
    const original = calculateFederalTaxes(ctx);
    const block = buildFederalSnapshotBlock(ctx.ruleSet, original, FEDERAL_ROUNDING_V1.version);

    // A later publication changes the Social Security rate from 10% to 50%.
    const laterRules = syntheticRuleSet();
    const entry = laterRules.entries[FederalRuleKey.FICA_SOCIAL_SECURITY];
    if (entry === undefined || !entry.available) throw new Error('fixture');
    const supersededWorld = {
      ...laterRules,
      entries: {
        ...laterRules.entries,
        [FederalRuleKey.FICA_SOCIAL_SECURITY]: {
          available: true as const,
          rule: {
            ...entry.rule,
            detail: { employeeRate: '0.5', employerRate: '0.5', wageBase: '1000' },
          },
        },
      },
    };

    // Today's calculation moves...
    const today = calculateFederalTaxes({ ...ctx, ruleSet: supersededWorld });
    expect(today.fica.socialSecurityEmployee.amount).toBe('50');

    // ...but the snapshot does not.
    const replayed = calculateFederalTaxes({ ...ctx, ruleSet: ruleSetFromSnapshot(block) });
    expect(replayed.fica.socialSecurityEmployee.amount).toBe('10');
    expect(replayed.fica.socialSecurityEmployee.amount).toBe(
      original.fica.socialSecurityEmployee.amount,
    );
  });

  it('deep-copies detail so mutating a live rule cannot reach into history', () => {
    const ctx = context();
    const block = buildFederalSnapshotBlock(
      ctx.ruleSet,
      calculateFederalTaxes(ctx),
      FEDERAL_ROUNDING_V1.version,
    );
    const snapshotDetail = block.resolvedRules.find(
      (rule) => rule.key === FederalRuleKey.FICA_SOCIAL_SECURITY,
    )?.detail as { employeeRate: string };

    const live = ctx.ruleSet.entries[FederalRuleKey.FICA_SOCIAL_SECURITY];
    if (live === undefined || !live.available) throw new Error('fixture');
    const liveDetail = live.rule.detail as { employeeRate: string };

    expect(snapshotDetail).not.toBe(liveDetail);
    expect(snapshotDetail.employeeRate).toBe('0.1');
  });

  it('carries the engine version so a result can be matched to the engine that made it', () => {
    const ctx = context();
    const block = buildFederalSnapshotBlock(
      ctx.ruleSet,
      calculateFederalTaxes(ctx),
      FEDERAL_ROUNDING_V1.version,
    );
    expect(block.engineVersion).toBe(calculateFederalTaxes(ctx).engineVersion);
  });
});

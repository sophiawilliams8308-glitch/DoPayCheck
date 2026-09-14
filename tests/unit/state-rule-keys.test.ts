import { describe, expect, it } from 'vitest';

import { FederalRuleKey } from '@/lib/tax/federal/rule-keys';
import {
  ALL_STATE_PROGRAMS,
  ALL_STATE_RULE_KEYS,
  FEDERAL_KEY_PREFIX,
  PROGRAM_BUCKET,
  STATE_BUCKETS,
  STATE_KEY_PREFIX,
  StateProgram,
  StateRuleKey,
  isStateRuleKey,
} from '@/lib/tax/state/ruleKeys';

/** Canonical state rule-key namespace (Phase 5 Step 1). */

describe('canonical key uniqueness', () => {
  it('declares every key exactly once', () => {
    expect(new Set(ALL_STATE_RULE_KEYS).size).toBe(ALL_STATE_RULE_KEYS.length);
  });

  it('gives every constant name a distinct string', () => {
    const names = Object.keys(StateRuleKey);
    expect(new Set(names).size).toBe(names.length);
    expect(names.length).toBe(ALL_STATE_RULE_KEYS.length);
  });
});

describe('state namespace validity', () => {
  it('prefixes every key with the state namespace', () => {
    for (const key of ALL_STATE_RULE_KEYS) {
      expect(key.startsWith(STATE_KEY_PREFIX), `${key} is not in the STATE namespace`).toBe(true);
    }
  });

  it('names no jurisdiction in any key', () => {
    // A key that embedded a state code would force a branch per state and turn
    // one 50-state engine into fifty engines that drift apart.
    const twoLetterSegment = /\.[A-Z]{2}\./;
    for (const key of ALL_STATE_RULE_KEYS) {
      const withoutPrefix = key.slice(STATE_KEY_PREFIX.length);
      expect(
        twoLetterSegment.test(`.${withoutPrefix}.`),
        `${key} looks jurisdiction-specific`,
      ).toBe(false);
    }
  });

  it('recognises its own keys and rejects anything else', () => {
    expect(isStateRuleKey(StateRuleKey.PIT_RATE_BRACKETS)).toBe(true);
    expect(isStateRuleKey('STATE.NOT.A.REAL.KEY')).toBe(false);
    expect(isStateRuleKey(FederalRuleKey.SS_EMPLOYEE_RATE)).toBe(false);
  });
});

describe('state and federal namespaces are disjoint', () => {
  it('shares no key string with the federal namespace', () => {
    const federal = new Set<string>(Object.values(FederalRuleKey));
    for (const key of ALL_STATE_RULE_KEYS) {
      expect(federal.has(key), `${key} collides with a federal key`).toBe(false);
    }
  });

  it('never begins a state key with the federal prefix', () => {
    for (const key of ALL_STATE_RULE_KEYS) {
      expect(key.startsWith(FEDERAL_KEY_PREFIX)).toBe(false);
    }
  });

  it('never begins a federal key with the state prefix', () => {
    for (const key of Object.values(FederalRuleKey)) {
      expect(key.startsWith(STATE_KEY_PREFIX)).toBe(false);
    }
  });
});

describe('programmes and buckets', () => {
  it('gives every programme its own bucket', () => {
    for (const program of ALL_STATE_PROGRAMS) {
      const bucket = PROGRAM_BUCKET[program];
      expect(STATE_BUCKETS).toContain(bucket);
    }
    // Independent buckets: no two programmes read the same taxable figure.
    const buckets = ALL_STATE_PROGRAMS.map((program) => PROGRAM_BUCKET[program]);
    expect(new Set(buckets).size).toBe(buckets.length);
  });

  it('covers every declared programme', () => {
    expect([...ALL_STATE_PROGRAMS].sort()).toEqual([...Object.values(StateProgram)].sort());
  });
});

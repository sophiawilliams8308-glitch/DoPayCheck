import type { RuleCategory } from '@/lib/db/generated/client';

import type { IncompleteReason } from './status';

/**
 * The rule contract the engine consumes (spec §3, §4).
 *
 * ===========================================================================
 * WHY THE ENGINE DOES NOT TOUCH THE DATABASE
 *
 * `calculatePaycheck` receives rules that have ALREADY been resolved, as plain data. It never
 * imports a repository or a Prisma client.
 *
 * Three consequences, all deliberate:
 *   1. The engine is synchronous, pure and deterministic — identical input plus identical
 *      rules always yields an identical result.
 *   2. Every stage is testable without a database.
 *   3. Persistence cannot contaminate calculation methodology (spec §3).
 *
 * A thin service layer performs resolution and hands the outcome in.
 * ===========================================================================
 */

/** Provenance retained for every rule that influenced a result (spec §21, §40). */
export interface RuleReference {
  readonly ruleId: string;
  readonly ruleKey: string;
  readonly version: number;
  readonly category: RuleCategory;
  readonly taxYear: number;
  readonly jurisdictionId: string;
  readonly jurisdictionCode: string;
  readonly effectiveFrom: Date;
  readonly effectiveTo: Date | null;
  /** Sources supporting this rule. Empty means unverified — never fabricated (spec §21). */
  readonly sourceIds: readonly string[];
  /** False when no verified source backs the rule; the result is marked accordingly. */
  readonly verified: boolean;
}

/** One authoritative component value, exactly as stored. */
export interface RuleValue {
  readonly key: string;
  readonly groupKey: string;
  readonly ordinal: number;
  /**
   * Exact decimal STRING, or null when the official source does not state a value.
   *
   * `null` is NEVER zero (spec §19). A consumer that needs this value must report
   * RULE_VALUES_PENDING rather than defaulting.
   */
  readonly value: string | null;
  readonly unit?: string;
  /** True only when the component is VERIFIED. */
  readonly verified: boolean;
}

/** A resolved rule plus its authoritative values. */
export interface ResolvedRule {
  readonly reference: RuleReference;
  readonly values: readonly RuleValue[];
  /** Category-specific structured payload, or null while PENDING DATA. */
  readonly payload: unknown;
}

/** Outcome of resolving one category. Mirrors Phase 2's resolver, never guessing. */
export type RuleLookup =
  | { readonly found: true; readonly rule: ResolvedRule }
  | { readonly found: false; readonly reason: IncompleteReason; readonly detail?: string };

/**
 * Rules supplied to one calculation, keyed by category.
 *
 * A category absent from the map is treated as NO_APPLICABLE_RULE — the engine never
 * substitutes a default (spec §2).
 */
export interface ResolvedRuleSet {
  readonly byCategory: Readonly<Partial<Record<RuleCategory, RuleLookup>>>;
}

/** Looks up a category, defaulting to a "not found" outcome rather than undefined. */
export function lookupRule(ruleSet: ResolvedRuleSet, category: RuleCategory): RuleLookup {
  return (
    ruleSet.byCategory[category] ?? {
      found: false,
      reason: 'NO_APPLICABLE_RULE',
      detail: `No rule supplied for category ${category}`,
    }
  );
}

/** Reads one named value from a rule. Returns null when absent or not stated. */
export function readRuleValue(rule: ResolvedRule, key: string, groupKey = ''): RuleValue | null {
  return rule.values.find((value) => value.key === key && value.groupKey === groupKey) ?? null;
}

import type { RuleReference } from '@/lib/calculator/types/rules';

import type { FederalUnavailable } from '../errors/federal-errors';
import type { FederalRuleKey } from '../rule-keys';

/**
 * The immutable rule set Stage B consumes (Phase 4).
 *
 * ===========================================================================
 * FROZEN BY CONSTRUCTION.
 *
 * Stage A resolves rules once and freezes the result. Stage B then computes from this object
 * alone — no query, no clock, no environment. That is what makes a historical calculation
 * reproducible: replay the same frozen set and the same input, get the same answer, whatever
 * has since been published.
 * ===========================================================================
 */

/** One resolved federal rule: its provenance, its verification state and its detail. */
export interface ResolvedFederalRule {
  readonly key: FederalRuleKey;
  readonly reference: RuleReference;
  /** Schema-validated detail payload. Individual components may still be null. */
  readonly detail: unknown;
  /** Verification status carried from the rule row, e.g. VERIFIED / PENDING / CONFLICT. */
  readonly verificationStatus: string;
}

export type FederalRuleEntry =
  | { readonly available: true; readonly rule: ResolvedFederalRule }
  | { readonly available: false; readonly problem: FederalUnavailable };

export interface ResolvedFederalRuleSet {
  readonly taxYear: number;
  /** ISO instant the rules were resolved FOR — not when resolution ran. */
  readonly effectiveDate: string;
  readonly jurisdictionCode: string;
  /** Every key the scenario required, resolved or explained. */
  readonly entries: Readonly<Partial<Record<FederalRuleKey, FederalRuleEntry>>>;
  /** Deduplicated provenance across every resolved rule. */
  readonly ruleReferences: readonly RuleReference[];
  readonly sourceIds: readonly string[];
}

/** Looks a key up, defaulting to an explained absence rather than `undefined`. */
export function federalRule(
  ruleSet: ResolvedFederalRuleSet,
  key: FederalRuleKey,
): FederalRuleEntry {
  return (
    ruleSet.entries[key] ?? {
      available: false,
      problem: {
        reason: 'RULE_MISSING',
        ruleKey: key,
        detail: `No rule was resolved for ${key}`,
      },
    }
  );
}

/** Deep-freezes the rule set so Stage B cannot mutate what it was handed. */
export function freezeRuleSet(ruleSet: ResolvedFederalRuleSet): ResolvedFederalRuleSet {
  Object.freeze(ruleSet.entries);
  for (const entry of Object.values(ruleSet.entries)) {
    Object.freeze(entry);
  }
  Object.freeze(ruleSet.ruleReferences);
  Object.freeze(ruleSet.sourceIds);
  return Object.freeze(ruleSet);
}

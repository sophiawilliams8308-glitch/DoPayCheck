import type { RuleReference } from '@/lib/calculator/types/rules';

import type { StateMissingRuleIssue, StateUnavailable } from '../errors/stateErrors';
import type { StateRuleKey } from '../ruleKeys';

/**
 * The immutable state rule set a future Stage B will consume — Phase 5 Step 1.
 *
 * ===========================================================================
 * FROZEN BY CONSTRUCTION.
 *
 * Stage A resolves state rules once and freezes the result. Stage B then
 * computes from this object alone — no query, no clock, no environment. That
 * is what makes a historical state paycheck reproducible: replay the same
 * frozen set with the same input and the answer cannot have drifted because a
 * state published a correction since.
 * ===========================================================================
 *
 * NO FALLBACK, ANYWHERE. Not to a neighbouring state, not to last year, not to
 * a previous rule version, not to zero. A key that does not resolve is recorded
 * with the reason it did not, and every amount that needed it reports
 * INCOMPLETE. With fifty-one jurisdictions onboarding gradually, a fallback
 * would quietly answer for a state nobody has entered yet — the single most
 * dangerous thing this engine could do.
 *
 * ONE JURISDICTION PER SET. A rule set is resolved for exactly one state. Two
 * states means two sets, which is what keeps work-state and residence-state
 * rules from being silently interchanged.
 */

/** One resolved state rule: its provenance, verification state and detail. */
export interface ResolvedStateRule {
  readonly key: StateRuleKey;
  readonly reference: RuleReference;
  /** Schema-validated detail payload. Individual components may still be null. */
  readonly detail: unknown;
  /** Verification status carried from the rule row, e.g. VERIFIED / PENDING / CONFLICT. */
  readonly verificationStatus: string;
}

export type StateRuleEntry =
  | { readonly available: true; readonly rule: ResolvedStateRule }
  | { readonly available: false; readonly problem: StateUnavailable };

export interface ResolvedStateRuleSet {
  readonly taxYear: number;
  /** ISO instant the rules were resolved FOR — not when resolution ran. */
  readonly effectiveDate: string;
  /** The single jurisdiction this set speaks for, e.g. a state code. */
  readonly jurisdictionCode: string;
  /** Engine build that resolved this set. */
  readonly engineVersion: string;
  /** When resolution ran. METADATA ONLY — never used in arithmetic. */
  readonly resolvedAt: string;
  /** Gaps an operator can act on, machine-readable. */
  readonly missing: readonly StateMissingRuleIssue[];
  /** Every key the scenario required, resolved or explained. */
  readonly entries: Readonly<Partial<Record<StateRuleKey, StateRuleEntry>>>;
  /** Deduplicated provenance across every resolved rule. */
  readonly ruleReferences: readonly RuleReference[];
  readonly sourceIds: readonly string[];
}

/**
 * Looks a key up, defaulting to an EXPLAINED ABSENCE rather than `undefined`.
 *
 * The caller cannot accidentally treat a missing rule as falsy and carry on:
 * the only thing it can do with this return value is read the reason.
 */
export function stateRule(ruleSet: ResolvedStateRuleSet, key: StateRuleKey): StateRuleEntry {
  return (
    ruleSet.entries[key] ?? {
      available: false,
      problem: {
        reason: 'RULE_MISSING',
        ruleKey: key,
        detail: `No rule was resolved for ${key} in ${ruleSet.jurisdictionCode}`,
      },
    }
  );
}

/** Deep-freezes the rule set so a later stage cannot mutate what it was handed. */
export function freezeStateRuleSet(ruleSet: ResolvedStateRuleSet): ResolvedStateRuleSet {
  Object.freeze(ruleSet.entries);
  for (const entry of Object.values(ruleSet.entries)) {
    Object.freeze(entry);
  }
  Object.freeze(ruleSet.ruleReferences);
  Object.freeze(ruleSet.sourceIds);
  Object.freeze(ruleSet.missing);
  return Object.freeze(ruleSet);
}

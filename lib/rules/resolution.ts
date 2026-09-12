import { RuleCategory, RuleStatus } from '@/lib/db/generated/index';

import { rangesOverlap } from './validation';

/**
 * Rule resolution foundation (spec §17, §23).
 *
 * ===========================================================================
 * THE CONTRACT
 *
 *   This never "returns the newest row". Selecting the most recent record would silently
 *   apply the wrong law to a historical paycheck. Resolution filters by jurisdiction,
 *   category, lifecycle status and — decisively — EFFECTIVE DATE.
 *
 *   When two ACTIVE rules genuinely both apply, the result is AMBIGUOUS. It does not guess.
 * ===========================================================================
 *
 * Phase 3+ consumes this to ask:
 *     resolveApplicableRules({ taxYear, jurisdiction, category, effectiveDate })
 * and receives versioned, source-traceable records.
 *
 * This module is deliberately PURE — it takes candidate rules and returns a decision, with no
 * database import. That keeps it trivially testable and keeps persistence out of the
 * resolution methodology (spec §3).
 */

/** Minimum shape resolution needs. Repositories map database rows onto this. */
export interface ResolvableRule {
  readonly id: string;
  readonly ruleKey: string;
  readonly version: number;
  readonly category: RuleCategory;
  readonly jurisdictionId: string;
  readonly taxYear: number;
  readonly status: RuleStatus;
  readonly effectiveFrom: Date;
  readonly effectiveTo: Date | null;
}

export interface ResolutionQuery {
  readonly category: RuleCategory;
  readonly jurisdictionId: string;
  /** The instant the calculation applies to. This, not `taxYear`, decides applicability. */
  readonly effectiveDate: Date;
  /** Optional administrative filter. Never the deciding factor on its own. */
  readonly taxYear?: number;
}

export const ResolutionStatus = {
  /** Exactly one applicable rule. */
  RESOLVED: 'RESOLVED',
  /** No rule covers this scenario — the caller must not substitute a default. */
  NOT_FOUND: 'NOT_FOUND',
  /** Multiple ACTIVE rules apply. Never silently resolved. */
  AMBIGUOUS: 'AMBIGUOUS',
} as const;

export type ResolutionStatus = (typeof ResolutionStatus)[keyof typeof ResolutionStatus];

export type ResolutionResult =
  | { readonly status: 'RESOLVED'; readonly rule: ResolvableRule }
  | { readonly status: 'NOT_FOUND'; readonly reason: string }
  | { readonly status: 'AMBIGUOUS'; readonly candidates: readonly ResolvableRule[] };

/** True when `date` falls inside the rule's half-open effective period. */
export function isEffectiveAt(rule: ResolvableRule, date: Date): boolean {
  const at = date.getTime();
  if (at < rule.effectiveFrom.getTime()) {
    return false;
  }
  return rule.effectiveTo === null || at < rule.effectiveTo.getTime();
}

/**
 * Resolves the single applicable rule, or reports ambiguity.
 *
 * Pipeline, in order:
 *   1. filter by jurisdiction
 *   2. filter by category
 *   3. filter to ACTIVE lifecycle state (drafts and superseded versions never apply)
 *   4. filter by effective date
 *   5. optionally narrow by tax year
 *   6. decide: exactly one → RESOLVED; none → NOT_FOUND; more than one → AMBIGUOUS
 */
export function resolveApplicableRules(
  candidates: readonly ResolvableRule[],
  query: ResolutionQuery,
): ResolutionResult {
  const inScope = candidates
    .filter((rule) => rule.jurisdictionId === query.jurisdictionId)
    .filter((rule) => rule.category === query.category)
    .filter((rule) => rule.status === RuleStatus.ACTIVE)
    .filter((rule) => isEffectiveAt(rule, query.effectiveDate))
    .filter((rule) => query.taxYear === undefined || rule.taxYear === query.taxYear);

  if (inScope.length === 0) {
    return {
      status: ResolutionStatus.NOT_FOUND,
      reason:
        `No ACTIVE ${query.category} rule for jurisdiction ${query.jurisdictionId} ` +
        `effective ${query.effectiveDate.toISOString()}`,
    };
  }

  if (inScope.length > 1) {
    // Two ACTIVE rules covering the same instant is a data defect, not something to
    // arbitrate at calculation time. Surface it.
    return { status: ResolutionStatus.AMBIGUOUS, candidates: inScope };
  }

  const [rule] = inScope;
  // Length is exactly 1 here; the guard satisfies noUncheckedIndexedAccess.
  if (rule === undefined) {
    return { status: ResolutionStatus.NOT_FOUND, reason: 'No applicable rule' };
  }

  return { status: ResolutionStatus.RESOLVED, rule };
}

/**
 * Detects overlapping ACTIVE versions of the same conceptual rule.
 *
 * Used by administrative validation to surface data defects before publication; the database
 * exclusion constraint is the hard backstop.
 */
export function findOverlappingActiveVersions(
  rules: readonly ResolvableRule[],
): readonly (readonly [ResolvableRule, ResolvableRule])[] {
  const active = rules.filter((rule) => rule.status === RuleStatus.ACTIVE);
  const overlaps: (readonly [ResolvableRule, ResolvableRule])[] = [];

  for (let i = 0; i < active.length; i += 1) {
    for (let j = i + 1; j < active.length; j += 1) {
      const a = active[i];
      const b = active[j];
      if (a === undefined || b === undefined) {
        continue;
      }
      if (
        a.ruleKey === b.ruleKey &&
        rangesOverlap(a.effectiveFrom, a.effectiveTo, b.effectiveFrom, b.effectiveTo)
      ) {
        overlaps.push([a, b]);
      }
    }
  }

  return overlaps;
}

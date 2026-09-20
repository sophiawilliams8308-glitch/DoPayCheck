import { ResolutionStatus, resolveApplicableRules } from '@/lib/rules/resolution';

import type { StateRuleKey } from '../ruleKeys';
import type { StateResolvableRule, StateRuleCandidates } from './candidateRetrieval';

/**
 * Candidate resolution — Phase 5 Step 3.6 (`resolveCandidates`).
 *
 * ===========================================================================
 * ONE DECISION PER KEY. NOTHING ELSE.
 *
 * Step 3.5 retrieved zero or more candidate rows per requested `StateRuleKey`.
 * This module decides, independently for each key, whether that group of
 * candidates is `RESOLVED` (exactly one applies), `NOT_FOUND` (none applies)
 * or `AMBIGUOUS` (more than one applies) — using Phase 2's existing, generic
 * `resolveApplicableRules` (`lib/rules/resolution.ts`) as the SOLE decision
 * primitive, exactly as Phase 4's own `resolveFederalRuleSet` already does
 * per key. No second resolution algorithm is implemented here.
 *
 * `AMBIGUOUS` is never arbitrated. This module has no concept of "pick the
 * newest", "pick by database order" or any other tie-break — an ambiguous
 * group is reported with every candidate preserved, in whatever order they
 * were supplied, and nothing more is decided about it here.
 * ===========================================================================
 *
 * PURE, SYNCHRONOUS, DATABASE-INDEPENDENT. No Prisma import, no `getPrisma`,
 * no filesystem or network access — this module reads only the in-memory
 * `StateRuleCandidates[]` it is given.
 *
 * NOT `ResolvedStateRuleSet`. This module produces a resolution DECISION per
 * key, not the final frozen rule set — it never imports `stateRuleSet.ts`,
 * never calls `freezeStateRuleSet` or `stateRule`, and constructs nothing a
 * later assembly stage is responsible for.
 *
 * ===========================================================================
 * A NECESSARY BRIDGING DECISION, DISCLOSED HERE (not silently made).
 *
 * `resolveApplicableRules` requires a `ResolutionQuery`
 * (`{ jurisdictionId, category, effectiveDate }`) to re-apply its own
 * jurisdiction/category/effective-date filters. Step 3.6's locked signature
 * takes only `StateRuleCandidates[]` — no jurisdiction, category or
 * calculation instant is passed in alongside it. Those values are therefore
 * DERIVED from the candidates themselves, never invented:
 *
 *   - `jurisdictionId` and `category` come from the group's own first
 *     candidate. Step 3.5 guarantees every candidate in a group shares one
 *     jurisdiction (it queries exactly one `jurisdictionId`), and a rule key
 *     conceptually belongs to exactly one category, so this is read, not
 *     assumed.
 *
 *   - `effectiveDate` is reconstructed as the LATEST `effectiveFrom` among
 *     the group's own candidates, not the original calculation instant
 *     (`StateRuleCandidates` does not carry it). This is provably a no-op
 *     filter for every existing candidate: Step 3.5's own SQL query already
 *     guarantees every returned candidate's window contains the true
 *     calculation instant, which means every candidate's own `effectiveFrom`
 *     is <= that instant and every `effectiveTo` is > that instant. The
 *     latest `effectiveFrom` in the group is therefore also <= the true
 *     instant and, transitively, still < every candidate's `effectiveTo` —
 *     so re-checking `isEffectiveAt` against it keeps every candidate that
 *     was already correctly retrieved. It is a mechanical value chosen only
 *     to satisfy `resolveApplicableRules`'s parameter shape; it decides
 *     nothing about which date "applies" — that decision was already made,
 *     correctly, by Step 3.5.
 *
 *   - An EMPTY candidate group needs no such query at all: filtering zero
 *     candidates is unconditionally `NOT_FOUND` regardless of any
 *     jurisdiction, category or date, and there is nothing in an empty array
 *     to derive those fields from even if it mattered. This module reports
 *     `NOT_FOUND` directly for that case rather than inventing placeholder
 *     query values to force a call that cannot change the outcome.
 * ===========================================================================
 *
 * PROVENANCE SURVIVES UNCHANGED (follow-up correction, 2026-09-20). Step 3.5's
 * candidates are `StateResolvableRule` (`ResolvableRule` enriched with
 * `jurisdictionCode`/`sourceIds`/`verified`/`detail`/`verificationStatus` —
 * see `candidateRetrieval.ts`). `resolveApplicableRules` itself is untouched
 * and still declares its `ResolutionResult` in terms of the plain,
 * non-enriched `ResolvableRule`, since it is Phase 2's SHARED primitive and
 * also used by the federal engine, which has no such enrichment. It never
 * copies or narrows the rule object, though — the `RESOLVED` case returns one
 * of its own input elements verbatim, and `AMBIGUOUS` returns an unmodified
 * subset of them. Every candidate handed to it here IS a
 * `StateResolvableRule`, so what comes back out, at runtime, still is one —
 * only the shared function's own static return type doesn't know that. The
 * casts below restore that already-true fact to the type checker; they do
 * not change what value flows through, and no field is invented.
 * ===========================================================================
 */

/** One key's resolution decision. Mirrors `ResolutionStatus` — never a fourth value. */
export type StateRuleResolution =
  | {
      readonly ruleKey: StateRuleKey;
      readonly status: typeof ResolutionStatus.RESOLVED;
      readonly rule: StateResolvableRule;
    }
  | {
      readonly ruleKey: StateRuleKey;
      readonly status: typeof ResolutionStatus.NOT_FOUND;
      readonly reason: string;
    }
  | {
      readonly ruleKey: StateRuleKey;
      readonly status: typeof ResolutionStatus.AMBIGUOUS;
      readonly candidates: readonly StateResolvableRule[];
    };

export interface StateRuleResolutionResult {
  /** One entry per input group, in the SAME order. Duplicate keys are never merged. */
  readonly results: readonly StateRuleResolution[];
}

function resolveOneGroup(group: StateRuleCandidates): StateRuleResolution {
  const { ruleKey, candidates } = group;

  const [first] = candidates;
  if (first === undefined) {
    return {
      ruleKey,
      status: ResolutionStatus.NOT_FOUND,
      reason: `No candidates were retrieved for ${ruleKey}`,
    };
  }

  // See the module-level doc comment: a mechanical, provably-safe derivation,
  // not a date-selection decision.
  const effectiveDate = new Date(
    Math.max(...candidates.map((candidate) => candidate.effectiveFrom.getTime())),
  );

  const resolution = resolveApplicableRules(candidates, {
    jurisdictionId: first.jurisdictionId,
    category: first.category,
    effectiveDate,
  });

  switch (resolution.status) {
    case ResolutionStatus.RESOLVED:
      // Safe: `candidates` passed above is `readonly StateResolvableRule[]`, and
      // `resolveApplicableRules` returns one of its own input elements verbatim
      // (see the module doc comment) — this restores a fact already true at
      // runtime, it does not invent or transform any field.
      return {
        ruleKey,
        status: ResolutionStatus.RESOLVED,
        rule: resolution.rule as StateResolvableRule,
      };
    case ResolutionStatus.NOT_FOUND:
      return { ruleKey, status: ResolutionStatus.NOT_FOUND, reason: resolution.reason };
    case ResolutionStatus.AMBIGUOUS:
      // Safe for the same reason: an unmodified subset of the input elements.
      return {
        ruleKey,
        status: ResolutionStatus.AMBIGUOUS,
        candidates: resolution.candidates as readonly StateResolvableRule[],
      };
  }
}

/**
 * Resolves every candidate group independently, preserving input order and
 * never merging duplicate rule keys.
 */
export function resolveCandidates(
  candidateGroups: readonly StateRuleCandidates[],
): StateRuleResolutionResult {
  return { results: candidateGroups.map(resolveOneGroup) };
}

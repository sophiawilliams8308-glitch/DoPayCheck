import type { RuleReference } from '@/lib/calculator/types/rules';

import { StateReason, stateUnavailable } from '../errors/stateErrors';
import type { StateRuleKey } from '../ruleKeys';
import type { StateRuleResolutionResult } from './resolveCandidates';
import { freezeStateRuleSet, type ResolvedStateRuleSet, type StateRuleEntry } from './stateRuleSet';

/**
 * Final assembly — Phase 5 Step 3.7 (`assembleStateRuleSet`).
 *
 * ===========================================================================
 * ASSEMBLY ONLY. NO NEW DECISION IS MADE HERE.
 *
 * Step 3.6 already decided, per key, RESOLVED / NOT_FOUND / AMBIGUOUS. This
 * module does not re-examine that decision — it maps each outcome onto the
 * existing `ResolvedStateRuleSet`/`StateRuleEntry` representation (Step 1,
 * `stateRuleSet.ts`) and freezes the result. `resolveApplicableRules` is
 * never imported or called here; `ResolutionStatus`'s three string values are
 * matched as literals so this module has no dependency on
 * `lib/rules/resolution.ts` at all.
 * ===========================================================================
 *
 * PURE, SYNCHRONOUS, DATABASE-INDEPENDENT. No Prisma import, no `getPrisma`,
 * no repository, no `candidateRetrieval` import — this is possible ONLY
 * because of the Step 3.5 provenance-preservation correction: every field a
 * `ResolvedStateRule`/`RuleReference` needs (`jurisdictionCode`, `sourceIds`,
 * `verified`, `detail`, `verificationStatus`) already arrives on the
 * `StateResolvableRule` carried inside a `RESOLVED` result. Nothing is
 * re-fetched, re-derived from an id, or reconstructed — every value below is
 * read directly off the resolved rule or off the caller-supplied metadata.
 *
 * ===========================================================================
 * VERIFICATION IS NEVER REINTERPRETED.
 *
 * Unlike the federal assembler (`lib/tax/federal/rules/resolver.ts`), which
 * derives `verified`/`verificationStatus` itself because it reads the
 * database directly, this module receives BOTH already computed and
 * authoritative on `StateResolvableRule` (Step 3.5 computed them once, from
 * the same `TaxRuleSource` links federal reads). They are carried through
 * verbatim — never upgraded, downgraded, or re-derived from `sourceIds` a
 * second time.
 * ===========================================================================
 *
 * JURISDICTION CONSISTENCY, NOT SUBSTITUTION. Every resolved rule already
 * carries its own `jurisdictionCode` (Step 3.5 reads it from the one
 * `Jurisdiction` row it queried). Nothing about Step 3.5/3.6's own guarantees
 * makes a mismatch against the caller's assembly metadata reachable in
 * today's call pattern, but the type contract does not itself forbid a
 * caller from supplying inconsistent metadata — so this is checked, not
 * assumed. A mismatch never rewrites the rule's jurisdiction and never
 * silently keeps the cross-jurisdiction rule; it is reported through the
 * EXISTING `StateReason.INVARIANT_BREACH` vocabulary (a defect, not a data
 * state — exactly what an engine invariant breach means per
 * `stateErrors.ts`), for that one key only.
 *
 * ===========================================================================
 * A DISCLOSED, NOT SILENT, GAP: `ResolvedStateRuleSet.missing`.
 *
 * `missing` is documented (Step 1) as "gaps an operator can act on,
 * machine-readable" and its entries (`StateMissingRuleIssue`) require a
 * `category: string`. No `StateRuleKey -> RuleCategory` mapping exists
 * anywhere in the repository (confirmed by inspection before writing this
 * module — federal has one, `KEY_CATEGORY` in `resolver.ts`, but it is
 * federal-key-scoped and inventing a state equivalent here would be a new,
 * unapproved design decision, exactly what this project's rules forbid).
 * `StateRuleResolutionResult`'s `NOT_FOUND` outcome carries no candidate row
 * to read a category from either way (Step 3.6 reports it as `{ ruleKey,
 * status, reason: string }` only). Rather than fabricate a category to force
 * a `missing` entry to typecheck, this module leaves `missing: []` and
 * relies on `entries` — which IS fully populated for every key, including
 * every unavailable one with its real reason — as the source of truth for
 * gaps. This is a genuine, disclosed architecture gap, not an oversight; a
 * future step that wants a populated `missing` list needs an explicit
 * key -> category mapping decision from the project owner first.
 * ===========================================================================
 */

/**
 * The top-level `ResolvedStateRuleSet` fields Step 3.6's output cannot supply
 * on its own. Every field here is explicit, caller-supplied data — none of it
 * is derived, defaulted, or read from a clock inside this module.
 */
export interface StateRuleSetAssemblyMetadata {
  readonly taxYear: number;
  /** ISO instant the rules apply TO. Matches `ResolvedStateRuleSet.effectiveDate` exactly. */
  readonly effectiveDate: string;
  /** The single jurisdiction this assembly speaks for. */
  readonly jurisdictionCode: string;
  readonly engineVersion: string;
  /** When resolution ran. Supplied by the caller so assembly never reads the clock itself. */
  readonly resolvedAt: string;
}

/**
 * The enriched candidate type carried by a RESOLVED outcome — derived
 * structurally from `StateRuleResolutionResult` itself (which already
 * imports it as `StateResolvableRule` from `candidateRetrieval.ts`) rather
 * than imported directly here, so this module names no dependency on that
 * module at all, type-only or otherwise (see the module doc comment and
 * §14/§19 of this step's contract).
 */
type ResolvedCandidate = Extract<
  StateRuleResolutionResult['results'][number],
  { readonly status: 'RESOLVED' }
>['rule'];

function buildRuleReference(rule: ResolvedCandidate): RuleReference {
  return {
    ruleId: rule.id,
    ruleKey: rule.ruleKey,
    version: rule.version,
    category: rule.category,
    taxYear: rule.taxYear,
    jurisdictionId: rule.jurisdictionId,
    jurisdictionCode: rule.jurisdictionCode,
    effectiveFrom: rule.effectiveFrom,
    effectiveTo: rule.effectiveTo,
    sourceIds: rule.sourceIds,
    verified: rule.verified,
  };
}

/**
 * Assembles Step 3.6's per-key decisions, plus explicit caller-supplied
 * metadata, into a frozen `ResolvedStateRuleSet`.
 *
 * Every key present in `resolution.results` is represented in the returned
 * set's `entries` — RESOLVED as an available `ResolvedStateRule`, NOT_FOUND
 * and AMBIGUOUS as an unavailable entry carrying `RULE_MISSING`/
 * `RULE_CONFLICT` respectively. No key is dropped, invented, or merged with
 * another. `ruleReferences` and top-level `sourceIds` are derived only from
 * successfully RESOLVED entries — the same aggregation the federal assembler
 * performs.
 */
export function assembleStateRuleSet(
  resolution: StateRuleResolutionResult,
  metadata: StateRuleSetAssemblyMetadata,
): ResolvedStateRuleSet {
  const entries: Partial<Record<StateRuleKey, StateRuleEntry>> = {};
  const references: RuleReference[] = [];

  for (const result of resolution.results) {
    if (result.status === 'NOT_FOUND') {
      entries[result.ruleKey] = {
        available: false,
        problem: stateUnavailable(StateReason.RULE_MISSING, result.reason, result.ruleKey),
      };
      continue;
    }

    if (result.status === 'AMBIGUOUS') {
      entries[result.ruleKey] = {
        available: false,
        problem: stateUnavailable(
          StateReason.RULE_CONFLICT,
          `${String(result.candidates.length)} ACTIVE rules apply simultaneously for ${result.ruleKey}`,
          result.ruleKey,
        ),
      };
      continue;
    }

    const rule = result.rule;
    if (rule.jurisdictionCode !== metadata.jurisdictionCode) {
      // An existing project error mechanism, not an invented one (see the
      // module doc comment): a mismatch here is a defect, not a data state.
      entries[result.ruleKey] = {
        available: false,
        problem: stateUnavailable(
          StateReason.INVARIANT_BREACH,
          `Resolved rule for ${result.ruleKey} belongs to jurisdiction ` +
            `${rule.jurisdictionCode}, not the requested ${metadata.jurisdictionCode}`,
          result.ruleKey,
        ),
      };
      continue;
    }

    const reference = buildRuleReference(rule);
    references.push(reference);

    entries[result.ruleKey] = {
      available: true,
      rule: {
        key: result.ruleKey,
        reference,
        detail: rule.detail,
        verificationStatus: rule.verificationStatus,
      },
    };
  }

  return freezeStateRuleSet({
    taxYear: metadata.taxYear,
    effectiveDate: metadata.effectiveDate,
    jurisdictionCode: metadata.jurisdictionCode,
    engineVersion: metadata.engineVersion,
    resolvedAt: metadata.resolvedAt,
    // See the module doc comment: disclosed gap, not an oversight.
    missing: [],
    entries,
    ruleReferences: references,
    sourceIds: [...new Set(references.flatMap((reference) => reference.sourceIds))],
  });
}

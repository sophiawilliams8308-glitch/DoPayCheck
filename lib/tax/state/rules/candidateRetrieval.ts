import { getPrisma } from '@/lib/db/client';
import { findByCode } from '@/lib/jurisdictions/repository';
import type { ResolvableRule } from '@/lib/rules/resolution';

import type { StateRuleKey } from '../ruleKeys';

/**
 * Candidate retrieval — Phase 5 Step 3.5 (`retrieveCandidates`).
 *
 * ===========================================================================
 * A CANDIDATE IS NOT A RESOLVED RULE.
 *
 * This module answers one question: "which rule ROWS exist for this
 * jurisdiction and these rule keys, at this instant, in a publishable
 * lifecycle status?" It does not decide which one wins, and its return type
 * is an array per key for exactly that reason — this module never assumes
 * or enforces at-most-one, because that is not its job to guarantee.
 *
 * IN PRACTICE, TWO OVERLAPPING ACTIVE ROWS FOR ONE KEY CANNOT EXIST: the
 * database itself carries `TaxRule_no_overlapping_active_versions` (Postgres
 * migration `20260912151038`), an EXCLUDE constraint on
 * `(ruleKey, tsrange(effectiveFrom, effectiveTo))` for `status = 'ACTIVE'`
 * rows. Confirmed by this module's own integration test: attempting to
 * activate a second overlapping row for the same key fails at the database,
 * not at retrieval. That constraint has NO jurisdiction term, so it is
 * scoped to `ruleKey` alone, not `(ruleKey, jurisdictionId)` — worth flagging
 * for whoever designs Step 3.6+ or the rule-authoring admin tooling, since
 * `ruleKeys.ts` deliberately keeps jurisdiction out of the key string
 * ("no key names a state"). This module does not rely on or repair that
 * property; it queries and returns rows as they exist, whatever the
 * constraint currently guarantees.
 * ===========================================================================
 *
 * PIPELINE POSITION. Sits immediately after Step 3.4 (`requiredRuleKeys`) and
 * the Step 3.3 coverage gate (`consultCoverage`), which this module never
 * calls, imports, or reinterprets — a caller is expected to have already
 * consulted coverage and built its required-key list before reaching here.
 * This module trusts both inputs rather than re-deriving them.
 *
 * NO JURISDICTION DECISION. `jurisdictionCode` is taken exactly as given.
 * This module never chooses between a work and a residence jurisdiction,
 * never substitutes a neighboring state, and never defaults to one — that
 * decision belongs to whatever produced the caller's resolution context.
 * The one DB lookup below (jurisdiction code -> id) is a mechanical
 * translation needed to shape the SQL `WHERE` clause, identical in kind to
 * the same lookup Phase 4's own `resolveFederalRuleSet` already performs
 * inline (`lib/tax/federal/rules/resolver.ts`) — it is not a jurisdiction
 * SELECTION step.
 *
 * NO EFFECTIVE-INSTANT DECISION. `calculationDate` is used exactly as given,
 * read verbatim (matching Step 3.1's own convention for the same field) and
 * converted to a `Date` only at this DB-query boundary, the same boundary
 * crossing Phase 4's resolver already makes. No calendar arithmetic, no
 * "which date applies" logic lives here.
 *
 * ACTIVE-STATUS FILTERING IS RETRIEVAL, NOT RESOLUTION. Excluding DRAFT /
 * PENDING_REVIEW / SUPERSEDED / REJECTED / ROLLED_BACK / BLOCKED rows is a
 * publishing-lifecycle gate ("can this row ever be used at all?"), not a
 * "which ACTIVE row wins?" decision — multiple ACTIVE rows can still be
 * returned for one key. Phase 4's own resolver filters identically before
 * handing rows to its pure resolution step.
 *
 * ===========================================================================
 * PROVENANCE PRESERVATION (follow-up correction, 2026-09-20).
 *
 * The Step 3.7 assembly attempt found that `ResolvableRule` alone (Phase 2's
 * minimal resolution-decision shape) does not carry `jurisdictionCode`,
 * `sourceIds`, `verified`, the rule's `detail`/payload, or its own
 * `verificationStatus` — fields `ResolvedStateRule`/`RuleReference` require
 * to be constructed honestly later. Rather than fabricate them at assembly
 * time (forbidden — `verified` in particular gates whether a rule may ever
 * be presented as authoritative), this module now reads them from the
 * database ONCE, here, exactly like `lib/tax/federal/rules/resolver.ts` and
 * `lib/calculator/rule-provider.ts` already do for the same reason
 * (`sourceIds`/`verified` derived from `TaxRuleSource` links).
 *
 * `StateResolvableRule` EXTENDS `ResolvableRule` rather than replacing it —
 * every field `resolveApplicableRules` (Step 3.6's sole decision primitive)
 * requires is still present, so nothing about resolution semantics changes.
 * ===========================================================================
 */

/**
 * A candidate row, enriched with the provenance fields Step 3.7's assembly
 * needs. A strict superset of `ResolvableRule` — passing `StateResolvableRule[]`
 * anywhere `readonly ResolvableRule[]` is expected (i.e. into
 * `resolveApplicableRules`) remains fully valid.
 */
export interface StateResolvableRule extends ResolvableRule {
  /** The human-readable jurisdiction code, e.g. "US-CA" — not `jurisdictionId`. */
  readonly jurisdictionCode: string;
  /** Phase 2 `Source` ids backing this rule. Empty means genuinely none linked. */
  readonly sourceIds: readonly string[];
  /** True only when at least one linked source is itself VERIFIED. Never assumed. */
  readonly verified: boolean;
  /** The rule's own category-specific payload, exactly as stored. Never transformed. */
  readonly detail: unknown;
  /** The rule row's own verification status (distinct from per-source verification). */
  readonly verificationStatus: string;
}

/** One rule key's candidates. Always present for every requested key, even when empty. */
export interface StateRuleCandidates {
  readonly ruleKey: StateRuleKey;
  /** Every ACTIVE, effective-at-instant row for this key. Order carries no meaning. */
  readonly candidates: readonly StateResolvableRule[];
}

/**
 * Retrieves candidate rule rows for one jurisdiction and a caller-supplied set
 * of required rule keys.
 *
 * PURE INPUT HANDLING, IMPURE EXECUTION: this is the first Phase 5 Step 3
 * module that touches the database — Steps 3.1-3.4 are all pure by design,
 * and this module is deliberately the seam where that changes, mirroring
 * where Phase 4 draws the same line (`resolveFederalRuleSet`).
 *
 * Returns one `StateRuleCandidates` entry per element of `ruleKeys`, in the
 * SAME order, whether or not any candidate rows were found — a requested key
 * is never silently dropped from the result. An empty `candidates` array is
 * the explicit representation of "no candidates were found for this key",
 * distinguishable from a thrown/rejected promise, which represents a genuine
 * retrieval failure (a database error) and is never converted into an empty
 * result.
 *
 * An unrecognized `jurisdictionCode` (no matching `Jurisdiction` row) yields
 * every requested key with an empty candidate list — there being no
 * jurisdiction row, there can be no candidate rows scoped to it. This is not
 * a fallback: nothing is substituted, the absence is simply total.
 */
export async function retrieveCandidates(
  jurisdictionCode: string,
  calculationDate: string,
  ruleKeys: readonly StateRuleKey[],
): Promise<readonly StateRuleCandidates[]> {
  if (ruleKeys.length === 0) {
    return [];
  }

  const jurisdiction = await findByCode(jurisdictionCode);
  if (jurisdiction === null) {
    return ruleKeys.map((ruleKey) => ({ ruleKey, candidates: [] }));
  }

  const effectiveInstant = new Date(calculationDate);

  // ONE query for every requested key — narrowed in SQL by jurisdiction, rule
  // key, publishing status and effective window. Nothing beyond that
  // narrowing happens here; which row (if any) is authoritative is a later
  // stage's question. `sources` is included so sourceIds/verified can be
  // derived honestly below, mirroring lib/calculator/rule-provider.ts.
  const rows = await getPrisma().taxRule.findMany({
    where: {
      jurisdictionId: jurisdiction.id,
      ruleKey: { in: [...ruleKeys] },
      status: 'ACTIVE',
      effectiveFrom: { lte: effectiveInstant },
      OR: [{ effectiveTo: null }, { effectiveTo: { gt: effectiveInstant } }],
    },
    include: {
      taxYear: { select: { year: true } },
      sources: { select: { sourceId: true, verificationStatus: true } },
    },
  });

  return ruleKeys.map((ruleKey) => ({
    ruleKey,
    candidates: rows
      .filter((row) => row.ruleKey === ruleKey)
      .map((row): StateResolvableRule => {
        const sourceIds = row.sources.map((link) => link.sourceId);
        // "Verified" requires at least one linked source itself marked
        // VERIFIED — a rule with an attached but unverified source is not
        // presented as authoritative (same rule rule-provider.ts applies).
        const verified = row.sources.some((link) => link.verificationStatus === 'VERIFIED');

        return {
          id: row.id,
          ruleKey: row.ruleKey,
          version: row.version,
          category: row.category,
          jurisdictionId: row.jurisdictionId,
          jurisdictionCode: jurisdiction.code,
          taxYear: row.taxYear.year,
          status: row.status,
          effectiveFrom: row.effectiveFrom,
          effectiveTo: row.effectiveTo,
          sourceIds,
          verified,
          detail: row.payload,
          verificationStatus: row.verificationStatus,
        };
      }),
  }));
}

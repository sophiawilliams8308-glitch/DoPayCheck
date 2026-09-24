/**
 * Deterministic internal-link generation and validation (SEO-03 contract §Q).
 *
 * ===========================================================================
 * PRECOMPUTED, NEVER AN UNBOUNDED RUNTIME QUERY (contract §Q.2, §46).
 *
 * `selectRelatedLinks()` is the ONE generation primitive every relation in the §Q.1 table is
 * built from — it takes an already-fetched candidate pool (the caller queries it; this module
 * never touches the database) and returns a bounded, deterministically ordered selection. The
 * per-relation functions below (`relatedCalculatorsForCalculator`, `statesForCalculatorHub`,
 * etc.) are thin, named wrappers over it that pin each relation's own min/max counts from the
 * contract's table — so the counts live in one place, not copy-pasted at every call site.
 *
 * The RESULT of a generation call is what a caller stores into `SeoPage.relatedLinksCache`
 * (contract §Q.2) — this module has no database write path itself; persistence and the
 * invalidation triggers (page save, template save, lifecycle change of a target, publication
 * change) belong to whichever future admin/save path creates and updates `SeoPage` rows.
 * ===========================================================================
 */

export interface LinkCandidate {
  readonly path: string;
  readonly label: string;
}

export interface LinkTarget {
  readonly path: string;
  readonly label: string;
}

/**
 * Deterministically selects up to `max` (never fewer than what's available, never more than
 * `max`) candidates, in the candidate pool's own given order — callers are responsible for
 * supplying that order already curated/sorted per the relation's own selection rule (contract
 * §Q.1's "Selection" column: curated order, rotating, neighbours/structural peers, nearest
 * amount, contextual). This function does no sorting of its own — sorting IS the selection
 * rule, and differs per relation, so it belongs at the call site, not buried here.
 */
export function selectRelatedLinks(
  candidates: readonly LinkCandidate[],
  max: number,
): readonly LinkTarget[] {
  return candidates.slice(0, max);
}

// --- Per-relation wrappers, pinning the §Q.1 table's own counts -----------------------------

/** CALCULATOR → related calculators: curated order, 3–6. */
export function relatedCalculatorsForCalculator(
  candidates: readonly LinkCandidate[],
): readonly LinkTarget[] {
  return selectRelatedLinks(candidates, 6);
}

/** CALCULATOR (paycheck) → states: rotating + hub link, 6–10. */
export function statesForCalculatorHub(
  candidates: readonly LinkCandidate[],
): readonly LinkTarget[] {
  return selectRelatedLinks(candidates, 10);
}

/** STATE → main paycheck calculator: always exactly 1. */
export function mainCalculatorForState(candidate: LinkCandidate): readonly LinkTarget[] {
  return [candidate];
}

/** STATE → related states: neighbours + structural peers, 4–8. */
export function relatedStatesForState(candidates: readonly LinkCandidate[]): readonly LinkTarget[] {
  return selectRelatedLinks(candidates, 8);
}

/** STATE → related calculators: cluster, 3–5. */
export function relatedCalculatorsForState(
  candidates: readonly LinkCandidate[],
): readonly LinkTarget[] {
  return selectRelatedLinks(candidates, 5);
}

/** SALARY → salary calculator: always exactly 1. */
export function salaryCalculatorForSalary(candidate: LinkCandidate): readonly LinkTarget[] {
  return [candidate];
}

/** SALARY → adjacent salaries: nearest published amounts above/below, 2–4. */
export function adjacentSalariesForSalary(
  candidates: readonly LinkCandidate[],
): readonly LinkTarget[] {
  return selectRelatedLinks(candidates, 4);
}

/** GUIDE → calculators: contextual, 1–3. */
export function calculatorsForGuide(candidates: readonly LinkCandidate[]): readonly LinkTarget[] {
  return selectRelatedLinks(candidates, 3);
}

/** HUB → children: paginated index, all of them (bounded by the caller's own page size, not
 * a fixed count — the §Q.1 table's own "Count" column says "All"). */
export function childrenForHub(candidates: readonly LinkCandidate[]): readonly LinkTarget[] {
  return candidates;
}

/**
 * Drops any target that does not resolve to a currently `PUBLISHED` and indexable page
 * (contract §Q.2: "every generated target must resolve to a PUBLISHED, indexable page.
 * Targets failing validation are dropped, not rendered as dead links"). `publishedIndexablePaths`
 * is supplied by the caller — this module never queries the database.
 */
export function validateLinkTargets(
  targets: readonly LinkTarget[],
  publishedIndexablePaths: ReadonlySet<string>,
): readonly LinkTarget[] {
  return targets.filter((target) => publishedIndexablePaths.has(target.path));
}

export interface InboundLink {
  readonly fromPath: string;
  readonly fromIsHubOrCalculator: boolean;
}

export interface OrphanCheckResult {
  readonly ok: boolean;
  readonly inboundCount: number;
  readonly hasHubOrCalculatorSource: boolean;
}

const MIN_INBOUND_LINKS = 2;

/**
 * Orphan prevention (contract §Q.2): a published programmatic page needs at least two inbound
 * internal links from distinct pages, with at least one from a hub or calculator page — not
 * solely from same-type siblings. This is the same rule `lib/seo/gates.ts`'s gate 12
 * evaluates; this function exists so link GENERATION code can check it before persisting a
 * `relatedLinksCache`, without importing the gate module for one boolean.
 */
export function checkOrphanPrevention(inboundLinks: readonly InboundLink[]): OrphanCheckResult {
  const distinctSources = new Set(inboundLinks.map((link) => link.fromPath));
  const hasHubOrCalculatorSource = inboundLinks.some((link) => link.fromIsHubOrCalculator);
  return {
    ok: distinctSources.size >= MIN_INBOUND_LINKS && hasHubOrCalculatorSource,
    inboundCount: distinctSources.size,
    hasHubOrCalculatorSource,
  };
}

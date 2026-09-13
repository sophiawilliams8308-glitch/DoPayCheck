import { createHash } from 'node:crypto';

import type { FederalCalculationResult } from '../types';
import type { ResolvedFederalRuleSet } from '../rules/resolved-rule-set';

/**
 * Federal snapshot block — spec §29, decision D-SNAP-1.
 *
 * ===========================================================================
 * RULE IDS ALONE ARE NOT ENOUGH (§29.2).
 *
 * "The snapshot must contain enough information to recompute the identical
 * result without reading the rule tables." Storing only IDs leaves history at
 * the mercy of a rollback, a correction or an archival policy — precisely the
 * things versioning exists to allow.
 *
 * So the RESOLVED DETAIL is embedded, and each entry also carries a
 * `detailHash` over that detail. The hash is what a test can assert against, so
 * tampering or drift is detectable rather than merely unlikely.
 *
 * The test of this design: publish a new rule tomorrow, replay this snapshot,
 * and the answer must not move (§29.3).
 * ===========================================================================
 *
 * `createHash` is deterministic and performs no I/O, so this stays reproducible.
 */

export interface FederalSnapshotRule {
  readonly ruleKey: string;
  readonly ruleId: string;
  /** Phase 2 versions rules by (ruleKey, version); both are retained (§24.2). */
  readonly ruleVersionId: string;
  readonly version: number;
  readonly category: string;
  readonly effectiveFrom: string;
  readonly effectiveTo: string | null;
  readonly verificationStatus: string;
  /**
   * Provenance retained verbatim so replay reconstructs the SAME reference (§29.2).
   *
   * `jurisdictionId` and `verified` are stored rather than re-derived: `verified` is a
   * property of the rule row, not a function of `verificationStatus` (a NOT_APPLICABLE
   * component can still be verified), and re-deriving either would make a replayed result
   * differ from the original in its cited provenance.
   */
  readonly jurisdictionId: string;
  readonly verified: boolean;
  readonly sourceIds: readonly string[];
  /** SHA-256 over the canonical JSON of `detail`. */
  readonly detailHash: string;
  /** The full resolved detail, embedded — not a pointer to a live row. */
  readonly detail: unknown;
}

export interface FederalSnapshotBlock {
  readonly taxYear: number;
  readonly effectiveDate: string;
  readonly jurisdictionId: string;
  readonly engineVersion: string;
  readonly methodology: {
    readonly fitMethod: string;
    readonly supplementalMethod: string | null;
    readonly roundingPolicy: unknown;
  };
  readonly resolvedRuleSet: readonly FederalSnapshotRule[];
  readonly worksheetIntermediates: Readonly<Record<string, string | null>>;
  /** `null` marks a bucket that could not be determined — never zero (§12.2). */
  readonly buckets: Readonly<Record<string, string | null>>;
  readonly result: unknown;
  readonly disclosures: readonly string[];
  readonly featureFlags: Readonly<Record<string, boolean>>;
  readonly status: string;
  readonly missingRules: unknown;
}

/**
 * Canonical JSON: keys sorted at every level, so an identical document always
 * hashes identically regardless of property order.
 */
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
      a < b ? -1 : a > b ? 1 : 0,
    );
    return Object.fromEntries(entries.map(([key, item]) => [key, canonicalize(item)]));
  }
  return value;
}

export function hashDetail(detail: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(canonicalize(detail)))
    .digest('hex');
}

/** Builds the federal block. Pure; persisting it is a separate concern. */
export function buildFederalSnapshotBlock(
  ruleSet: ResolvedFederalRuleSet,
  result: FederalCalculationResult,
): FederalSnapshotBlock {
  const resolvedRuleSet: FederalSnapshotRule[] = [];

  for (const [key, entry] of Object.entries(ruleSet.entries)) {
    if (entry === undefined || !entry.available) {
      continue;
    }
    const reference = entry.rule.reference;
    // Deep-copied so a later mutation of a live rule cannot reach into history.
    const detail = JSON.parse(JSON.stringify(entry.rule.detail ?? null)) as unknown;

    resolvedRuleSet.push({
      ruleKey: key,
      ruleId: reference.ruleId,
      ruleVersionId: `${reference.ruleId}@${String(reference.version)}`,
      version: reference.version,
      category: reference.category,
      effectiveFrom: reference.effectiveFrom.toISOString(),
      effectiveTo: reference.effectiveTo === null ? null : reference.effectiveTo.toISOString(),
      verificationStatus: entry.rule.verificationStatus,
      jurisdictionId: reference.jurisdictionId,
      verified: reference.verified,
      sourceIds: [...reference.sourceIds],
      detailHash: hashDetail(detail),
      detail,
    });
  }

  return {
    taxYear: result.taxYear,
    effectiveDate: result.effectiveDate,
    jurisdictionId: ruleSet.jurisdictionCode,
    engineVersion: result.engineVersion,
    methodology: {
      fitMethod: result.methodology.fitMethod,
      supplementalMethod: result.methodology.supplementalMethod,
      roundingPolicy: JSON.parse(
        JSON.stringify(result.methodology.roundingPolicy ?? null),
      ) as unknown,
    },
    resolvedRuleSet,
    worksheetIntermediates: { ...result.worksheetLines },
    buckets: { ...result.buckets },
    result: JSON.parse(
      JSON.stringify({
        employee: result.employee,
        employer: result.employer,
        estimates: result.estimates,
      }),
    ) as unknown,
    disclosures: result.disclosures.map((disclosure) => disclosure.message),
    featureFlags: { ...result.flags },
    status: result.status,
    missingRules: JSON.parse(JSON.stringify(result.missingRules)) as unknown,
  };
}

/**
 * Rebuilds a frozen rule set from a stored snapshot.
 *
 * This is what makes historical reproducibility real rather than aspirational:
 * the replay path reads the snapshot, never the live rule tables (§29.2).
 */
export function ruleSetFromSnapshot(block: FederalSnapshotBlock): ResolvedFederalRuleSet {
  const entries: Record<string, unknown> = {};
  const references = block.resolvedRuleSet.map((rule) => ({
    ruleId: rule.ruleId,
    ruleKey: rule.ruleKey,
    version: rule.version,
    category: rule.category as never,
    taxYear: block.taxYear,
    jurisdictionId: rule.jurisdictionId,
    jurisdictionCode: block.jurisdictionId,
    effectiveFrom: new Date(rule.effectiveFrom),
    effectiveTo: rule.effectiveTo === null ? null : new Date(rule.effectiveTo),
    sourceIds: rule.sourceIds,
    verified: rule.verified,
  }));

  block.resolvedRuleSet.forEach((rule, index) => {
    entries[rule.ruleKey] = {
      available: true,
      rule: {
        key: rule.ruleKey,
        reference: references[index],
        detail: rule.detail,
        verificationStatus: rule.verificationStatus,
      },
    };
  });

  return {
    taxYear: block.taxYear,
    effectiveDate: block.effectiveDate,
    jurisdictionCode: block.jurisdictionId,
    engineVersion: block.engineVersion,
    resolvedAt: block.effectiveDate,
    missing: [],
    entries: entries as ResolvedFederalRuleSet['entries'],
    ruleReferences: references,
    sourceIds: [...new Set(references.flatMap((reference) => reference.sourceIds))],
  };
}

/** Verifies every embedded detail still matches its recorded hash (§29.2). */
export function verifyDetailHashes(block: FederalSnapshotBlock): readonly string[] {
  return block.resolvedRuleSet
    .filter((rule) => hashDetail(rule.detail) !== rule.detailHash)
    .map((rule) => rule.ruleKey);
}

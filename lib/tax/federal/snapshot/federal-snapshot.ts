import type { FederalCalculationResult } from '../types';
import type { ResolvedFederalRuleSet } from '../rules/resolved-rule-set';

/**
 * Federal snapshot block (Phase 4, D-SNAP-1).
 *
 * ===========================================================================
 * RULE IDS ALONE ARE NOT ENOUGH.
 *
 * A snapshot that stores only rule IDs is reproducible only for as long as those rows keep
 * their current values — which is exactly what versioning and superseding are designed to
 * change. So the RESOLVED DETAIL is copied in: rates, bases, thresholds and schedule rows as
 * they stood when the calculation ran.
 *
 * The test of this design: publish a 2027 rule tomorrow, replay this snapshot, and the answer
 * must not move.
 * ===========================================================================
 */

export interface FederalSnapshotRule {
  readonly key: string;
  readonly ruleId: string;
  readonly ruleKey: string;
  readonly version: number;
  readonly effectiveFrom: string;
  readonly effectiveTo: string | null;
  readonly sourceIds: readonly string[];
  readonly verificationStatus: string;
  readonly verified: boolean;
  /** The full resolved detail, embedded — not a pointer to a live row. */
  readonly detail: unknown;
}

export interface FederalSnapshotBlock {
  readonly taxYear: number;
  readonly effectiveDate: string;
  readonly jurisdictionCode: string;
  readonly engineVersion: string;
  readonly methodology: string;
  readonly roundingPolicy: string;
  readonly featureFlags: Readonly<Record<string, boolean>>;
  readonly resolvedRules: readonly FederalSnapshotRule[];
  readonly sourceIds: readonly string[];
  readonly wageBuckets: Readonly<Record<string, string>>;
  readonly worksheetLines: Readonly<Record<string, string | null>>;
  readonly withholding: unknown;
  readonly fica: unknown;
  readonly employer: unknown;
  readonly annualEstimate: unknown;
  readonly disclosures: unknown;
  readonly status: string;
  readonly issues: unknown;
}

/** Builds the federal block. Pure: persisting it is a separate concern. */
export function buildFederalSnapshotBlock(
  ruleSet: ResolvedFederalRuleSet,
  result: FederalCalculationResult,
  roundingPolicyVersion: string,
): FederalSnapshotBlock {
  const resolvedRules: FederalSnapshotRule[] = [];

  for (const [key, entry] of Object.entries(ruleSet.entries)) {
    if (entry === undefined || !entry.available) {
      continue;
    }
    const reference = entry.rule.reference;
    resolvedRules.push({
      key,
      ruleId: reference.ruleId,
      ruleKey: reference.ruleKey,
      version: reference.version,
      effectiveFrom: reference.effectiveFrom.toISOString(),
      effectiveTo: reference.effectiveTo === null ? null : reference.effectiveTo.toISOString(),
      sourceIds: [...reference.sourceIds],
      verificationStatus: entry.rule.verificationStatus,
      verified: reference.verified,
      // Deep-copied so a later mutation of the live rule cannot reach into history.
      detail: JSON.parse(JSON.stringify(entry.rule.detail ?? null)) as unknown,
    });
  }

  return {
    taxYear: result.taxYear,
    effectiveDate: result.effectiveDate,
    jurisdictionCode: ruleSet.jurisdictionCode,
    engineVersion: result.engineVersion,
    methodology: result.methodology,
    roundingPolicy: roundingPolicyVersion,
    featureFlags: { ...result.flags },
    resolvedRules,
    sourceIds: [...result.sourceIds],
    wageBuckets: { ...result.buckets },
    worksheetLines: { ...result.withholding.worksheetLines },
    withholding: JSON.parse(JSON.stringify(result.withholding)) as unknown,
    fica: JSON.parse(JSON.stringify(result.fica)) as unknown,
    employer: JSON.parse(JSON.stringify(result.employer)) as unknown,
    annualEstimate: JSON.parse(JSON.stringify(result.annualEstimate)) as unknown,
    disclosures: JSON.parse(JSON.stringify(result.disclosures)) as unknown,
    status: result.status,
    issues: JSON.parse(JSON.stringify(result.issues)) as unknown,
  };
}

/**
 * Rebuilds a frozen rule set from a stored snapshot block.
 *
 * This is what makes historical reproducibility real rather than aspirational: the replay
 * path reads the snapshot, never the live rule tables.
 */
export function ruleSetFromSnapshot(block: FederalSnapshotBlock): ResolvedFederalRuleSet {
  const entries: Record<string, unknown> = {};
  const references = block.resolvedRules.map((rule) => ({
    ruleId: rule.ruleId,
    ruleKey: rule.ruleKey,
    version: rule.version,
    category: 'FEDERAL_WITHHOLDING' as const,
    taxYear: block.taxYear,
    jurisdictionId: '',
    jurisdictionCode: block.jurisdictionCode,
    effectiveFrom: new Date(rule.effectiveFrom),
    effectiveTo: rule.effectiveTo === null ? null : new Date(rule.effectiveTo),
    sourceIds: rule.sourceIds,
    verified: rule.verified,
  }));

  block.resolvedRules.forEach((rule, index) => {
    entries[rule.key] = {
      available: true,
      rule: {
        key: rule.key,
        reference: references[index],
        detail: rule.detail,
        verificationStatus: rule.verificationStatus,
      },
    };
  });

  return {
    taxYear: block.taxYear,
    effectiveDate: block.effectiveDate,
    jurisdictionCode: block.jurisdictionCode,
    entries: entries as ResolvedFederalRuleSet['entries'],
    ruleReferences: references,
    sourceIds: [...block.sourceIds],
  };
}

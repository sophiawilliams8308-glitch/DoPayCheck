import { createHash } from 'node:crypto';

import { requiredRuleKeys } from '@/lib/tax/state/capabilityRuleKeys';
import type { CapabilityCode } from '@/lib/tax/state/resolutionContext';
import { getPrisma } from '@/lib/db/client';

/**
 * Evidence fingerprint (SEO-03 contract §E.2).
 *
 * ===========================================================================
 * OWNED BY THE TAX DOMAIN. OPAQUE TO SEO.
 *
 * SEO never imports this module, never parses a fingerprint, and never compares one — it only
 * ever sees the boolean/string result of `coverage.isPublishable()` (`./coverage.ts`).
 *
 * Required properties (contract §E.2), and how each is met:
 *   - deterministic            — same evidence rows always hash to the same string
 *   - order-independent        — rows are sorted before hashing, not read in query order
 *   - changes when evidence changes — every field that could change (version, status,
 *     effective window, update time) is part of the hashed tuple
 *   - opaque                   — a SHA-256 hex digest; nothing about its structure is exposed
 *
 * The algorithm and exact field set are an IMPLEMENTATION DETAIL within a settled mechanism
 * (contract §E.2, §AH D-2) — the contract deliberately does not fix them.
 * ===========================================================================
 *
 * "Relevant evidence" for one (jurisdiction, tax year, capability set) is every ACTIVE
 * `TaxRule` row for the rule keys those capabilities require (via the existing, approved F-02
 * mapping — `requiredRuleKeys()`, never a second capability→rule-key list), whose effective
 * window can reach the tax year. Reads `ruleKey`, `version`, `verificationStatus`,
 * `effectiveFrom`, `effectiveTo` and `updatedAt` only — never a rate, bracket, threshold or
 * any other authoritative value (this module never touches `TaxRuleValue` or `payload`).
 */

export interface EvidenceRow {
  readonly ruleKey: string;
  readonly version: number;
  readonly verificationStatus: string;
  readonly effectiveFrom: string;
  readonly effectiveTo: string | null;
  readonly updatedAt: string;
}

/** Reads the current evidence rows. Exported only for the fingerprint's own tests — this is
 * still an internal tax-domain detail, never imported by `lib/seo/**`. */
export async function readCurrentEvidence(
  jurisdictionId: string,
  taxYearId: number,
  capabilities: readonly CapabilityCode[],
): Promise<readonly EvidenceRow[]> {
  const ruleKeys = [...new Set(capabilities.flatMap((capability) => requiredRuleKeys(capability)))];
  if (ruleKeys.length === 0) {
    return [];
  }

  const taxYear = await getPrisma().taxYear.findUnique({
    where: { id: taxYearId },
    select: { startDate: true, endDate: true },
  });
  if (taxYear === null) {
    return [];
  }

  const rows = await getPrisma().taxRule.findMany({
    where: {
      jurisdictionId,
      ruleKey: { in: ruleKeys as string[] },
      status: 'ACTIVE',
      effectiveFrom: { lt: taxYear.endDate },
      OR: [{ effectiveTo: null }, { effectiveTo: { gt: taxYear.startDate } }],
    },
    select: {
      ruleKey: true,
      version: true,
      verificationStatus: true,
      effectiveFrom: true,
      effectiveTo: true,
      updatedAt: true,
    },
  });

  return rows.map((row) => ({
    ruleKey: row.ruleKey,
    version: row.version,
    verificationStatus: row.verificationStatus,
    effectiveFrom: row.effectiveFrom.toISOString(),
    effectiveTo: row.effectiveTo === null ? null : row.effectiveTo.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }));
}

/** Deterministic, order-independent digest of a set of evidence rows. Pure — given the same
 * rows (in any order), always the same string. */
export function fingerprintOf(rows: readonly EvidenceRow[]): string {
  const sorted = [...rows].sort((a, b) => {
    if (a.ruleKey !== b.ruleKey) {
      return a.ruleKey < b.ruleKey ? -1 : 1;
    }
    return a.version - b.version;
  });

  const canonical = JSON.stringify(
    sorted.map((row) => [
      row.ruleKey,
      row.version,
      row.verificationStatus,
      row.effectiveFrom,
      row.effectiveTo,
      row.updatedAt,
    ]),
  );

  return createHash('sha256').update(canonical).digest('hex');
}

/** Reads current evidence and fingerprints it in one call — what the gate uses. */
export async function computeCurrentEvidenceFingerprint(
  jurisdictionId: string,
  taxYearId: number,
  capabilities: readonly CapabilityCode[],
): Promise<string> {
  const rows = await readCurrentEvidence(jurisdictionId, taxYearId, capabilities);
  return fingerprintOf(rows);
}

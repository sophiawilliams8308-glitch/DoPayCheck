import type { CapabilityCode } from '@/lib/tax/state/resolutionContext';

import { computeCurrentEvidenceFingerprint } from './fingerprint';
import { findCurrentApproval, findLatestApproval } from './repository';

/**
 * The SEO ↔ tax boundary (SEO-03 contract §F). THE ONLY THING SEO CODE MAY IMPORT FROM THE
 * TAX DOMAIN.
 *
 * ===========================================================================
 * ONE-WAY DEPENDENCY, NO CYCLE (contract §F.4).
 *
 * SEO depends on this function's result. This module depends on nothing from `lib/seo/**` —
 * it has no import from that tree, and never will (enforced by a scanner test).
 *
 * SEO never imports `TaxRule`, never reads `TaxRule.verificationStatus`, never interprets
 * rule resolution, never computes a capability, never defines readiness, and never parses the
 * fingerprint this module compares. It sees only the plain object this function returns.
 * ===========================================================================
 *
 * FAIL-CLOSED (contract §J.3, §21): every early return below is `publishable: false`. A
 * database or computation error is caught and ALSO reported as `publishable: false` — never
 * optimistic, never a thrown error that a caller might accidentally treat as "try again
 * later, assume yes for now."
 */

export interface PublishabilityResult {
  readonly publishable: boolean;
  /** Machine-readable code, colon-separated from human text, e.g.
   * `"NO_APPROVAL: no readiness approval exists for this jurisdiction and tax year"`. */
  readonly reason: string;
  readonly stale: boolean;
}

function result(
  publishable: boolean,
  code: string,
  detail: string,
  stale = false,
): PublishabilityResult {
  return { publishable, reason: `${code}: ${detail}`, stale };
}

/**
 * The mandatory boundary interface (contract §F.1). Shape may be refined at a later
 * implementation; the ARCHITECTURAL BOUNDARY — this is the only way SEO ever learns about tax
 * readiness — may not.
 *
 * `requiredCapabilities` is typed `readonly string[]` here, not `CapabilityCode[]`: this is
 * the one function signature SEO code calls directly, and SEO carries a capability key as an
 * opaque string (contract §S.2, `lib/seo/capability.ts`) — it must never need to import the
 * tax domain's own `CapabilityCode` type just to call this function. This module still
 * interprets the values as `CapabilityCode`s internally.
 */
export async function isPublishable(
  jurisdictionId: string,
  taxYearId: string | number,
  requiredCapabilities: readonly string[],
): Promise<PublishabilityResult> {
  try {
    const taxYearIdNumber =
      typeof taxYearId === 'number' ? taxYearId : Number.parseInt(taxYearId, 10);
    if (!Number.isInteger(taxYearIdNumber)) {
      return result(false, 'INVALID_TAX_YEAR', `"${String(taxYearId)}" is not a valid tax year id`);
    }

    const approval = await findCurrentApproval(jurisdictionId, taxYearIdNumber);

    if (approval === null) {
      const latest = await findLatestApproval(jurisdictionId, taxYearIdNumber);
      if (latest === null) {
        return result(false, 'NO_APPROVAL', 'no readiness approval has ever been granted');
      }
      if (latest.revokedAt !== null) {
        return result(false, 'REVOKED', 'the most recent approval was revoked');
      }
      return result(false, 'EXPIRED', 'the most recent approval has expired');
    }

    // Insufficient capability ⇒ not publishable EVEN WITH a valid approval (contract §F, §J.1).
    const approvedCapabilities = new Set(approval.capabilities);
    const missing = requiredCapabilities.filter(
      (capability) => !approvedCapabilities.has(capability),
    );
    if (missing.length > 0) {
      return result(
        false,
        'INSUFFICIENT_CAPABILITY',
        `approval does not cover: ${missing.join(', ')}`,
      );
    }

    // Stale evidence ⇒ not publishable, even though the approval itself is still "current"
    // by date (contract §E.2, §J.1).
    const currentFingerprint = await computeCurrentEvidenceFingerprint(
      jurisdictionId,
      taxYearIdNumber,
      approval.capabilities as CapabilityCode[],
    );
    if (currentFingerprint !== approval.evidenceFingerprint) {
      return result(
        false,
        'STALE_EVIDENCE',
        'the underlying tax rule evidence has changed since this approval was granted',
        true,
      );
    }

    return result(true, 'OK', 'a current, capability-sufficient, non-stale approval exists');
  } catch (error) {
    // Fail-closed: a readiness-check error is never optimistic (contract §21, §J.3).
    return result(
      false,
      'READINESS_CHECK_ERROR',
      error instanceof Error
        ? error.message
        : 'an unexpected error occurred during the readiness check',
    );
  }
}

/** The one export SEO code may import from the tax domain (contract §F.1). */
export const coverage = { isPublishable };

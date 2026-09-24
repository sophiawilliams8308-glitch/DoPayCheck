import { coverage, type PublishabilityResult } from '@/lib/tax/readiness';

import {
  allGatesPass,
  evaluateQualityGates,
  failedGates,
  type GateOutcome,
  type QualityGateInput,
} from './gates';
import type { CapabilityCode } from './capability';
import type { SeoIndexabilityReason } from './types';

/**
 * Indexability derivation (SEO-03 contract §J).
 *
 * ===========================================================================
 * NEVER A STORED ANSWER. Always recomputed:
 *
 *   indexable = lifecycleState == PUBLISHED
 *           AND manualIndexable == true
 *           AND allQualityGatesPass
 *           AND (requires tax capability → coverage.isPublishable(...).publishable)
 *           AND routeIsValid
 *           AND not contentStale beyond threshold
 *
 * `manualIndexable` is editor intent ONLY — it can withhold indexing but can never grant it
 * past a failed gate (contract §J.1).
 *
 * FAIL-CLOSED (contract §J.3, §21): every branch below defaults to `indexable: false`. The
 * whole function is wrapped so an unexpected error — anywhere, including inside the tax
 * readiness call this module in turn calls — degrades to `not publishable`, never optimistic.
 * ===========================================================================
 */

export interface IndexabilityInput extends QualityGateInput {
  readonly manualIndexable: boolean;
  readonly routeValid: boolean;
  /** Only read when `requiresTaxReadiness` is true. */
  readonly jurisdictionId: string | null;
  readonly taxYearId: string | number | null;
  readonly requiredCapabilities: readonly CapabilityCode[];
}

export interface IndexabilityResult {
  readonly indexable: boolean;
  readonly reason: SeoIndexabilityReason;
  readonly gateOutcomes: readonly GateOutcome[];
  readonly readiness: PublishabilityResult | null;
}

function closed(
  reason: SeoIndexabilityReason,
  gateOutcomes: readonly GateOutcome[] = [],
): IndexabilityResult {
  return { indexable: false, reason, gateOutcomes, readiness: null };
}

/** Maps a `coverage.isPublishable()` machine-readable code onto the fixed
 * `SeoIndexabilityReason` vocabulary. Never inspects anything beyond the reason string's own
 * leading code — SEO does not parse tax-domain internals (contract §F.2). */
function readinessReasonToIndexabilityReason(
  readiness: PublishabilityResult,
): SeoIndexabilityReason {
  if (readiness.stale) {
    return 'TAX_READINESS_STALE';
  }
  if (readiness.reason.startsWith('INSUFFICIENT_CAPABILITY')) {
    return 'TAX_CAPABILITY_INSUFFICIENT';
  }
  return 'TAX_READINESS_MISSING';
}

/** Resolves indexability for one page. Async — the tax-readiness call requires it (contract
 * §G.2). Metadata resolution itself (`lib/seo/resolver.ts`) stays synchronous and separate. */
export async function resolveIndexability(input: IndexabilityInput): Promise<IndexabilityResult> {
  try {
    if (input.lifecycleState === 'ARCHIVED') {
      return closed('ARCHIVED');
    }
    if (input.lifecycleState !== 'PUBLISHED') {
      return closed('NOT_PUBLISHED');
    }
    if (!input.manualIndexable) {
      return closed('MANUAL_NOINDEX');
    }
    if (!input.routeValid) {
      return closed('NOT_PUBLISHED');
    }
    if (input.duplicateIdentity) {
      return closed('DUPLICATE_IDENTITY');
    }
    if (input.contentStale) {
      return closed('CONTENT_STALE');
    }

    let readiness: PublishabilityResult | null = null;
    if (input.requiresTaxReadiness) {
      if (input.jurisdictionId === null || input.taxYearId === null) {
        return closed('TAX_READINESS_MISSING');
      }
      readiness = await coverage.isPublishable(
        input.jurisdictionId,
        input.taxYearId,
        input.requiredCapabilities,
      );
      if (!readiness.publishable) {
        return {
          indexable: false,
          reason: readinessReasonToIndexabilityReason(readiness),
          gateOutcomes: [],
          readiness,
        };
      }
    }

    const gateInput: QualityGateInput = {
      ...input,
      readinessPublishable: readiness?.publishable ?? null,
    };
    const outcomes = evaluateQualityGates(gateInput);
    if (!allGatesPass(outcomes)) {
      return {
        indexable: false,
        reason: 'QUALITY_GATE_FAILED',
        gateOutcomes: failedGates(outcomes),
        readiness,
      };
    }

    return { indexable: true, reason: 'OK', gateOutcomes: outcomes, readiness };
  } catch {
    // Fail-closed: any unexpected error anywhere in this derivation is never optimistic.
    return closed('QUALITY_GATE_FAILED');
  }
}

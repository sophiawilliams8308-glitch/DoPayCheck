import { unavailable, FederalReason, type FederalUnavailable } from '../errors/federal-errors';
import { FederalRuleKey } from '../rule-keys';

/**
 * Source provenance for Track B withholding schedules — spec §35.4.
 *
 * ===========================================================================
 * A WITHHOLDING SCHEDULE MUST COME FROM PUBLICATION 15-T.
 *
 * The single most damaging substitution this engine could make is to withhold a
 * paycheck from the annual 1040 rate brackets. The two tables look alike, and a
 * plausible-looking number would come out — wrong all year, for everyone.
 *
 * Namespacing the keys (§2.5) prevents that mistake in CODE. This prevents it in
 * DATA: a rule filed under FED.FIT.RATE_SCHEDULE.* whose cited document is not
 * Pub. 15-T is refused, not used.
 * ===========================================================================
 *
 * This is a check on PROVENANCE, never on values. It reads no tax figure and
 * supplies none; a rule it refuses becomes unavailable with a stated reason.
 */

/** The keys whose authority may come from one document only. */
export const PUB_15T_REQUIRED_KEYS: readonly FederalRuleKey[] = [
  FederalRuleKey.FIT_RATE_SCHEDULE_STANDARD,
  FederalRuleKey.FIT_RATE_SCHEDULE_STEP2,
];

/** The parts of a source document this check looks at. Never its values. */
export interface SourceDescriptor {
  readonly code: string;
  readonly title: string;
}

/**
 * Matches the document however an administrator spelled it: `IRS-PUB-15-T-2026`,
 * `Publication 15-T`, `Pub 15T`. Deliberately tolerant of separators and case,
 * and deliberately intolerant of anything else.
 */
const PUB_15T = /\bpub(?:lication)?[\s._-]*15[\s._-]*t\b/i;

export function isPub15T(source: SourceDescriptor): boolean {
  return PUB_15T.test(source.code) || PUB_15T.test(source.title);
}

export function requiresPub15T(key: FederalRuleKey): boolean {
  return PUB_15T_REQUIRED_KEYS.includes(key);
}

/**
 * @returns `null` when the citation is acceptable, otherwise the reason it is not.
 *
 * An empty source list is NOT reported here — an unsourced rule is already caught
 * by the verification path (§21), and reporting it twice would obscure which
 * defect an operator has to fix.
 */
export function checkTrackBProvenance(
  key: FederalRuleKey,
  sources: readonly SourceDescriptor[],
): FederalUnavailable | null {
  if (!requiresPub15T(key) || sources.length === 0) {
    return null;
  }
  if (sources.some(isPub15T)) {
    return null;
  }
  return unavailable(
    FederalReason.SOURCE_PROVENANCE_MISMATCH,
    `${key} must cite IRS Publication 15-T; the attached source documents do not include it`,
    key,
  );
}

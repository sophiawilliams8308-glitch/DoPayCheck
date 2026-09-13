import type { CalculationStatus } from '@/lib/calculator/types/status';

/**
 * Federal failure taxonomy — spec §28.
 *
 * ===========================================================================
 * THE ENGINE DOES NOT THROW FOR DOMAIN CONDITIONS (§28.6).
 *
 * A missing rule, an unverified value, an unsupported scenario and a rule
 * conflict are ordinary states of a tax system whose data is published
 * gradually. Each is returned as a typed reason on the component it affects —
 * never raised, never silently zero.
 * ===========================================================================
 */

export const FederalReason = {
  RULE_MISSING: 'RULE_MISSING',
  RULE_CONFLICT: 'RULE_CONFLICT',
  RULE_UNVERIFIED: 'RULE_UNVERIFIED',
  COMPONENT_NOT_STATED: 'COMPONENT_NOT_STATED',
  RULE_DETAIL_INVALID: 'RULE_DETAIL_INVALID',
  /** A Track B schedule cites a document other than Pub. 15-T (§35.4). */
  SOURCE_PROVENANCE_MISMATCH: 'SOURCE_PROVENANCE_MISMATCH',
  /** A deduction's taxability for a needed bucket is NOT_STATED (§12.2). */
  TAXABILITY_NOT_STATED: 'TAXABILITY_NOT_STATED',
  FEATURE_DISABLED: 'FEATURE_DISABLED',
  SCENARIO_UNSUPPORTED: 'SCENARIO_UNSUPPORTED',
  PENDING_VERIFICATION: 'PENDING_VERIFICATION',
  INPUT_INVALID: 'INPUT_INVALID',
  /** An engine invariant (§28.5) was breached — a defect, not a data state. */
  INVARIANT_BREACH: 'INVARIANT_BREACH',
} as const;

export type FederalReason = (typeof FederalReason)[keyof typeof FederalReason];

/** Maps a federal reason onto the project-wide calculation status (§28.1). */
export function statusForFederalReason(reason: FederalReason): CalculationStatus {
  switch (reason) {
    case FederalReason.RULE_CONFLICT:
    case FederalReason.RULE_DETAIL_INVALID:
    case FederalReason.SOURCE_PROVENANCE_MISMATCH:
      return 'RULE_CONFLICT';
    case FederalReason.SCENARIO_UNSUPPORTED:
    case FederalReason.FEATURE_DISABLED:
      return 'UNSUPPORTED_SCENARIO';
    case FederalReason.INPUT_INVALID:
      return 'INVALID_INPUT';
    case FederalReason.INVARIANT_BREACH:
      return 'CALCULATION_ERROR';
    case FederalReason.RULE_MISSING:
    case FederalReason.RULE_UNVERIFIED:
    case FederalReason.COMPONENT_NOT_STATED:
    case FederalReason.TAXABILITY_NOT_STATED:
    case FederalReason.PENDING_VERIFICATION:
      return 'INCOMPLETE';
  }
}

/** Machine-readable missing-rule reason codes (§28.2). */
export const MissingRuleReason = {
  NO_RULE: 'NO_RULE',
  NO_EFFECTIVE_VERSION: 'NO_EFFECTIVE_VERSION',
  NOT_LIVE_STATUS: 'NOT_LIVE_STATUS',
  DETAIL_INVALID: 'DETAIL_INVALID',
  SOURCE_PROVENANCE_MISMATCH: 'SOURCE_PROVENANCE_MISMATCH',
} as const;

export type MissingRuleReason = (typeof MissingRuleReason)[keyof typeof MissingRuleReason];

/**
 * A gap an operator can act on directly (§28.2).
 *
 * Machine-readable on purpose: admin tooling and the coverage gate consume it,
 * so a missing rule surfaces as a work item rather than a support ticket.
 */
export interface MissingRuleIssue {
  readonly ruleKey: string;
  readonly category: string;
  readonly taxYear: number;
  readonly effectiveDate: string;
  readonly reason: MissingRuleReason;
}

/** Why one federal amount could not be produced. */
export interface FederalUnavailable {
  readonly reason: FederalReason;
  readonly ruleKey?: string;
  /** The specific component of that rule, e.g. "rate", "amount". */
  readonly component?: string;
  /** Human-readable detail. Never contains a tax value. */
  readonly detail: string;
}

export function unavailable(
  reason: FederalReason,
  detail: string,
  ruleKey?: string,
  component?: string,
): FederalUnavailable {
  return {
    reason,
    detail,
    ...(ruleKey === undefined ? {} : { ruleKey }),
    ...(component === undefined ? {} : { component }),
  };
}

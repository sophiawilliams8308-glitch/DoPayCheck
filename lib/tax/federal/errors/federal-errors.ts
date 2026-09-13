import type { CalculationStatus } from '@/lib/calculator/types/status';

/**
 * Federal engine failure taxonomy (Phase 4).
 *
 * ===========================================================================
 * THE ENGINE DOES NOT THROW FOR DOMAIN CONDITIONS.
 *
 * A missing rule, an unverified value, an unsupported scenario and a rule conflict are all
 * ordinary, expected states of a tax system whose data is published gradually. Each is
 * returned as a typed reason attached to the component it affects — never raised, and never
 * silently converted to zero.
 *
 * Only a genuine programming defect becomes CALCULATION_ERROR, and only at the pipeline
 * boundary.
 * ===========================================================================
 */

export const FederalReason = {
  /** No ACTIVE rule covers this key for the tax year / effective date. */
  RULE_MISSING: 'RULE_MISSING',
  /** More than one ACTIVE rule applies. A data defect — surfaced, never arbitrated. */
  RULE_CONFLICT: 'RULE_CONFLICT',
  /** A rule exists but carries no VERIFIED official source. */
  RULE_UNVERIFIED: 'RULE_UNVERIFIED',
  /** A rule exists but the official source does not state the component this needs. */
  COMPONENT_NOT_STATED: 'COMPONENT_NOT_STATED',
  /** A rule exists but its detail payload failed its schema. */
  RULE_DETAIL_INVALID: 'RULE_DETAIL_INVALID',
  /** The methodology this scenario needs is behind a disabled feature flag. */
  FEATURE_DISABLED: 'FEATURE_DISABLED',
  /** The scenario is understood but deliberately not supported yet. */
  SCENARIO_UNSUPPORTED: 'SCENARIO_UNSUPPORTED',
  /** The official semantics are not yet verified, so no behaviour may be applied. */
  PENDING_VERIFICATION: 'PENDING_VERIFICATION',
  /** The caller's federal input is internally inconsistent. */
  INPUT_INVALID: 'INPUT_INVALID',
} as const;

export type FederalReason = (typeof FederalReason)[keyof typeof FederalReason];

/** Maps a federal reason onto the project-wide calculation status (spec §16). */
export function statusForFederalReason(reason: FederalReason): CalculationStatus {
  switch (reason) {
    case FederalReason.RULE_CONFLICT:
      return 'RULE_CONFLICT';
    case FederalReason.SCENARIO_UNSUPPORTED:
    case FederalReason.FEATURE_DISABLED:
      return 'UNSUPPORTED_SCENARIO';
    case FederalReason.INPUT_INVALID:
      return 'INVALID_INPUT';
    case FederalReason.RULE_MISSING:
    case FederalReason.RULE_UNVERIFIED:
    case FederalReason.COMPONENT_NOT_STATED:
    case FederalReason.RULE_DETAIL_INVALID:
    case FederalReason.PENDING_VERIFICATION:
      return 'INCOMPLETE';
  }
}

/**
 * Why one federal amount could not be produced.
 *
 * `ruleKey` and `component` are mandatory for data-shaped reasons so an operator can go
 * straight to the row that needs sourcing, rather than searching for it.
 */
export interface FederalUnavailable {
  readonly reason: FederalReason;
  /** The rule key involved, when the reason is about rule data. */
  readonly ruleKey?: string;
  /** The specific component of that rule, e.g. "employeeRate", "wageBase". */
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

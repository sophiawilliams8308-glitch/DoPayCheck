import type { CalculationStatus } from '@/lib/calculator/types/status';

/**
 * State engine failure taxonomy — Phase 5 Step 1.
 *
 * ===========================================================================
 * THE ENGINE DOES NOT THROW FOR DOMAIN CONDITIONS.
 *
 * A missing rule, an unverified value, an unsupported scenario and a rule
 * conflict are ordinary states of a tax system whose data is published one
 * jurisdiction at a time. Fifty-one jurisdictions publish on fifty-one
 * schedules, so "we do not have this yet" is the NORMAL case for most of
 * Phase 5's life — it must be a first-class return value, never an exception
 * and never a zero.
 * ===========================================================================
 *
 * Mirrors the Phase 4 federal taxonomy deliberately: the two engines fail in
 * the same vocabulary so a caller handles one shape, not two.
 */

export const StateReason = {
  RULE_MISSING: 'RULE_MISSING',
  RULE_CONFLICT: 'RULE_CONFLICT',
  RULE_UNVERIFIED: 'RULE_UNVERIFIED',
  COMPONENT_NOT_STATED: 'COMPONENT_NOT_STATED',
  RULE_DETAIL_INVALID: 'RULE_DETAIL_INVALID',
  /** A deduction's treatment for a needed state bucket is NOT_STATED. */
  TAXABILITY_NOT_STATED: 'TAXABILITY_NOT_STATED',
  /** The jurisdiction has no capability declaration, so coverage is unknown. */
  CAPABILITY_NOT_DECLARED: 'CAPABILITY_NOT_DECLARED',
  /** A declared methodology exists but this engine build does not implement it. */
  METHOD_NOT_IMPLEMENTED: 'METHOD_NOT_IMPLEMENTED',
  FEATURE_DISABLED: 'FEATURE_DISABLED',
  SCENARIO_UNSUPPORTED: 'SCENARIO_UNSUPPORTED',
  PENDING_VERIFICATION: 'PENDING_VERIFICATION',
  INPUT_INVALID: 'INPUT_INVALID',
  /** An engine invariant was breached — a defect, not a data state. */
  INVARIANT_BREACH: 'INVARIANT_BREACH',
} as const;

export type StateReason = (typeof StateReason)[keyof typeof StateReason];

/** Maps a state reason onto the project-wide calculation status. */
export function statusForStateReason(reason: StateReason): CalculationStatus {
  switch (reason) {
    case StateReason.RULE_CONFLICT:
    case StateReason.RULE_DETAIL_INVALID:
      return 'RULE_CONFLICT';
    case StateReason.SCENARIO_UNSUPPORTED:
    case StateReason.FEATURE_DISABLED:
    case StateReason.METHOD_NOT_IMPLEMENTED:
      return 'UNSUPPORTED_SCENARIO';
    case StateReason.INPUT_INVALID:
      return 'INVALID_INPUT';
    case StateReason.INVARIANT_BREACH:
      return 'CALCULATION_ERROR';
    case StateReason.RULE_MISSING:
    case StateReason.RULE_UNVERIFIED:
    case StateReason.COMPONENT_NOT_STATED:
    case StateReason.TAXABILITY_NOT_STATED:
    case StateReason.CAPABILITY_NOT_DECLARED:
    case StateReason.PENDING_VERIFICATION:
      return 'INCOMPLETE';
  }
}

/** Machine-readable missing-rule reason codes, for admin tooling. */
export const StateMissingRuleReason = {
  NO_RULE: 'NO_RULE',
  NO_EFFECTIVE_VERSION: 'NO_EFFECTIVE_VERSION',
  NOT_LIVE_STATUS: 'NOT_LIVE_STATUS',
  DETAIL_INVALID: 'DETAIL_INVALID',
  JURISDICTION_UNRESOLVED: 'JURISDICTION_UNRESOLVED',
} as const;

export type StateMissingRuleReason =
  (typeof StateMissingRuleReason)[keyof typeof StateMissingRuleReason];

/**
 * A gap an operator can act on directly.
 *
 * Carries the jurisdiction, because in Phase 5 "which state is missing this?"
 * is the first question anyone asks — unlike Phase 4, where it was always US.
 */
export interface StateMissingRuleIssue {
  readonly ruleKey: string;
  readonly category: string;
  readonly jurisdictionCode: string;
  readonly taxYear: number;
  readonly effectiveDate: string;
  readonly reason: StateMissingRuleReason;
}

/** Why one state amount could not be produced. */
export interface StateUnavailable {
  readonly reason: StateReason;
  readonly ruleKey?: string;
  /** The specific component of that rule, e.g. "rate", "amount". */
  readonly component?: string;
  /** Human-readable detail. Never contains a tax value. */
  readonly detail: string;
}

export function stateUnavailable(
  reason: StateReason,
  detail: string,
  ruleKey?: string,
  component?: string,
): StateUnavailable {
  return {
    reason,
    detail,
    ...(ruleKey === undefined ? {} : { ruleKey }),
    ...(component === undefined ? {} : { component }),
  };
}

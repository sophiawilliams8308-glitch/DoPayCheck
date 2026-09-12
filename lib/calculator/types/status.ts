/**
 * Calculation statuses (spec §16).
 *
 * The engine NEVER throws for an expected unsupported scenario and never substitutes a
 * default when data is missing. Every outcome is one of these statuses, so a caller can
 * always distinguish "the law says zero" from "we do not have the law".
 */

export const CalculationStatus = {
  /** Every stage completed with applicable, verified rules. */
  COMPLETE: 'COMPLETE',
  /** Structurally valid, but at least one required rule was unavailable. */
  INCOMPLETE: 'INCOMPLETE',
  /** The caller's input failed validation. Distinct from missing tax data. */
  INVALID_INPUT: 'INVALID_INPUT',
  /** Two or more ACTIVE rules applied to the same scenario. Never arbitrated. */
  RULE_CONFLICT: 'RULE_CONFLICT',
  /** The scenario is understood but not supported by the current rule architecture. */
  UNSUPPORTED_SCENARIO: 'UNSUPPORTED_SCENARIO',
  /** An unexpected engine failure. A defect, not a data state. */
  CALCULATION_ERROR: 'CALCULATION_ERROR',
} as const;

export type CalculationStatus = (typeof CalculationStatus)[keyof typeof CalculationStatus];

/** Why a component could not be calculated. Attached per tax component, not globally. */
export const IncompleteReason = {
  /** No ACTIVE rule covers this jurisdiction/category/date. */
  NO_APPLICABLE_RULE: 'NO_APPLICABLE_RULE',
  /** Multiple ACTIVE rules apply — a data defect, surfaced not resolved. */
  AMBIGUOUS_RULE: 'AMBIGUOUS_RULE',
  /** A rule exists but its authoritative values are not yet stated by a source. */
  RULE_VALUES_PENDING: 'RULE_VALUES_PENDING',
  /** A rule exists but carries no verified official source. */
  RULE_UNVERIFIED: 'RULE_UNVERIFIED',
  /** The jurisdiction could not be resolved from the supplied location. */
  JURISDICTION_UNRESOLVED: 'JURISDICTION_UNRESOLVED',
  /** The methodology this rule declares is not implemented yet. */
  METHOD_NOT_IMPLEMENTED: 'METHOD_NOT_IMPLEMENTED',
} as const;

export type IncompleteReason = (typeof IncompleteReason)[keyof typeof IncompleteReason];

/**
 * Severity ordering used to fold component statuses into one overall status.
 *
 * Higher wins. INVALID_INPUT and CALCULATION_ERROR outrank data gaps because they indicate a
 * caller or engine fault rather than a missing law.
 */
const SEVERITY: Record<CalculationStatus, number> = {
  COMPLETE: 0,
  INCOMPLETE: 1,
  UNSUPPORTED_SCENARIO: 2,
  RULE_CONFLICT: 3,
  INVALID_INPUT: 4,
  CALCULATION_ERROR: 5,
};

/** Folds component statuses into the overall result status. Empty input is COMPLETE. */
export function combineStatuses(statuses: readonly CalculationStatus[]): CalculationStatus {
  return statuses.reduce<CalculationStatus>(
    (worst, status) => (SEVERITY[status] > SEVERITY[worst] ? status : worst),
    CalculationStatus.COMPLETE,
  );
}

/** Maps a missing-data reason onto the status it produces. */
export function statusForReason(reason: IncompleteReason): CalculationStatus {
  switch (reason) {
    case IncompleteReason.AMBIGUOUS_RULE:
      return CalculationStatus.RULE_CONFLICT;
    case IncompleteReason.METHOD_NOT_IMPLEMENTED:
      return CalculationStatus.UNSUPPORTED_SCENARIO;
    case IncompleteReason.NO_APPLICABLE_RULE:
    case IncompleteReason.RULE_VALUES_PENDING:
    case IncompleteReason.RULE_UNVERIFIED:
    case IncompleteReason.JURISDICTION_UNRESOLVED:
      return CalculationStatus.INCOMPLETE;
  }
}

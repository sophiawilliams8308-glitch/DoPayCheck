import { CoverageStatus, findCoverageCell, type CoverageMatrix } from './coverage/coverage';
import type { CapabilityCode } from './resolutionContext';

/**
 * Coverage Gate — Phase 5 Step 3.3.
 *
 * ===========================================================================
 * COVERAGE GATES. IT DOES NOT GRANT.
 *
 * This module answers exactly one question: given a `(jurisdiction,
 * capability)` pair, may candidate rule retrieval even be ATTEMPTED? It sits
 * in the pipeline immediately before candidate retrieval (Step 3.4, not yet
 * implemented) so that a blocked coverage result costs zero candidate-rule
 * queries.
 *
 * `SUPPORTED` means only "candidate retrieval may proceed" — never "rule
 * resolved", "rule valid" or "rule production-ready". Those are questions for
 * later resolver stages (Step 3.4 onward) that this module never asks.
 * ===========================================================================
 *
 * PURE, SYNCHRONOUS, ZERO-QUERY. `consultCoverage` reads only the in-memory
 * `CoverageMatrix` it is given (Step 2's own model, via `findCoverageCell`) —
 * it imports no database client, calls no candidate-retrieval function
 * (none is imported here at all), and awaits nothing. A blocked outcome is
 * therefore free by construction, not by discipline.
 *
 * NO CAPABILITY -> RULE-KEY MAPPING. F-02 (which `StateRuleKey`s a capability
 * needs) is unresolved and blocking. This module never asks "which keys" —
 * every decision is made at (jurisdiction, capability) granularity, exactly
 * as Step 2's coverage model itself is keyed.
 */

/**
 * The subset of Step 2's `CoverageStatus` this gate ever emits as a blocking
 * OUTCOME. `SUPPORTED` never appears here (it permits, it is not an outcome
 * of its own), and `PARTIALLY_SUPPORTED` never appears here either — per the
 * specification's L-05 behavior it maps to `PENDING_VERIFICATION` (see
 * `consultCoverage`), with `PARTIALLY_SUPPORTED` itself recorded only in the
 * consultation entry below for the trace.
 */
export const CoverageGateOutcome = {
  NOT_APPLICABLE: CoverageStatus.NOT_APPLICABLE,
  NOT_STATED: CoverageStatus.NOT_STATED,
  PENDING_RESEARCH: CoverageStatus.PENDING_RESEARCH,
  PENDING_VERIFICATION: CoverageStatus.PENDING_VERIFICATION,
  CONFLICT: CoverageStatus.CONFLICT,
  UNSUPPORTED_SCENARIO: CoverageStatus.UNSUPPORTED_SCENARIO,
} as const;

export type CoverageGateOutcome = (typeof CoverageGateOutcome)[keyof typeof CoverageGateOutcome];

/** Whether this consultation permitted retrieval or blocked it. */
export const CoverageConsultationAction = {
  PERMITTED: 'PERMITTED',
  BLOCKED: 'BLOCKED',
} as const;

export type CoverageConsultationAction =
  (typeof CoverageConsultationAction)[keyof typeof CoverageConsultationAction];

/**
 * The minimal coverage-gate trace entry the specification names
 * (`ResolutionTrace.coverageConsultation`) — `state`, `capability`, `status`,
 * `action`, and nothing more. No rule ids, no candidate lists, no precedence,
 * no detail/readiness information: those belong to later stages and are
 * deliberately absent here so this entry can never leak them.
 *
 * `status` is the RAW coverage status from the cell (so `PARTIALLY_SUPPORTED`
 * is visible here even though the gate's own `outcome` reports
 * `PENDING_VERIFICATION` for that case).
 */
export interface CoverageConsultationEntry {
  readonly state: string;
  readonly capability: CapabilityCode;
  readonly status: CoverageStatus;
  readonly action: CoverageConsultationAction;
}

/** The gate's decision for one `(jurisdiction, capability)` pair. */
export type CoverageGateResult =
  | { readonly permitted: true; readonly consultation: CoverageConsultationEntry }
  | {
      readonly permitted: false;
      readonly outcome: CoverageGateOutcome;
      readonly consultation: CoverageConsultationEntry;
    };

function permit(
  state: string,
  capability: CapabilityCode,
  status: CoverageStatus,
): CoverageGateResult {
  return {
    permitted: true,
    consultation: { state, capability, status, action: CoverageConsultationAction.PERMITTED },
  };
}

function block(
  state: string,
  capability: CapabilityCode,
  status: CoverageStatus,
  outcome: CoverageGateOutcome,
): CoverageGateResult {
  return {
    permitted: false,
    outcome,
    consultation: { state, capability, status, action: CoverageConsultationAction.BLOCKED },
  };
}

/**
 * Consults Step 2 coverage for one `(jurisdiction, capability)` pair and
 * decides whether candidate retrieval may proceed — Step 3.3, pipeline
 * position 5 (`consultCoverage`), before Step 3.4's candidate retrieval.
 *
 * UNKNOWN JURISDICTION: this function never checks whether `jurisdictionCode`
 * is a "real" or "known" state — it does not need to. `findCoverageCell`
 * (Step 2, unchanged) already gives the authoritative answer for a
 * `(jurisdiction, capability)` pair with no recorded cell: it synthesizes one
 * at `PENDING_RESEARCH`, on the documented basis that "an unrecorded cell and
 * an unresearched one are the same claim: we do not know." This gate simply
 * reuses that existing Step 2 contract rather than adding a second notion of
 * jurisdiction existence, a lookup, or a static vocabulary.
 *
 * SUPPORTED READS THE RAW STATUS, NOT `assessSupport`. Step 2's
 * `assessSupport` additionally flags a cell recorded SUPPORTED but missing
 * its own evidence as a data defect — a Step 2 data-integrity concern about
 * whether a human's SUPPORTED claim is well-formed. That is a different
 * question from Step 3.3's, and layering it in here would require inventing
 * a ninth outcome the specification's eight-status table does not define.
 * Step 3.3 trusts the recorded status, exactly as it trusts the recorded
 * jurisdiction and capability — the same way it never second-guesses a rule's
 * validity, because that too belongs to a later stage.
 */
export function consultCoverage(
  matrix: CoverageMatrix,
  jurisdictionCode: string,
  capability: CapabilityCode,
): CoverageGateResult {
  const cell = findCoverageCell(matrix, jurisdictionCode, capability);

  switch (cell.status) {
    case CoverageStatus.SUPPORTED:
      // Permits candidate retrieval only. No rule is resolved here, no tax is
      // calculated, no readiness decision is made. SUPPORTED != RESOLVED.
      return permit(jurisdictionCode, capability, cell.status);

    case CoverageStatus.PARTIALLY_SUPPORTED:
      // L-05: F-02 (capability -> rule-key mapping) does not exist, so which
      // keys of this capability are/aren't supported can never be determined
      // here. The ENTIRE capability is blocked, never split. The coverage
      // status that caused the block (PARTIALLY_SUPPORTED) is recorded in the
      // consultation entry for the trace; the outcome itself is
      // PENDING_VERIFICATION, per the specification.
      return block(
        jurisdictionCode,
        capability,
        cell.status,
        CoverageGateOutcome.PENDING_VERIFICATION,
      );

    case CoverageStatus.NOT_APPLICABLE:
      return block(jurisdictionCode, capability, cell.status, CoverageGateOutcome.NOT_APPLICABLE);

    case CoverageStatus.NOT_STATED:
      return block(jurisdictionCode, capability, cell.status, CoverageGateOutcome.NOT_STATED);

    case CoverageStatus.PENDING_RESEARCH:
      return block(jurisdictionCode, capability, cell.status, CoverageGateOutcome.PENDING_RESEARCH);

    case CoverageStatus.PENDING_VERIFICATION:
      return block(
        jurisdictionCode,
        capability,
        cell.status,
        CoverageGateOutcome.PENDING_VERIFICATION,
      );

    case CoverageStatus.CONFLICT:
      return block(jurisdictionCode, capability, cell.status, CoverageGateOutcome.CONFLICT);

    case CoverageStatus.UNSUPPORTED_SCENARIO:
      return block(
        jurisdictionCode,
        capability,
        cell.status,
        CoverageGateOutcome.UNSUPPORTED_SCENARIO,
      );
  }
}

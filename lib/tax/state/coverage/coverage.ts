import { ALL_STATE_CAPABILITIES, type StateCapability } from './capabilities';

/**
 * State coverage model — Phase 5 Step 2.
 *
 * ===========================================================================
 * COVERAGE IS THE AUTHORITATIVE ANSWER TO "DO WE SUPPORT THIS?"
 *
 * The inference this model exists to forbid:
 *
 *     generic engine code exists  →  therefore this state is supported
 *
 * That reasoning is how a calculator ends up confidently withholding the wrong
 * amount for a state nobody has researched. The engine running without
 * throwing says nothing about whether anyone has read that jurisdiction's
 * published method. So support is a RECORDED CLAIM, backed by evidence and
 * verification, and everything starts at PENDING_RESEARCH.
 * ===========================================================================
 *
 * NOT A SECOND RULE STORE. Coverage records READINESS — what we know and how
 * well we know it. Values live in Phase 2's `TaxRule` and nowhere else. A
 * coverage cell references rules and sources by identifier; it never copies a
 * rate, a bracket or a threshold.
 */

/**
 * Coverage statuses. Eight genuinely different things, none interchangeable.
 *
 * The distinctions that matter most, because collapsing either one produces a
 * confident wrong answer:
 *
 *   NOT_APPLICABLE vs NOT_STATED — "this state has no disability programme"
 *   is a positive, sourced fact you can calculate from. "The source does not
 *   say" is an absence you cannot. Neither is zero.
 *
 *   PENDING_RESEARCH vs PENDING_VERIFICATION — nobody has looked, versus
 *   somebody has looked and a second human has not yet confirmed it.
 */
export const CoverageStatus = {
  /** Every readiness condition is satisfied and recorded. */
  SUPPORTED: 'SUPPORTED',
  /** Authoritative positive evidence that the capability does not apply here. */
  NOT_APPLICABLE: 'NOT_APPLICABLE',
  /** The source does not state the required fact. NEVER zero, never NOT_APPLICABLE. */
  NOT_STATED: 'NOT_STATED',
  /** No authoritative research has been completed. The starting state of every cell. */
  PENDING_RESEARCH: 'PENDING_RESEARCH',
  /** Research exists; human verification is incomplete. */
  PENDING_VERIFICATION: 'PENDING_VERIFICATION',
  /** Authoritative sources or rules disagree. Escalated, never arbitrated. */
  CONFLICT: 'CONFLICT',
  /** Only a defined subset of the capability is supported. */
  PARTIALLY_SUPPORTED: 'PARTIALLY_SUPPORTED',
  /** The requested scenario is outside the supported calculation scope. */
  UNSUPPORTED_SCENARIO: 'UNSUPPORTED_SCENARIO',
} as const;

export type CoverageStatus = (typeof CoverageStatus)[keyof typeof CoverageStatus];

export const ALL_COVERAGE_STATUSES: readonly CoverageStatus[] = Object.values(CoverageStatus);

/** The status every production cell starts in, and stays in until researched. */
export const INITIAL_COVERAGE_STATUS: CoverageStatus = CoverageStatus.PENDING_RESEARCH;

/**
 * Scenario dimensions a cell may narrow support by.
 *
 * `null` means "not narrowed by this dimension" — it does NOT mean "none" or
 * "all values unsupported". A cell that supports only weekly payroll says so
 * by listing weekly; a cell indifferent to pay frequency leaves it null.
 */
export interface CoverageScenario {
  readonly payFrequencies?: readonly string[] | null;
  readonly filingStatuses?: readonly string[] | null;
  readonly wageTypes?: readonly string[] | null;
  readonly side?: 'EMPLOYEE' | 'EMPLOYER' | 'BOTH' | null;
  readonly residencyStatuses?: readonly string[] | null;
  readonly programs?: readonly string[] | null;
  /** True when support depends on an employee election being supplied. */
  readonly requiresElection?: boolean | null;
  /** True when applicability depends on employer headcount. */
  readonly dependsOnEmployerSize?: boolean | null;
  /** True when a private plan or opt-out changes the answer. */
  readonly dependsOnPrivatePlan?: boolean | null;
  /** True when a reciprocity agreement changes the answer. */
  readonly dependsOnReciprocity?: boolean | null;
}

/**
 * Evidence behind a claim.
 *
 * IDENTIFIERS ONLY. A source is referenced by its Phase 2 `Source` id, never
 * reproduced here — so this model cannot become a place where an unsourced URL
 * or a remembered rate quietly appears.
 */
export interface CoverageEvidence {
  /** Phase 2 `Source` ids supporting the claim. Empty means none recorded. */
  readonly sourceIds: readonly string[];
  /** Phase 2 `TaxRule` ids this claim depends on. */
  readonly ruleIds: readonly string[];
  /** Who confirmed the research, when a human has. */
  readonly verifiedBy: string | null;
  /** ISO instant of verification. Null until verified. */
  readonly verifiedAt: string | null;
  /** Free-text researcher notes. Never a tax value. */
  readonly notes: string | null;
}

export function emptyEvidence(): CoverageEvidence {
  return { sourceIds: [], ruleIds: [], verifiedBy: null, verifiedAt: null, notes: null };
}

/**
 * One cell of the coverage matrix: one jurisdiction, one capability, one year.
 *
 * Effective-date aware, because a state can change methodology mid-year and
 * coverage must be able to say "supported from this date" without rewriting
 * what was true before.
 */
export interface CoverageCell {
  readonly jurisdictionCode: string;
  readonly capability: StateCapability;
  readonly taxYear: number;
  readonly status: CoverageStatus;
  /** Narrowing dimensions. Absent means the cell is not narrowed. */
  readonly scenario: CoverageScenario;
  readonly evidence: CoverageEvidence;
  /** ISO instant this claim begins. Null means "for the whole tax year". */
  readonly effectiveFrom: string | null;
  /** ISO instant this claim ends, exclusive. Null means open-ended. */
  readonly effectiveTo: string | null;
  /** Model version, so a stored cell can be re-read after the shape evolves. */
  readonly contractVersion: number;
  /** What a user must be told when this cell is relied upon. */
  readonly disclosures: readonly string[];
}

/** Bump when the cell shape changes in a way a stored record must be read through. */
export const COVERAGE_CONTRACT_VERSION = 1;

/** A complete matrix for one tax year. */
export interface CoverageMatrix {
  readonly taxYear: number;
  readonly jurisdictionCodes: readonly string[];
  readonly cells: readonly CoverageCell[];
}

export function coverageCellKey(
  jurisdictionCode: string,
  capability: StateCapability,
  taxYear: number,
): string {
  return `${jurisdictionCode}|${capability}|${String(taxYear)}`;
}

/**
 * Builds the full matrix for a set of jurisdictions, every cell PENDING_RESEARCH.
 *
 * PURE, and deliberately takes jurisdiction codes rather than reading them:
 * the caller supplies them from the seeded jurisdiction repository, so this
 * module needs no database and no hardcoded list of states. A list of state
 * codes in engine code is the first step toward a branch per state.
 */
export function buildCoverageMatrix(
  jurisdictionCodes: readonly string[],
  taxYear: number,
): CoverageMatrix {
  const cells: CoverageCell[] = [];
  for (const jurisdictionCode of jurisdictionCodes) {
    for (const capability of ALL_STATE_CAPABILITIES) {
      cells.push({
        jurisdictionCode,
        capability,
        taxYear,
        status: INITIAL_COVERAGE_STATUS,
        scenario: {},
        evidence: emptyEvidence(),
        effectiveFrom: null,
        effectiveTo: null,
        contractVersion: COVERAGE_CONTRACT_VERSION,
        disclosures: [],
      });
    }
  }
  return { taxYear, jurisdictionCodes: [...jurisdictionCodes], cells };
}

/**
 * Looks a cell up, defaulting to PENDING_RESEARCH rather than `undefined`.
 *
 * An unrecorded cell and an unresearched one are the same claim: we do not
 * know. Returning `undefined` would let a caller treat absence as falsy and
 * carry on.
 */
export function findCoverageCell(
  matrix: CoverageMatrix,
  jurisdictionCode: string,
  capability: StateCapability,
): CoverageCell {
  const found = matrix.cells.find(
    (cell) => cell.jurisdictionCode === jurisdictionCode && cell.capability === capability,
  );
  return (
    found ?? {
      jurisdictionCode,
      capability,
      taxYear: matrix.taxYear,
      status: INITIAL_COVERAGE_STATUS,
      scenario: {},
      evidence: emptyEvidence(),
      effectiveFrom: null,
      effectiveTo: null,
      contractVersion: COVERAGE_CONTRACT_VERSION,
      disclosures: [],
    }
  );
}

/**
 * The conditions a cell must satisfy before SUPPORTED may be claimed.
 *
 * Deliberately explicit and deliberately unforgiving: each is a thing a human
 * did, not a thing the code can observe about itself.
 */
export const SupportCondition = {
  RESEARCH_RECORDED: 'RESEARCH_RECORDED',
  SOURCE_CITED: 'SOURCE_CITED',
  RULE_LINKED: 'RULE_LINKED',
  HUMAN_VERIFIED: 'HUMAN_VERIFIED',
  NO_CONFLICT: 'NO_CONFLICT',
} as const;

export type SupportCondition = (typeof SupportCondition)[keyof typeof SupportCondition];

export const ALL_SUPPORT_CONDITIONS: readonly SupportCondition[] = Object.values(SupportCondition);

export interface SupportAssessment {
  /** True ONLY when the cell is SUPPORTED and every condition is met. */
  readonly supported: boolean;
  readonly status: CoverageStatus;
  readonly unmetConditions: readonly SupportCondition[];
  /** Plain-language reason, for admin tooling and for the calculation trace. */
  readonly reason: string;
}

/**
 * Deterministic readiness gate.
 *
 * ===========================================================================
 * THE GATE ANSWERS "MAY WE CLAIM SUPPORT?" AND NOTHING ELSE.
 *
 * It never consults whether engine code exists, whether a rule resolves, or
 * whether a calculation would succeed. Those are different questions, and
 * letting any of them imply support is the exact inference this model forbids.
 * ===========================================================================
 *
 * CONFLICT, PARTIALLY_SUPPORTED and UNSUPPORTED_SCENARIO are NOT support. A
 * partially supported capability is one whose unsupported subset is precisely
 * the case a user is most likely to hit and least likely to notice.
 */
export function assessSupport(cell: CoverageCell): SupportAssessment {
  const unmet: SupportCondition[] = [];

  if (cell.evidence.sourceIds.length === 0) {
    unmet.push(SupportCondition.SOURCE_CITED);
  }
  if (cell.evidence.ruleIds.length === 0) {
    unmet.push(SupportCondition.RULE_LINKED);
  }
  if (cell.evidence.verifiedBy === null || cell.evidence.verifiedAt === null) {
    unmet.push(SupportCondition.HUMAN_VERIFIED);
  }
  if (cell.status === CoverageStatus.PENDING_RESEARCH) {
    unmet.push(SupportCondition.RESEARCH_RECORDED);
  }
  if (cell.status === CoverageStatus.CONFLICT) {
    unmet.push(SupportCondition.NO_CONFLICT);
  }

  if (cell.status !== CoverageStatus.SUPPORTED) {
    return {
      supported: false,
      status: cell.status,
      unmetConditions: unmet,
      reason: `${cell.capability} in ${cell.jurisdictionCode} is ${cell.status}, not SUPPORTED`,
    };
  }

  if (unmet.length > 0) {
    // Recorded as SUPPORTED but missing its evidence: a data defect, and the
    // gate refuses rather than trusting the label.
    return {
      supported: false,
      status: cell.status,
      unmetConditions: unmet,
      reason:
        `${cell.capability} in ${cell.jurisdictionCode} is recorded SUPPORTED but ` +
        `${String(unmet.length)} readiness condition(s) are unmet`,
    };
  }

  return {
    supported: true,
    status: cell.status,
    unmetConditions: [],
    reason: `${cell.capability} in ${cell.jurisdictionCode} satisfies every readiness condition`,
  };
}

/** True only for a cell that passes the full gate. */
export function isSupported(cell: CoverageCell): boolean {
  return assessSupport(cell).supported;
}

/**
 * Whether a cell's claim covers the instant in question.
 *
 * A cell with no effective period covers the whole tax year. One with a period
 * covers `[effectiveFrom, effectiveTo)` — half-open, as Phase 2 rules are.
 */
export function coversInstant(cell: CoverageCell, isoInstant: string): boolean {
  if (cell.effectiveFrom !== null && isoInstant < cell.effectiveFrom) {
    return false;
  }
  if (cell.effectiveTo !== null && isoInstant >= cell.effectiveTo) {
    return false;
  }
  return true;
}

// --- Admin-facing queries. Read-only; no UI, no persistence. ----------------

export interface CoverageQuery {
  readonly jurisdictionCode?: string;
  readonly capability?: StateCapability;
  readonly status?: CoverageStatus;
}

export function queryCoverage(
  matrix: CoverageMatrix,
  query: CoverageQuery,
): readonly CoverageCell[] {
  return matrix.cells.filter(
    (cell) =>
      (query.jurisdictionCode === undefined ||
        cell.jurisdictionCode === query.jurisdictionCode) &&
      (query.capability === undefined || cell.capability === query.capability) &&
      (query.status === undefined || cell.status === query.status),
  );
}

/** Count of cells per status. Every status appears, including the zeroes. */
export function summarizeCoverage(
  matrix: CoverageMatrix,
): Readonly<Record<CoverageStatus, number>> {
  const summary = Object.fromEntries(
    ALL_COVERAGE_STATUSES.map((status) => [status, 0]),
  ) as Record<CoverageStatus, number>;
  for (const cell of matrix.cells) {
    summary[cell.status] += 1;
  }
  return summary;
}

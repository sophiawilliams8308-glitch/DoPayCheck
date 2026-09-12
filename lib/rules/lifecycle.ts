import { ConflictStatus, RuleStatus, VerificationStatus } from '@/lib/db/generated/index';

/**
 * Rule lifecycle and activation safety (spec §18, §22, §29).
 *
 * Two guarantees live here:
 *
 *   1. TRANSITIONS ARE EXPLICIT. Only the moves in `ALLOWED_TRANSITIONS` are legal, so a rule
 *      cannot jump from DRAFT straight to ACTIVE and bypass review.
 *   2. ACTIVATION IS GATED. `evaluateActivation()` enumerates every blocking reason rather
 *      than returning a bare boolean, so an administrator is told exactly what is missing.
 *
 * Published history is immutable: ACTIVE and SUPERSEDED are terminal for editing. A
 * correction creates a NEW version that supersedes the old row (spec §23, §29, §30).
 */

/** Statuses whose rows represent published history and must never be edited or deleted. */
export const PUBLISHED_STATUSES: readonly RuleStatus[] = [
  RuleStatus.ACTIVE,
  RuleStatus.SUPERSEDED,
  RuleStatus.ROLLED_BACK,
];

/** Statuses that are still editable working state. */
export const EDITABLE_STATUSES: readonly RuleStatus[] = [
  RuleStatus.DRAFT,
  RuleStatus.PENDING_REVIEW,
  RuleStatus.REJECTED,
  RuleStatus.BLOCKED,
];

const ALLOWED_TRANSITIONS: Readonly<Record<RuleStatus, readonly RuleStatus[]>> = {
  [RuleStatus.DRAFT]: [RuleStatus.PENDING_REVIEW, RuleStatus.BLOCKED, RuleStatus.REJECTED],
  [RuleStatus.PENDING_REVIEW]: [
    RuleStatus.APPROVED,
    RuleStatus.REJECTED,
    RuleStatus.BLOCKED,
    RuleStatus.DRAFT,
  ],
  [RuleStatus.APPROVED]: [RuleStatus.ACTIVE, RuleStatus.BLOCKED, RuleStatus.REJECTED],
  [RuleStatus.ACTIVE]: [RuleStatus.SUPERSEDED, RuleStatus.ROLLED_BACK],
  // Terminal: published history is preserved, never revived in place.
  [RuleStatus.SUPERSEDED]: [],
  [RuleStatus.REJECTED]: [RuleStatus.DRAFT],
  [RuleStatus.ROLLED_BACK]: [],
  [RuleStatus.BLOCKED]: [RuleStatus.DRAFT, RuleStatus.REJECTED],
};

export function isTransitionAllowed(from: RuleStatus, to: RuleStatus): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

export function allowedTransitionsFrom(from: RuleStatus): readonly RuleStatus[] {
  return ALLOWED_TRANSITIONS[from];
}

export function isPublished(status: RuleStatus): boolean {
  return PUBLISHED_STATUSES.includes(status);
}

export function isEditable(status: RuleStatus): boolean {
  return EDITABLE_STATUSES.includes(status);
}

/** Reasons activation may be refused. Each maps to a concrete, fixable condition. */
export const ActivationBlocker = {
  INVALID_TRANSITION: 'INVALID_TRANSITION',
  NOT_VERIFIED: 'NOT_VERIFIED',
  NO_SOURCE: 'NO_SOURCE',
  UNRESOLVED_CONFLICT: 'UNRESOLVED_CONFLICT',
  NOT_APPROVED: 'NOT_APPROVED',
  UNVERIFIED_COMPONENT: 'UNVERIFIED_COMPONENT',
} as const;

export type ActivationBlocker = (typeof ActivationBlocker)[keyof typeof ActivationBlocker];

export interface ActivationInput {
  readonly status: RuleStatus;
  readonly verificationStatus: VerificationStatus;
  /** Number of linked official sources. */
  readonly sourceCount: number;
  /** Statuses of conflicts recorded against the rule. */
  readonly conflictStatuses: readonly ConflictStatus[];
  /** Verification statuses of the rule's individual value components. */
  readonly componentVerificationStatuses: readonly VerificationStatus[];
  /** Whether an approver has been recorded. */
  readonly approvedBy: string | null;
}

export interface ActivationResult {
  readonly canActivate: boolean;
  readonly blockers: readonly ActivationBlocker[];
}

/** Conflict states that still block activation. */
const UNRESOLVED_CONFLICT_STATUSES: readonly ConflictStatus[] = [
  ConflictStatus.OPEN,
  ConflictStatus.INVESTIGATING,
];

/**
 * Decides whether a rule may become ACTIVE, listing every blocking reason.
 *
 * A rule reaches ACTIVE only when it is APPROVED, VERIFIED, has at least one official source,
 * has no unresolved conflict, and has no component left in a non-decided verification state.
 *
 * Note on components: PENDING and CONFLICT block activation. NOT_APPLICABLE and NOT_STATED do
 * NOT — they are *decided* outcomes, recording that a value does not apply or that the source
 * is silent. Treating NOT_STATED as a blocker would push administrators toward inventing a
 * value, which is exactly what the specification forbids (spec §19).
 */
export function evaluateActivation(input: ActivationInput): ActivationResult {
  const blockers: ActivationBlocker[] = [];

  if (!isTransitionAllowed(input.status, RuleStatus.ACTIVE)) {
    blockers.push(ActivationBlocker.INVALID_TRANSITION);
  }

  if (input.status !== RuleStatus.APPROVED || input.approvedBy === null) {
    blockers.push(ActivationBlocker.NOT_APPROVED);
  }

  if (input.verificationStatus !== VerificationStatus.VERIFIED) {
    blockers.push(ActivationBlocker.NOT_VERIFIED);
  }

  if (input.sourceCount < 1) {
    blockers.push(ActivationBlocker.NO_SOURCE);
  }

  if (input.conflictStatuses.some((status) => UNRESOLVED_CONFLICT_STATUSES.includes(status))) {
    blockers.push(ActivationBlocker.UNRESOLVED_CONFLICT);
  }

  const undecided: readonly VerificationStatus[] = [
    VerificationStatus.PENDING,
    VerificationStatus.CONFLICT,
    VerificationStatus.PARTIALLY_VERIFIED,
  ];
  if (input.componentVerificationStatuses.some((status) => undecided.includes(status))) {
    blockers.push(ActivationBlocker.UNVERIFIED_COMPONENT);
  }

  return { canActivate: blockers.length === 0, blockers };
}

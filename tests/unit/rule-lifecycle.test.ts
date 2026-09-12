import { describe, expect, it } from 'vitest';

import { ConflictStatus, RuleStatus, VerificationStatus } from '@/lib/db/generated/index';
import {
  ActivationBlocker,
  allowedTransitionsFrom,
  evaluateActivation,
  isEditable,
  isPublished,
  isTransitionAllowed,
} from '@/lib/rules/lifecycle';

/** Rule lifecycle tests (spec §18, §22). No tax values appear anywhere in this file. */

const verifiedAndApproved = {
  status: RuleStatus.APPROVED,
  verificationStatus: VerificationStatus.VERIFIED,
  sourceCount: 1,
  conflictStatuses: [] as ConflictStatus[],
  componentVerificationStatuses: [] as VerificationStatus[],
  approvedBy: 'reviewer@example.com',
};

describe('status transitions', () => {
  it('permits the intended review path', () => {
    expect(isTransitionAllowed(RuleStatus.DRAFT, RuleStatus.PENDING_REVIEW)).toBe(true);
    expect(isTransitionAllowed(RuleStatus.PENDING_REVIEW, RuleStatus.APPROVED)).toBe(true);
    expect(isTransitionAllowed(RuleStatus.APPROVED, RuleStatus.ACTIVE)).toBe(true);
  });

  it('forbids skipping review — DRAFT cannot jump to ACTIVE', () => {
    expect(isTransitionAllowed(RuleStatus.DRAFT, RuleStatus.ACTIVE)).toBe(false);
    expect(isTransitionAllowed(RuleStatus.PENDING_REVIEW, RuleStatus.ACTIVE)).toBe(false);
  });

  it('treats published history as terminal', () => {
    expect(allowedTransitionsFrom(RuleStatus.SUPERSEDED)).toEqual([]);
    expect(allowedTransitionsFrom(RuleStatus.ROLLED_BACK)).toEqual([]);
  });

  it('allows an ACTIVE rule only to be superseded or rolled back', () => {
    expect(isTransitionAllowed(RuleStatus.ACTIVE, RuleStatus.SUPERSEDED)).toBe(true);
    expect(isTransitionAllowed(RuleStatus.ACTIVE, RuleStatus.ROLLED_BACK)).toBe(true);
    expect(isTransitionAllowed(RuleStatus.ACTIVE, RuleStatus.DRAFT)).toBe(false);
    expect(isTransitionAllowed(RuleStatus.ACTIVE, RuleStatus.REJECTED)).toBe(false);
  });

  it('classifies published vs editable states', () => {
    expect(isPublished(RuleStatus.ACTIVE)).toBe(true);
    expect(isPublished(RuleStatus.SUPERSEDED)).toBe(true);
    expect(isPublished(RuleStatus.DRAFT)).toBe(false);
    expect(isEditable(RuleStatus.DRAFT)).toBe(true);
    expect(isEditable(RuleStatus.ACTIVE)).toBe(false);
  });
});

describe('activation gate', () => {
  it('activates a fully verified, approved, sourced rule', () => {
    const result = evaluateActivation(verifiedAndApproved);
    expect(result.canActivate).toBe(true);
    expect(result.blockers).toEqual([]);
  });

  it('blocks a rule with no official source', () => {
    const result = evaluateActivation({ ...verifiedAndApproved, sourceCount: 0 });
    expect(result.canActivate).toBe(false);
    expect(result.blockers).toContain(ActivationBlocker.NO_SOURCE);
  });

  it('blocks a rule that is not VERIFIED', () => {
    const result = evaluateActivation({
      ...verifiedAndApproved,
      verificationStatus: VerificationStatus.PENDING,
    });
    expect(result.blockers).toContain(ActivationBlocker.NOT_VERIFIED);
  });

  it('blocks a rule with an unresolved conflict', () => {
    const open = evaluateActivation({
      ...verifiedAndApproved,
      conflictStatuses: [ConflictStatus.OPEN],
    });
    expect(open.blockers).toContain(ActivationBlocker.UNRESOLVED_CONFLICT);

    const investigating = evaluateActivation({
      ...verifiedAndApproved,
      conflictStatuses: [ConflictStatus.INVESTIGATING],
    });
    expect(investigating.blockers).toContain(ActivationBlocker.UNRESOLVED_CONFLICT);
  });

  it('permits activation once a conflict is resolved', () => {
    const result = evaluateActivation({
      ...verifiedAndApproved,
      conflictStatuses: [ConflictStatus.RESOLVED, ConflictStatus.DISMISSED],
    });
    expect(result.canActivate).toBe(true);
  });

  it('blocks when any component is still undecided', () => {
    for (const status of [
      VerificationStatus.PENDING,
      VerificationStatus.CONFLICT,
      VerificationStatus.PARTIALLY_VERIFIED,
    ]) {
      const result = evaluateActivation({
        ...verifiedAndApproved,
        componentVerificationStatuses: [VerificationStatus.VERIFIED, status],
      });
      expect(result.blockers).toContain(ActivationBlocker.UNVERIFIED_COMPONENT);
    }
  });

  it('does NOT block on NOT_APPLICABLE or NOT_STATED components', () => {
    // These are decided outcomes. Blocking on them would pressure an administrator into
    // inventing a value, which the specification forbids (spec §19).
    const result = evaluateActivation({
      ...verifiedAndApproved,
      componentVerificationStatuses: [
        VerificationStatus.NOT_APPLICABLE,
        VerificationStatus.NOT_STATED,
      ],
    });
    expect(result.canActivate).toBe(true);
  });

  it('blocks when no approver is recorded', () => {
    const result = evaluateActivation({ ...verifiedAndApproved, approvedBy: null });
    expect(result.blockers).toContain(ActivationBlocker.NOT_APPROVED);
  });

  it('reports every blocker at once rather than the first', () => {
    const result = evaluateActivation({
      status: RuleStatus.DRAFT,
      verificationStatus: VerificationStatus.PENDING,
      sourceCount: 0,
      conflictStatuses: [ConflictStatus.OPEN],
      componentVerificationStatuses: [VerificationStatus.PENDING],
      approvedBy: null,
    });
    expect(result.canActivate).toBe(false);
    expect(result.blockers.length).toBeGreaterThanOrEqual(5);
  });
});

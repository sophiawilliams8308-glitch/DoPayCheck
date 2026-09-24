import type { TaxDataReadinessApproval } from '@/lib/db/generated/index';
import { getPrisma } from '@/lib/db/client';
import { AppError, ErrorCode } from '@/lib/errors/app-error';
import { recordAudit } from '@/lib/audit/repository';
import type { CapabilityCode } from '@/lib/tax/state/resolutionContext';

import { computeCurrentEvidenceFingerprint } from './fingerprint';

/**
 * `TaxDataReadinessApproval` persistence (SEO-03 contract §E.1, §W).
 *
 * ===========================================================================
 * OWNED BY THE TAX DOMAIN. Never imported by `lib/seo/**` (enforced by a scanner test,
 * `tests/unit/seo-guards.test.ts`) — SEO reaches this data only through
 * `coverage.isPublishable()` (`./coverage.ts`).
 *
 * ROWS ARE EFFECTIVELY IMMUTABLE. `grantReadinessApproval()` always INSERTS a new row —
 * there is no update function for the approval fields themselves. `revokeReadinessApproval()`
 * is the one permitted mutation, and it writes only the three revocation columns. The
 * database enforces both halves of this independently (`TaxDataReadinessApproval_no_delete`,
 * `TaxDataReadinessApproval_immutable_except_revocation`) so this module's own discipline is
 * not the only thing holding the guarantee.
 * ===========================================================================
 */

export interface GrantReadinessApprovalInput {
  readonly jurisdictionId: string;
  readonly taxYearId: number;
  readonly capabilities: readonly CapabilityCode[];
  readonly approvedByUserId: string;
  /** Required — why approval was granted. Never blank (contract §E.1). */
  readonly reason: string;
  readonly expiresAt?: Date;
}

/**
 * Grants a new readiness approval. Computes the evidence fingerprint itself at grant time —
 * a caller can never supply one, since a fabricated fingerprint would defeat the entire
 * staleness mechanism.
 */
export async function grantReadinessApproval(
  input: GrantReadinessApprovalInput,
): Promise<TaxDataReadinessApproval> {
  if (input.reason.trim() === '') {
    throw new AppError(ErrorCode.VALIDATION_FAILED, 'A readiness approval requires a reason', {
      publicMessage: 'Please state why this approval is being granted.',
    });
  }
  if (input.capabilities.length === 0) {
    throw new AppError(
      ErrorCode.VALIDATION_FAILED,
      'A readiness approval requires at least one capability',
    );
  }

  const evidenceFingerprint = await computeCurrentEvidenceFingerprint(
    input.jurisdictionId,
    input.taxYearId,
    input.capabilities,
  );

  const created = await getPrisma().taxDataReadinessApproval.create({
    data: {
      jurisdictionId: input.jurisdictionId,
      taxYearId: input.taxYearId,
      capabilities: [...input.capabilities],
      evidenceFingerprint,
      approvedByUserId: input.approvedByUserId,
      reason: input.reason,
      ...(input.expiresAt === undefined ? {} : { expiresAt: input.expiresAt }),
    },
  });

  await recordAudit({
    action: 'APPROVE',
    entityType: 'TaxDataReadinessApproval',
    entityId: created.id,
    actor: input.approvedByUserId,
    reason: input.reason,
    newValue: {
      jurisdictionId: created.jurisdictionId,
      taxYearId: created.taxYearId,
      capabilities: created.capabilities,
    },
  });

  return created;
}

export interface RevokeReadinessApprovalInput {
  readonly approvalId: string;
  readonly revokedByUserId: string;
  readonly revocationReason: string;
}

/** Revokes an approval. Writes only the three revocation columns — never touches what was
 * approved, by whom, or against what evidence (contract §E.1). */
export async function revokeReadinessApproval(
  input: RevokeReadinessApprovalInput,
): Promise<TaxDataReadinessApproval> {
  if (input.revocationReason.trim() === '') {
    throw new AppError(ErrorCode.VALIDATION_FAILED, 'Revocation requires a reason', {
      publicMessage: 'Please state why this approval is being revoked.',
    });
  }

  const existing = await getPrisma().taxDataReadinessApproval.findUnique({
    where: { id: input.approvalId },
  });
  if (existing === null) {
    throw new AppError(ErrorCode.NOT_FOUND, `Readiness approval "${input.approvalId}" not found`);
  }

  const revoked = await getPrisma().taxDataReadinessApproval.update({
    where: { id: input.approvalId },
    data: {
      revokedAt: new Date(),
      revokedByUserId: input.revokedByUserId,
      revocationReason: input.revocationReason,
    },
  });

  await recordAudit({
    action: 'ROLLBACK',
    entityType: 'TaxDataReadinessApproval',
    entityId: revoked.id,
    actor: input.revokedByUserId,
    reason: input.revocationReason,
  });

  return revoked;
}

/**
 * The CURRENT approval for one (jurisdiction, tax year): the most recent row that is neither
 * revoked nor expired (contract §E.1's exact definition). `null` when none exists.
 */
export async function findCurrentApproval(
  jurisdictionId: string,
  taxYearId: number,
): Promise<TaxDataReadinessApproval | null> {
  return getPrisma().taxDataReadinessApproval.findFirst({
    where: {
      jurisdictionId,
      taxYearId,
      revokedAt: null,
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
    },
    orderBy: { approvedAt: 'desc' },
  });
}

/** The most recent row regardless of validity — used only to give `coverage.isPublishable()`
 * a more specific reason (never approved vs. revoked vs. expired) than a bare "not found". */
export async function findLatestApproval(
  jurisdictionId: string,
  taxYearId: number,
): Promise<TaxDataReadinessApproval | null> {
  return getPrisma().taxDataReadinessApproval.findFirst({
    where: { jurisdictionId, taxYearId },
    orderBy: { approvedAt: 'desc' },
  });
}

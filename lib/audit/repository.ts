import type { AuditAction, Prisma } from '@/lib/db/generated/index';
import { getPrisma } from '@/lib/db/client';
import { logger } from '@/lib/logging/logger';

/**
 * Append-only audit trail (spec §31).
 *
 * There is deliberately NO update and NO delete function in this module — the omission is the
 * point. The database additionally enforces it with BEFORE UPDATE / BEFORE DELETE triggers,
 * so history cannot be rewritten even through raw SQL.
 */

export interface AuditEntry {
  readonly action: AuditAction;
  readonly entityType: string;
  readonly entityId: string;
  readonly actor: string;
  readonly reason?: string;
  readonly oldValue?: Prisma.InputJsonValue;
  readonly newValue?: Prisma.InputJsonValue;
  readonly metadata?: Prisma.InputJsonValue;
}

/**
 * Records an auditable action.
 *
 * Callers must not pass salary, W-4 or other sensitive personal data in `oldValue`/`newValue`
 * — this table records rule administration, not paycheck content (spec §58).
 */
export async function recordAudit(entry: AuditEntry): Promise<string> {
  const created = await getPrisma().auditLog.create({
    data: {
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId,
      actor: entry.actor,
      ...(entry.reason === undefined ? {} : { reason: entry.reason }),
      ...(entry.oldValue === undefined ? {} : { oldValue: entry.oldValue }),
      ...(entry.newValue === undefined ? {} : { newValue: entry.newValue }),
      ...(entry.metadata === undefined ? {} : { metadata: entry.metadata }),
    },
    select: { id: true },
  });

  logger.info('audit.recorded', {
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId,
    auditId: created.id,
  });

  return created.id;
}

/** Reads the audit trail for one entity, newest first. */
export async function listAuditForEntity(
  entityType: string,
  entityId: string,
  limit = 100,
): Promise<{ id: string; action: AuditAction; actor: string; createdAt: Date }[]> {
  return getPrisma().auditLog.findMany({
    where: { entityType, entityId },
    orderBy: { createdAt: 'desc' },
    take: limit,
    select: { id: true, action: true, actor: true, createdAt: true },
  });
}

import type { Jurisdiction, JurisdictionType } from '@/lib/db/generated/index';
import { getPrisma } from '@/lib/db/client';
import { AppError, ErrorCode } from '@/lib/errors/app-error';

/**
 * Jurisdiction access (spec §9).
 *
 * DELETION POLICY: jurisdictions referenced by rules are DEACTIVATED, never destructively
 * deleted (spec §29). `deactivate()` is the supported operation; there is no `delete`.
 * The database additionally sets `onDelete: Restrict` on the rule relation.
 */

export async function findByCode(code: string): Promise<Jurisdiction | null> {
  return getPrisma().jurisdiction.findUnique({ where: { code } });
}

export async function findBySlug(slug: string): Promise<Jurisdiction | null> {
  return getPrisma().jurisdiction.findUnique({ where: { slug } });
}

export async function listByType(type: JurisdictionType): Promise<Jurisdiction[]> {
  return getPrisma().jurisdiction.findMany({
    where: { type, isActive: true },
    orderBy: { name: 'asc' },
  });
}

/**
 * Walks the jurisdiction hierarchy from a node up to its root.
 *
 * Phase 6 locality resolution needs the ancestor chain (city → county → state → federal) to
 * decide which taxes stack. Phase 2 provides the traversal only; it applies no tax logic.
 */
export async function getAncestorChain(code: string): Promise<Jurisdiction[]> {
  const chain: Jurisdiction[] = [];
  let current = await findByCode(code);

  // Bounded to avoid an unbounded walk if data is ever cyclic; the DB forbids self-parenting
  // but not longer cycles.
  const maxDepth = 10;
  let depth = 0;

  while (current !== null && depth < maxDepth) {
    chain.push(current);
    if (current.parentId === null) {
      break;
    }
    current = await getPrisma().jurisdiction.findUnique({ where: { id: current.parentId } });
    depth += 1;
  }

  return chain;
}

/** Deactivates a jurisdiction. Referenced jurisdictions are never hard-deleted (spec §29). */
export async function deactivate(code: string): Promise<Jurisdiction> {
  const existing = await findByCode(code);
  if (existing === null) {
    throw new AppError(ErrorCode.NOT_FOUND, `Jurisdiction "${code}" not found`);
  }
  return getPrisma().jurisdiction.update({ where: { code }, data: { isActive: false } });
}

import type { Source, SourceStatus, SourceType } from '@/lib/db/generated/index';
import { getPrisma } from '@/lib/db/client';
import { AppError, ErrorCode } from '@/lib/errors/app-error';

/**
 * Official source access (spec §21).
 *
 * DELETION POLICY: a source referenced by any rule is ARCHIVED, never destructively deleted
 * (spec §29) — deleting it would sever the traceability chain for every rule that cites it.
 *
 * URLs are never fabricated. `url` is nullable precisely so an unrecorded URL stays absent
 * rather than being invented.
 */

export interface CreateSourceInput {
  readonly code: string;
  readonly organization: string;
  readonly title: string;
  readonly sourceType: SourceType;
  readonly url?: string;
  readonly publicationDate?: Date;
  readonly effectiveDate?: Date;
  readonly documentVersion?: string;
  readonly notes?: string;
}

export async function create(input: CreateSourceInput): Promise<Source> {
  return getPrisma().source.create({
    data: {
      code: input.code,
      organization: input.organization,
      title: input.title,
      sourceType: input.sourceType,
      ...(input.url === undefined ? {} : { url: input.url }),
      ...(input.publicationDate === undefined ? {} : { publicationDate: input.publicationDate }),
      ...(input.effectiveDate === undefined ? {} : { effectiveDate: input.effectiveDate }),
      ...(input.documentVersion === undefined ? {} : { documentVersion: input.documentVersion }),
      ...(input.notes === undefined ? {} : { notes: input.notes }),
    },
  });
}

export async function findByCode(code: string): Promise<Source | null> {
  return getPrisma().source.findUnique({ where: { code } });
}

export async function listByStatus(status: SourceStatus): Promise<Source[]> {
  return getPrisma().source.findMany({ where: { status }, orderBy: { organization: 'asc' } });
}

export async function archive(code: string): Promise<Source> {
  const existing = await findByCode(code);
  if (existing === null) {
    throw new AppError(ErrorCode.NOT_FOUND, `Source "${code}" not found`);
  }
  return getPrisma().source.update({ where: { code }, data: { status: 'ARCHIVED' } });
}

/**
 * Deletes a source that nothing references.
 *
 * Refuses when any rule cites it — that is the traceability safeguard, not an inconvenience.
 * Use `archive()` instead.
 */
export async function deleteUnusedSource(code: string): Promise<void> {
  const prisma = getPrisma();
  const existing = await prisma.source.findUnique({
    where: { code },
    include: { _count: { select: { ruleSources: true } } },
  });

  if (existing === null) {
    throw new AppError(ErrorCode.NOT_FOUND, `Source "${code}" not found`);
  }

  if (existing._count.ruleSources > 0) {
    throw new AppError(
      ErrorCode.VALIDATION_FAILED,
      `Source "${code}" is referenced by ${String(existing._count.ruleSources)} rule(s) and ` +
        'cannot be deleted; archive it instead',
      { publicMessage: 'This source is in use and cannot be deleted.' },
    );
  }

  await prisma.source.delete({ where: { code } });
}

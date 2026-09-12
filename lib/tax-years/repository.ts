import type { TaxYear, TaxYearStatus } from '@/lib/db/generated/index';
import { getPrisma } from '@/lib/db/client';
import { AppError, ErrorCode } from '@/lib/errors/app-error';

/**
 * Tax year access (spec §23).
 *
 * Nothing is hardcoded to a single year. Adding 2027, 2028 and beyond is inserting rows, not
 * changing code — which is what makes routine annual updates a data task (spec §23).
 *
 * At most one year may be flagged current; a partial unique index enforces it in the database.
 */

export async function findByYear(year: number): Promise<TaxYear | null> {
  return getPrisma().taxYear.findUnique({ where: { year } });
}

export async function listAll(): Promise<TaxYear[]> {
  return getPrisma().taxYear.findMany({ orderBy: { year: 'desc' } });
}

export async function getCurrent(): Promise<TaxYear | null> {
  return getPrisma().taxYear.findFirst({ where: { isCurrent: true } });
}

export interface CreateTaxYearInput {
  readonly year: number;
  readonly startDate: Date;
  readonly endDate: Date;
  readonly status?: TaxYearStatus;
  readonly notes?: string;
}

export async function create(input: CreateTaxYearInput): Promise<TaxYear> {
  if (input.startDate >= input.endDate) {
    throw new AppError(ErrorCode.VALIDATION_FAILED, 'Tax year startDate must be before endDate', {
      publicMessage: 'The tax year period is not valid.',
    });
  }

  return getPrisma().taxYear.create({
    data: {
      year: input.year,
      startDate: input.startDate,
      endDate: input.endDate,
      ...(input.status === undefined ? {} : { status: input.status }),
      ...(input.notes === undefined ? {} : { notes: input.notes }),
    },
  });
}

/**
 * Marks one tax year current, clearing the flag elsewhere.
 *
 * Done in a transaction because the partial unique index would otherwise reject the write
 * while the previous current year still holds the flag.
 */
export async function setCurrent(year: number): Promise<TaxYear> {
  const prisma = getPrisma();
  return prisma.$transaction(async (tx) => {
    const target = await tx.taxYear.findUnique({ where: { year } });
    if (target === null) {
      throw new AppError(ErrorCode.NOT_FOUND, `Tax year ${String(year)} not found`);
    }
    await tx.taxYear.updateMany({ where: { isCurrent: true }, data: { isCurrent: false } });
    return tx.taxYear.update({ where: { year }, data: { isCurrent: true } });
  });
}

import { Prisma } from '@/lib/db/generated/index';
import { type Money, money, toStorageString } from '@/lib/core/money';

/**
 * Bridge between PostgreSQL NUMERIC values (via Prisma) and the authoritative `Money` type.
 *
 * ===========================================================================
 * THE RULE THIS FILE EXISTS TO ENFORCE (spec §4; CLAUDE.md §6)
 *
 *   An authoritative tax value must never pass through a JavaScript `number`.
 *
 * Prisma returns NUMERIC columns as its own Decimal instance. Calling `.toNumber()` on one
 * would silently convert to IEEE-754 and lose exactness. Every conversion here goes through
 * the decimal STRING form, which is lossless in both directions.
 * ===========================================================================
 *
 * NULL HANDLING: a NULL NUMERIC means the official source did not state a value
 * (verification status NOT_STATED) — it is NOT zero. These helpers therefore preserve
 * null/undefined rather than defaulting, so `NOT_STATED` can never decay into `0` (spec §19).
 */

/** Converts a NUMERIC column value into exact `Money`. Null/undefined are preserved. */
export function fromPrismaDecimal(value: Prisma.Decimal | null | undefined): Money | null {
  if (value === null || value === undefined) {
    return null;
  }
  // `toFixed()` renders the full decimal form without exponent notation.
  return money(value.toFixed());
}

/** Converts `Money` into a value Prisma will write to a NUMERIC column. */
export function toPrismaDecimal(value: Money | null | undefined): Prisma.Decimal | null {
  if (value === null || value === undefined) {
    return null;
  }
  return new Prisma.Decimal(toStorageString(value));
}

/**
 * Parses a decimal STRING (the transport form used by validation schemas) for storage.
 * Accepting only strings keeps float input structurally impossible.
 */
export function decimalStringToPrisma(value: string | null | undefined): Prisma.Decimal | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  return new Prisma.Decimal(toStorageString(money(value)));
}

/** Renders a NUMERIC column value as an exact string for transport. */
export function prismaDecimalToString(value: Prisma.Decimal | null | undefined): string | null {
  const parsed = fromPrismaDecimal(value);
  return parsed === null ? null : toStorageString(parsed);
}

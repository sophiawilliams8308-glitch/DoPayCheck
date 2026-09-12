import { z } from 'zod';

import { type FieldIssue, validationError } from '@/lib/errors/app-error';

/**
 * Centralized validation foundation (spec §57 "Zod or equivalent validation").
 *
 * Phase 1 provides the mechanism only — the helpers below plus a few primitives shared
 * across the app.
 *
 * OUT OF SCOPE FOR PHASE 1 (deliberately not defined here):
 *   - the paycheck calculator input schema
 *   - tax rule / jurisdiction / tax-year schemas
 *   - admin and report schemas
 * Those are defined by Phase 2 (rule & data system) and Phase 3 (calculation engine), and
 * must not be guessed at now.
 */

/** Converts a ZodError into transport-safe field issues. */
export function toFieldIssues(error: z.ZodError): FieldIssue[] {
  return error.issues.map((issue) => ({
    path: issue.path.join('.'),
    message: issue.message,
  }));
}

/**
 * Parses `input` against `schema`, throwing an `AppError` (VALIDATION_FAILED) on failure.
 * Use at trust boundaries: API route handlers, server actions, admin forms.
 */
export function parseOrThrow<TSchema extends z.ZodType>(
  schema: TSchema,
  input: unknown,
  context?: string,
): z.infer<TSchema> {
  const result = schema.safeParse(input);
  if (result.success) {
    return result.data;
  }

  throw validationError(
    toFieldIssues(result.error),
    context === undefined ? 'Validation failed' : `Validation failed: ${context}`,
  );
}

/**
 * Non-throwing variant for callers that want to branch on the outcome.
 */
export function parseSafely<TSchema extends z.ZodType>(
  schema: TSchema,
  input: unknown,
): { success: true; data: z.infer<TSchema> } | { success: false; issues: FieldIssue[] } {
  const result = schema.safeParse(input);
  return result.success
    ? { success: true, data: result.data }
    : { success: false, issues: toFieldIssues(result.error) };
}

/**
 * Shared primitives.
 *
 * NOTE: `decimalString` validates the FORMAT of a monetary string only. It intentionally
 * does not convert to a number — see `lib/core/money.ts` for why monetary values must never
 * pass through a JS `number`.
 */
export const primitives = {
  /** Non-empty, trimmed string. */
  nonEmptyString: z.string().trim().min(1),

  /**
   * A decimal value expressed as a string, e.g. "0", "-12.5", "1234.5678".
   * Kept as a string to preserve exactness for `money()`.
   */
  decimalString: z
    .string()
    .trim()
    .regex(/^-?\d+(\.\d+)?$/, 'Must be a decimal number expressed as a string'),

  /** Four-digit tax year. Range is intentionally wide; applicable years come from rule data. */
  taxYear: z.number().int().min(1900).max(2200),

  /** Lowercase, hyphenated URL slug (spec §37 "Lowercase URLs", "Hyphenated slugs"). */
  slug: z
    .string()
    .trim()
    .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'Must be lowercase and hyphen-separated'),
} as const;

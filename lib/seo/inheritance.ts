import { InheritanceLevel, type EffectiveField } from './types';

/**
 * Inheritance / override resolution (SEO-03 contract §H).
 *
 * ===========================================================================
 * THE RULE: PRESENCE OVERRIDES. ABSENCE INHERITS.
 *
 * Five levels, most specific first for resolution purposes: Individual Page → State/
 * programmatic Context → Template → Page Type → Global.
 *
 * SQL `NULL`        — absent, inherit from the next level up.
 * `''` (empty)      — explicitly empty, SUPPRESS this field. Never inherits further.
 * any other value   — override with that value.
 *
 * This module is PURE — no database access, no Prisma import. It resolves whatever five
 * values its caller already fetched.
 * ===========================================================================
 */

export interface InheritanceInputs<T> {
  readonly page: T | null;
  readonly context: T | null;
  readonly template: T | null;
  readonly pageType: T | null;
  readonly global: T | null;
}

/**
 * Resolves one field's effective value across the five levels.
 *
 * `''` at any level is PRESENT — it stops inheritance exactly like a non-empty override, but
 * the effective value is the empty string (suppressed), not a fallback to the next level.
 */
export function resolveInheritance<T>(inputs: InheritanceInputs<T>): EffectiveField<T> {
  const ordered: readonly [InheritanceLevel, T | null][] = [
    [InheritanceLevel.PAGE, inputs.page],
    [InheritanceLevel.CONTEXT, inputs.context],
    [InheritanceLevel.TEMPLATE, inputs.template],
    [InheritanceLevel.PAGE_TYPE, inputs.pageType],
    [InheritanceLevel.GLOBAL, inputs.global],
  ];

  for (const [level, value] of ordered) {
    if (value !== null) {
      return { value, source: level };
    }
  }
  return { value: null, source: 'ABSENT' };
}

/**
 * Normalizes a string value at write time, before it reaches the database.
 *
 * Whitespace-only input becomes `''` (explicit suppress) — so an accidental space cannot
 * masquerade as "not set" (contract §H.2). `null` (reset to inherited) and genuinely
 * meaningful strings pass through unchanged; this function never trims a non-whitespace-only
 * value, since that would silently alter editorial content beyond what the contract asks for.
 */
export function normalizeOverrideWrite(input: string | null): string | null {
  if (input === null) {
    return null;
  }
  return input.trim() === '' ? '' : input;
}

/**
 * "Reset to inherited" always writes `NULL` — it NEVER copies the currently resolved value
 * down into the more specific level (contract §H.3). This constant exists so a caller writes
 * `RESET_TO_INHERITED` rather than re-deriving `null` at each call site, and so a reviewer can
 * grep for the one correct reset value.
 */
export const RESET_TO_INHERITED = null;

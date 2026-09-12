import { z } from 'zod';

import {
  JurisdictionType,
  RuleCategory,
  RuleStatus,
  VerificationStatus,
} from '@/lib/db/generated/index';
import { type FieldIssue } from '@/lib/errors/app-error';
import { primitives } from '@/lib/validation';

import { isCategoryValidForJurisdiction } from './categories';
import { validatePayload } from './payloads';

/**
 * Tax rule validation (spec §22 publish gate).
 *
 * Validates STRUCTURE, IDENTITY and DATES. It deliberately does not judge whether a tax value
 * is "reasonable" — there is no correct range to check against, and inventing one would be a
 * form of guessing. Correctness of values comes from source verification, not heuristics.
 */

const isoDate = z.union([z.date(), z.string().datetime()]).transform((value) => new Date(value));

/** Stable rule key: lowercase, dot/hyphen separated, e.g. `us.social-security.oasdi`. */
export const ruleKeySchema = z
  .string()
  .trim()
  .min(3)
  .max(200)
  .regex(
    /^[a-z0-9]+([._-][a-z0-9]+)*$/,
    'Rule key must be lowercase alphanumeric separated by ".", "_" or "-"',
  );

export const taxRuleInputSchema = z
  .object({
    ruleKey: ruleKeySchema,
    version: z.number().int().min(1).optional(),
    taxYear: primitives.taxYear,
    jurisdictionCode: z.string().trim().min(1),
    category: z.enum(RuleCategory),
    name: primitives.nonEmptyString,
    description: z.string().trim().optional(),
    effectiveFrom: isoDate,
    effectiveTo: isoDate.nullable().optional(),
    status: z.enum(RuleStatus).optional(),
    verificationStatus: z.enum(VerificationStatus).optional(),
    payload: z.unknown().optional(),
    applicability: z.unknown().optional(),
    conditions: z.unknown().optional(),
    exceptions: z.unknown().optional(),
    notes: z.string().trim().optional(),
  })
  .superRefine((value, ctx) => {
    if (
      value.effectiveTo !== null &&
      value.effectiveTo !== undefined &&
      value.effectiveFrom >= value.effectiveTo
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['effectiveTo'],
        message: 'effectiveTo must be after effectiveFrom',
      });
    }
  });

export type TaxRuleInput = z.infer<typeof taxRuleInputSchema>;

export interface RuleValidationContext {
  /** Jurisdiction level the rule is being attached to. */
  readonly jurisdictionType: JurisdictionType;
  /** Whether the referenced jurisdiction is active. */
  readonly jurisdictionActive: boolean;
  /** Whether the referenced tax year exists. */
  readonly taxYearExists: boolean;
  /** Existing versions of the same ruleKey, for duplicate/overlap detection. */
  readonly existingVersions?: readonly {
    readonly version: number;
    readonly status: RuleStatus;
    readonly effectiveFrom: Date;
    readonly effectiveTo: Date | null;
  }[];
}

export interface RuleValidationResult {
  readonly valid: boolean;
  readonly issues: readonly FieldIssue[];
}

/**
 * Validates a rule against its schema and the surrounding data context.
 *
 * Effective-date overlap is checked here for ACTIVE rules so an administrator gets a readable
 * message; the database also enforces it with an exclusion constraint, so the guarantee holds
 * even if this function is bypassed.
 */
export function validateTaxRule(
  input: unknown,
  context: RuleValidationContext,
): RuleValidationResult {
  const issues: FieldIssue[] = [];

  const parsed = taxRuleInputSchema.safeParse(input);
  if (!parsed.success) {
    return {
      valid: false,
      issues: parsed.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
    };
  }

  const rule = parsed.data;

  if (!context.taxYearExists) {
    issues.push({ path: 'taxYear', message: `Tax year ${String(rule.taxYear)} does not exist` });
  }

  if (!context.jurisdictionActive) {
    issues.push({ path: 'jurisdictionCode', message: 'Jurisdiction is not active' });
  }

  if (!isCategoryValidForJurisdiction(rule.category, context.jurisdictionType)) {
    issues.push({
      path: 'category',
      message: `Category ${rule.category} cannot be defined at jurisdiction level ${context.jurisdictionType}`,
    });
  }

  const payloadResult = validatePayload(rule.category, rule.payload ?? null);
  if (!payloadResult.success) {
    for (const issue of payloadResult.issues) {
      issues.push({ path: `payload.${issue.path}`, message: issue.message });
    }
  }

  const existing = context.existingVersions ?? [];

  if (rule.version !== undefined && existing.some((v) => v.version === rule.version)) {
    issues.push({
      path: 'version',
      message: `Version ${String(rule.version)} already exists for rule key "${rule.ruleKey}"`,
    });
  }

  if (rule.status === RuleStatus.ACTIVE) {
    const overlapping = existing.filter(
      (v) =>
        v.status === RuleStatus.ACTIVE &&
        rangesOverlap(rule.effectiveFrom, rule.effectiveTo ?? null, v.effectiveFrom, v.effectiveTo),
    );
    if (overlapping.length > 0) {
      issues.push({
        path: 'effectiveFrom',
        message:
          `Effective period overlaps ${String(overlapping.length)} existing ACTIVE version(s) ` +
          `of rule key "${rule.ruleKey}". Supersede the previous version instead.`,
      });
    }
  }

  return { valid: issues.length === 0, issues };
}

/**
 * Half-open interval overlap: [fromA, toA) vs [fromB, toB), `null` meaning open-ended.
 *
 * Half-open is what makes consecutive periods legal — a rule ending 2026-07-01 and the next
 * starting 2026-07-01 touch without overlapping. This mirrors the `'[)'` bounds used by the
 * database exclusion constraint, so both layers agree.
 */
export function rangesOverlap(
  fromA: Date,
  toA: Date | null,
  fromB: Date,
  toB: Date | null,
): boolean {
  const endA = toA?.getTime() ?? Number.POSITIVE_INFINITY;
  const endB = toB?.getTime() ?? Number.POSITIVE_INFINITY;
  return fromA.getTime() < endB && fromB.getTime() < endA;
}

// ===========================================================================
// STRUCTURED DETAIL VALIDATION (Phase 2 extension)
//
// Brackets and withholding tables are ordered, contiguous structures. A gap or an overlap
// means a wage falls into two rows or none — either way the eventual calculation would be
// wrong. These checks validate SHAPE and ORDERING only; they never judge whether a rate or
// threshold is plausible, because there is no correct range to check against.
// ===========================================================================

/** One bracket as supplied for validation. Bounds are decimal STRINGS, never numbers. */
export interface BracketInput {
  readonly ordinal: number;
  readonly lowerBound: string | null;
  readonly upperBound: string | null;
  readonly filingStatus: string;
}

/** One withholding-table row as supplied for validation. */
export interface WithholdingRowInput {
  readonly ordinal: number;
  readonly wageFrom: string | null;
  readonly wageTo: string | null;
}

/**
 * Compares two decimal strings exactly, without converting to a JS number.
 *
 * Implemented by aligning the integer and fractional parts as strings, so a 16-digit wage
 * base compares correctly and no value ever passes through IEEE-754 (spec §4).
 */
export function compareDecimalStrings(a: string, b: string): -1 | 0 | 1 {
  const parse = (value: string): { neg: boolean; int: string; frac: string } => {
    const neg = value.startsWith('-');
    const body = neg ? value.slice(1) : value;
    const [int = '0', frac = ''] = body.split('.');
    return { neg, int: int.replace(/^0+(?=\d)/, ''), frac };
  };

  const left = parse(a);
  const right = parse(b);

  if (left.neg !== right.neg) {
    return left.neg ? -1 : 1;
  }

  const sign: 1 | -1 = left.neg ? -1 : 1;

  if (left.int.length !== right.int.length) {
    return (left.int.length > right.int.length ? 1 : -1) * sign === 1 ? 1 : -1;
  }
  if (left.int !== right.int) {
    return (left.int > right.int ? 1 : -1) * sign === 1 ? 1 : -1;
  }

  const width = Math.max(left.frac.length, right.frac.length);
  const lf = left.frac.padEnd(width, '0');
  const rf = right.frac.padEnd(width, '0');
  if (lf === rf) {
    return 0;
  }
  return (lf > rf ? 1 : -1) * sign === 1 ? 1 : -1;
}

/**
 * Validates an ordered bracket schedule for one filing status.
 *
 * Checks: ordinals are unique and consecutive from 0; each bracket's upper bound exceeds its
 * lower bound; brackets are contiguous (each lower bound equals the previous upper bound);
 * only the final bracket may be open-ended.
 */
export function validateBracketSchedule(brackets: readonly BracketInput[]): RuleValidationResult {
  const issues: FieldIssue[] = [];

  if (brackets.length === 0) {
    return { valid: true, issues };
  }

  const sorted = [...brackets].sort((a, b) => a.ordinal - b.ordinal);

  const ordinals = new Set(sorted.map((bracket) => bracket.ordinal));
  if (ordinals.size !== sorted.length) {
    issues.push({ path: 'brackets.ordinal', message: 'Bracket ordinals must be unique' });
  }

  sorted.forEach((bracket, index) => {
    if (bracket.ordinal !== index) {
      issues.push({
        path: `brackets.${String(index)}.ordinal`,
        message: `Bracket ordinals must run consecutively from 0; found ${String(bracket.ordinal)}`,
      });
    }

    if (
      bracket.lowerBound !== null &&
      bracket.upperBound !== null &&
      compareDecimalStrings(bracket.lowerBound, bracket.upperBound) >= 0
    ) {
      issues.push({
        path: `brackets.${String(index)}.upperBound`,
        message: 'Bracket upperBound must be greater than lowerBound',
      });
    }

    const isLast = index === sorted.length - 1;
    if (!isLast && bracket.upperBound === null) {
      issues.push({
        path: `brackets.${String(index)}.upperBound`,
        message: 'Only the final bracket may be open-ended',
      });
    }

    if (index > 0) {
      const previous = sorted[index - 1];
      if (
        previous !== undefined &&
        previous.upperBound !== null &&
        bracket.lowerBound !== null &&
        compareDecimalStrings(previous.upperBound, bracket.lowerBound) !== 0
      ) {
        issues.push({
          path: `brackets.${String(index)}.lowerBound`,
          message:
            'Brackets must be contiguous: each lowerBound must equal the previous upperBound',
        });
      }
    }
  });

  return { valid: issues.length === 0, issues };
}

/**
 * Validates an ordered withholding table's wage rows.
 *
 * Same contiguity and ordering rules as brackets. Kept separate because a withholding table
 * is not an income-tax bracket schedule and must never be substituted for one (spec §6).
 */
export function validateWithholdingRows(
  rows: readonly WithholdingRowInput[],
): RuleValidationResult {
  const issues: FieldIssue[] = [];

  if (rows.length === 0) {
    return { valid: true, issues };
  }

  const sorted = [...rows].sort((a, b) => a.ordinal - b.ordinal);

  if (new Set(sorted.map((row) => row.ordinal)).size !== sorted.length) {
    issues.push({ path: 'rows.ordinal', message: 'Withholding row ordinals must be unique' });
  }

  sorted.forEach((row, index) => {
    if (
      row.wageFrom !== null &&
      row.wageTo !== null &&
      compareDecimalStrings(row.wageFrom, row.wageTo) >= 0
    ) {
      issues.push({
        path: `rows.${String(index)}.wageTo`,
        message: 'Withholding row wageTo must be greater than wageFrom',
      });
    }

    const isLast = index === sorted.length - 1;
    if (!isLast && row.wageTo === null) {
      issues.push({
        path: `rows.${String(index)}.wageTo`,
        message: 'Only the final withholding row may be open-ended',
      });
    }

    if (index > 0) {
      const previous = sorted[index - 1];
      if (
        previous !== undefined &&
        previous.wageTo !== null &&
        row.wageFrom !== null &&
        compareDecimalStrings(previous.wageTo, row.wageFrom) !== 0
      ) {
        issues.push({
          path: `rows.${String(index)}.wageFrom`,
          message: 'Withholding rows must be contiguous with no gap or overlap',
        });
      }
    }
  });

  return { valid: issues.length === 0, issues };
}

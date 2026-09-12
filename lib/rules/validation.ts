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

import {
  type Prisma,
  RuleStatus,
  type TaxRule,
  VerificationStatus,
} from '@/lib/db/generated/index';
import { getPrisma } from '@/lib/db/client';
import { AppError, ErrorCode } from '@/lib/errors/app-error';

import { evaluateActivation, isPublished, isTransitionAllowed } from './lifecycle';
import type { ResolutionResult, ResolvableRule } from './resolution';
import { resolveApplicableRules } from './resolution';

/**
 * Tax rule persistence and lifecycle operations (spec §18, §22, §23, §29, §30).
 *
 * SAFETY PROPERTIES ENFORCED HERE
 *   - A published rule (ACTIVE / SUPERSEDED / ROLLED_BACK) is never edited or deleted.
 *   - Corrections create a NEW version that supersedes the old row; history is preserved.
 *   - Activation runs the full publish gate, including conflict and source checks.
 *   - Resolution asks the database for candidates and delegates the decision to the pure
 *     resolver, so persistence never contaminates the methodology.
 */

export async function findByKeyAndVersion(
  ruleKey: string,
  version: number,
): Promise<TaxRule | null> {
  return getPrisma().taxRule.findUnique({ where: { ruleKey_version: { ruleKey, version } } });
}

export async function listVersions(ruleKey: string): Promise<TaxRule[]> {
  return getPrisma().taxRule.findMany({ where: { ruleKey }, orderBy: { version: 'asc' } });
}

/** Next free version number for a conceptual rule. */
export async function nextVersion(ruleKey: string): Promise<number> {
  const latest = await getPrisma().taxRule.findFirst({
    where: { ruleKey },
    orderBy: { version: 'desc' },
    select: { version: true },
  });
  return latest === null ? 1 : latest.version + 1;
}

/**
 * Activates a rule after running the publish gate.
 *
 * Every blocking reason is reported at once so an administrator is not sent round a loop
 * discovering one problem at a time.
 *
 * @throws {AppError} VALIDATION_FAILED listing the blockers.
 */
export async function activate(ruleId: string, actor: string): Promise<TaxRule> {
  const prisma = getPrisma();

  const rule = await prisma.taxRule.findUnique({
    where: { id: ruleId },
    include: {
      sources: { select: { id: true } },
      conflicts: { select: { status: true } },
      values: { select: { verificationStatus: true } },
    },
  });

  if (rule === null) {
    throw new AppError(ErrorCode.NOT_FOUND, `Tax rule ${ruleId} not found`);
  }

  const evaluation = evaluateActivation({
    status: rule.status,
    verificationStatus: rule.verificationStatus,
    sourceCount: rule.sources.length,
    conflictStatuses: rule.conflicts.map((conflict) => conflict.status),
    componentVerificationStatuses: rule.values.map((value) => value.verificationStatus),
    approvedBy: rule.approvedBy,
  });

  if (!evaluation.canActivate) {
    throw new AppError(
      ErrorCode.VALIDATION_FAILED,
      `Rule ${ruleId} cannot be activated: ${evaluation.blockers.join(', ')}`,
      {
        publicMessage: 'This rule does not yet meet the requirements for publication.',
        issues: evaluation.blockers.map((blocker) => ({ path: 'status', message: blocker })),
      },
    );
  }

  return prisma.taxRule.update({
    where: { id: ruleId },
    data: {
      status: RuleStatus.ACTIVE,
      publishedAt: new Date(),
      approvedBy: rule.approvedBy ?? actor,
    },
  });
}

/**
 * Creates a correction as a NEW version that supersedes an existing published rule.
 *
 * The previous row is marked SUPERSEDED but keeps its data, so a historical calculation can
 * still reproduce exactly what it used (spec §23, §40).
 */
export async function supersede(
  existingRuleId: string,
  changes: Omit<Prisma.TaxRuleUncheckedCreateInput, 'ruleKey' | 'version' | 'supersedesId'>,
): Promise<TaxRule> {
  const prisma = getPrisma();

  return prisma.$transaction(async (tx) => {
    const existing = await tx.taxRule.findUnique({ where: { id: existingRuleId } });
    if (existing === null) {
      throw new AppError(ErrorCode.NOT_FOUND, `Tax rule ${existingRuleId} not found`);
    }

    const version = await tx.taxRule
      .findFirst({
        where: { ruleKey: existing.ruleKey },
        orderBy: { version: 'desc' },
        select: { version: true },
      })
      .then((latest) => (latest === null ? 1 : latest.version + 1));

    // Retire the old version first so the exclusion constraint cannot see two ACTIVE rows.
    if (existing.status === RuleStatus.ACTIVE) {
      await tx.taxRule.update({
        where: { id: existingRuleId },
        data: { status: RuleStatus.SUPERSEDED },
      });
    }

    return tx.taxRule.create({
      data: {
        ...changes,
        ruleKey: existing.ruleKey,
        version,
        supersedesId: existingRuleId,
      },
    });
  });
}

/**
 * Deletes a rule that has never been published.
 *
 * Published rules are refused outright — they are archived or superseded instead (spec §29).
 * This is the data-layer safeguard that stops destructive deletion being the default.
 */
export async function deleteDraftRule(ruleId: string): Promise<void> {
  const prisma = getPrisma();
  const rule = await prisma.taxRule.findUnique({ where: { id: ruleId } });

  if (rule === null) {
    throw new AppError(ErrorCode.NOT_FOUND, `Tax rule ${ruleId} not found`);
  }

  if (isPublished(rule.status)) {
    throw new AppError(
      ErrorCode.VALIDATION_FAILED,
      `Rule ${ruleId} has status ${rule.status} and represents published history; ` +
        'it cannot be deleted. Supersede, archive or roll it back instead.',
      { publicMessage: 'Published tax rules cannot be deleted.' },
    );
  }

  await prisma.taxRule.delete({ where: { id: ruleId } });
}

/** Applies a lifecycle transition, refusing moves not permitted by the state machine. */
export async function transition(ruleId: string, to: RuleStatus, actor: string): Promise<TaxRule> {
  const prisma = getPrisma();
  const rule = await prisma.taxRule.findUnique({ where: { id: ruleId } });

  if (rule === null) {
    throw new AppError(ErrorCode.NOT_FOUND, `Tax rule ${ruleId} not found`);
  }

  if (!isTransitionAllowed(rule.status, to)) {
    throw new AppError(
      ErrorCode.VALIDATION_FAILED,
      `Transition ${rule.status} -> ${to} is not permitted`,
      { publicMessage: 'That status change is not allowed.' },
    );
  }

  const approvalFields =
    to === RuleStatus.APPROVED ? { approvedBy: actor, approvedAt: new Date() } : {};

  return prisma.taxRule.update({ where: { id: ruleId }, data: { status: to, ...approvalFields } });
}

export interface ResolveQuery {
  readonly jurisdictionId: string;
  readonly category: Prisma.TaxRuleWhereInput['category'];
  readonly effectiveDate: Date;
  readonly taxYear?: number;
}

/**
 * Loads candidate rules and delegates the decision to the pure resolver.
 *
 * Candidates are narrowed in SQL for efficiency, but the ACTIVE/effective-date decision is
 * re-applied by `resolveApplicableRules` so the rules of resolution live in exactly one place.
 */
export async function resolve(query: {
  jurisdictionId: string;
  category: ResolvableRule['category'];
  effectiveDate: Date;
  taxYear?: number;
}): Promise<ResolutionResult> {
  const rows = await getPrisma().taxRule.findMany({
    where: {
      jurisdictionId: query.jurisdictionId,
      category: query.category,
      status: RuleStatus.ACTIVE,
      effectiveFrom: { lte: query.effectiveDate },
      OR: [{ effectiveTo: null }, { effectiveTo: { gt: query.effectiveDate } }],
    },
    include: { taxYear: { select: { year: true } } },
  });

  const candidates: ResolvableRule[] = rows.map((row) => ({
    id: row.id,
    ruleKey: row.ruleKey,
    version: row.version,
    category: row.category,
    jurisdictionId: row.jurisdictionId,
    taxYear: row.taxYear.year,
    status: row.status,
    effectiveFrom: row.effectiveFrom,
    effectiveTo: row.effectiveTo,
  }));

  return resolveApplicableRules(candidates, {
    category: query.category,
    jurisdictionId: query.jurisdictionId,
    effectiveDate: query.effectiveDate,
    ...(query.taxYear === undefined ? {} : { taxYear: query.taxYear }),
  });
}

/** Verification statuses that leave a rule ineligible for publication. */
export const BLOCKING_VERIFICATION_STATUSES: readonly VerificationStatus[] = [
  VerificationStatus.PENDING,
  VerificationStatus.CONFLICT,
  VerificationStatus.PARTIALLY_VERIFIED,
];

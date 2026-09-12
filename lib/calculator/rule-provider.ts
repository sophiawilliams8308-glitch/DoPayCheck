import { RuleCategory, RuleStatus } from '@/lib/db/generated/client';
import { getPrisma } from '@/lib/db/client';
import { prismaDecimalToString } from '@/lib/db/decimal';
import { ResolutionStatus, resolveApplicableRules } from '@/lib/rules/resolution';

import { IncompleteReason } from './types/status';
import type { ResolvedRuleSet, RuleLookup } from './types/rules';

/**
 * Bridge between the Phase 2 rule database and the pure Phase 3 engine.
 *
 * This is the ONLY Phase 3 module that touches persistence. The engine itself stays pure and
 * synchronous (spec §3) — this loads rules, maps them onto the engine's contract, and hands
 * the result in.
 *
 * It never invents a rule. A category with no ACTIVE rule becomes NO_APPLICABLE_RULE, and two
 * overlapping ACTIVE rules become AMBIGUOUS_RULE, which the engine reports as RULE_CONFLICT
 * rather than arbitrating (spec §17).
 */

export interface RuleProviderQuery {
  readonly taxYear: number;
  readonly effectiveDate: Date;
  /** Jurisdiction code per category, e.g. federal for FICA, state for state withholding. */
  readonly jurisdictionCodes: Readonly<Partial<Record<RuleCategory, string>>>;
  readonly categories: readonly RuleCategory[];
}

/**
 * Loads and maps rules for the requested categories.
 *
 * A category whose jurisdiction code is absent resolves to JURISDICTION_UNRESOLVED, so a
 * missing state never silently becomes "no state tax".
 */
export async function loadRuleSet(query: RuleProviderQuery): Promise<ResolvedRuleSet> {
  const prisma = getPrisma();
  const byCategory: Partial<Record<RuleCategory, RuleLookup>> = {};

  for (const category of query.categories) {
    const jurisdictionCode = query.jurisdictionCodes[category];

    if (jurisdictionCode === undefined) {
      byCategory[category] = {
        found: false,
        reason: IncompleteReason.JURISDICTION_UNRESOLVED,
        detail: `No jurisdiction supplied for category ${category}`,
      };
      continue;
    }

    const jurisdiction = await prisma.jurisdiction.findUnique({
      where: { code: jurisdictionCode },
      select: { id: true, code: true },
    });

    if (jurisdiction === null) {
      byCategory[category] = {
        found: false,
        reason: IncompleteReason.JURISDICTION_UNRESOLVED,
        detail: `Jurisdiction ${jurisdictionCode} not found`,
      };
      continue;
    }

    const rows = await prisma.taxRule.findMany({
      where: {
        jurisdictionId: jurisdiction.id,
        category,
        status: RuleStatus.ACTIVE,
        effectiveFrom: { lte: query.effectiveDate },
        OR: [{ effectiveTo: null }, { effectiveTo: { gt: query.effectiveDate } }],
      },
      include: {
        taxYear: { select: { year: true } },
        values: true,
        sources: { select: { sourceId: true, verificationStatus: true } },
      },
    });

    // The ACTIVE/effective-date decision is re-applied by the pure resolver so the rules of
    // resolution live in exactly one place.
    const resolution = resolveApplicableRules(
      rows.map((row) => ({
        id: row.id,
        ruleKey: row.ruleKey,
        version: row.version,
        category: row.category,
        jurisdictionId: row.jurisdictionId,
        taxYear: row.taxYear.year,
        status: row.status,
        effectiveFrom: row.effectiveFrom,
        effectiveTo: row.effectiveTo,
      })),
      { category, jurisdictionId: jurisdiction.id, effectiveDate: query.effectiveDate },
    );

    if (resolution.status === ResolutionStatus.NOT_FOUND) {
      byCategory[category] = {
        found: false,
        reason: IncompleteReason.NO_APPLICABLE_RULE,
        detail: resolution.reason,
      };
      continue;
    }

    if (resolution.status === ResolutionStatus.AMBIGUOUS) {
      byCategory[category] = {
        found: false,
        reason: IncompleteReason.AMBIGUOUS_RULE,
        detail: `${String(resolution.candidates.length)} ACTIVE rules apply simultaneously`,
      };
      continue;
    }

    const row = rows.find((candidate) => candidate.id === resolution.rule.id);
    if (row === undefined) {
      byCategory[category] = {
        found: false,
        reason: IncompleteReason.NO_APPLICABLE_RULE,
        detail: 'Resolved rule could not be re-read',
      };
      continue;
    }

    const sourceIds = row.sources.map((link) => link.sourceId);
    // "Verified" requires at least one source link actually marked VERIFIED — a rule with an
    // attached but unverified source is NOT presented as authoritative (spec §21).
    const verified = row.sources.some((link) => link.verificationStatus === 'VERIFIED');

    byCategory[category] = {
      found: true,
      rule: {
        reference: {
          ruleId: row.id,
          ruleKey: row.ruleKey,
          version: row.version,
          category: row.category,
          taxYear: row.taxYear.year,
          jurisdictionId: row.jurisdictionId,
          jurisdictionCode: jurisdiction.code,
          effectiveFrom: row.effectiveFrom,
          effectiveTo: row.effectiveTo,
          sourceIds,
          verified,
        },
        values: row.values.map((value) => ({
          key: value.key,
          groupKey: value.groupKey,
          ordinal: value.ordinal,
          // NULL stays null — it is "not stated", never zero (spec §19).
          value: prismaDecimalToString(value.numericValue) ?? value.textValue,
          ...(value.unit === null ? {} : { unit: value.unit }),
          verified: value.verificationStatus === 'VERIFIED',
        })),
        payload: row.payload,
      },
    };
  }

  return { byCategory };
}

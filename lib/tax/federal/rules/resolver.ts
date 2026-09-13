import type { RuleCategory } from '@/lib/db/generated/client';
import { getPrisma } from '@/lib/db/client';
import type { RuleReference } from '@/lib/calculator/types/rules';
import { ResolutionStatus, resolveApplicableRules } from '@/lib/rules/resolution';

import { FederalReason, unavailable } from '../errors/federal-errors';
import { FederalRuleKey, requiredRuleKeys, type FederalScenario } from '../rule-keys';
import {
  freezeRuleSet,
  type FederalRuleEntry,
  type ResolvedFederalRuleSet,
} from './resolved-rule-set';

/**
 * STAGE A — federal rule resolution (Phase 4). THE ONLY IMPURE MODULE IN THE ENGINE.
 *
 * ===========================================================================
 * WHY THE ENGINE IS SPLIT IN TWO.
 *
 * Stage A talks to the database, then FREEZES what it found. Stage B computes from that
 * frozen set and nothing else — no query, no clock, no environment, no randomness. That is
 * what makes a historical paycheck reproducible: replay the snapshot's frozen rules and the
 * same input, and the answer cannot have drifted because someone published a 2027 rule.
 * ===========================================================================
 *
 * ONE CONSISTENT READ. Every required key is fetched in a single query, so a rule activated
 * mid-resolution cannot be visible to one key and invisible to another.
 *
 * NO FALLBACK. Not to last year, not to the newest version, not to zero. A key that does not
 * resolve is recorded with the reason it did not.
 */

/** Which Phase 2 category each federal key is filed under. */
const KEY_CATEGORY: Record<FederalRuleKey, RuleCategory> = {
  'FED.FIT.WORKSHEET_1A': 'FEDERAL_WITHHOLDING',
  'FED.FIT.SUPPLEMENTAL': 'FEDERAL_WITHHOLDING',
  'FED.FIT.NRA_ADJUSTMENT': 'FEDERAL_WITHHOLDING',
  'FED.FIT.PRE2020_ALLOWANCE': 'FEDERAL_WITHHOLDING',
  'FED.ANNUAL.RATE_SCHEDULE': 'FEDERAL_INCOME_TAX',
  'FED.ANNUAL.STANDARD_DEDUCTION': 'FEDERAL_INCOME_TAX',
  'FED.FICA.SOCIAL_SECURITY': 'SOCIAL_SECURITY',
  'FED.FICA.MEDICARE': 'MEDICARE',
  'FED.FICA.ADDITIONAL_MEDICARE': 'MEDICARE',
  // PENDING DECISION: Phase 2's RuleCategory enum has no FUTA member, so FUTA is filed as a
  // federal employer obligation under SOCIAL_SECURITY. Whether to add a category is open.
  'FED.FUTA.STANDARD': 'SOCIAL_SECURITY',
};

export interface FederalResolutionQuery {
  readonly taxYear: number;
  readonly effectiveDate: Date;
  readonly scenario: FederalScenario;
  /** Federal jurisdiction code. Defaults to the root federal jurisdiction. */
  readonly jurisdictionCode?: string;
}

/**
 * Opt-in rule-set cache.
 *
 * Identity includes tax year, effective instant, jurisdiction AND the exact key set, so a
 * cached set can never leak across years, dates, jurisdictions or scenarios. Caching changes
 * nothing about the result — it only avoids re-reading rules that cannot have changed within
 * one request.
 */
export interface FederalRuleSetCache {
  get(identity: string): ResolvedFederalRuleSet | undefined;
  set(identity: string, ruleSet: ResolvedFederalRuleSet): void;
}

export function createFederalRuleSetCache(): FederalRuleSetCache {
  const store = new Map<string, ResolvedFederalRuleSet>();
  return {
    get: (identity) => store.get(identity),
    set: (identity, ruleSet) => {
      store.set(identity, ruleSet);
    },
  };
}

export function cacheIdentity(
  query: FederalResolutionQuery,
  keys: readonly FederalRuleKey[],
): string {
  return [
    String(query.taxYear),
    query.effectiveDate.toISOString(),
    query.jurisdictionCode ?? 'US',
    [...keys].sort().join(','),
  ].join('|');
}

/**
 * Resolves every rule the scenario requires, in one read, and freezes the result.
 *
 * @param cache Optional. Supplying one is a performance choice only; it cannot change what a
 *              calculation produces.
 */
export async function resolveFederalRuleSet(
  query: FederalResolutionQuery,
  cache?: FederalRuleSetCache,
): Promise<ResolvedFederalRuleSet> {
  const keys = requiredRuleKeys(query.scenario);
  const identity = cacheIdentity(query, keys);

  const cached = cache?.get(identity);
  if (cached !== undefined) {
    return cached;
  }

  const jurisdictionCode = query.jurisdictionCode ?? 'US';
  const prisma = getPrisma();

  const jurisdiction = await prisma.jurisdiction.findUnique({
    where: { code: jurisdictionCode },
    select: { id: true, code: true },
  });

  const entries: Partial<Record<FederalRuleKey, FederalRuleEntry>> = {};

  if (jurisdiction === null) {
    for (const key of keys) {
      entries[key] = {
        available: false,
        problem: unavailable(
          FederalReason.RULE_MISSING,
          `Federal jurisdiction ${jurisdictionCode} not found`,
          key,
        ),
      };
    }
    return freezeRuleSet({
      taxYear: query.taxYear,
      effectiveDate: query.effectiveDate.toISOString(),
      jurisdictionCode,
      entries,
      ruleReferences: [],
      sourceIds: [],
    });
  }

  // ONE query for every key. Narrowed in SQL; the ACTIVE/effective-date decision is then
  // re-applied by the pure Phase 2 resolver so resolution logic lives in exactly one place.
  const rows = await prisma.taxRule.findMany({
    where: {
      jurisdictionId: jurisdiction.id,
      ruleKey: { in: [...keys] },
      status: 'ACTIVE',
      effectiveFrom: { lte: query.effectiveDate },
      OR: [{ effectiveTo: null }, { effectiveTo: { gt: query.effectiveDate } }],
    },
    include: {
      taxYear: { select: { year: true } },
      sources: { select: { sourceId: true, verificationStatus: true } },
    },
  });

  const references: RuleReference[] = [];

  for (const key of keys) {
    const candidates = rows.filter((row) => row.ruleKey === key);

    const resolution = resolveApplicableRules(
      candidates.map((row) => ({
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
      {
        category: KEY_CATEGORY[key],
        jurisdictionId: jurisdiction.id,
        effectiveDate: query.effectiveDate,
      },
    );

    if (resolution.status === ResolutionStatus.NOT_FOUND) {
      entries[key] = {
        available: false,
        problem: unavailable(FederalReason.RULE_MISSING, resolution.reason, key),
      };
      continue;
    }

    if (resolution.status === ResolutionStatus.AMBIGUOUS) {
      // Two ACTIVE rules covering one instant is a data defect. Surface it; never arbitrate.
      entries[key] = {
        available: false,
        problem: unavailable(
          FederalReason.RULE_CONFLICT,
          `${String(resolution.candidates.length)} ACTIVE rules apply simultaneously for ${key}`,
          key,
        ),
      };
      continue;
    }

    const row = candidates.find((candidate) => candidate.id === resolution.rule.id);
    if (row === undefined) {
      entries[key] = {
        available: false,
        problem: unavailable(FederalReason.RULE_MISSING, 'Resolved rule could not be re-read', key),
      };
      continue;
    }

    const sourceIds = row.sources.map((link) => link.sourceId);
    // A rule counts as verified only when a source link is itself VERIFIED. An attached but
    // unverified source does not make a rule authoritative.
    const sourceVerified = row.sources.some((link) => link.verificationStatus === 'VERIFIED');

    const reference: RuleReference = {
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
      verified: sourceVerified,
    };
    references.push(reference);

    entries[key] = {
      available: true,
      rule: {
        key,
        reference,
        detail: row.payload,
        // Both the rule's own verification AND a verified source are required; the weaker of
        // the two wins, so a VERIFIED rule with no verified source is not treated as final.
        verificationStatus: sourceVerified ? row.verificationStatus : 'PENDING',
      },
    };
  }

  const ruleSet = freezeRuleSet({
    taxYear: query.taxYear,
    effectiveDate: query.effectiveDate.toISOString(),
    jurisdictionCode,
    entries,
    ruleReferences: references,
    sourceIds: [...new Set(references.flatMap((reference) => reference.sourceIds))],
  });

  cache?.set(identity, ruleSet);
  return ruleSet;
}

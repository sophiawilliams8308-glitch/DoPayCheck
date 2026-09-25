import { add, max, money, subtract, toStorageString, zero, type Money } from '@/lib/core/money';
import type { RuleReference } from '@/lib/calculator/types/rules';

import { statusForStateReason } from '../errors/stateErrors';
import { resolveTaxability, type TaxabilityResolutionContext } from '../rules/resolveTaxability';
import type { ResolvedStateRuleSet } from '../rules/stateRuleSet';
import { ALL_STATE_PROGRAMS, PROGRAM_BUCKET, type StateBucket } from '../ruleKeys';
import type { StateAmount, StateDeductionLine } from '../types';
import { BUCKET_DISPLAY, grossWagesFor } from './stateWageBuckets';

/**
 * Resolver-driven state wage-bucket derivation — DM-03 Slice 7.
 *
 * ===========================================================================
 * THE AUTHORITATIVE RESOLVER PATH (4O-6R62), NOT OPTION A.
 *
 * This is a SEPARATE function from `deriveStateWageBuckets()`
 * (`stateWageBuckets.ts`), which remains completely unmodified and
 * continues to implement Option A (caller-supplied `taxabilityProfiles`,
 * no provenance, reduce-only). This module instead resolves taxability
 * through `resolveTaxability()` — the `TaxRule`-backed, provenance-bearing
 * DM-03 resolver (Slices 1-3) — for every deduction × every `StateProgram`,
 * and folds the results into the same `StateBucket` shape using the
 * OWNER-LOCKED DM-03 combination decision (Slice 7):
 *
 *   SCOPE: GLOBAL — one formula, uniform across every StateBucket/StateProgram.
 *   FORMULA (Option B): taxable = max(gross - totalReduce, 0) + totalIncrease
 *
 * This module never reimplements taxability-rule interpretation, condition
 * matching, limit handling, or provenance extraction — all of that stays
 * inside `resolveTaxability()`, called once per (deduction, program) pair.
 * ===========================================================================
 *
 * ===========================================================================
 * WHAT THIS SLICE DELIBERATELY DOES NOT PLUMB.
 *
 * `priorAppliedAmount` is always passed as `undefined` to every
 * `resolveTaxability()` call: no period-to-date/prior-usage accumulator
 * exists anywhere in the repository (confirmed, Slices 4-6), and inventing
 * one is explicitly out of this slice's scope. A deduction whose taxability
 * genuinely requires prior usage (an `ANNUAL` limit, or a sub-monthly
 * `MONTHLY` limit) correctly resolves to `SCENARIO_UNSUPPORTED` via
 * `resolveTaxability()`'s own existing, unmodified, fail-closed behavior —
 * this module does not work around that; it propagates it as an
 * unavailable bucket, exactly as Option A already does for its own
 * failure cases.
 *
 * `context: TaxabilityResolutionContext` (delivery mechanism, limit
 * discriminator, sub-monthly classification) is supplied WHOLE by this
 * function's own caller and reused unchanged for every resolution in one
 * invocation — it is pay-period-level information, not deduction-specific,
 * and `payPeriodIsSubMonthly` remains exactly the caller-level
 * classification Slice 3 established (never recomputed here).
 * ===========================================================================
 */

export interface ResolvedStateWageBucketsInput {
  readonly ruleSet: ResolvedStateRuleSet;
  readonly wages: { readonly regular: Money; readonly supplemental: Money };
  readonly deductions: readonly StateDeductionLine[];
  /** Shared across every resolution this call makes — see module doc comment. */
  readonly context: TaxabilityResolutionContext;
}

/** The exact `RuleReference[]` dedup key convention already established by
 * `lib/calculator/index.ts`'s `collectReferences()` — `ruleId@version` —
 * reused here rather than reinvented. */
function mergeReferences(groups: readonly (readonly RuleReference[])[]): RuleReference[] {
  const seen = new Map<string, RuleReference>();
  for (const group of groups) {
    for (const reference of group) {
      seen.set(`${reference.ruleId}@${String(reference.version)}`, reference);
    }
  }
  return [...seen.values()];
}

function deriveBucket(bucket: StateBucket, input: ResolvedStateWageBucketsInput): StateAmount {
  const { code, label } = BUCKET_DISPLAY[bucket];

  let problem: StateAmount['problem'] = undefined;
  let status: StateAmount['status'] | null = null;
  const reduceAmounts: Money[] = [];
  const increaseAmounts: Money[] = [];
  const referenceGroups: (readonly RuleReference[])[] = [];

  for (const program of ALL_STATE_PROGRAMS) {
    // Only the program(s) mapped to THIS bucket affect it — PROGRAM_BUCKET
    // is a fixed 1:1 mapping (ruleKeys.ts), never inferred here.
    if (PROGRAM_BUCKET[program] !== bucket) {
      continue;
    }

    for (const deduction of input.deductions) {
      // `priorAppliedAmount` is deliberately omitted (never even `undefined`
      // under `exactOptionalPropertyTypes`) — see module doc comment.
      const outcome = resolveTaxability({
        ruleSet: input.ruleSet,
        deductionTypeKey: deduction.deductionTypeKey,
        program,
        applicableAmount: money(deduction.amount),
        context: input.context,
      });

      if (!outcome.ok) {
        // First failure wins, mirroring deriveStateWageBuckets()'s own
        // established pattern: every deduction/program pair is still
        // visited (so no later problem is silently skipped from view),
        // but the bucket's own reported problem is the first encountered.
        if (problem === undefined) {
          problem = outcome.problem;
          status = statusForStateReason(outcome.problem.reason);
        }
        continue;
      }

      referenceGroups.push(outcome.resolution.rules);

      switch (outcome.resolution.direction) {
        case 'REDUCE_WAGES':
          reduceAmounts.push(outcome.resolution.effectiveAmount);
          break;
        case 'INCREASE_WAGES':
          increaseAmounts.push(outcome.resolution.effectiveAmount);
          break;
        case 'NO_CHANGE':
          // Contributes zero to both totals — not pushed anywhere.
          break;
      }
    }
  }

  if (problem !== undefined) {
    return {
      code,
      label,
      // NEVER "0" — an absent bucket and a zero bucket are different facts,
      // exactly as deriveStateWageBuckets() already establishes.
      amount: null,
      status: status ?? 'UNSUPPORTED_SCENARIO',
      problem,
      rules: [],
    };
  }

  const totalReduce = reduceAmounts.length === 0 ? zero() : sumMoney(reduceAmounts);
  const totalIncrease = increaseAmounts.length === 0 ? zero() : sumMoney(increaseAmounts);

  // OWNER-LOCKED FORMULA (DM-03 Slice 7, SCOPE: GLOBAL, Option B):
  //   taxable = max(gross - totalReduce, 0) + totalIncrease
  // Never reinterpreted, never made program-specific.
  const gross = grossWagesFor(bucket, input.wages);
  const taxable = add(max(subtract(gross, totalReduce), zero()), totalIncrease);

  return {
    code,
    label,
    amount: toStorageString(taxable),
    status: 'COMPLETE',
    rules: mergeReferences(referenceGroups),
  };
}

function sumMoney(values: readonly Money[]): Money {
  return values.reduce<Money>((total, value) => add(total, value), zero());
}

/**
 * Derives the four independent state wage buckets via the DM-03 resolver
 * path — the resolver-driven counterpart to `deriveStateWageBuckets()`
 * (Option A). Current-period amounts only, exactly as Option A: no YTD, no
 * annualization, no wage-base capping, no rate application.
 */
export function deriveResolvedStateWageBuckets(
  input: ResolvedStateWageBucketsInput,
): Record<StateBucket, StateAmount> {
  return {
    stateIncomeTaxWages: deriveBucket('stateIncomeTaxWages', input),
    sdiWages: deriveBucket('sdiWages', input),
    pfmlWages: deriveBucket('pfmlWages', input),
    sutaWages: deriveBucket('sutaWages', input),
  };
}

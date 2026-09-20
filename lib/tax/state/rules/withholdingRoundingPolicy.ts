import { RoundingMode } from '@/lib/core/money';

import type { StateRoundingPolicyDetail } from './detailSchemas';
import { readDetail, readFail, readOk, type Read } from './read-detail';
import type { ResolvedStateRuleSet } from './stateRuleSet';
import { StateRuleKey } from '../ruleKeys';

/**
 * State withholding rounding-policy reader.
 *
 * ===========================================================================
 * A DEDICATED READER, NOT A NEW READING MECHANISM.
 *
 * `STATE.WITHHOLDING.ROUNDING_POLICY` is one rule key among many, and
 * `read-detail.ts` already provides the single source of truth for existence,
 * verification and schema-validity handling. This module adds nothing to
 * that: it calls `readDetail()` exactly once and maps its `ok: true` value
 * onto a small, calculation-ready `StateRoundingPolicy` type. Existence,
 * verification (`RULE_MISSING` / `RULE_UNVERIFIED`) and schema validation
 * (`RULE_DETAIL_INVALID`) are `read-detail.ts`'s outcomes, returned here
 * verbatim via `readFail(found.problem)` — never reconstructed, never
 * reinterpreted.
 * ===========================================================================
 *
 * NOT THE ROUNDING ENGINE. This module does not round a `Money` value. It
 * makes the jurisdiction's published rounding policy safely readable so a
 * later withholding-calculation module can round with it — exactly as
 * `lib/tax/federal/rounding/federal-rounding.ts` separates "read the policy"
 * from "apply it" (`roundTax`/`roundIntermediate`, not reproduced here; that
 * belongs to the calculation stage itself, a later task).
 *
 * ===========================================================================
 * WHY THIS IS ITS OWN TYPE, NOT A REUSE OF AN EXISTING ONE.
 *
 * `lib/calculator/rounding/policy.ts`'s `RoundingPolicy` is the project's
 * GENERIC currency-arithmetic fallback — its own doc comment says "THIS IS
 * NOT A TAX RULE" and it exists for when no official methodology has been
 * sourced. Reusing it here would blur exactly the distinction its own
 * documentation draws: `STATE.WITHHOLDING.ROUNDING_POLICY` IS a sourced,
 * rule-driven policy. `lib/tax/federal/rounding/federal-rounding.ts`'s
 * `FederalRoundingPolicy` is the closest precedent in shape, but it is
 * federal-typed and lives in the federal namespace, which state code may not
 * import from. `StateRoundingPolicyDetail`
 * (`detailSchemas.ts`) is therefore the only existing type describing this
 * data; `StateRoundingPolicy` below is the smallest addition that converts it
 * into a calculation-ready shape — `currencyMode` becomes the generic
 * `RoundingMode` enum (`lib/core/money.ts`, not a federal or state type)
 * instead of the raw string the schema stores, which is a type mapping, not
 * a calculation. Every other field is carried through unchanged, including
 * `mandatedBySource` — the schema's full semantics, not a subset of them.
 * ===========================================================================
 */

/** Converts the schema's string enum to the generic, engine-agnostic `RoundingMode`. */
const MODE_MAP: Record<StateRoundingPolicyDetail['currencyMode'], RoundingMode> = {
  HALF_UP: RoundingMode.HALF_UP,
  HALF_EVEN: RoundingMode.HALF_EVEN,
  DOWN: RoundingMode.DOWN,
  UP: RoundingMode.UP,
};

/**
 * The jurisdiction's published withholding rounding policy, calculation-ready.
 *
 * Mirrors `StateRoundingPolicyDetail` field-for-field (see `detailSchemas.ts`
 * for the authoritative shape) — nothing added, nothing dropped, only
 * `currencyMode` converted from a string to `RoundingMode`.
 */
export interface StateRoundingPolicy {
  readonly policyId: string;
  readonly currencyScale: number;
  readonly currencyMode: RoundingMode;
  readonly intermediateScale: number;
  readonly appliedAt: 'TAX_LEVEL' | 'STEP_LEVEL';
  /** True when the jurisdiction MANDATES this; false when it is a disclosed choice. */
  readonly mandatedBySource: boolean;
}

/**
 * Reads `STATE.WITHHOLDING.ROUNDING_POLICY` from an already-resolved,
 * already-frozen `ResolvedStateRuleSet` and returns it as a
 * `StateRoundingPolicy`, or the existing `StateUnavailable` explaining why
 * not. No default exists: a missing, unverified, or invalid policy is never
 * assumed to be "round to the nearest cent" or any other convention.
 */
export function readWithholdingRoundingPolicy(
  ruleSet: ResolvedStateRuleSet,
): Read<StateRoundingPolicy> {
  const found = readDetail(ruleSet, StateRuleKey.WITHHOLDING_ROUNDING_POLICY);
  if (!found.ok) {
    return readFail(found.problem);
  }

  const detail = found.value.detail as StateRoundingPolicyDetail;

  return readOk({
    policyId: detail.policyId,
    currencyScale: detail.currencyScale,
    currencyMode: MODE_MAP[detail.currencyMode],
    intermediateScale: detail.intermediateScale,
    appliedAt: detail.appliedAt,
    mandatedBySource: detail.mandatedBySource,
  });
}

import type { StateTaxabilityProfileSetDetail } from './detailSchemas';
import { readDetail, readFail, readOk, type Read } from './read-detail';
import type { ResolvedStateRuleSet } from './stateRuleSet';
import { StateReason, stateUnavailable } from '../errors/stateErrors';
import { StateRuleKey } from '../ruleKeys';

/**
 * DM-03 taxability-profile-set reader — Slice 2 (Task 4O-6R68).
 *
 * ===========================================================================
 * THE DM-03 SHAPE ONLY. NEVER THE LEGACY SHAPE, NEVER AN ADAPTER.
 *
 * `StateRuleKey.TAXABILITY_PROFILE` resolves through the SAME rule-set
 * pipeline as every other state rule key (Steps 3.1-3.7, `assembleStateRuleSet`)
 * and the SAME schema-validation seam (`readDetail()` -> `validateStateDetail()`)
 * Slice 1 already registered as a `z.union([legacy, TAXABILITY_PROFILE_SET])`.
 * This reader does not duplicate any of that: it delegates existence,
 * verification and schema validity entirely to `readDetail()`, exactly as
 * `readTaxabilityProfile()` (`taxabilityProfile.ts`) already does — and that
 * function is UNCHANGED by this module. This is a second, separate reader,
 * not a replacement.
 *
 * The one thing `readDetail()` cannot do is tell the two union arms apart:
 * its return type is `unknown`, validated but not narrowed (by design — see
 * `read-detail.ts`'s own doc comment). This reader performs exactly that one
 * additional narrowing step, and REJECTS the legacy shape outright with
 * `RULE_DETAIL_INVALID` rather than lifting it into the new shape. DM-03
 * contract OD-1 is locked as ONE-TIME REWRITE: no legacy production record
 * exists, and no read-time adapter is built here or anywhere in this slice.
 * A hybrid payload (both shapes' fields on one record) never reaches this
 * function at all — Slice 1's `.strict()` fix (4O-6R65) already fails it at
 * `validateStateDetail()`, before `readDetail()` would ever return `ok: true`.
 * ===========================================================================
 */

/**
 * Reads `STATE.TAXABILITY.PROFILE` from an already-resolved, already-frozen
 * `ResolvedStateRuleSet`, narrowed to the DM-03 `TAXABILITY_PROFILE_SET`
 * shape only.
 *
 * A resolved detail whose `shape` is the legacy `TAXABILITY_PROFILE` value
 * fails with `RULE_DETAIL_INVALID` — the DM-03 resolver (`resolveTaxability`)
 * accepts only this shape, and this reader is its sole entry point into the
 * rule set.
 */
export function readTaxabilityProfileSet(
  ruleSet: ResolvedStateRuleSet,
): Read<StateTaxabilityProfileSetDetail> {
  const found = readDetail(ruleSet, StateRuleKey.TAXABILITY_PROFILE);
  if (!found.ok) {
    return readFail(found.problem);
  }

  const detail = found.value.detail;
  const shape =
    typeof detail === 'object' && detail !== null && 'shape' in detail
      ? (detail as { readonly shape: unknown }).shape
      : undefined;

  if (shape !== 'TAXABILITY_PROFILE_SET') {
    return readFail(
      stateUnavailable(
        StateReason.RULE_DETAIL_INVALID,
        `Rule ${StateRuleKey.TAXABILITY_PROFILE} resolved to shape ${String(shape)}, not ` +
          'TAXABILITY_PROFILE_SET; the DM-03 resolver accepts only the DM-03 shape and never ' +
          'adapts the legacy TAXABILITY_PROFILE representation',
        StateRuleKey.TAXABILITY_PROFILE,
      ),
    );
  }

  return readOk(detail as StateTaxabilityProfileSetDetail);
}

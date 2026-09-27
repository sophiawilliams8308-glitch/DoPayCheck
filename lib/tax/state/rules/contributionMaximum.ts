import { type Money, max, min, subtract, zero } from '@/lib/core/money';

import type { StateThresholdDetail } from './detailSchemas';
import { readDetail, readFail, readOk, requireComponent, type Read } from './read-detail';
import type { ResolvedStateRuleSet } from './stateRuleSet';
import { StateRuleKey } from '../ruleKeys';

/**
 * State maximum-contribution primitive — DM-03 (SDI/PFML contribution
 * maximum wiring).
 *
 * ===========================================================================
 * ONE PRIMITIVE, TWO CALLERS — MIRRORS `wageBase.ts` EXACTLY.
 *
 * `SDI_MAX_CONTRIBUTION` and `PFML_MAX_CONTRIBUTION` both validate under the
 * SAME `stateThresholdDetailSchema` (`detailSchemas.ts`): `{ amount, basis,
 * inclusive, applicability }`. One generic helper, parameterized by which of
 * the two keys to read, is justified by the schema itself, exactly the way
 * `applyStateWageBase()` is justified for `SDI_WAGE_BASE`/`PFML_WAGE_BASE`/
 * `SUTA_WAGE_BASE`. There is no `SUTA_MAX_CONTRIBUTION` key, so SUTA is not
 * part of this union.
 * ===========================================================================
 *
 * MAXIMUM CONTRIBUTION, NOT WAGE BASE. A wage base limits the WAGES a rate
 * applies to (`wageBase.ts`); a maximum contribution limits the total
 * CONTRIBUTION DOLLAR AMOUNT already computed from wages x rate. This module
 * never reads a rate and never multiplies a wage figure — it caps an
 * already-computed contribution amount its caller supplies.
 *
 * ===========================================================================
 * YTD-AWARE, SAME CONVENTION AS WAGE-BASE YTD WIRING (commit 0f4b0c8):
 * `remaining = max(maximum - ytdContribution, 0)`,
 * `cappedContribution = min(periodContribution, remaining)`.
 *
 * `ytdContribution` is the caller's already-resolved `StateYtd` figure for
 * this programme (`StateYtd.sdiContributions`/`pfmlContributions`) — this
 * employer's contributions, EXCLUDING the current pay period, the same
 * convention `StateYtd`'s own doc comment establishes. This module does not
 * accumulate, mutate, or reinterpret that figure.
 * ===========================================================================
 *
 * ===========================================================================
 * NOT_APPLICABLE IS THE SCHEMA'S OWN "NO CAP" REPRESENTATION.
 *
 * `stateThresholdDetailSchema.applicability: 'APPLIES' | 'NOT_APPLICABLE'` —
 * identical convention to `stateWageBaseDetailSchema`. When `NOT_APPLICABLE`,
 * this helper returns the contribution UNCHANGED, `maximum: null`, and
 * `inclusive: null` (there is no threshold to have a strict-vs-inclusive
 * reading of when none applies).
 *
 * A null `amount` while `applicability: 'APPLIES'` is `COMPONENT_NOT_STATED`
 * (via the existing `requireComponent`), never zero and never "no cap".
 * ===========================================================================
 *
 * ===========================================================================
 * OWNER-LOCKED: `inclusive` IS PRESERVED, NEVER INFERRED.
 *
 * `inclusive: boolean | null` is read from the resolved detail and returned
 * verbatim in `StateContributionMaximumApplication.inclusive` — `true`/
 * `false` when the source states one, `null` when strict-vs-inclusive is
 * unverified for this jurisdiction. This module implements NO strict/
 * inclusive comparison behavior of any kind: the cap arithmetic above
 * (`remaining`/`min`) is applied identically regardless of `inclusive`'s
 * value. `null` is never converted to `true` or `false`, and no default
 * boundary interpretation is invented — the owner-locked decision preceding
 * this implementation is explicit that this ambiguity stays disclosed,
 * exactly as the federal `ADDL_MEDICARE_WITHHOLDING_THRESHOLD` precedent
 * (`lib/tax/federal/fica/additional-medicare.ts`'s own `thresholdInclusive`
 * field, PENDING VERIFICATION V-02) already leaves its own analogous
 * ambiguity disclosed rather than resolved.
 *
 * `inclusive` is exposed here, at this primitive's own result type — not
 * bolted onto `SdiContribution`/`PfmlContribution` (which have no existing
 * slot for rule-detail metadata beyond `rules: RuleReference[]`) — because
 * inventing a new public field on that widely-used contract solely to carry
 * an unused value would be exactly the kind of speculative API this task's
 * own contract forbids. This module's own result type is the smallest place
 * that can honestly preserve the resolved value while it is read.
 * ===========================================================================
 *
 * `basis` (`stateThresholdDetailSchema.basis: 'ANNUAL_YTD' | 'PER_PERIOD'`) is
 * not carried into `StateContributionMaximumApplication`: no caller or test
 * anywhere in the repository branches on it, and this module always treats
 * `ytdContribution` as the caller's already-resolved annual-YTD figure
 * regardless of the stated basis — inventing basis-dispatch logic here would
 * be a new, unapproved business rule. Noted here, not silently dropped.
 */

/** The two rule keys that validate under `stateThresholdDetailSchema` for a
 * maximum-contribution ceiling today. */
export type StateContributionMaximumRuleKey =
  typeof StateRuleKey.SDI_MAX_CONTRIBUTION | typeof StateRuleKey.PFML_MAX_CONTRIBUTION;

export interface StateContributionMaximumApplication {
  /** `periodContribution`, clamped to the remaining annual maximum when one
   * applies; `periodContribution` unchanged otherwise. */
  readonly cappedContribution: Money;
  /** The maximum contribution actually applied, or `null` when this
   * jurisdiction states no ceiling applies. */
  readonly maximum: Money | null;
  /** The resolved rule's own `inclusive` value, preserved verbatim and never
   * interpreted — see this module's own doc comment. */
  readonly inclusive: boolean | null;
}

/**
 * Applies a state maximum-contribution ceiling to an already-computed
 * period contribution amount, using an already-resolved, already-frozen
 * `ResolvedStateRuleSet` and the caller's already-resolved year-to-date
 * contribution for this programme (`StateYtd`'s convention: excluding the
 * current pay period).
 *
 * Delegates all existence/verification/schema-validity handling to the
 * existing `readDetail()` — this module adds only the maximum-contribution
 * semantics (`APPLIES` -> `remaining = max(maximum - ytdContribution, 0)`,
 * clamp the period contribution to `remaining`; `NOT_APPLICABLE` -> unchanged,
 * no cap, `ytdContribution` unused) on top.
 */
export function applyStateContributionMaximum(
  ruleSet: ResolvedStateRuleSet,
  ruleKey: StateContributionMaximumRuleKey,
  periodContribution: Money,
  ytdContribution: Money,
): Read<StateContributionMaximumApplication> {
  const found = readDetail(ruleSet, ruleKey);
  if (!found.ok) {
    return readFail(found.problem);
  }

  const detail = found.value.detail as StateThresholdDetail;

  if (detail.applicability === 'NOT_APPLICABLE') {
    return readOk({ cappedContribution: periodContribution, maximum: null, inclusive: null });
  }

  const amount = requireComponent(detail.amount, ruleKey, 'amount');
  if (!amount.ok) {
    return readFail(amount.problem);
  }

  const remaining = max(subtract(amount.value, ytdContribution), zero());
  return readOk({
    cappedContribution: min(periodContribution, remaining),
    maximum: amount.value,
    inclusive: detail.inclusive,
  });
}

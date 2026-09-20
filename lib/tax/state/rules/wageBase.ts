import { type Money, min } from '@/lib/core/money';

import type { StateWageBaseDetail } from './detailSchemas';
import { readDetail, readFail, readOk, requireComponent, type Read } from './read-detail';
import type { ResolvedStateRuleSet } from './stateRuleSet';
import { StateRuleKey } from '../ruleKeys';

/**
 * State wage-base / cap primitive.
 *
 * ===========================================================================
 * ONE PRIMITIVE, THREE FUTURE CALLERS.
 *
 * `SDI_WAGE_BASE`, `PFML_WAGE_BASE` and `SUTA_WAGE_BASE` all validate under
 * the SAME `stateWageBaseDetailSchema` (`detailSchemas.ts`): `{ amount,
 * basis: 'ANNUAL', applicability }`. One generic helper, parameterized by
 * which of the three keys to read, is therefore justified by the schema
 * itself — not a guess that the three programmes happen to look similar.
 * ===========================================================================
 *
 * WAGE BASE, NOT CONTRIBUTION CAP. A wage base limits the WAGES a rate
 * applies to; a maximum contribution limits the total CONTRIBUTION amount.
 * These are separate rule keys (`SDI_MAX_CONTRIBUTION`, `PFML_MAX_CONTRIBUTION`)
 * with their own, different schema (`stateThresholdDetailSchema`) and are
 * out of scope here — this module reads and applies a wage base only, never
 * a rate, and never a contribution figure. `rate x wageBase` is not computed
 * anywhere in this file.
 *
 * ===========================================================================
 * A SIMPLE CURRENT-INPUT CLAMP, NOT A YTD WAGE-BASE TRACKER.
 *
 * `applyStateWageBase` clamps whatever `wages` it is given against the
 * resolved base — it does not know about year-to-date wages, does not
 * compute a "remaining base", and does not decide what "wages" means for a
 * given call (current-period, cumulative, or otherwise). That is the future
 * SDI/PFML/SUTA calculation context's decision to make and pass in; adding
 * YTD accumulation here would invent a business rule this task's contract
 * does not ask for.
 *
 * ===========================================================================
 * NOT_APPLICABLE IS THE SCHEMA'S OWN "NO CAP" REPRESENTATION.
 *
 * `stateWageBaseDetailSchema.applicability: 'APPLIES' | 'NOT_APPLICABLE'` — no
 * separate "unlimited" sentinel exists or is invented here.
 * `NOT_APPLICABLE` is a positive, source-backed statement that this
 * jurisdiction's programme has no wage base at all (the same convention
 * federal's own reader already documents for the Medicare wage base — see
 * `lib/tax/federal/rules/read-detail.ts`), not a data gap. When it applies,
 * this helper returns the wages UNCHANGED and `wageBase: null` — `null` here
 * is this module's own TypeScript representation of that already-existing
 * schema state, not a new schema field.
 *
 * A null `amount` while `applicability: 'APPLIES'` is a different thing
 * entirely: the jurisdiction DOES have a wage base, but the source has not
 * yet stated its amount. That is `COMPONENT_NOT_STATED` (via the existing
 * `requireComponent` from `read-detail.ts`), never zero and never treated as
 * "no cap".
 *
 * ===========================================================================
 * NOT VALIDATED HERE: NEGATIVE WAGES.
 *
 * No existing project contract forbids a negative `wages` input at this
 * layer (`validateStateContext` does not check wage sign either), so this
 * module does not invent one. `min(wages, wageBase)` is applied exactly as
 * given; a caller supplying a negative wage figure gets a negative result
 * back, unmodified — the same "do not invent a business rule" discipline
 * this task's own contract requires.
 *
 * `basis` (`stateWageBaseDetailSchema.basis: z.literal('ANNUAL')`) is not
 * carried into `StateWageBaseApplication`: it has exactly one possible value
 * today, so exposing it would not let a caller decide anything a constant
 * doesn't already tell them. Noted here, not silently dropped.
 * ===========================================================================
 */

/** The three rule keys that validate under `stateWageBaseDetailSchema` today. */
export type StateWageBaseRuleKey =
  | typeof StateRuleKey.SDI_WAGE_BASE
  | typeof StateRuleKey.PFML_WAGE_BASE
  | typeof StateRuleKey.SUTA_WAGE_BASE;

export interface StateWageBaseApplication {
  /** `wages`, clamped to the wage base when one applies; `wages` unchanged otherwise. */
  readonly applicableWages: Money;
  /** The wage base actually applied, or `null` when this jurisdiction states no cap applies. */
  readonly wageBase: Money | null;
}

/**
 * Applies a state wage base to a wage figure, using an already-resolved,
 * already-frozen `ResolvedStateRuleSet`.
 *
 * Delegates all existence/verification/schema-validity handling to the
 * existing `readDetail()` — this module adds only the wage-base semantics
 * (`APPLIES` -> clamp; `NOT_APPLICABLE` -> unchanged, no cap) on top.
 */
export function applyStateWageBase(
  ruleSet: ResolvedStateRuleSet,
  ruleKey: StateWageBaseRuleKey,
  wages: Money,
): Read<StateWageBaseApplication> {
  const found = readDetail(ruleSet, ruleKey);
  if (!found.ok) {
    return readFail(found.problem);
  }

  const detail = found.value.detail as StateWageBaseDetail;

  if (detail.applicability === 'NOT_APPLICABLE') {
    return readOk({ applicableWages: wages, wageBase: null });
  }

  const amount = requireComponent(detail.amount, ruleKey, 'amount');
  if (!amount.ok) {
    return readFail(amount.problem);
  }

  return readOk({ applicableWages: min(wages, amount.value), wageBase: amount.value });
}

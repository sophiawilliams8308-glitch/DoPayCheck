import { toStorageString } from '@/lib/core/money';

import type { ResolvedStateRuleSet } from '@/lib/tax/state/rules/stateRuleSet';
import type { StateTaxabilityProfileDetail } from '@/lib/tax/state/rules/detailSchemas';
import type { StateDeductionLine } from '@/lib/tax/state/types';

import type { DeductionResult } from './pipeline/deductions';

/**
 * Bridge between the Phase 3 pipeline and the Phase 5 state engine.
 *
 * ===========================================================================
 * MIRRORS THE FEDERAL BRIDGE PATTERN — NOT THE FEDERAL DATA.
 *
 * Task 4G locked this as a parallel options object plus a `toXDeductions()`
 * mapping function, following `federal-bridge.ts`'s existing shape exactly.
 * The federal engine's own deduction/taxability VALUES are never reused: a
 * state deduction line and a state taxability profile are always produced
 * from this bridge's own inputs, never copied from
 * `toFederalDeductions()`/`FederalOptions`.
 *
 * This module implements ONLY the locked Task 4G contract — the options
 * type and the deduction bridge function. It does not build
 * `StateCalculationContext`, does not run any state calculation, and is not
 * consulted anywhere yet: `CalculationOptions.state` is not read by
 * `calculatePaycheck` (see `index.ts`). Wiring it in is a later task.
 * ===========================================================================
 */

export interface StateOptions {
  readonly ruleSet: ResolvedStateRuleSet;
  /** Caller-supplied, per Task 4B Option A — never resolved via `TAXABILITY_PROFILE`. */
  readonly taxabilityProfiles?: Readonly<Record<string, StateTaxabilityProfileDetail>>;
}

/**
 * Maps Phase 3 deduction lines onto the state engine's contract.
 *
 * Takes the SAME `DeductionResult[]` already computed once by
 * `calculateDeductions()` (the caller passes `preTaxResult.items`, exactly as
 * `runFederalEngine` does) — this never re-derives or re-calculates a
 * deduction amount, and it never calls `calculateDeductions()` itself.
 *
 * One output per input, in the same order: no sort, no filter, no dedup, no
 * aggregation. `amount` is `DeductionResult.amount` (already the calculated,
 * rounded `Money` value) re-expressed as the `DecimalString` `StateDeductionLine`
 * requires — no re-rounding, no floating point.
 *
 * Never reads taxability of any kind (federal or state): inclusion was
 * already decided by `calculateDeductions()`, and taxability is a wholly
 * separate input applied later by `deriveStateWageBuckets()`.
 */
export function toStateDeductions(
  items: readonly DeductionResult[],
): readonly StateDeductionLine[] {
  return items.map((item) => ({
    // Phase 3 identifies a deduction by its id; the state engine resolves a
    // taxability profile by type key, and the id is the type key by
    // convention until Phase 3 carries an explicit one — the same convention
    // `toFederalDeductions()` already uses, inherited here rather than
    // reinvented (Task 4G §9-10).
    deductionTypeKey: item.input.deductionTypeKey ?? item.id,
    amount: toStorageString(item.amount),
  }));
}

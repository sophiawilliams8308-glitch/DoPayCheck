import type { StateFormulaStepsDetail } from './detailSchemas';
import { readDetail, readFail, readOk, type Read } from './read-detail';
import type { ResolvedStateRuleSet } from './stateRuleSet';
import { StateRuleKey } from '../ruleKeys';

/**
 * State withholding-formula reader — Task 4O-1.
 *
 * ===========================================================================
 * THIS IS THE READER ONLY. INTERPRETATION IS NOT IMPLEMENTED HERE.
 *
 * The Task 4O contract audit found the `WITHHOLDING_FORMULA` interpreter
 * BLOCKED BY SPEC GAPS: the `operandRef` vocabulary is unconstrained free
 * text with no established convention, the execution model (single running
 * value vs. something else), filing-status consumption, and the
 * `ANNUALIZE`/`DEANNUALIZE` periods-per-year source are all unresolved. None
 * of that is decided here. This module answers exactly one question: "is
 * `WITHHOLDING_FORMULA` safe to read, and if so, here it is" — the same
 * narrow scope `readWithholdingMethod()` (`withholdingMethod.ts`) and
 * `readWithholdingFilingStatusMap()` (`withholdingFilingStatusMap.ts`)
 * already use for their own rule keys.
 * ===========================================================================
 */

/**
 * Reads `STATE.WITHHOLDING.FORMULA` from an already-resolved, already-frozen
 * `ResolvedStateRuleSet`.
 *
 * Returns `StateFormulaStepsDetail` (`detailSchemas.ts`) verbatim — a 1:1
 * pass-through, since the schema needs no unit conversion or semantic
 * transformation to be exposed. All existence, verification, and
 * schema-validity handling is delegated entirely to the existing
 * `readDetail()`. `steps` (including an empty array, and every step's
 * `ordinal`, `operation`, `operandRef` — including `null` — and `note` —
 * including `null`) is preserved exactly as stored, in exactly the order
 * supplied — no sorting, filtering, deduplication, or interpretation.
 */
export function readWithholdingFormula(
  ruleSet: ResolvedStateRuleSet,
): Read<StateFormulaStepsDetail> {
  const found = readDetail(ruleSet, StateRuleKey.WITHHOLDING_FORMULA);
  if (!found.ok) {
    return readFail(found.problem);
  }

  return readOk(found.value.detail as StateFormulaStepsDetail);
}

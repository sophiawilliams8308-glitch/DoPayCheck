import type { StateMethodDescriptorDetail } from './detailSchemas';
import { readDetail, readFail, readOk, type Read } from './read-detail';
import type { ResolvedStateRuleSet } from './stateRuleSet';
import { StateRuleKey } from '../ruleKeys';

/**
 * State withholding-method reader — Task 4J.
 *
 * ===========================================================================
 * THIS IS THE READER ONLY. DISPATCH AND CALCULATION ARE NOT IMPLEMENTED HERE.
 *
 * `structure` (`NONE | FLAT | PROGRESSIVE | TABLE | FORMULA | HYBRID`) is, per
 * `stateMethodDescriptorDetailSchema`'s own doc comment, "the one permitted
 * form of dispatch" for a future withholding calculation — but deciding which
 * shape to consume next, reading `WITHHOLDING_TABLE`/`WITHHOLDING_FORMULA`,
 * selecting a table row, interpreting a formula step, or computing any
 * withholding amount are all later, separate work. This module answers
 * exactly one question: "is `WITHHOLDING_METHOD` safe to read, and if so,
 * here it is" — the same narrow scope `readTaxabilityProfile()`
 * (`taxabilityProfile.ts`) and `readWithholdingRoundingPolicy()`
 * (`withholdingRoundingPolicy.ts`) already use for their own rule keys.
 * ===========================================================================
 */

/**
 * Reads `STATE.WITHHOLDING.METHOD` from an already-resolved, already-frozen
 * `ResolvedStateRuleSet`.
 *
 * Returns `StateMethodDescriptorDetail` (`detailSchemas.ts`) verbatim — a 1:1
 * pass-through, since the schema needs no unit conversion or semantic
 * transformation to be calculation-ready. All existence, verification, and
 * schema-validity handling is delegated entirely to the existing
 * `readDetail()`.
 */
export function readWithholdingMethod(
  ruleSet: ResolvedStateRuleSet,
): Read<StateMethodDescriptorDetail> {
  const found = readDetail(ruleSet, StateRuleKey.WITHHOLDING_METHOD);
  if (!found.ok) {
    return readFail(found.problem);
  }

  return readOk(found.value.detail as StateMethodDescriptorDetail);
}

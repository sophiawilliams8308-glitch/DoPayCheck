import { StateRuleKey } from '../ruleKeys';
import type { StateWithholdingTableDetail } from './detailSchemas';
import { readDetail, readFail, readOk, type Read } from './read-detail';
import type { ResolvedStateRuleSet } from './stateRuleSet';

/**
 * State withholding-table reader — DM-03 Slice 18.
 *
 * ===========================================================================
 * THIS IS THE READER ONLY. SELECTION, ARITHMETIC, AND CALCULATION ARE NOT
 * IMPLEMENTED HERE.
 *
 * `selectStateWithholdingTableRow()` (`withholdingTable.ts`, Task 4N-R,
 * already implemented) selects one row from an already-validated
 * `StateWithholdingTableDetail` — but its own doc comment says it takes that
 * detail directly "(e.g. from a future `readWithholdingTable()`)", because
 * no such reader existed yet. This module is that reader, and nothing more:
 * it answers exactly one question, "is `WITHHOLDING_TABLE` safe to read, and
 * if so, here it is" — the same narrow scope `readWithholdingMethod()`
 * (`withholdingMethod.ts`) and `readWithholdingFormula()`
 * (`withholdingFormula.ts`) already use for their own rule keys.
 *
 * NOT ADDED TO `withholdingTable.ts` ITSELF. That file already holds
 * `selectStateWithholdingTableRow()` — the CONSUMER of an already-read
 * detail, not a reader. This repository already draws that exact line
 * elsewhere: `withholdingFormula.ts` (the `WITHHOLDING_FORMULA` reader) is a
 * separate file from `withholdingFormulaInterpreter.ts` (the formula
 * executor that consumes what it reads), with a matching split in their own
 * test files (`state-withholding-formula.test.ts` vs
 * `state-withholding-formula-interpreter.test.ts`). This module follows
 * that same reader/consumer file split for `WITHHOLDING_TABLE`, rather than
 * merging a new reader into the existing selector file or renaming it
 * (renaming `withholdingTable.ts` would be an unrelated, out-of-scope
 * change to an already-committed, already-tested module).
 * ===========================================================================
 */

/**
 * Reads `STATE.WITHHOLDING.TABLE` from an already-resolved, already-frozen
 * `ResolvedStateRuleSet`.
 *
 * Returns `StateWithholdingTableDetail` (`detailSchemas.ts`) verbatim — a 1:1
 * pass-through, since the schema needs no unit conversion or semantic
 * transformation to be calculation-ready. All existence, verification, and
 * schema-validity handling is delegated entirely to the existing
 * `readDetail()`. An empty `rows` array is a valid, schema-conformant detail
 * (the schema places no minimum length on `rows`) and is returned exactly as
 * read — this reader does not decide whether an empty table is usable for
 * any particular calculation scenario; that is a downstream question.
 */
export function readWithholdingTable(
  ruleSet: ResolvedStateRuleSet,
): Read<StateWithholdingTableDetail> {
  const found = readDetail(ruleSet, StateRuleKey.WITHHOLDING_TABLE);
  if (!found.ok) {
    return readFail(found.problem);
  }

  return readOk(found.value.detail as StateWithholdingTableDetail);
}

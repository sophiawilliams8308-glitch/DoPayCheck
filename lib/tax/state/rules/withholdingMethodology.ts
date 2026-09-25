import type { StateMethodDescriptorDetail } from './detailSchemas';
import { readFail, readOk, type Read } from './read-detail';
import { StateReason, stateUnavailable } from '../errors/stateErrors';
import { StateRuleKey } from '../ruleKeys';

/**
 * State withholding methodology dispatcher — DM-03 Slice 17.
 *
 * ===========================================================================
 * WHAT THIS MODULE DECIDES, AND WHAT IT DELIBERATELY DOES NOT.
 *
 * `readWithholdingMethod()` (Task 4J, `withholdingMethod.ts`) reads
 * `STATE.WITHHOLDING.METHOD` but is explicitly forbidden from ever
 * dispatching on the resolved `structure` — enforced both by its own doc
 * comment and by a machine-checked guard test
 * (`state-withholding-method.test.ts`, "no forbidden responsibilities":
 * `expect(source).not.toMatch(/switch\s*\(|if\s*\(.*structure/)`). This
 * module is that separate dispatch step, and nothing more: given an
 * already-read `StateMethodDescriptorDetail`, it decides WHICH withholding
 * mechanism (if any established one exists) the jurisdiction's declared
 * `structure` maps to.
 *
 * It does NOT accept or read a `ResolvedStateRuleSet` (the caller already
 * read `WITHHOLDING_METHOD` via `readWithholdingMethod()`), does not call
 * `readWithholdingFormula()` or a `readWithholdingTable()` (which does not
 * exist anywhere in the repository — `withholdingTable.ts`'s own doc
 * comment calls it "a future `readWithholdingTable()`"), does not run
 * `runStateWithholdingFormula()` or `selectStateWithholdingTableRow()`, and
 * produces no `Money` value, no `StateAmount`, and no `StateTaxResult`. It
 * is limited to deterministic methodology SELECTION, never calculation.
 * ===========================================================================
 *
 * ===========================================================================
 * EVIDENCE FOR THE TWO STRUCTURES THIS MODULE DOES CLASSIFY.
 *
 * `stateMethodDescriptorDetailSchema`'s own doc comment (`detailSchemas.ts`):
 * "The engine reads this to decide WHICH shape to consume — it is the one
 * permitted form of dispatch, and it dispatches on DECLARED METHOD, never on
 * a state code." `withholdingMethod.ts` itself (Task 4J, already committed)
 * names the two shapes this dispatch is for, explicitly, in its own doc
 * comment: "deciding which shape to consume next, reading
 * `WITHHOLDING_TABLE`/`WITHHOLDING_FORMULA`... are all later, separate
 * work" — the same order the schema's own `structure` enum lists them in.
 * Combined with the exact, unambiguous 1:1 naming correspondence between the
 * enum values `TABLE`/`FORMULA` and the only two rule keys
 * (`STATE.WITHHOLDING.TABLE`, `STATE.WITHHOLDING.FORMULA` — `ruleKeys.ts`)
 * shaped to carry a withholding mechanism, this is repository evidence
 * already written down in an earlier, reviewed slice — not a fresh
 * inference invented for this one. No schema field FORCES this pairing (a
 * jurisdiction's `structure` and its authored rule keys are not
 * cross-validated against each other anywhere), so this module reports
 * which mechanism the DECLARED structure names, never which rule keys
 * happen to be present.
 *
 * `TABLE`'s classification carries a disclosed caveat: `selectStateWithholdingTableRow()`
 * (`withholdingTable.ts`) selects a row only — no post-selection arithmetic
 * (`baseWithholding + rate x excess` or equivalent) exists anywhere in the
 * repository (confirmed by DM-03 Slice 16's discovery pass). This module's
 * `TABLE` outcome is therefore explicitly marked incomplete-for-calculation
 * (`TABLE_SELECTION_ONLY`), never conflated with `FORMULA`'s outcome, which
 * — modulo the interpreter's own already-disclosed gaps (`ROUND`,
 * the `PIT_DEPENDENT_EXEMPTION` path of `SUBTRACT_EXEMPTIONS`) — can in
 * principle run to completion today.
 * ===========================================================================
 *
 * ===========================================================================
 * THE FOUR STRUCTURES THIS MODULE DELIBERATELY DOES NOT CLASSIFY.
 *
 * `NONE`, `FLAT`, `PROGRESSIVE`, `HYBRID` have NO rule key, shape, reader, or
 * doc comment anywhere in the repository naming an execution mechanism for
 * them (confirmed by repository-wide search, DM-03 Slice 16 and this
 * slice). In particular, `FLAT`/`PROGRESSIVE` are NOT assumed to mean
 * "authored as a `WITHHOLDING_FORMULA` using a single
 * `APPLY_FLAT_RATE`/`APPLY_BRACKETS` step" — that is a plausible guess, not
 * a stated contract, and guessing it would silently narrow which real
 * formulas a `FORMULA`-structured jurisdiction is allowed to author. All
 * four report `StateReason.SCENARIO_UNSUPPORTED`, the engine's own
 * established "no established selector -> report, never guess" convention
 * (already used identically for the SDI/PFML/SUTA wage-base
 * APPLIES-without-YTD case and the SUTA employer-rate selection gap). This
 * module invents no meaning for any of the four — it is a genuine,
 * disclosed contract gap, not filled by a default or a fallback to
 * `FORMULA`/`TABLE`.
 * ===========================================================================
 *
 * PURE. No database access, no filesystem, no global state, no rule-set
 * lookup — its only input is an already-read detail value.
 */

export type WithholdingMethodologyDecision =
  { readonly kind: 'FORMULA' } | { readonly kind: 'TABLE_SELECTION_ONLY' };

/**
 * Classifies an already-read `WITHHOLDING_METHOD` detail into which
 * withholding mechanism (if any established one exists) applies. Does not
 * read the mechanism's own rule key, select a table row, interpret a
 * formula, or compute an amount — see this module's own doc comment.
 */
export function resolveWithholdingMethodology(
  detail: StateMethodDescriptorDetail,
): Read<WithholdingMethodologyDecision> {
  switch (detail.structure) {
    case 'FORMULA':
      return readOk({ kind: 'FORMULA' });
    case 'TABLE':
      return readOk({ kind: 'TABLE_SELECTION_ONLY' });
    case 'NONE':
    case 'FLAT':
    case 'PROGRESSIVE':
    case 'HYBRID':
      return readFail(
        stateUnavailable(
          StateReason.SCENARIO_UNSUPPORTED,
          `WITHHOLDING_METHOD.structure "${detail.structure}" has no established withholding ` +
            'mechanism in this repository; this is a genuine contract gap, not filled by a ' +
            'guessed default or a fallback to FORMULA/TABLE',
          StateRuleKey.WITHHOLDING_METHOD,
        ),
      );
  }
}

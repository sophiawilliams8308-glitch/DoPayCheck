import type { StateFilingStatusMapDetail } from './detailSchemas';
import { readDetail, readFail, readOk, type Read } from './read-detail';
import type { ResolvedStateRuleSet } from './stateRuleSet';
import { StateRuleKey } from '../ruleKeys';

/**
 * State withholding filing-status-map reader — Task 4L.
 *
 * ===========================================================================
 * THIS IS THE READER ONLY. LOOKUP/MAPPING IS NOT IMPLEMENTED HERE.
 *
 * `stateFilingStatusMapDetailSchema` records how a jurisdiction's own filing
 * statuses (`entries[].stateFilingStatus`) relate to the federal vocabulary
 * (`entries[].federalFilingStatus`) — per its own doc comment, "a jurisdiction
 * DATA" question, not a code transformation this module performs.
 *
 * The Task 4L architecture audit found NO current consumer of this rule
 * anywhere in the repository, and `read-detail.ts`'s own comment already
 * disclaims building a per-status lookup helper as "a speculative API"
 * without one. This module therefore does exactly what
 * `readTaxabilityProfile()` and `readWithholdingMethod()` already do for
 * their own rule keys: expose the validated detail verbatim, and nothing
 * more. It does NOT look up a status, does NOT translate a state status into
 * a federal one, does NOT touch `StateCalculationContext`, and does NOT
 * decide whether/how a future TABLE or FORMULA implementation should use
 * this data — that remains an explicitly open question (Task 4L §11).
 * ===========================================================================
 */

/**
 * Reads `STATE.WITHHOLDING.FILING_STATUS_MAP` from an already-resolved,
 * already-frozen `ResolvedStateRuleSet`.
 *
 * Returns `StateFilingStatusMapDetail` (`detailSchemas.ts`) verbatim — a 1:1
 * pass-through, since the schema needs no unit conversion or semantic
 * transformation to be exposed. All existence, verification, and
 * schema-validity handling is delegated entirely to the existing
 * `readDetail()`. `entries` (including an empty array, and any entry whose
 * `federalFilingStatus` is `NOT_STATED`) is preserved exactly as stored — no
 * filtering, sorting, deduplication, or value conversion.
 */
export function readWithholdingFilingStatusMap(
  ruleSet: ResolvedStateRuleSet,
): Read<StateFilingStatusMapDetail> {
  const found = readDetail(ruleSet, StateRuleKey.WITHHOLDING_FILING_STATUS_MAP);
  if (!found.ok) {
    return readFail(found.problem);
  }

  return readOk(found.value.detail as StateFilingStatusMapDetail);
}

import { compare, money, type Money } from '@/lib/core/money';

import { StateReason, stateUnavailable, type StateUnavailable } from '../errors/stateErrors';
import { StateRuleKey } from '../ruleKeys';
import type { StateWithholdingTableDetail } from './detailSchemas';
import { readFail, readOk, type Read } from './read-detail';

/** One row of an already-validated `WITHHOLDING_TABLE` detail. */
export type StateWithholdingTableRow = StateWithholdingTableDetail['rows'][number];

/**
 * State withholding table row selector — Task 4N-R.
 *
 * ===========================================================================
 * IMPLEMENTS ONLY THE LOCKED TASK 4N-R CONTRACT.
 *
 * Filing status is matched STATE-NATIVE, directly against `context filingStatus
 * === tableRow.filingStatus` — `WITHHOLDING_FILING_STATUS_MAP` is never
 * consulted, and no state-to-federal conversion happens here. A `null` filing
 * status is a scenario-input problem, not a rule-data problem, and reports
 * `SCENARIO_UNSUPPORTED` rather than defaulting to any status.
 *
 * Wage ranges use `[wageFrom, wageTo)` — `wageFrom` inclusive, `wageTo`
 * exclusive, `wageTo === null` meaning open-ended. This boundary convention is
 * directly evidenced by `lib/rules/validation.ts`'s `validateWithholdingRows()`,
 * whose contiguity check (`previous.wageTo === row.wageFrom`) is only
 * coherent under half-open semantics — a wage exactly at a shared boundary
 * belongs to the row whose `wageFrom` equals it, never the row whose
 * `wageTo` does.
 *
 * The supplied wage is the CURRENT PAY-PERIOD wage for the row's own
 * `payFrequency` — this function never annualizes, never multiplies by a
 * periods-per-year factor, and never touches
 * `WITHHOLDING_PAY_PERIODS_PER_YEAR` or the generic `periodsPerYear()`.
 *
 * Zero matches and multiple matches are both `RULE_CONFLICT` — never
 * resolved by `ordinal`, array order, or any other heuristic. `ordinal` is
 * read nowhere in this module.
 *
 * THIS IS SELECTION ONLY. It does not compute `baseWithholding + rate ×
 * excess`, does not apply rounding, standard deduction, allowances,
 * supplemental treatment, or taxability — those remain later, separate
 * responsibilities. It is pure, synchronous, and touches no rule set,
 * resolver, or database.
 * ===========================================================================
 */

function matchesRange(row: StateWithholdingTableRow, wages: Money): boolean {
  const aboveLower = row.wageFrom === null || compare(wages, money(row.wageFrom)) >= 0;
  const belowUpper = row.wageTo === null || compare(wages, money(row.wageTo)) < 0;
  return aboveLower && belowUpper;
}

function conflict(detail: string): StateUnavailable {
  return stateUnavailable(StateReason.RULE_CONFLICT, detail, StateRuleKey.WITHHOLDING_TABLE);
}

/**
 * Selects the single `WITHHOLDING_TABLE` row matching a filing status, pay
 * frequency, and current-period wage amount.
 *
 * @param table Already-validated `WITHHOLDING_TABLE` detail (e.g. from a
 *   future `readWithholdingTable()`). This function performs no existence,
 *   verification, or schema validation of its own.
 * @param filingStatus The employee's state-native filing status, exactly as
 *   carried on `StateCalculationContext.elections[...].filingStatus`. `null`
 *   reports `SCENARIO_UNSUPPORTED`.
 * @param payFrequency Matched by exact equality against each row's own
 *   `payFrequency`. No normalization, no conversion.
 * @param wages The current pay-period wage amount for that frequency.
 */
export function selectStateWithholdingTableRow(
  table: StateWithholdingTableDetail,
  filingStatus: string | null,
  payFrequency: string,
  wages: Money,
): Read<StateWithholdingTableRow> {
  if (filingStatus === null) {
    return readFail(
      stateUnavailable(
        StateReason.SCENARIO_UNSUPPORTED,
        'No filing status is available for WITHHOLDING_TABLE row selection; a filing status is ' +
          'never assumed',
        StateRuleKey.WITHHOLDING_TABLE,
      ),
    );
  }

  const byStatus = table.rows.filter((row) => row.filingStatus === filingStatus);
  const byFrequency = byStatus.filter((row) => row.payFrequency === payFrequency);
  const matches = byFrequency.filter((row) => matchesRange(row, wages));

  if (matches.length === 0) {
    return readFail(
      conflict(
        `No WITHHOLDING_TABLE row covers filing status ${filingStatus}, pay frequency ` +
          `${payFrequency}, and the supplied wage — the table has a gap`,
      ),
    );
  }

  if (matches.length > 1) {
    const ordinals = matches.map((row) => String(row.ordinal)).join(', ');
    return readFail(
      conflict(
        `${String(matches.length)} WITHHOLDING_TABLE rows (ordinal ${ordinals}) match filing ` +
          `status ${filingStatus}, pay frequency ${payFrequency}, and the supplied wage — ` +
          'overlapping rows are a data defect and are never resolved by preference',
      ),
    );
  }

  const row = matches[0];
  if (row === undefined) {
    return readFail(conflict('Row match lost'));
  }

  return readOk(row);
}

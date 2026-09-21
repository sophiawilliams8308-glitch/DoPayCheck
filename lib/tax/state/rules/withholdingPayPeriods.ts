import { StateReason, stateUnavailable } from '../errors/stateErrors';
import { StateRuleKey } from '../ruleKeys';
import type { StateCountByPayPeriodDetail } from './detailSchemas';
import { readDetail, readFail, readOk, type Read } from './read-detail';
import type { ResolvedStateRuleSet } from './stateRuleSet';

/**
 * State withholding pay-periods-per-year reader — Task 4K.
 *
 * ===========================================================================
 * A SEPARATE, RULE-SOURCED FACT — NEVER THE GENERIC CALENDAR TABLE.
 *
 * `StateRuleKey.WITHHOLDING_PAY_PERIODS_PER_YEAR` is a jurisdiction-published
 * withholding-methodology fact (Task 4K architecture audit, Option D,
 * SUPPORTED), structurally identical to federal's own
 * `FED.FIT.PAY_PERIODS_PER_YEAR` (`lib/tax/federal/fit/pay-periods.ts`'s
 * `resolvePayPeriodsPerYear`) — cited here as an architecture PRECEDENT only,
 * never imported. This module has NO dependency on, and NO fallback to,
 * `lib/calculator/pipeline/pay-frequency.ts`'s generic `periodsPerYear()`,
 * which remains authoritative for Phase 3 gross-pay/annualization arithmetic
 * and is untouched by this module. The two sources are never reconciled.
 *
 * THIS IS THE READER ONLY. `ANNUALIZE`/`DEANNUALIZE` formula execution and
 * `WITHHOLDING_TABLE` row selection (which the Task 4K audit found does not
 * consume this value at all) are not implemented here.
 * ===========================================================================
 */

/**
 * Resolves the periods-per-year factor for one pay frequency from the
 * resolved `WITHHOLDING_PAY_PERIODS_PER_YEAR` rule.
 *
 * Existence, verification, and schema-validity are delegated entirely to
 * `readDetail()`. Beyond that:
 *
 * - No row for `payFrequency` in `counts[]` → `SCENARIO_UNSUPPORTED`.
 * - A matching row whose `periodsPerYear` is `null` → `SCENARIO_UNSUPPORTED`
 *   ("the jurisdiction does not state a count for this frequency" per the
 *   schema's own doc comment) — never treated as zero, and never inferred
 *   from the generic calendar table.
 * - A matching row with a stated count → `readOk(count)`, preserved exactly.
 */
export function resolveStatePayPeriodsPerYear(
  ruleSet: ResolvedStateRuleSet,
  payFrequency: string,
): Read<number> {
  const found = readDetail(ruleSet, StateRuleKey.WITHHOLDING_PAY_PERIODS_PER_YEAR);
  if (!found.ok) {
    return readFail(found.problem);
  }

  const detail = found.value.detail as StateCountByPayPeriodDetail;
  const row = detail.counts.find((candidate) => candidate.payFrequency === payFrequency);

  if (row === undefined) {
    return readFail(
      stateUnavailable(
        StateReason.SCENARIO_UNSUPPORTED,
        `${StateRuleKey.WITHHOLDING_PAY_PERIODS_PER_YEAR} states no periods-per-year count for ` +
          `${payFrequency}`,
        StateRuleKey.WITHHOLDING_PAY_PERIODS_PER_YEAR,
        `counts[${payFrequency}]`,
      ),
    );
  }

  if (row.periodsPerYear === null) {
    return readFail(
      stateUnavailable(
        StateReason.SCENARIO_UNSUPPORTED,
        `No periods-per-year count is published for ${payFrequency}; this operation is not ` +
          'supported for it, and no count is assumed',
        StateRuleKey.WITHHOLDING_PAY_PERIODS_PER_YEAR,
        `counts[${payFrequency}]`,
      ),
    );
  }

  return readOk(row.periodsPerYear);
}

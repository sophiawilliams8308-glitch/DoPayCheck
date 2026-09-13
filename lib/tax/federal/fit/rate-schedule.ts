import { type Money, compare, money } from '@/lib/core/money';

import { FederalReason, unavailable } from '../errors/federal-errors';
import { type Read, readFail, readOk, requireComponent } from '../rules/read-detail';
import type { RateScheduleRow, Worksheet1ADetail } from '../rules/detail-schemas';

/**
 * Pub. 15-T percentage-method rate schedule lookup (Phase 4, Track B, Worksheet 1A step 2).
 *
 * ===========================================================================
 * THIS IS NOT AN ANNUAL BRACKET LOOKUP.
 *
 * A withholding rate schedule and a 1040 bracket table have similar shapes and different
 * numbers, published for different purposes. They live in different rule namespaces
 * (FED.FIT.* vs FED.ANNUAL.*) and are read by different modules so one can never stand in
 * for the other (spec §6).
 * ===========================================================================
 *
 * Pub. 15-T publishes a separate schedule per filing status AND per Step 2 checkbox state, so
 * the checkbox selects a different table — it is not a modifier applied to one table.
 */

export interface RateScheduleMatch {
  readonly row: RateScheduleRow;
  /** Column C — the flat amount for rows at or above this bracket. */
  readonly baseAmount: Money;
  /** Column D — marginal rate on the excess. */
  readonly marginalRate: Money;
  /** Column E — the figure the adjusted annual wage is measured against. */
  readonly excessOver: Money;
}

/** Selects the schedule for a filing status and Step 2 state. */
export function selectSchedule(
  detail: Worksheet1ADetail,
  filingStatus: string,
  step2Checked: boolean,
  ruleKey: string,
): Read<{ rows: readonly RateScheduleRow[] }> {
  const schedule = detail.schedules.find(
    (candidate) =>
      candidate.filingStatus === filingStatus && candidate.step2Checkbox === step2Checked,
  );

  if (schedule === undefined) {
    return readFail(
      unavailable(
        FederalReason.COMPONENT_NOT_STATED,
        `No Worksheet 1A rate schedule for filing status ${filingStatus} with Step 2 ` +
          `${step2Checked ? 'checked' : 'unchecked'}`,
        ruleKey,
        `schedules[${filingStatus}/step2=${String(step2Checked)}]`,
      ),
    );
  }

  if (schedule.rows.length === 0) {
    return readFail(
      unavailable(
        FederalReason.COMPONENT_NOT_STATED,
        `Rate schedule for ${filingStatus} has no rows; official table values are PENDING_DATA`,
        ruleKey,
        'schedules.rows',
      ),
    );
  }

  return readOk({ rows: schedule.rows });
}

/**
 * Finds the row covering an adjusted annual wage.
 *
 * Bounds are half-open `[atLeast, lessThan)`, matching how the published table reads
 * ("at least X but less than Y"). A null bound is open-ended.
 */
export function findRow(
  rows: readonly RateScheduleRow[],
  adjustedAnnualWage: Money,
  ruleKey: string,
): Read<RateScheduleMatch> {
  const ordered = [...rows].sort((a, b) => a.ordinal - b.ordinal);

  for (const row of ordered) {
    const aboveLower = row.atLeast === null || compare(adjustedAnnualWage, money(row.atLeast)) >= 0;
    const belowUpper =
      row.lessThan === null || compare(adjustedAnnualWage, money(row.lessThan)) < 0;

    if (aboveLower && belowUpper) {
      const baseAmount = requireComponent(
        row.baseAmount,
        ruleKey,
        `rows[${row.ordinal}].baseAmount`,
      );
      if (!baseAmount.ok) {
        return readFail(baseAmount.problem);
      }
      const marginalRate = requireComponent(
        row.marginalRate,
        ruleKey,
        `rows[${row.ordinal}].marginalRate`,
      );
      if (!marginalRate.ok) {
        return readFail(marginalRate.problem);
      }
      const excessOver = requireComponent(
        row.excessOver,
        ruleKey,
        `rows[${row.ordinal}].excessOver`,
      );
      if (!excessOver.ok) {
        return readFail(excessOver.problem);
      }

      return readOk({
        row,
        baseAmount: baseAmount.value,
        marginalRate: marginalRate.value,
        excessOver: excessOver.value,
      });
    }
  }

  // A wage that matches no row means the published table has a gap, not that tax is zero.
  return readFail(
    unavailable(
      FederalReason.COMPONENT_NOT_STATED,
      'No rate-schedule row covers the adjusted annual wage; the table is incomplete',
      ruleKey,
      'schedules.rows',
    ),
  );
}

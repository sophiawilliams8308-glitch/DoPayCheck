import { type Money, compare, money } from '@/lib/core/money';

import { FederalReason, unavailable } from '../errors/federal-errors';
import { type Read, readFail, readOk, readRate, requireComponent } from '../rules/read-detail';
import type { WithholdingScheduleDetail, WithholdingScheduleRow } from '../rules/detail-schemas';

/**
 * Pub. 15-T rate-schedule lookup — spec §5.3 step 2, invariants §5.4.
 *
 * ===========================================================================
 * THIS IS NOT AN ANNUAL BRACKET LOOKUP.
 *
 * A withholding rate schedule and a 1040 bracket table have similar shapes and
 * different numbers, published for different purposes. They live in different
 * rule namespaces, carry different detail shapes, and are read by different
 * modules, so one can never stand in for the other (§5.7).
 * ===========================================================================
 *
 * Invariants enforced here, each with a test:
 *   FIT-INV-4  exactly one row may match; zero or several is RULE_CONFLICT
 *   FIT-INV-5  the top row must be open-ended (`lessThan = null`)
 *   FIT-INV-6  rows are half-open [A, B), contiguous, no gaps, no overlaps
 *   FIT-INV-7  never interpolate between rows
 */

export interface RateScheduleMatch {
  readonly row: WithholdingScheduleRow;
  /** Column C. */
  readonly baseAmount: Money;
  /** Column D, always a decimal fraction after unit conversion. */
  readonly rate: Money;
  /** Column A — the figure the adjusted annual wage is measured against. */
  readonly atLeast: Money;
}

/** Selects the per-filing-status schedule from a resolved schedule rule. */
export function selectSchedule(
  detail: WithholdingScheduleDetail,
  filingStatus: string,
  ruleKey: string,
): Read<{ rows: readonly WithholdingScheduleRow[] }> {
  const schedule = detail.schedules.find((candidate) => candidate.filingStatus === filingStatus);

  if (schedule === undefined) {
    return readFail(
      unavailable(
        FederalReason.COMPONENT_NOT_STATED,
        `No ${detail.scheduleType} rate schedule for filing status ${filingStatus}`,
        ruleKey,
        `schedules[${filingStatus}]`,
      ),
    );
  }

  if (schedule.rows.length === 0) {
    return readFail(
      unavailable(
        FederalReason.COMPONENT_NOT_STATED,
        `Rate schedule for ${filingStatus} has no rows; official values are PENDING DATA`,
        ruleKey,
        `schedules[${filingStatus}].rows`,
      ),
    );
  }

  return readOk({ rows: schedule.rows });
}

/**
 * Structural validation of a schedule — FIT-INV-5 and FIT-INV-6.
 *
 * Run at resolution rather than only at publish time: malformed data that
 * reached the database must still not silently produce a number.
 */
export function validateScheduleRows(
  rows: readonly WithholdingScheduleRow[],
  ruleKey: string,
  filingStatus: string,
): Read<true> {
  const ordered = [...rows].sort((a, b) => a.rowOrder - b.rowOrder);
  const where = `schedules[${filingStatus}].rows`;

  const conflict = (detail: string): Read<true> =>
    readFail(unavailable(FederalReason.RULE_CONFLICT, detail, ruleKey, where));

  const last = ordered[ordered.length - 1];
  if (last === undefined || last.lessThan !== null) {
    return conflict('FIT-INV-5: the top schedule row must be open-ended (lessThan = null)');
  }

  for (let index = 0; index < ordered.length; index += 1) {
    const row = ordered[index];
    if (row === undefined) {
      continue;
    }

    const isFirst = index === 0;
    if (isFirst) {
      if (row.atLeast !== null && !money(row.atLeast).isZero()) {
        return conflict('FIT-INV-6: the first schedule row must start at zero or be open-ended');
      }
    }

    if (row.lessThan !== null && row.atLeast !== null) {
      if (compare(money(row.lessThan), money(row.atLeast)) <= 0) {
        return conflict(`FIT-INV-6: row ${String(row.rowOrder)} has lessThan <= atLeast`);
      }
    }

    const next = ordered[index + 1];
    if (next === undefined) {
      continue;
    }
    if (row.lessThan === null) {
      return conflict(
        `FIT-INV-5: row ${String(row.rowOrder)} is open-ended but is not the top row`,
      );
    }
    if (next.atLeast === null) {
      return conflict(`FIT-INV-6: row ${String(next.rowOrder)} has no lower bound`);
    }
    // Contiguity: each row must begin exactly where the previous one ended.
    // A gap silently drops a wage band; an overlap makes two rows match.
    if (compare(money(next.atLeast), money(row.lessThan)) !== 0) {
      return conflict(
        `FIT-INV-6: rows ${String(row.rowOrder)} and ${String(next.rowOrder)} are not contiguous`,
      );
    }
  }

  return readOk(true);
}

/**
 * Finds the single row covering an adjusted annual wage.
 *
 * Bounds are half-open `[atLeast, lessThan)`, matching how the table reads
 * ("at least X but less than Y"). Zero or multiple matches are a data defect,
 * reported as RULE_CONFLICT — never resolved by taking the first (FIT-INV-4).
 */
export function findRow(
  rows: readonly WithholdingScheduleRow[],
  adjustedAnnualWage: Money,
  ruleKey: string,
): Read<RateScheduleMatch> {
  const matches = rows.filter((row) => {
    const aboveLower = row.atLeast === null || compare(adjustedAnnualWage, money(row.atLeast)) >= 0;
    const belowUpper =
      row.lessThan === null || compare(adjustedAnnualWage, money(row.lessThan)) < 0;
    return aboveLower && belowUpper;
  });

  if (matches.length === 0) {
    return readFail(
      unavailable(
        FederalReason.RULE_CONFLICT,
        'FIT-INV-4: no rate-schedule row covers the adjusted annual wage; the table has a gap',
        ruleKey,
        'schedules.rows',
      ),
    );
  }

  if (matches.length > 1) {
    const orders = matches.map((row) => String(row.rowOrder)).join(', ');
    return readFail(
      unavailable(
        FederalReason.RULE_CONFLICT,
        `FIT-INV-4: ${String(matches.length)} rate-schedule rows match (rowOrder ${orders}); ` +
          'overlapping rows are a data defect and are never resolved by preference',
        ruleKey,
        'schedules.rows',
      ),
    );
  }

  const row = matches[0];
  if (row === undefined) {
    return readFail(
      unavailable(FederalReason.RULE_CONFLICT, 'Row match lost', ruleKey, 'schedules.rows'),
    );
  }

  const baseAmount = requireComponent(
    row.baseAmount,
    ruleKey,
    `rows[${String(row.rowOrder)}].baseAmount`,
  );
  if (!baseAmount.ok) {
    return readFail(baseAmount.problem);
  }

  const rate = readRate(row.rate, row.unit, ruleKey, `rows[${String(row.rowOrder)}].rate`);
  if (!rate.ok) {
    return readFail(rate.problem);
  }

  const atLeast = row.atLeast === null ? money('0') : money(row.atLeast);

  return readOk({ row, baseAmount: baseAmount.value, rate: rate.value, atLeast });
}

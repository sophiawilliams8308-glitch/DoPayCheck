import { type Money, min, multiply } from '@/lib/core/money';

import { FederalRuleKey } from '../rule-keys';
import {
  FEDERAL_ROUNDING_V1,
  roundTax,
  type FederalRoundingPolicy,
} from '../rounding/federal-rounding';
import { readDetail, requireComponent, type Read, readFail, readOk } from '../rules/read-detail';
import type { ResolvedFederalRuleSet } from '../rules/resolved-rule-set';
import type { MedicareDetail } from '../rules/detail-schemas';

/**
 * Medicare (Phase 4, Tracks C and D).
 *
 * Medicare has no wage cap under current law — but the engine does not hardcode that. The
 * rule detail carries `hasWageLimit` as a STATED FACT: `false` means the source says there is
 * no limit, which is different from a limit the source failed to state. Only when
 * `hasWageLimit` is true is a cap applied, and then the cap itself must be stated.
 *
 * Employee and employer use separate rates for the same reason as Social Security.
 */

export interface MedicareComputation {
  readonly taxableThisPeriod: Money;
  readonly employee: Money;
  readonly employer: Money;
  readonly capApplied: boolean;
  readonly ruleKey: string;
}

export function calculateMedicare(
  ruleSet: ResolvedFederalRuleSet,
  periodWages: Money,
  policy: FederalRoundingPolicy = FEDERAL_ROUNDING_V1,
): Read<MedicareComputation> {
  const found = readDetail(ruleSet, FederalRuleKey.FICA_MEDICARE);
  if (!found.ok) {
    return readFail(found.problem);
  }

  const detail = found.value.detail as MedicareDetail;
  const ruleKey = found.value.ruleKey;

  const employeeRate = requireComponent(detail.employeeRate, ruleKey, 'employeeRate');
  if (!employeeRate.ok) {
    return readFail(employeeRate.problem);
  }
  const employerRate = requireComponent(detail.employerRate, ruleKey, 'employerRate');
  if (!employerRate.ok) {
    return readFail(employerRate.problem);
  }

  let taxable = periodWages;
  let capApplied = false;

  if (detail.hasWageLimit) {
    // The source says a limit exists, so it must also state it. A stated limit with no value
    // is incomplete data, never an absent cap.
    const limit = requireComponent(detail.wageLimit ?? null, ruleKey, 'wageLimit');
    if (!limit.ok) {
      return readFail(limit.problem);
    }
    taxable = min(periodWages, limit.value);
    capApplied = true;
  }

  return readOk({
    taxableThisPeriod: taxable,
    employee: roundTax(multiply(taxable, employeeRate.value), policy),
    employer: roundTax(multiply(taxable, employerRate.value), policy),
    capApplied,
    ruleKey,
  });
}

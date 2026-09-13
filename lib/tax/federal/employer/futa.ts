import { type Money, max, min, multiply, subtract, zero } from '@/lib/core/money';

import { FederalRuleKey } from '../rule-keys';
import {
  FEDERAL_ROUNDING_V1,
  roundTax,
  type FederalRoundingPolicy,
} from '../rounding/federal-rounding';
import { readDetail, requireComponent, type Read, readFail, readOk } from '../rules/read-detail';
import type { ResolvedFederalRuleSet } from '../rules/resolved-rule-set';
import type { FutaDetail } from '../rules/detail-schemas';

/**
 * FUTA (Phase 4, Track D — EMPLOYER ONLY).
 *
 * ===========================================================================
 * FUTA IS NEVER A PAYCHECK DEDUCTION.
 *
 * It is an employer liability. It must never appear in employee tax totals, and must never
 * reduce net pay. Nothing in this module returns an employee figure, so it cannot.
 * ===========================================================================
 *
 * Effective rate = gross rate − credit. The credit is a stated component of the rule; a
 * missing credit is COMPONENT_NOT_STATED, never an assumed full credit and never zero.
 *
 * PHASE 5 — state credit reduction. Some states reduce the standard credit, which raises the
 * effective rate. That determination is jurisdiction-specific and is deliberately out of
 * Phase 4 scope: this module applies the STANDARD credit only and discloses that it has.
 */

export interface FutaComputation {
  readonly taxableThisPeriod: Money;
  readonly wageBaseRemaining: Money;
  readonly grossRate: Money;
  readonly credit: Money;
  readonly effectiveRate: Money;
  readonly employer: Money;
  readonly ruleKey: string;
}

/** FUTA is capped by an annual wage base, tracked the same way as Social Security. */
export function futaTaxableWages(
  periodWages: Money,
  ytdWages: Money,
  wageBase: Money,
): { taxable: Money; remaining: Money } {
  const remaining = max(subtract(wageBase, ytdWages), zero());
  return { taxable: min(remaining, periodWages), remaining };
}

export function calculateFuta(
  ruleSet: ResolvedFederalRuleSet,
  periodWages: Money,
  ytdWages: Money,
  policy: FederalRoundingPolicy = FEDERAL_ROUNDING_V1,
): Read<FutaComputation> {
  const found = readDetail(ruleSet, FederalRuleKey.FUTA);
  if (!found.ok) {
    return readFail(found.problem);
  }

  const detail = found.value.detail as FutaDetail;
  const ruleKey = found.value.ruleKey;

  const grossRate = requireComponent(detail.grossRate, ruleKey, 'grossRate');
  if (!grossRate.ok) {
    return readFail(grossRate.problem);
  }
  const credit = requireComponent(detail.standardCredit, ruleKey, 'standardCredit');
  if (!credit.ok) {
    return readFail(credit.problem);
  }
  const wageBase = requireComponent(detail.wageBase, ruleKey, 'wageBase');
  if (!wageBase.ok) {
    return readFail(wageBase.problem);
  }

  const { taxable, remaining } = futaTaxableWages(periodWages, ytdWages, wageBase.value);
  const effectiveRate = subtract(grossRate.value, credit.value);

  return readOk({
    taxableThisPeriod: taxable,
    wageBaseRemaining: remaining,
    grossRate: grossRate.value,
    credit: credit.value,
    effectiveRate,
    employer: roundTax(multiply(taxable, effectiveRate), policy),
    ruleKey,
  });
}

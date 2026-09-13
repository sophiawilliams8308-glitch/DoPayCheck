import { type Money, max, min, multiply, subtract, zero } from '@/lib/core/money';

import { FederalReason, unavailable } from '../errors/federal-errors';
import { FederalRuleKey } from '../rule-keys';
import { roundTax, type FederalRoundingPolicy } from '../rounding/federal-rounding';
import {
  readDetail,
  readRate,
  requireComponent,
  type Read,
  readFail,
  readOk,
} from '../rules/read-detail';
import type { ResolvedFederalRuleSet } from '../rules/resolved-rule-set';
import type { RateDetail, WageBaseDetail } from '../rules/detail-schemas';

/**
 * FUTA — spec §18. Track D, EMPLOYER ONLY.
 *
 * ===========================================================================
 * FUTA IS NEVER A PAYCHECK DEDUCTION (§18.1).
 *
 * It must never appear in employee taxes, never reduce net pay, never show in
 * the employee-facing breakdown. Nothing in this module returns an employee
 * figure, so structurally it cannot.
 * ===========================================================================
 *
 * The effective rate is DERIVED at calculation time (gross − credit), never
 * stored pre-computed, so the trace can show the subtraction and a credit
 * change needs no rate re-entry (§18.3).
 *
 * CREDIT REDUCTION (§18.6, D-FUTA-2) — deferred to Phase 5. The standard credit
 * only is applied here, and the caller is told so explicitly: silently
 * presenting a possibly understated employer cost as complete would violate the
 * transparency principle.
 *
 * APPLICABILITY (§18.7) — a paycheck calculator cannot evaluate the statutory
 * employer tests, so FUTA is conditioned on `employerSubjectToFuta` and that
 * condition is stated in the output rather than assumed away.
 */

export interface FutaComputation {
  readonly taxableThisPeriod: Money;
  readonly wageBaseRemaining: Money;
  readonly grossRate: Money;
  readonly credit: Money;
  readonly effectiveRate: Money;
  readonly employer: Money;
  readonly creditReductionEvaluated: false;
  readonly ruleKeys: readonly string[];
}

export function calculateFuta(
  ruleSet: ResolvedFederalRuleSet,
  periodWages: Money,
  ytdWages: Money,
  employerSubjectToFuta: boolean,
  policy: FederalRoundingPolicy,
): Read<FutaComputation> {
  if (!employerSubjectToFuta) {
    return readFail(
      unavailable(
        FederalReason.SCENARIO_UNSUPPORTED,
        'The employer is not subject to FUTA, so no FUTA is computed. It is omitted with this ' +
          'statement rather than reported as zero.',
        FederalRuleKey.FUTA_GROSS_RATE,
      ),
    );
  }

  const grossRule = readDetail(ruleSet, FederalRuleKey.FUTA_GROSS_RATE);
  if (!grossRule.ok) {
    return readFail(grossRule.problem);
  }
  const grossDetail = grossRule.value.detail as RateDetail;
  const grossRate = readRate(grossDetail.rate, grossDetail.unit, FederalRuleKey.FUTA_GROSS_RATE);
  if (!grossRate.ok) {
    return readFail(grossRate.problem);
  }

  const creditRule = readDetail(ruleSet, FederalRuleKey.FUTA_STANDARD_CREDIT);
  if (!creditRule.ok) {
    return readFail(creditRule.problem);
  }
  const creditDetail = creditRule.value.detail as RateDetail;
  const credit = readRate(
    creditDetail.rate,
    creditDetail.unit,
    FederalRuleKey.FUTA_STANDARD_CREDIT,
  );
  if (!credit.ok) {
    return readFail(credit.problem);
  }

  const baseRule = readDetail(ruleSet, FederalRuleKey.FUTA_WAGE_BASE);
  if (!baseRule.ok) {
    return readFail(baseRule.problem);
  }
  const baseDetail = baseRule.value.detail as WageBaseDetail;
  if (baseDetail.applicability === 'NOT_APPLICABLE') {
    return readFail(
      unavailable(
        FederalReason.RULE_CONFLICT,
        'The FUTA wage base is recorded NOT_APPLICABLE, but FUTA has a wage base; data defect',
        FederalRuleKey.FUTA_WAGE_BASE,
        'applicability',
      ),
    );
  }
  const wageBase = requireComponent(baseDetail.amount, FederalRuleKey.FUTA_WAGE_BASE, 'amount');
  if (!wageBase.ok) {
    return readFail(wageBase.problem);
  }

  const remaining = max(subtract(wageBase.value, ytdWages), zero());
  const taxable = min(periodWages, remaining);
  const effectiveRate = subtract(grossRate.value, credit.value);

  return readOk({
    taxableThisPeriod: taxable,
    wageBaseRemaining: remaining,
    grossRate: grossRate.value,
    credit: credit.value,
    effectiveRate,
    employer: roundTax(multiply(taxable, effectiveRate), policy),
    creditReductionEvaluated: false,
    ruleKeys: [
      FederalRuleKey.FUTA_GROSS_RATE,
      FederalRuleKey.FUTA_STANDARD_CREDIT,
      FederalRuleKey.FUTA_WAGE_BASE,
    ],
  });
}

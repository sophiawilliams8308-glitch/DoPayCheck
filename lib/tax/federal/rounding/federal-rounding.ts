import { type Money, RoundingMode, round } from '@/lib/core/money';

import { FederalRuleKey } from '../rule-keys';
import { readDetail, type Read, readFail, readOk } from '../rules/read-detail';
import type { ResolvedFederalRuleSet } from '../rules/resolved-rule-set';
import type { RoundingPolicyDetail } from '../rules/detail-schemas';

/**
 * Federal rounding — spec §22, decision D-ROUND-1.
 *
 * ===========================================================================
 * THE POLICY IS RULE DATA, NOT CODE (§22.3).
 *
 * Pub. 15-T's rounding guidance is PERMISSIVE, not mandatory — so the choice
 * DoPayCheck makes is a policy, it must be source-referenced, and it must be
 * disclosed to the user (§22.4). A policy hardcoded in TypeScript could be
 * neither versioned nor disclosed honestly, so it is resolved from
 * `FED.FIT.ROUNDING_POLICY` like any other rule.
 *
 * TAX-LEVEL ROUNDING. Intermediates carry full precision and are rounded once,
 * when a tax amount is finalised. Rounding every step compounds error;
 * rounding only at the very end loses the per-tax figures a payslip must show.
 * ===========================================================================
 */

export interface FederalRoundingPolicy {
  readonly policyId: string;
  readonly currencyScale: number;
  readonly currencyMode: RoundingMode;
  readonly intermediateScale: number;
  readonly appliedAt: 'TAX_LEVEL' | 'STEP_LEVEL';
}

const MODE_MAP: Record<RoundingPolicyDetail['currencyMode'], RoundingMode> = {
  HALF_UP: RoundingMode.HALF_UP,
  HALF_EVEN: RoundingMode.HALF_EVEN,
  DOWN: RoundingMode.DOWN,
  UP: RoundingMode.UP,
};

/** Resolves the rounding policy from rule data. No code default exists. */
export function resolveRoundingPolicy(
  ruleSet: ResolvedFederalRuleSet,
): Read<FederalRoundingPolicy> {
  const found = readDetail(ruleSet, FederalRuleKey.FIT_ROUNDING_POLICY);
  if (!found.ok) {
    return readFail(found.problem);
  }
  const detail = found.value.detail as RoundingPolicyDetail;

  return readOk({
    policyId: detail.policyId,
    currencyScale: detail.currencyScale,
    currencyMode: MODE_MAP[detail.currencyMode],
    intermediateScale: detail.intermediateScale,
    appliedAt: detail.appliedAt,
  });
}

/** Rounds a finalised tax amount. Called once per tax, never per intermediate. */
export function roundTax(value: Money, policy: FederalRoundingPolicy): Money {
  return round(value, policy.currencyScale, policy.currencyMode);
}

/** Rounds a worksheet intermediate to the policy's carrying precision. */
export function roundIntermediate(value: Money, policy: FederalRoundingPolicy): Money {
  return round(value, policy.intermediateScale, policy.currencyMode);
}

/** Disclosure text for §22.4 — the user is told which policy produced the figures. */
export function roundingDisclosure(policy: FederalRoundingPolicy): string {
  return (
    `Amounts are rounded to ${String(policy.currencyScale)} decimal places (${policy.currencyMode}), ` +
    `applied at the ${policy.appliedAt === 'TAX_LEVEL' ? 'tax' : 'step'} level. ` +
    'IRS Publication 15-T permits more than one rounding approach, so your employer may round ' +
    'slightly differently.'
  );
}

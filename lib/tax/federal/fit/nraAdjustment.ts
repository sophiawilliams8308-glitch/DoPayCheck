import type { Money } from '@/lib/core/money';

import { FederalReason, unavailable } from '../errors/federal-errors';
import { FederalRuleKey } from '../rule-keys';
import { readDetail, requireComponent, type Read, readFail, readOk } from '../rules/read-detail';
import type { ResolvedFederalRuleSet } from '../rules/resolved-rule-set';
import type { NraAdjustmentDetail } from '../rules/detail-schemas';
import type { FederalFeatureFlags } from '../flags';
import type { W4Revision } from '../types';

/**
 * Nonresident-alien wage adjustment (Phase 4, Track B).
 *
 * ===========================================================================
 * STRUCTURE MODELLED. BEHAVIOUR OFF BY DEFAULT.
 *
 * Pub. 15-T requires an additional amount to be added to an NRA employee's wages before the
 * rate schedule is applied, and the figure differs by pay frequency and W-4 revision. Those
 * figures are not verified, so `FEDERAL_NRA_ADJUSTMENT` defaults OFF and an NRA scenario is
 * reported UNSUPPORTED_SCENARIO.
 *
 * There is no approximation path. Withholding too little for a nonresident alien creates a
 * real liability for the employee, and guessing the adjustment would do exactly that.
 * ===========================================================================
 */

export interface NraAdjustment {
  readonly amount: Money;
  readonly ruleKey: string;
}

export function resolveNraAdjustment(
  ruleSet: ResolvedFederalRuleSet,
  payFrequency: string,
  revision: W4Revision,
  flags: FederalFeatureFlags,
): Read<NraAdjustment> {
  if (!flags.FEDERAL_NRA_ADJUSTMENT) {
    return readFail(
      unavailable(
        FederalReason.FEATURE_DISABLED,
        'Nonresident-alien withholding is not supported: the FEDERAL_NRA_ADJUSTMENT flag is ' +
          'off because the adjustment amounts are not yet verified. No approximation is applied.',
        FederalRuleKey.FIT_NRA_ADJUSTMENT,
      ),
    );
  }

  const found = readDetail(ruleSet, FederalRuleKey.FIT_NRA_ADJUSTMENT);
  if (!found.ok) {
    return readFail(found.problem);
  }
  const detail = found.value.detail as NraAdjustmentDetail;
  const ruleKey = found.value.ruleKey;

  const row = detail.amounts.find(
    (candidate) => candidate.payFrequency === payFrequency && candidate.w4Revision === revision,
  );

  if (row === undefined) {
    return readFail(
      unavailable(
        FederalReason.COMPONENT_NOT_STATED,
        `No NRA adjustment stated for ${payFrequency} with a ${revision} W-4`,
        ruleKey,
        `amounts[${payFrequency}/${revision}]`,
      ),
    );
  }

  const amount = requireComponent(row.amount, ruleKey, `amounts[${payFrequency}/${revision}]`);
  if (!amount.ok) {
    return readFail(amount.problem);
  }

  return readOk({ amount: amount.value, ruleKey });
}

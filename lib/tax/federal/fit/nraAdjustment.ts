import type { Money } from '@/lib/core/money';

import { FederalReason, unavailable } from '../errors/federal-errors';
import { FederalRuleKey } from '../rule-keys';
import { readDetail, requireComponent, type Read, readFail, readOk } from '../rules/read-detail';
import type { ResolvedFederalRuleSet } from '../rules/resolved-rule-set';
import type { AmountByPayPeriodDetail } from '../rules/detail-schemas';
import type { FederalFeatureFlags } from '../flags';
import { W4Revision, type W4RevisionValue } from '../types';

/**
 * Nonresident-alien wage addition — spec §7.8, decision D-FIT-3.
 *
 * ===========================================================================
 * STRUCTURE MODELLED. BEHAVIOUR FLAGGED OFF.
 *
 * Pub. 15-T requires an amount to be added to an NRA employee's wages before
 * the withholding tables are applied — Table 1 for 2019-or-earlier Forms W-4,
 * Table 2 for 2020-or-later. The addition does not affect Social Security,
 * Medicare or FUTA, is not reported on Form W-2, does not increase the
 * employee's liability, does not apply to supplemental wages taxed at the flat
 * rates, and does NOT apply to students and business apprentices from India.
 *
 * That India carve-out is unresolved, so `FEDERAL_NRA_ADJUSTMENT` is OFF and an
 * NRA scenario returns UNSUPPORTED_SCENARIO. A half-correct NRA path is worse
 * than an honest refusal: under-withholding here creates a real liability for
 * the employee.
 * ===========================================================================
 */

export interface NraAdjustment {
  readonly amount: Money;
  readonly ruleKey: string;
}

export function resolveNraAdjustment(
  ruleSet: ResolvedFederalRuleSet,
  payFrequency: string,
  revision: W4RevisionValue,
  flags: FederalFeatureFlags,
): Read<NraAdjustment> {
  const key =
    revision === W4Revision.PRE_2020
      ? FederalRuleKey.FIT_NRA_WAGE_ADDITION_PRE2020
      : FederalRuleKey.FIT_NRA_WAGE_ADDITION_POST2019;

  if (!flags.FEDERAL_NRA_ADJUSTMENT) {
    return readFail(
      unavailable(
        FederalReason.FEATURE_DISABLED,
        'Nonresident-alien withholding is not supported in Phase 4: FEDERAL_NRA_ADJUSTMENT is off ' +
          'because the India carve-out is unresolved. No approximation is applied.',
        key,
      ),
    );
  }

  const found = readDetail(ruleSet, key);
  if (!found.ok) {
    return readFail(found.problem);
  }
  const detail = found.value.detail as AmountByPayPeriodDetail;
  const row = detail.amounts.find((candidate) => candidate.payFrequency === payFrequency);

  if (row === undefined) {
    return readFail(
      unavailable(
        FederalReason.COMPONENT_NOT_STATED,
        `No NRA wage addition stated for ${payFrequency}`,
        key,
        `amounts[${payFrequency}]`,
      ),
    );
  }

  const amount = requireComponent(row.amount, key, `amounts[${payFrequency}]`);
  if (!amount.ok) {
    return readFail(amount.problem);
  }

  return readOk({ amount: amount.value, ruleKey: key });
}

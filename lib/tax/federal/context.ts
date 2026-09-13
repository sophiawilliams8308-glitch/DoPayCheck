import type { W4Input } from '@/lib/calculator/types/input';

import {
  FilingStatus,
  LEGACY_MARITAL_STATUS_MAP,
  type FederalScenario,
  type LegacyMaritalStatus,
} from './rule-keys';
import { W4Revision, asAnnual, asPerPeriod, type FederalW4, type FederalYtd } from './types';

/**
 * Adapter from the Phase 3 input contract to worksheet vocabulary — spec §7.7.
 *
 * ===========================================================================
 * ONE W-4 TYPE IN THE PROJECT (D-W4-1).
 *
 * Phase 3's `W4Input` remains the single input contract. This RENAMES its
 * fields for use inside the federal engine, so the withholding code reads like
 * the published form without a second, competing W-4 model drifting alongside
 * the first.
 * ===========================================================================
 *
 * Absent optional fields become `null`, not zero. What a blank line means is
 * the worksheet's decision (§5.3), not the adapter's.
 */

export function toFederalW4(w4: W4Input): FederalW4 {
  return {
    revision: w4.w4Revision === 'PRE_2020' ? W4Revision.PRE_2020 : W4Revision.REVISION_2020_PLUS,
    filingStatus: w4.filingStatus,
    step2MultipleJobsChecked: w4.multipleJobs ?? false,
    step3CreditsAnnual: w4.dependentsAmount === undefined ? null : asAnnual(w4.dependentsAmount),
    step4aOtherIncomeAnnual: w4.otherIncome === undefined ? null : asAnnual(w4.otherIncome),
    step4bDeductionsAnnual:
      w4.deductionsAmount === undefined ? null : asAnnual(w4.deductionsAmount),
    step4cExtraPerPeriod:
      w4.additionalWithholding === undefined ? null : asPerPeriod(w4.additionalWithholding),
    claimsExemption: w4.claimsExemption ?? false,
    isNonresidentAlien: w4.isNonresidentAlien ?? false,
    pre2020Allowances: w4.pre2020Allowances ?? null,
  };
}

/** Maps a 2019-or-earlier marital status to a canonical filing status (§8.2). */
export function mapLegacyMaritalStatus(status: LegacyMaritalStatus): FilingStatus {
  return LEGACY_MARITAL_STATUS_MAP[status];
}

/** W-4 validation that must fail before any calculation (§7.5, §8.4). */
export function validateFederalW4(w4: FederalW4): readonly { path: string; message: string }[] {
  const issues: { path: string; message: string }[] = [];

  // §8.4 — Pub. 15-T states the Head of Household table must not be used for a
  // 2019-or-earlier Form W-4. The status did not exist on that form.
  if (w4.revision === W4Revision.PRE_2020 && w4.filingStatus === FilingStatus.HEAD_OF_HOUSEHOLD) {
    issues.push({
      path: 'w4.filingStatus',
      message:
        'Head of Household is not valid on a 2019-or-earlier Form W-4; Pub. 15-T forbids using ' +
        'the Head of Household table for it',
    });
  }

  // §7.5 — fields for the wrong revision are rejected, never silently ignored.
  if (w4.revision === W4Revision.PRE_2020) {
    if (w4.step2MultipleJobsChecked) {
      issues.push({
        path: 'w4.multipleJobs',
        message: 'The Step 2 checkbox does not exist on a 2019-or-earlier Form W-4',
      });
    }
    if (w4.step3CreditsAnnual !== null || w4.step4aOtherIncomeAnnual !== null) {
      issues.push({
        path: 'w4.dependentsAmount',
        message: 'Steps 3 and 4(a) do not exist on a 2019-or-earlier Form W-4',
      });
    }
  } else if (w4.pre2020Allowances !== null) {
    issues.push({
      path: 'w4.pre2020Allowances',
      message: 'Allowances do not exist on a 2020-or-later Form W-4',
    });
  }

  return issues;
}

/** Derives the scenario that decides which rule keys must be resolved (§3.2). */
export function deriveScenario(
  w4: FederalW4,
  options: {
    readonly hasSupplementalWages: boolean;
    readonly nraFlagEnabled: boolean;
    readonly wantsAnnualEstimate: boolean;
    readonly wantsEmployerTaxes: boolean;
  },
): FederalScenario {
  return {
    wantsFitWithholding: true,
    claimsExemption: w4.claimsExemption,
    step2MultipleJobsChecked: w4.step2MultipleJobsChecked,
    isPre2020W4: w4.revision === W4Revision.PRE_2020,
    hasSupplementalWages: options.hasSupplementalWages,
    isNonresidentAlien: w4.isNonresidentAlien,
    nraFlagEnabled: options.nraFlagEnabled,
    wantsAnnualEstimate: options.wantsAnnualEstimate,
    wantsEmployerTaxes: options.wantsEmployerTaxes,
  };
}

/** YTD defaults to zero — permitted, but the assumption is disclosed (§16.2). */
export function federalYtdOrZero(partial?: Partial<Omit<FederalYtd, 'assumedZero'>>): FederalYtd {
  const supplied = partial ?? {};
  const anySupplied = Object.values(supplied).some((value) => value !== undefined);
  return {
    socialSecurityWages: supplied.socialSecurityWages ?? '0',
    medicareWages: supplied.medicareWages ?? '0',
    futaWages: supplied.futaWages ?? '0',
    supplementalWages: supplied.supplementalWages ?? '0',
    assumedZero: !anySupplied,
  };
}

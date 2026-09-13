import type { W4Input } from '@/lib/calculator/types/input';

import { W4Revision, type FederalW4 } from './types';
import type { FederalScenario } from './rule-keys';

/**
 * Adapter from the Phase 3 input contract to the federal engine's vocabulary (Phase 4).
 *
 * ===========================================================================
 * ONE W-4 TYPE IN THE PROJECT.
 *
 * Phase 3's `W4Input` remains the single input contract. This module RENAMES its fields to
 * IRS worksheet vocabulary for use inside the federal engine, so the withholding code reads
 * like the published form without a second, competing W-4 model drifting alongside the first.
 * ===========================================================================
 *
 * Absent optional fields become `null`, not zero. The worksheet decides what a blank line
 * means (there, a blank Step 4(a) is a stated "no other income"); the adapter does not.
 */

export function toFederalW4(w4: W4Input): FederalW4 {
  return {
    revision: w4.w4Revision === 'PRE_2020' ? W4Revision.PRE_2020 : W4Revision.REVISION_2020_PLUS,
    filingStatus: w4.filingStatus,
    step2MultipleJobsChecked: w4.multipleJobs ?? false,
    step3CreditsAnnual: w4.dependentsAmount ?? null,
    step4aOtherIncomeAnnual: w4.otherIncome ?? null,
    step4bDeductionsAnnual: w4.deductionsAmount ?? null,
    step4cExtraPerPeriod: w4.additionalWithholding ?? null,
    claimsExemption: w4.claimsExemption ?? false,
    isNonresidentAlien: w4.isNonresidentAlien ?? false,
    pre2020Allowances: w4.pre2020Allowances ?? null,
  };
}

/** Derives the scenario that decides which rule keys must be resolved. */
export function deriveScenario(
  w4: FederalW4,
  hasRegularWages: boolean,
  hasSupplementalWages: boolean,
  options: { readonly wantsAnnualEstimate: boolean; readonly wantsEmployerTaxes: boolean },
): FederalScenario {
  return {
    hasRegularWages,
    hasSupplementalWages,
    isNonresidentAlien: w4.isNonresidentAlien,
    isPre2020W4: w4.revision === W4Revision.PRE_2020,
    wantsAnnualEstimate: options.wantsAnnualEstimate,
    wantsEmployerTaxes: options.wantsEmployerTaxes,
  };
}

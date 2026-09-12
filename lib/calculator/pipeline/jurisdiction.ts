import type { EmployeeInput, LocationInput } from '../types/input';
import type { JurisdictionSummary } from '../types/result';

/**
 * Jurisdiction resolution foundation (pipeline stage 3; spec §9).
 *
 * ===========================================================================
 * PHASE 3 SCOPE: it resolves the jurisdiction CODES the caller supplied and nothing more.
 *
 * Full locality resolution — deriving a legal taxing jurisdiction from a ZIP code, work and
 * residence addresses, and walking the county/city/school-district hierarchy — is Phase 6.
 *
 * A ZIP code is accepted only as an input aid and is NEVER treated as the taxing authority
 * (spec §9). If a locality cannot be resolved, the result says so explicitly rather than
 * guessing at one.
 * ===========================================================================
 */

export const FEDERAL_JURISDICTION_CODE = 'US';

export interface JurisdictionResolution {
  readonly summary: JurisdictionSummary;
  /** Codes the caller supplied that this phase cannot resolve to a jurisdiction. */
  readonly unresolved: readonly string[];
}

function localCodes(location: LocationInput): string[] {
  return [location.countyCode, location.cityCode, location.localityCode].filter(
    (code): code is string => code !== undefined && code !== '',
  );
}

/**
 * Resolves the jurisdiction chain for a calculation.
 *
 * The federal jurisdiction always applies. State and local jurisdictions apply only when the
 * caller supplied codes for them — an absent state is reported as unresolved, never
 * defaulted.
 *
 * The WORK location determines the primary jurisdiction chain in this phase. Residence-based
 * taxation and reciprocity are rule-driven and belong to Phases 5–6.
 */
export function resolveJurisdiction(employee: EmployeeInput): JurisdictionResolution {
  const work = employee.workLocation;
  const stateCode = work.stateCode ?? null;
  const locals = localCodes(work);

  const unresolved: string[] = [];
  if (stateCode === null) {
    unresolved.push('workLocation.stateCode');
  }
  // A ZIP with no explicit locality cannot be turned into a jurisdiction in this phase.
  if (work.zipCode !== undefined && locals.length === 0) {
    unresolved.push('workLocation.zipCode');
  }

  return {
    summary: {
      federalCode: FEDERAL_JURISDICTION_CODE,
      stateCode,
      localCodes: locals,
      // Federal always resolves; the chain is "resolved" when nothing was left dangling.
      resolved: unresolved.length === 0,
    },
    unresolved,
  };
}

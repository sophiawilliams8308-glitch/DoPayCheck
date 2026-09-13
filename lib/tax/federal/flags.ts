/**
 * Federal engine feature flags (Phase 4).
 *
 * A flag exists where the STRUCTURE of a methodology is modelled but the authoritative
 * behaviour is not yet verified. Default OFF means the engine reports the scenario as
 * unsupported rather than approximating it.
 *
 * Flag values are recorded in the trace and the snapshot, so a historical result always says
 * which behaviours were active when it was produced.
 */

export interface FederalFeatureFlags {
  /**
   * Nonresident-alien additional-wage adjustment (Pub. 15-T).
   *
   * OFF: an NRA scenario returns UNSUPPORTED_SCENARIO. The adjustment table is jurisdiction
   * data that has not been verified, and approximating it would misstate withholding.
   */
  readonly FEDERAL_NRA_ADJUSTMENT: boolean;
  /**
   * Computational bridge between pre-2020 and 2020+ W-4 methodologies.
   *
   * OFF: the structure exists but is not applied. A-50 is PENDING_DATA.
   */
  readonly FEDERAL_COMPUTATIONAL_BRIDGE: boolean;
  /**
   * Optional flat-rate method for supplemental wages.
   *
   * OFF: OPTIONAL_FLAT is unavailable, because eligibility conditions and the flat rate are
   * authoritative data that has not been verified.
   */
  readonly FEDERAL_SUPPLEMENTAL_OPTIONAL_FLAT: boolean;
}

/** All flags OFF. The engine never enables an unverified methodology by default. */
export const DEFAULT_FEDERAL_FLAGS: FederalFeatureFlags = {
  FEDERAL_NRA_ADJUSTMENT: false,
  FEDERAL_COMPUTATIONAL_BRIDGE: false,
  FEDERAL_SUPPLEMENTAL_OPTIONAL_FLAT: false,
};

export function withFlags(overrides: Partial<FederalFeatureFlags>): FederalFeatureFlags {
  return { ...DEFAULT_FEDERAL_FLAGS, ...overrides };
}

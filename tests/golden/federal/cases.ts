import type { FederalCalculationContext } from '@/lib/tax/federal/types';

/**
 * Golden-case registry for the federal engine (Phase 4).
 *
 * ===========================================================================
 * THERE ARE NO OFFICIAL GOLDEN CASES YET, AND NONE WILL BE INVENTED.
 *
 * A golden test asserts an EXACT figure taken from an authoritative worked example — an IRS
 * Publication 15-T example, or a verified payroll reference. Making one up would create a
 * test that passes forever while proving nothing, and would encode a fabricated tax value in
 * the repository with the appearance of authority.
 *
 * `OFFICIAL_GOLDEN_CASES` is therefore empty. The runner skips rather than pretends.
 * ===========================================================================
 *
 * WHEN OFFICIAL EXAMPLES ARRIVE, they drop straight in: add entries here with the source
 * citation, and the existing runner exercises them. No architectural change is required,
 * because a case is just a context plus the expected amounts — which is exactly the shape a
 * published worked example has.
 */

export interface FederalGoldenCase {
  /** Short identifier, e.g. "pub15t-2026-worksheet1a-example-1". */
  readonly id: string;
  /** The authoritative document and location the expected values come from. */
  readonly source: {
    readonly organization: string;
    readonly document: string;
    readonly location: string;
    readonly url?: string;
  };
  /** Engine version this case was verified against. */
  readonly engineVersion: string;
  readonly context: FederalCalculationContext;
  readonly expected: {
    readonly withholdingTotal?: string;
    readonly socialSecurityEmployee?: string;
    readonly medicareEmployee?: string;
    readonly additionalMedicareEmployee?: string;
    readonly futaEmployer?: string;
  };
}

/**
 * Official worked examples. EMPTY — PENDING_DATA.
 *
 * Do not add a case unless every expected value is copied from the cited document.
 */
export const OFFICIAL_GOLDEN_CASES: readonly FederalGoldenCase[] = [];

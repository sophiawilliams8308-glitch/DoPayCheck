import type { StateTaxabilityProfileDetail } from './detailSchemas';
import { readDetail, readFail, readOk, type Read } from './read-detail';
import type { ResolvedStateRuleSet } from './stateRuleSet';
import { StateRuleKey } from '../ruleKeys';

/**
 * State taxability-profile reader.
 *
 * ===========================================================================
 * THIS IS THE READER ONLY. WAGE-BUCKET DERIVATION IS NOT IMPLEMENTED HERE.
 *
 * The task this module was built for asked for "state taxability / wage-
 * bucket derivation": given a `TAXABILITY_PROFILE` rule and the calculation
 * context's wages, compute the four independent state wage buckets
 * (`StateWageBuckets`: `stateIncomeTaxWages`, `sdiWages`, `pfmlWages`,
 * `sutaWages`), the way `deriveFederalWageBuckets()`
 * (`lib/tax/federal/wages/federalWageBuckets.ts`) does for federal.
 *
 * That derivation is NOT implemented, because the repository does not yet
 * provide enough information to do it without inventing a model:
 *
 *   1. `stateTaxabilityProfileDetailSchema` (`detailSchemas.ts`) profiles ONE
 *      `deductionTypeKey` per row — mirroring federal's
 *      `DeductionTaxabilityProfile` exactly, which is a free-form identifier
 *      (a specific employer plan's deduction type), not a small fixed set.
 *      A jurisdiction with more than one recognized deduction type would
 *      need more than one `TAXABILITY_PROFILE` row.
 *
 *   2. `StateRuleKey.TAXABILITY_PROFILE` is ONE canonical rule key, resolved
 *      like every other state rule: at most one ACTIVE row for one
 *      effective window. The database's own
 *      `TaxRule_no_overlapping_active_versions` EXCLUDE constraint (Phase 2
 *      migration `20260912151038`) is scoped to `ruleKey` ALONE, with no
 *      `deductionTypeKey` term — so the schema cannot represent more than
 *      one deduction type's profile per jurisdiction under today's resolver
 *      architecture. (Federal avoids this entirely: its
 *      `taxabilityProfiles: Record<string, DeductionTaxabilityProfile>` is
 *      supplied directly on `FederalCalculationContext`, never resolved
 *      through `FederalRuleKey`/`ResolvedFederalRuleSet` at all.)
 *
 *   3. `StateCalculationContext` (`lib/tax/state/context.ts`, Step 1,
 *      committed) has no deduction-line list to apply a profile against in
 *      the first place — only `wages: { regular, supplemental }`, two flat
 *      figures. There is nothing here to fold a `TAXABILITY_PROFILE` over.
 *
 * Building a "derive `StateWageBuckets`" function on top of a single
 * resolved profile and two flat wage figures would therefore either silently
 * assume there is exactly one deduction type (a business rule nobody
 * approved) or silently ignore the schema's own per-deduction-type design —
 * both are exactly the kind of invented model this project's rules forbid.
 * This is a genuine, disclosed contract gap; resolving it needs an explicit
 * project-owner decision, not a guess made here.
 *
 * WHAT IS SAFE, AND WHAT THIS MODULE PROVIDES: reading the ONE
 * `TAXABILITY_PROFILE` rule that IS resolvable today, validated and
 * verification-checked exactly like every other state rule, with its
 * tri-state flags returned exactly as the schema states them — no
 * transformation, no bucket computation, no assumption about how many
 * deduction types exist. This is useful and reusable the moment the contract
 * gap above is resolved, and invents nothing in the meantime.
 * ===========================================================================
 */

/**
 * Reads `STATE.TAXABILITY.PROFILE` from an already-resolved, already-frozen
 * `ResolvedStateRuleSet`.
 *
 * Returns `StateTaxabilityProfileDetail` (`detailSchemas.ts`) verbatim — a
 * 1:1 pass-through, since the schema needs no unit conversion or semantic
 * transformation to be calculation-ready. All existence, verification, and
 * schema-validity handling is delegated entirely to the existing
 * `readDetail()`.
 */
export function readTaxabilityProfile(
  ruleSet: ResolvedStateRuleSet,
): Read<StateTaxabilityProfileDetail> {
  const found = readDetail(ruleSet, StateRuleKey.TAXABILITY_PROFILE);
  if (!found.ok) {
    return readFail(found.problem);
  }

  return readOk(found.value.detail as StateTaxabilityProfileDetail);
}

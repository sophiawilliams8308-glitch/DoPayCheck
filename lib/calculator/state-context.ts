import {
  stateYtdAssumedZero,
  type StateCalculationContext,
  type StateElectionValue,
  type StateElections,
  type StateEmployerProfile,
} from '@/lib/tax/state/context';
import type { StateRuleKey } from '@/lib/tax/state/ruleKeys';
import type { ResidencyStatus } from '@/lib/tax/state/types';

import { toStateDeductions, type StateOptions } from './state-bridge';
import type { DeductionResult } from './pipeline/deductions';
import type {
  CalculationInput,
  StateElectionsInput,
  StateElectionValueInput,
  StateInput,
} from './types/input';

/**
 * State calculation context builder (Task 4I, implementing the Task 4G/4H
 * locked architecture).
 *
 * ===========================================================================
 * STRUCTURAL ASSEMBLY ONLY — NOT A CALCULATION.
 *
 * This function assembles an already-known `CalculationInput`, an
 * already-resolved `StateOptions` (rule set + optional taxability profiles),
 * and an already-computed `DeductionResult[]` into a `StateCalculationContext`.
 * It resolves no rules (`options.ruleSet` arrives pre-resolved from Steps
 * 3.3-3.7), calculates no tax, and derives no wage bucket
 * (`deriveStateWageBuckets()` is a separate, later stage). It never touches
 * Prisma, the filesystem, or the network.
 *
 * `grossRegular`/`grossSupplemental` are additional parameters beyond the
 * Task 4G-sketched `(input, options, deductionResults)` signature. This is a
 * disclosed, evidenced deviation, not a redesign: `CalculationInput` carries
 * no pre-computed gross wage figures (`calculateGrossPay()`/`annualize()` are
 * pipeline stages, not raw input), so there is no authoritative source for
 * `StateCalculationContext.wages` without them. The two parameters mirror
 * `runFederalEngine(input, grossRegular, grossSupplemental, ...)` in
 * `federal-bridge.ts` exactly — the same gap, solved the same already-
 * established way, for the same reason.
 * ===========================================================================
 *
 * ===========================================================================
 * WHAT THIS FUNCTION REFUSES TO GUESS
 *
 * - `residencyStatus`: `ResidencyStatus`'s own doc comment states it is
 *   "Stated by the caller, never inferred by comparing two jurisdiction
 *   codes." A missing `input.state.residencyStatus` throws rather than
 *   defaulting — there is no value to invent.
 * - The residence jurisdiction, when it cannot be resolved from either
 *   `input.state.residenceState` or the work-jurisdiction fallback
 *   (`input.state.workState` / `input.employee.workLocation.stateCode`).
 *   `StateCalculationContext.residenceJurisdictionCode` is a required,
 *   non-nullable `string` with no "absent" representation, unlike
 *   `workJurisdictions`, which can honestly be `[]` — a state
 *   `validateStateContext()` already detects and reports.
 * - `residenceRuleSet` when the residence jurisdiction differs from
 *   `options.ruleSet.jurisdictionCode` (the jurisdiction the ONE supplied
 *   rule set was actually resolved for). `StateOptions` (Task 4G) carries
 *   exactly one resolved rule set; representing a distinct residence
 *   jurisdiction would need a second one that nothing in this contract
 *   supplies. This is a genuine, unresolved architecture gap (see the
 *   Task 4I report), not something this function may invent a value for.
 *
 * Two further fields have no source at all, but are operational processing
 * flags rather than tax data, so — mirroring `FederalOptions`' own
 * established convention of `?? true` / `?? false` defaults for the
 * identical kind of flag — they are defaulted rather than thrown on:
 *
 * - `reciprocityCertificateFiled` defaults to `false` when absent (an
 *   unchecked box is ordinarily "not filed", not "unknown").
 * - `includeEmployerTaxes` is hardcoded `true`: `StateOptions` carries no
 *   equivalent field at all (deliberately not added here — Task 4I does not
 *   redesign `StateOptions`), so there is nothing to read a caller's
 *   preference from yet. Disclosed in the Task 4I report as a known, narrow
 *   simplification, not a tax-rule invention.
 * ===========================================================================
 */

const SOLE_WORK_JURISDICTION_ALLOCATION = '1';

function mapElectionValue(value: StateElectionValueInput): StateElectionValue {
  return {
    fieldKey: value.fieldKey,
    value: value.value,
    ...(value.unit !== undefined ? { unit: value.unit } : {}),
  };
}

function mapElections(
  elections: Readonly<Record<string, StateElectionsInput>> | undefined,
): Readonly<Record<string, StateElections>> {
  if (elections === undefined) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(elections).map(([jurisdictionCode, election]) => {
      const mapped: StateElections = {
        formCode: election.formCode,
        filingStatus: election.filingStatus ?? null,
        values: (election.values ?? []).map(mapElectionValue),
      };
      return [jurisdictionCode, mapped] as const;
    }),
  );
}

/**
 * Maps `StateInput.allowanceCounts`'s free-string keys onto
 * `StateCalculationContext.allowanceCounts`'s `StateRuleKey`-keyed shape
 * (Task 4O-6R16).
 *
 * A pure passthrough of keys and values, exactly as `mapElections()` never
 * validates `formCode`/`fieldKey` against a known registry: this function
 * does not check that a supplied key is actually a member of `StateRuleKey`
 * (no `isStateRuleKey()` call), and does not drop or reject an unrecognized
 * key. Validating a `StateRuleKey`'s existence is `readDetail()`'s and
 * `VALID_RULE_KEYS`'s job, at the point a future `SUBTRACT_ALLOWANCES`
 * handler actually resolves one — duplicating that check here would be a
 * second, independent membership check drifting out of sync with the first.
 * The cast to `Partial<Record<StateRuleKey, number>>` documents the
 * project's own intended key semantics; it does not itself enforce them.
 */
function mapAllowanceCounts(
  allowanceCounts: Readonly<Record<string, number>> | undefined,
): Readonly<Partial<Record<StateRuleKey, number>>> {
  if (allowanceCounts === undefined) {
    return {};
  }
  return allowanceCounts as Readonly<Partial<Record<StateRuleKey, number>>>;
}

function mapEmployer(state: StateInput | undefined): StateEmployerProfile {
  return {
    ...(state?.employerEmployeeCount !== undefined
      ? { employeeCount: state.employerEmployeeCount }
      : {}),
    ...(state?.employerSutaRate !== undefined ? { sutaRate: state.employerSutaRate } : {}),
    ...(state?.employerPlanElection !== undefined
      ? { privatePlanElected: state.employerPlanElection }
      : {}),
  };
}

/**
 * Assembles a `StateCalculationContext` from already-known, already-computed
 * inputs. Pure, synchronous, side-effect free — see the module doc comment
 * for the exact fields this function refuses to default, and why.
 *
 * @param deductionResults The already-computed PRE-TAX deduction results for
 *   this period (`preTaxResult.items`) — the same scope `toFederalDeductions()`
 *   already uses. This function does not call `calculateDeductions()`.
 * @throws {Error} when `input.state.residencyStatus` is absent, when no
 *   residence jurisdiction can be resolved at all, or when the resolved
 *   residence jurisdiction differs from `options.ruleSet.jurisdictionCode`
 *   (a second resolved rule set that `StateOptions` does not carry).
 */
export function buildStateCalculationContext(
  input: CalculationInput,
  grossRegular: string,
  grossSupplemental: string,
  deductionResults: readonly DeductionResult[],
  options: StateOptions,
): StateCalculationContext {
  const workJurisdictionCode = input.state?.workState ?? input.employee.workLocation.stateCode;
  const residenceJurisdictionCode = input.state?.residenceState ?? workJurisdictionCode;

  if (residenceJurisdictionCode === undefined) {
    throw new Error(
      'buildStateCalculationContext: no residence jurisdiction is available — neither ' +
        'input.state.residenceState, input.state.workState, nor ' +
        'input.employee.workLocation.stateCode was supplied. This is never inferred.',
    );
  }

  const residencyStatus: ResidencyStatus | undefined = input.state?.residencyStatus;
  if (residencyStatus === undefined) {
    throw new Error(
      'buildStateCalculationContext: input.state.residencyStatus is required and is never ' +
        'inferred by comparing jurisdiction codes.',
    );
  }

  if (residenceJurisdictionCode !== options.ruleSet.jurisdictionCode) {
    throw new Error(
      'buildStateCalculationContext: residence jurisdiction ' +
        `(${residenceJurisdictionCode}) differs from the jurisdiction options.ruleSet was ` +
        `resolved for (${options.ruleSet.jurisdictionCode}), which would require a second ` +
        'resolved state rule set. StateOptions (Task 4G) carries exactly one — this is an ' +
        'unresolved architecture gap, not a value this function may invent.',
    );
  }

  return {
    taxYear: input.taxYear,
    effectiveDate: input.effectiveDate.toISOString(),
    payFrequency: input.pay.payFrequency,

    workJurisdictions:
      workJurisdictionCode === undefined
        ? []
        : [
            {
              jurisdictionCode: workJurisdictionCode,
              allocation: SOLE_WORK_JURISDICTION_ALLOCATION,
            },
          ],
    residenceJurisdictionCode,
    residencyStatus,

    wages: {
      regular: grossRegular,
      supplemental: grossSupplemental,
    },

    deductions: toStateDeductions(deductionResults),
    taxabilityProfiles: options.taxabilityProfiles ?? {},

    ytd: stateYtdAssumedZero(),

    workRuleSet: options.ruleSet,
    // Guaranteed null: any mismatch against options.ruleSet.jurisdictionCode threw above.
    residenceRuleSet: null,

    elections: mapElections(input.state?.stateElections),
    allowanceCounts: mapAllowanceCounts(input.state?.allowanceCounts),
    employer: mapEmployer(input.state),
    reciprocityCertificateFiled: input.state?.reciprocityCertificateFiled ?? false,
    includeEmployerTaxes: true,
  };
}

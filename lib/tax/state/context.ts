import type { StateTaxabilityProfileDetail } from './rules/detailSchemas';
import type { ResolvedStateRuleSet } from './rules/stateRuleSet';
import type { StateRuleKey } from './ruleKeys';
import {
  SUPPORTED_WORK_JURISDICTION_COUNT,
  type DecimalString,
  type ResidencyStatus,
  type StateDeductionLine,
  type StateWorkJurisdiction,
  type StateYtd,
} from './types';

/**
 * State calculation context — Phase 5 Step 1.
 *
 * Everything a future pure Stage B needs, and nothing it could reach for
 * itself: no database handle, no clock, no environment. The resolved rule sets
 * arrive already frozen.
 */

/** What the employee elected on this jurisdiction's withholding certificate. */
export interface StateElectionValue {
  /** The field key declared by the jurisdiction's ELECTION_FORM_SCHEMA. */
  readonly fieldKey: string;
  /** Exact decimal string, count, or boolean — as the form states it. */
  readonly value: DecimalString | number | boolean;
  /**
   * MANDATORY for an amount, absent for anything else.
   *
   * Never defaulted. A missing unit on an amount is an input error, not an
   * invitation to assume the commoner of the two.
   */
  readonly unit?: 'ANNUAL' | 'PER_PERIOD';
}

/** One jurisdiction's elections, keyed by field. */
export interface StateElections {
  readonly formCode: string;
  readonly filingStatus: string | null;
  readonly values: readonly StateElectionValue[];
}

/** Employer facts that change an employer-side rate or a programme's applicability. */
export interface StateEmployerProfile {
  /** Drives employer-size thresholds in a PROGRAM_DESCRIPTOR. */
  readonly employeeCount?: number;
  /** The employer's experience-rated SUTA rate, which is employer-specific data. */
  readonly sutaRate?: DecimalString;
  /** True when an approved private plan substitutes for a state programme. */
  readonly privatePlanElected?: boolean;
}

export interface StateCalculationContext {
  readonly taxYear: number;
  /** ISO instant, supplied by the caller. The engine never reads a clock. */
  readonly effectiveDate: string;
  readonly payFrequency: string;

  /**
   * Work jurisdictions, as a weighted list of length 1 (D5-04).
   *
   * See `validateStateContext` — a second entry is UNSUPPORTED_SCENARIO, never
   * silently dropped and never averaged.
   */
  readonly workJurisdictions: readonly StateWorkJurisdiction[];
  readonly residenceJurisdictionCode: string;
  readonly residencyStatus: ResidencyStatus;

  readonly wages: {
    readonly regular: DecimalString;
    readonly supplemental: DecimalString;
  };

  /**
   * Pre-tax deduction/benefit lines for this pay period — Task 4B, Option A.
   *
   * Required, not optional; an empty array is the valid representation of
   * "no deductions this period", not an omission.
   */
  readonly deductions: readonly StateDeductionLine[];
  /**
   * One taxability profile per distinct `deductionTypeKey` present in
   * `deductions`, keyed by that same string.
   *
   * Supplied directly by whatever builds this context — NOT resolved via
   * `StateRuleKey.TAXABILITY_PROFILE`/the candidate-retrieval/resolution/
   * assembly pipeline, which remains unchanged and resolves at most one
   * `TAXABILITY_PROFILE` row per jurisdiction. Where these values actually
   * come from at runtime is intentionally not decided by this field: see
   * the Task 4B contract-lock report.
   */
  readonly taxabilityProfiles: Readonly<Record<string, StateTaxabilityProfileDetail>>;

  /** YTD EXCLUDING the current pay period. */
  readonly ytd: StateYtd;

  /** Frozen rule sets, one per jurisdiction this calculation touches. */
  readonly workRuleSet: ResolvedStateRuleSet;
  /** `null` when residence and work are the same jurisdiction. */
  readonly residenceRuleSet: ResolvedStateRuleSet | null;

  readonly elections: Readonly<Record<string, StateElections>>;
  /**
   * Allowance counts for `SUBTRACT_ALLOWANCES` — Task 4O-6R14/4O-6R15/4O-6R16.
   *
   * Keyed by the exact `StateRuleKey` a `WITHHOLDING_FORMULA` step's
   * `operandRef` names (the rule whose `AMOUNT_PER_ALLOWANCE` detail the
   * count belongs to) — never by `allowanceType`, and never a single
   * formula-wide scalar (Task 4O-6R15 §6 locked this matching invariant).
   * State-native only: never derived from `federal.w4.pre2020Allowances`,
   * filing status, dependents, or exemptions. Required, not optional — an
   * empty object is the valid representation of "no allowance counts were
   * supplied," matching this context's existing convention for
   * `taxabilityProfiles`/`deductions`. A key absent from this map is
   * indistinguishable, to a future consumer, from an explicit "not stated"
   * — both are surfaced as `COMPONENT_NOT_STATED` at the point a
   * `SUBTRACT_ALLOWANCES` step actually needs the value (not implemented
   * yet; this field is infrastructure only).
   */
  readonly allowanceCounts: Readonly<Partial<Record<StateRuleKey, number>>>;
  readonly employer: StateEmployerProfile;
  /** True when the employee has filed the certificate a reciprocity agreement requires. */
  readonly reciprocityCertificateFiled: boolean;
  readonly includeEmployerTaxes: boolean;
}

export interface StateContextIssue {
  readonly path: string;
  readonly message: string;
  /** UNSUPPORTED_SCENARIO for a modelled-but-unsupported case; INPUT_INVALID for a defect. */
  readonly kind: 'UNSUPPORTED_SCENARIO' | 'INPUT_INVALID';
}

/**
 * Structural validation that must pass before any state calculation.
 *
 * Returns issues rather than throwing — an unsupported scenario is an ordinary
 * answer here, not an exception.
 */
export function validateStateContext(
  context: StateCalculationContext,
): readonly StateContextIssue[] {
  const issues: StateContextIssue[] = [];

  if (context.workJurisdictions.length === 0) {
    issues.push({
      path: 'workJurisdictions',
      message: 'At least one work jurisdiction is required',
      kind: 'INPUT_INVALID',
    });
  }

  // D5-04 — the shape admits allocation; this engine does not perform it.
  if (context.workJurisdictions.length > SUPPORTED_WORK_JURISDICTION_COUNT) {
    issues.push({
      path: 'workJurisdictions',
      message:
        `Multi-state allocation is not supported: ${String(context.workJurisdictions.length)} ` +
        'work jurisdictions were supplied and exactly one is supported',
      kind: 'UNSUPPORTED_SCENARIO',
    });
  }

  const work = context.workJurisdictions[0];
  if (work !== undefined && work.jurisdictionCode !== context.workRuleSet.jurisdictionCode) {
    issues.push({
      path: 'workRuleSet',
      message:
        'The work rule set was resolved for a different jurisdiction than the work jurisdiction',
      kind: 'INPUT_INVALID',
    });
  }

  if (
    context.residenceRuleSet !== null &&
    context.residenceRuleSet.jurisdictionCode !== context.residenceJurisdictionCode
  ) {
    issues.push({
      path: 'residenceRuleSet',
      message:
        'The residence rule set was resolved for a different jurisdiction than the residence ' +
        'jurisdiction',
      kind: 'INPUT_INVALID',
    });
  }

  // Cross-year mixing is never permitted, in either direction.
  if (context.workRuleSet.taxYear !== context.taxYear) {
    issues.push({
      path: 'workRuleSet.taxYear',
      message: 'The work rule set was resolved for a different tax year than the calculation',
      kind: 'INPUT_INVALID',
    });
  }

  for (const election of Object.values(context.elections)) {
    for (const value of election.values) {
      if (typeof value.value === 'string' && value.unit === undefined) {
        issues.push({
          path: `elections.${election.formCode}.${value.fieldKey}.unit`,
          message: 'An amount election must declare its unit as ANNUAL or PER_PERIOD',
          kind: 'INPUT_INVALID',
        });
      }
    }
  }

  return issues;
}

/** The single work jurisdiction, or `null` when the scenario is unsupported. */
export function soleWorkJurisdiction(
  context: StateCalculationContext,
): StateWorkJurisdiction | null {
  if (context.workJurisdictions.length !== SUPPORTED_WORK_JURISDICTION_COUNT) {
    return null;
  }
  return context.workJurisdictions[0] ?? null;
}

/** YTD with every figure zero, flagged as assumed. Zero is DISCLOSED, never silent. */
export function stateYtdAssumedZero(): StateYtd {
  return {
    stateIncomeTaxWages: '0',
    stateIncomeTaxWithheld: '0',
    sdiWages: '0',
    sdiContributions: '0',
    pfmlWages: '0',
    pfmlContributions: '0',
    sutaWages: '0',
    assumedZero: true,
  };
}

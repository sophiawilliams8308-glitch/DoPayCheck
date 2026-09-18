import { StateCapability } from './coverage/capabilities';
import type { StateCalculationContext } from './context';
import type { ResidencyStatus } from './types';

/**
 * Resolver input projection — Phase 5 Step 3.1, spec §3.
 *
 * ===========================================================================
 * THE RESOLVER CANNOT SEE MONEY.
 *
 * `StateCalculationContext` carries wages, YTD figures and deduction amounts
 * because the CALCULATION needs them. Rule RESOLUTION must not: which rule
 * governs a paycheck is a question about jurisdiction, dates and scenario, and
 * a resolver able to read an amount is a resolver that could one day pick a
 * rule because of it.
 *
 * So the exclusion is STRUCTURAL rather than a convention. The projected type
 * has no field an amount could occupy, and a guard test asserts it stays that
 * way. `StateCalculationContext` itself is untouched (§3, D-W4-1 discipline).
 * ===========================================================================
 *
 * PURE AND TOTAL. No clock, no environment, no randomness, no I/O; defined for
 * every input and throws for none.
 */

/**
 * The capability vocabulary, aliased — NOT redefined.
 *
 * The specification calls this `CapabilityCode`; the repository already owns
 * the same 13 members as `StateCapability` (Step 2). An alias keeps the
 * specification's name readable at the call site while leaving exactly one
 * definition of the vocabulary in the codebase.
 */
export type CapabilityCode = StateCapability;

export const CapabilityCode = StateCapability;

/** Wage vocabulary, exactly the six members §3.4 names. Nothing added. */
export const WageType = {
  REGULAR: 'REGULAR',
  BONUS: 'BONUS',
  COMMISSION: 'COMMISSION',
  TIPS: 'TIPS',
  OVERTIME: 'OVERTIME',
  OTHER: 'OTHER',
} as const;

export type WageType = (typeof WageType)[keyof typeof WageType];

export const ALL_WAGE_TYPES: readonly WageType[] = Object.values(WageType);

/**
 * What the caller is asking the resolver for — §3.4.
 *
 * The two sets are `ReadonlySet` rather than `Set`: the runtime value is a
 * `Set` exactly as §3.4 writes it, and the narrowing exists only so a consumer
 * cannot mutate a projection it was handed.
 */
export interface StateResolutionScenario {
  /**
   * DEFERRED SPECIFICATION DECISION — §3.3 does not state how this is derived.
   *
   * Emitted EMPTY. An empty set here means "the derivation is not specified
   * yet", NOT "no capability is requested" — the same distinction the project
   * draws between NOT_STATED and a stated zero. A consumer must therefore treat
   * an empty set as undetermined and refuse, never as a licence to resolve
   * nothing. Populating it with all 13, or with a guess keyed off
   * `includeEmployerTaxes`, would be inventing the rule §3.3 omits.
   */
  readonly capabilitiesRequested: ReadonlySet<CapabilityCode>;
  /**
   * DEFERRED SPECIFICATION DECISION — §3.3 does not state how this is derived.
   *
   * Emitted EMPTY, and structurally underivable today besides: §3.4 names six
   * wage types while `StateCalculationContext.wages` exposes two aggregates,
   * `regular` and `supplemental`. Nothing distinguishes a bonus from a
   * commission from tips inside `supplemental`, so mapping it to any member —
   * including OTHER — would assert a classification the input never made.
   */
  readonly wageTypesPresent: ReadonlySet<WageType>;
  /** Directly available: `StateCalculationContext.includeEmployerTaxes`. */
  readonly employerSideRequested: boolean;
}

/** The resolver's entire view of a calculation — §3.2. Exactly eight fields. */
export interface StateRuleResolutionContext {
  readonly taxYear: number;
  /** ISO instant, carried verbatim. Phase 2 owns every effective-window decision. */
  readonly calculationDate: string;
  /**
   * `null` when no work jurisdiction was supplied.
   *
   * DEFERRED SPECIFICATION DECISION — §3.3 does not state the behaviour for an
   * empty `workJurisdictions`. `null` is the smallest total representation: it
   * keeps the projection defined for every input without asserting a default
   * jurisdiction, which would be the one error a state resolver must never make.
   */
  readonly workJurisdiction: string | null;
  readonly residenceJurisdiction: string;
  readonly residencyStatus: ResidencyStatus;
  /**
   * `null` when the work jurisdiction has no election, or its election states
   * no filing status.
   *
   * DEFERRED SPECIFICATION DECISION — §3.3 does not state the behaviour for a
   * missing election. `null` is not invented: `StateElections.filingStatus` is
   * already `string | null` in Step 1, so absence is representable upstream.
   */
  readonly stateFilingStatus: string | null;
  readonly payFrequency: string;
  readonly scenario: StateResolutionScenario;
}

/**
 * Projects the calculation context onto the resolver's view — §3.
 *
 * PURE: reads only its argument. TOTAL: returns for every input, throws for
 * none. It copies what §3.2 names and drops everything else; the dropped
 * fields have nowhere to land in the return type, so this is a narrowing the
 * type system enforces rather than a discipline reviewers must remember.
 *
 * Where §3.3 leaves a derivation unspecified the projection emits the empty or
 * absent case and says so above, rather than guessing a rule.
 */
export function projectResolutionContext(
  calcContext: StateCalculationContext,
): StateRuleResolutionContext {
  const work = calcContext.workJurisdictions[0];
  const workJurisdiction = work === undefined ? null : work.jurisdictionCode;
  const election = workJurisdiction === null ? undefined : calcContext.elections[workJurisdiction];

  return Object.freeze({
    taxYear: calcContext.taxYear,
    calculationDate: calcContext.effectiveDate,
    workJurisdiction,
    residenceJurisdiction: calcContext.residenceJurisdictionCode,
    residencyStatus: calcContext.residencyStatus,
    stateFilingStatus: election?.filingStatus ?? null,
    payFrequency: calcContext.payFrequency,
    scenario: Object.freeze({
      // Both sets: see the DEFERRED notes on StateResolutionScenario.
      capabilitiesRequested: new Set<CapabilityCode>(),
      wageTypesPresent: new Set<WageType>(),
      employerSideRequested: calcContext.includeEmployerTaxes,
    }),
  });
}

/** The eight top-level fields §3.2 defines, for contract assertions. */
export const RESOLUTION_CONTEXT_FIELDS: readonly (keyof StateRuleResolutionContext)[] = [
  'taxYear',
  'calculationDate',
  'workJurisdiction',
  'residenceJurisdiction',
  'residencyStatus',
  'stateFilingStatus',
  'payFrequency',
  'scenario',
];

/** The three scenario fields §3.4 defines. */
export const RESOLUTION_SCENARIO_FIELDS: readonly (keyof StateResolutionScenario)[] = [
  'capabilitiesRequested',
  'wageTypesPresent',
  'employerSideRequested',
];

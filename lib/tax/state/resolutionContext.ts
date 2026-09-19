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
   * The caller's explicit declaration of which state capability areas this
   * resolution operation is asking about — Amendment 3 (§3.4.1).
   *
   * SOURCED FROM THE CALLER, NEVER DERIVED. `projectResolutionContext` takes
   * this set as an explicit argument and carries it through verbatim. It is
   * resolution INTENT, not a fact inferred from wages, `wageTypesPresent`,
   * jurisdictions, filing status, pay frequency, residency status,
   * `employerSideRequested`, or any other field — and not "every capability
   * this jurisdiction supports". Deriving it from any of those would assert a
   * classification the caller never made, exactly as `wageTypesPresent`'s own
   * deferred derivation below must not be guessed.
   *
   * An empty set is still a well-typed INPUT to the projection — Step 3.2's
   * `validateResolutionContext` is what rejects it as INVALID_CONTEXT, not
   * this type or the projection.
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
 * PURE: reads only its two arguments. TOTAL: returns for every input, throws
 * for none. It copies what §3.2 names, drops everything else, and carries
 * `capabilitiesRequested` through from the caller-supplied argument verbatim
 * (Amendment 3, §3.4.1) — the projection never constructs a production
 * capability set of its own, and there is no default/fallback for an omitted
 * one because the parameter is required. The dropped `StateCalculationContext`
 * fields have nowhere to land in the return type, so this is a narrowing the
 * type system enforces rather than a discipline reviewers must remember.
 *
 * `capabilitiesRequested` is copied into a NEW `Set` rather than the caller's
 * own reference: the caller's set is never mutated, and nothing reached
 * through the returned context can mutate it either.
 *
 * Where §3.3 leaves a derivation unspecified (`wageTypesPresent`) the
 * projection still emits the empty case and says so on the type, rather than
 * guessing a rule.
 */
export function projectResolutionContext(
  calcContext: StateCalculationContext,
  capabilitiesRequested: ReadonlySet<CapabilityCode>,
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
      // Defensive copy of the caller's set — see the doc comment above.
      capabilitiesRequested: new Set<CapabilityCode>(capabilitiesRequested),
      // DEFERRED — see the doc comment on StateResolutionScenario.wageTypesPresent.
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

// =============================================================================
// STEP 3.2 — CONTEXT VALIDATION ONLY.
// =============================================================================
//
// Validates the STRUCTURE of a `StateRuleResolutionContext`: is it well-formed
// enough to even attempt resolution? It does NOT decide whether resolution can
// SUCCEED — that needs a required-key list, and building one needs a
// capability -> rule-key mapping, which is F-02 and remains deferred past this
// step. Nothing here constructs a rule key, references `StateRuleKey`, or
// asks what a capability requires.
//
// ZERO QUERIES, BY CONSTRUCTION. This module imports no database client and
// the validator below is synchronous — there is no `await` point at which a
// query could occur, so an invalid context is rejected before Stage A would
// ever run, with no provider call of any kind.

/** Why a context failed structural validation. Nothing else is producible here. */
export const ResolutionContextOutcome = {
  INVALID_CONTEXT: 'INVALID_CONTEXT',
} as const;

export type ResolutionContextOutcome =
  (typeof ResolutionContextOutcome)[keyof typeof ResolutionContextOutcome];

/**
 * One structural defect, in `StateContextIssue`'s shape (Step 1, `context.ts`).
 *
 * Returned, never thrown: an invalid context is an ordinary answer here, not
 * an exception — the same discipline `validateStateContext` already keeps.
 */
export interface ResolutionContextIssue {
  readonly path: string;
  readonly message: string;
  readonly reason: typeof ResolutionContextOutcome.INVALID_CONTEXT;
}

const ISO_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

/**
 * True for `null`/`undefined`, empty, or whitespace-only.
 *
 * Accepts `unknown` deliberately: `residenceJurisdiction` is typed `string`
 * and can never be `null` from a well-typed caller, but the runtime check
 * exists precisely FOR a caller that crosses the type boundary (`any`, a
 * deserialized payload). Such a value must be reported as INVALID_CONTEXT,
 * never thrown from inside a blank check.
 */
function isBlank(value: unknown): boolean {
  return typeof value !== 'string' || value.trim().length === 0;
}

/**
 * Structural validation for a projected resolver context — Step 3.2, rows 1-5.
 *
 * PURE, TOTAL, SYNCHRONOUS. Reads only its argument, returns for every input,
 * throws for none, and awaits nothing — so nothing downstream of it can have
 * been queried by the time it returns.
 *
 * Deliberately NARROW. Five checks only:
 *   1. taxYear is a plausible integer
 *   2. calculationDate is a well-formed instant, and names the same year
 *   3. workJurisdiction is null or a non-blank string (both are VALID)
 *   4. residenceJurisdiction is a non-blank string (required)
 *   5. every requested capability is one of Step 2's 13, and the set is non-empty
 *
 * Row 6 — whether the REQUESTED capabilities can be resolved with what the
 * context provides — is `MISSING_REQUIRED_CONTEXT`, and it is F-02: deferred.
 * There is no code path here that could produce it; the symbol does not even
 * appear in this file, which a guard test asserts directly.
 *
 * JURISDICTION VALIDATION IS STRUCTURAL ONLY (Amendment 2 / F-5). Neither
 * jurisdiction field is checked against a list, a format, a length, or a case
 * convention — only blank vs non-blank. An unrecognized but well-formed
 * jurisdiction code passes. Recognizing one at all needs a query, and rows
 * 1-5 must return their answer before any query is permitted.
 */
export function validateResolutionContext(
  context: StateRuleResolutionContext,
): readonly ResolutionContextIssue[] {
  const issues: ResolutionContextIssue[] = [];
  const issue = (path: string, message: string): void => {
    issues.push({ path, message, reason: ResolutionContextOutcome.INVALID_CONTEXT });
  };

  // ---- 1. taxYear ------------------------------------------------------------
  // Bound reused verbatim from the Phase 3 input schema (`calculationInputSchema`),
  // the repository's own existing tax-year policy — not a new, more restrictive one.
  if (!Number.isInteger(context.taxYear) || context.taxYear < 1900 || context.taxYear > 2200) {
    issue('taxYear', 'taxYear must be a plausible calendar year');
  }

  // ---- 2. calculationDate -----------------------------------------------------
  // Format: the same ISO 8601 instant shape `isoDate` already enforces elsewhere
  // in the repo (lib/rules/validation.ts) — reused, not reinvented.
  if (!ISO_DATETIME.test(context.calculationDate)) {
    issue('calculationDate', 'calculationDate must be a valid ISO 8601 instant');
  } else {
    // Consistency with taxYear: the ISO string's OWN leading year digits,
    // compared as text. No `Date` object, no calendar arithmetic, no timezone
    // conversion — the one mechanism that adds no timezone semantics beyond
    // what Step 3.1 already carries (an opaque ISO string, read verbatim).
    const statedYear = Number(context.calculationDate.slice(0, 4));
    if (statedYear !== context.taxYear) {
      issue(
        'calculationDate',
        `calculationDate's year (${context.calculationDate.slice(0, 4)}) does not match ` +
          `taxYear (${String(context.taxYear)})`,
      );
    }
  }

  // ---- 3. workJurisdiction -----------------------------------------------------
  // `null` is VALID — it means no work jurisdiction was supplied, not a defect.
  // Never substituted with residenceJurisdiction or any other value.
  if (context.workJurisdiction !== null && isBlank(context.workJurisdiction)) {
    issue('workJurisdiction', 'workJurisdiction must not be blank when supplied');
  }

  // ---- 4. residenceJurisdiction -------------------------------------------------
  // Required. Runtime-checked despite the `string` type, matching the project's
  // standing practice of validating at the boundary rather than trusting a type
  // a caller outside the type system could still violate.
  if (isBlank(context.residenceJurisdiction)) {
    issue('residenceJurisdiction', 'residenceJurisdiction is required and must not be blank');
  }

  // ---- 5. scenario.capabilitiesRequested ----------------------------------------
  // Reuses Step 2's existing 13-member vocabulary via `isStateCapability` —
  // no second list, no redefinition.
  const { capabilitiesRequested } = context.scenario;
  if (capabilitiesRequested.size === 0) {
    issue('scenario.capabilitiesRequested', 'At least one capability must be requested');
  }
  for (const capability of capabilitiesRequested) {
    if (!isStateCapabilityMember(capability)) {
      issue(
        'scenario.capabilitiesRequested',
        `${String(capability)} is not one of Step 2's 13 declared capabilities`,
      );
    }
  }

  return issues;
}

/** Local alias, so this file needs no separate import of the type guard's name. */
function isStateCapabilityMember(value: string): value is CapabilityCode {
  return (Object.values(StateCapability) as readonly string[]).includes(value);
}

/** True when the context has no structural defect. The gate Step 3.3+ would consult. */
export function isValidResolutionContext(context: StateRuleResolutionContext): boolean {
  return validateResolutionContext(context).length === 0;
}

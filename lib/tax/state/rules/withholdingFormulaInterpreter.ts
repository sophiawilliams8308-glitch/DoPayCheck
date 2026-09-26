import {
  add,
  compare,
  divideHighPrecision,
  max,
  money,
  multiply,
  subtract,
  sum,
  zero,
  type Money,
} from '@/lib/core/money';

import type { RuleReference } from '@/lib/calculator/types/rules';

import { StateReason, stateUnavailable, type StateUnavailable } from '../errors/stateErrors';
import { StateRuleKey } from '../ruleKeys';
import type { StateElectionValue } from '../context';
import type {
  StateAmountByFilingStatusDetail,
  StateAmountPerAllowanceDetail,
  StateBracketTableDetail,
  StateElectionFormSchemaDetail,
  StateFormulaStepsDetail,
  StateRateDetail,
  StateScalarAmountDetail,
} from './detailSchemas';
import {
  readDetail,
  readFail,
  readOk,
  readRate,
  requireComponent,
  requireForFilingStatus,
  type Read,
} from './read-detail';
import { stateRule, type ResolvedStateRuleSet } from './stateRuleSet';
import { resolveStatePayPeriodsPerYear } from './withholdingPayPeriods';

/**
 * State withholding formula interpreter — Task 4O-3A, extended by Tasks
 * 4O-5, 4O-6R6, 4O-6R12, 4O-6R17, 4O-6R23, 4O-6R26, 4O-6R33, and 4O-6R45.
 * Provenance-carrying since DM-03 Slice 23 (contract locked at Slice 22).
 *
 * ===========================================================================
 * SUCCESS RESULT CARRIES PROVENANCE — `{ amount: Money; rules:
 * readonly RuleReference[] }`, not a bare `Money` (DM-03 Slice 23).
 *
 * Mirrors the established `SdiContribution`/`PfmlContribution`/
 * `SutaContribution` result shape. Each operation reads at most one distinct
 * rule per invocation; its reference is captured via a second, independent
 * `stateRule()` call (this module's own `ruleReference()` helper — the same
 * pattern `calculateSuta.ts`/`calculateSdi.ts` already use), never by
 * modifying `readDetail()` or `resolveStatePayPeriodsPerYear()`, neither of
 * which is touched. References accumulate across successful steps in
 * first-occurrence execution order, deduplicated by `ruleId@version` —
 * identical to `mergeReferences()`'s existing convention. `WITHHOLDING_FORMULA`'s
 * own reference is NEVER included here (Slice 22, Question A): this
 * interpreter receives `detail` already resolved and never reads that rule
 * key itself, so that reference belongs to whichever future caller reads it
 * and merges it in externally, exactly like `bucket.rules` already is at the
 * `index.ts` aggregation boundary. On ANY failure, no partial provenance is
 * ever returned — `Read<T>`'s failure branch carries no value at all,
 * matching the established SDI/PFML/SUTA convention of `rules: []` on every
 * failure path.
 * ===========================================================================
 * IMPLEMENTS ELEVEN OPERATIONS: THE THREE TASK 4O-2 CONTRACT-LOCKED ONES
 * (`SUBTRACT_STANDARD_DEDUCTION`, `FLOOR_AT_ZERO`, `APPLY_BRACKETS`), PLUS
 * `SUBTRACT_EXEMPTIONS`'S PERSONAL-EXEMPTION PATH ONLY (Task 4O-4/4O-5),
 * PLUS `SUBTRACT_AMOUNT` (Task 4O-6R3/4O-6R4/4O-6R5/4O-6R6) — a GENERIC
 * SCALAR AMOUNT PRIMITIVE with no built-in real-world tax meaning: it
 * subtracts whatever `SCALAR_AMOUNT`-shaped rule its `operandRef` names —
 * PLUS `APPLY_FLAT_RATE` (Task 4O-6R9/4O-6R10/4O-6R11/4O-6R12), generic over
 * any `RATE`-shaped `StateRuleKey` — PLUS `SUBTRACT_ALLOWANCES` (Task
 * 4O-6R14/4O-6R15/4O-6R16/4O-6R17), generic over any `AMOUNT_PER_ALLOWANCE`-
 * shaped `StateRuleKey`, consuming an already-resolved, `StateRuleKey`-keyed
 * allowance-count map this function receives as its fifth parameter — PLUS
 * `ADD_AMOUNT` (Task 4O-6R20/4O-6R21/4O-6R22/4O-6R23), generic over any
 * `AMOUNT`-typed field the current WORK jurisdiction's `WITHHOLDING_ELECTION_FORM`
 * declares, consuming an already-resolved, `fieldKey`-keyed employee-election
 * map this function receives as its sixth parameter — PLUS
 * `APPLY_PERCENTAGE_OF` (Task 4O-6R24/4O-6R25/4O-6R26), also generic over any
 * `RATE`-shaped `StateRuleKey` like `APPLY_FLAT_RATE`, but computing
 * `runningValue × (1 + rate)` rather than `runningValue × rate` — an
 * EXPLICIT OWNER ARITHMETIC DECISION (Task 4O-6R26-OWNER), since no
 * repository evidence resolved which of the two was intended — PLUS
 * `ANNUALIZE` (Task 4O-6R32/4O-6R33), contract-locked null `operandRef`,
 * computing `runningValue × periodsPerYear` via the existing, unmodified
 * `resolveStatePayPeriodsPerYear()`, consuming a new, narrow `payFrequency`
 * parameter this function receives as its seventh parameter — structurally
 * identical in role to `filingStatus`, never the whole
 * `StateCalculationContext` — PLUS `DEANNUALIZE` (Task 4O-6R38/4O-6R40
 * through 4O-6R45), the inverse of `ANNUALIZE`: contract-locked null
 * `operandRef`, computing `runningValue ÷ periodsPerYear` via the same
 * `resolveStatePayPeriodsPerYear()` and the same `payFrequency` parameter,
 * but dividing via `divideHighPrecision()` (`lib/core/money.ts`) rather than
 * `divide()` — high-precision, explicitly NOT mathematically exact Decimal
 * arithmetic, never `WITHHOLDING_ROUNDING_POLICY` or any scale/`RoundingMode`
 * of any kind, resolving the rounding-policy precision conflict Task
 * 4O-6R33 §5 originally left unresolved.
 *
 * `SUBTRACT_EXEMPTIONS` supports ONLY `operandRef ===
 * StateRuleKey.PIT_PERSONAL_EXEMPTION`. The dependent-exemption path
 * (`PIT_DEPENDENT_EXEMPTION`) remains unresolved — presenting it, or any
 * other operandRef, to `SUBTRACT_EXEMPTIONS` fails `RULE_DETAIL_INVALID`
 * rather than being tolerated or treated as merely unsupported.
 *
 * The one remaining operation (`ROUND`) remains contractually unresolved
 * (Task 4O-2 §3/§8, Task 4O-6R31) and is never silently executed —
 * encountering it reports `METHOD_NOT_IMPLEMENTED`, mirroring the exact,
 * already-established meaning of that reason elsewhere in the project
 * (`lib/calculator/pipeline/tax-stages.ts`'s `evaluateComponent()`: "the
 * calculation methodology for this category is delivered in a later
 * phase"). `ROUND` was explicitly locked OUTSIDE this interpreter's scope
 * entirely (Task 4O-6R31) — it is not merely unimplemented, but architecturally
 * excluded: rounding belongs to a future, separate state rounding stage,
 * never to a formula-step operation.
 *
 * Execution model (Task 4O-2 §1, locked): steps run in strict `ordinal`
 * order over a single running `Money` accumulator. There is no named
 * intermediate variable and no step-to-step reference — each step reads only
 * the current accumulator and, for `APPLY_BRACKETS`, one named `StateRuleKey`.
 *
 * `operandRef` vocabulary (Task 4O-2 §2, locked): a non-null `operandRef`
 * names a `StateRuleKey` for every operation EXCEPT `ADD_AMOUNT`, which is a
 * later, separately-locked, deliberate exception (Task 4O-6R21 §3/§4, Task
 * 4O-6R22): its `operandRef` names an election `fieldKey` instead, and is
 * never checked against `VALID_RULE_KEYS`.
 *
 * Filing status (Task 4O-2 §5): used state-native, directly, exactly as
 * `StateCalculationContext.elections[...].filingStatus` carries it — never
 * mapped through `WITHHOLDING_FILING_STATUS_MAP`.
 * ===========================================================================
 */

const FORMULA_RULE_KEY: string = StateRuleKey.WITHHOLDING_FORMULA;

/** All valid `StateRuleKey` values, for validating a non-null `operandRef`. */
const VALID_RULE_KEYS: ReadonlySet<string> = new Set(Object.values(StateRuleKey));

function invalidDetail(detail: string): StateUnavailable {
  return stateUnavailable(StateReason.RULE_DETAIL_INVALID, detail, FORMULA_RULE_KEY);
}

function conflict(detail: string): StateUnavailable {
  return stateUnavailable(StateReason.RULE_CONFLICT, detail, FORMULA_RULE_KEY);
}

/**
 * One step's successful result — DM-03 Slice 23. The running value plus the
 * `RuleReference` of the single rule that step read, or `undefined` when the
 * step reads no rule (`FLOOR_AT_ZERO`). Every operation in this module reads
 * at most one distinct rule key per invocation, so a single optional
 * reference is sufficient — never a list at this level.
 */
interface FormulaStepResult {
  readonly value: Money;
  readonly reference: RuleReference | undefined;
}

/**
 * Fetches a rule's `RuleReference` via a second, independent, in-memory
 * `stateRule()` call — never via `readDetail()`, whose own `ResolvedDetail`
 * return type carries no reference. This is the exact, already-established
 * pattern `lib/tax/state/suta/calculateSuta.ts`'s own `ruleReference()`
 * helper uses (and `calculateSdi.ts`'s identically-named helper), reused
 * here rather than reinvented — `readDetail()` and `stateRule()` are never
 * modified.
 */
function ruleReference(
  ruleSet: ResolvedStateRuleSet,
  key: StateRuleKey,
): RuleReference | undefined {
  const entry = stateRule(ruleSet, key);
  return entry.available ? entry.rule.reference : undefined;
}

/**
 * `SUBTRACT_STANDARD_DEDUCTION` — contract-locked null `operandRef`.
 *
 * Resolves `WITHHOLDING_STANDARD_DEDUCTION` and selects its filing-status row
 * via the existing, unmodified `requireForFilingStatus()` — the same helper
 * already documented as reused for this exact schema shape
 * (`read-detail.ts`). `requireForFilingStatus()` itself never reads the
 * schema's `unit` field, and this operation does not add unit-conversion
 * logic beyond what that existing helper already does: no `PER_PERIOD`
 * annualization/deannualization is invented here (Task 4O-2 explicitly
 * defers that), so the amount is subtracted exactly as stated.
 */
function subtractStandardDeduction(
  ruleSet: ResolvedStateRuleSet,
  filingStatus: string | null,
  operandRef: string | null,
  runningValue: Money,
): Read<FormulaStepResult> {
  if (operandRef !== null) {
    return readFail(
      invalidDetail(
        'SUBTRACT_STANDARD_DEDUCTION requires a null operandRef; the standard deduction rule ' +
          'is resolved implicitly',
      ),
    );
  }

  if (filingStatus === null) {
    return readFail(
      stateUnavailable(
        StateReason.SCENARIO_UNSUPPORTED,
        'SUBTRACT_STANDARD_DEDUCTION requires a filing status; none is available and none is assumed',
        StateRuleKey.WITHHOLDING_STANDARD_DEDUCTION,
      ),
    );
  }

  const found = readDetail(ruleSet, StateRuleKey.WITHHOLDING_STANDARD_DEDUCTION);
  if (!found.ok) {
    return readFail(found.problem);
  }

  const detail = found.value.detail as StateAmountByFilingStatusDetail;
  const deduction = requireForFilingStatus(
    detail.amounts,
    filingStatus,
    StateRuleKey.WITHHOLDING_STANDARD_DEDUCTION,
    'amounts',
  );
  if (!deduction.ok) {
    return readFail(deduction.problem);
  }

  return readOk({
    value: subtract(runningValue, deduction.value),
    reference: ruleReference(ruleSet, StateRuleKey.WITHHOLDING_STANDARD_DEDUCTION),
  });
}

/**
 * `SUBTRACT_EXEMPTIONS` — Task 4O-4/4O-5 contract-locked, PERSONAL EXEMPTION
 * PATH ONLY.
 *
 * `operandRef` is REQUIRED and must equal exactly
 * `StateRuleKey.PIT_PERSONAL_EXEMPTION` — never `null`, never
 * `PIT_DEPENDENT_EXEMPTION`, never any other `StateRuleKey` or string. Two
 * independently-shaped exemption rule keys exist (`PIT_PERSONAL_EXEMPTION`,
 * filing-status keyed; `PIT_DEPENDENT_EXEMPTION`, per-allowance and requiring
 * a dependent count this architecture does not yet supply), so a `null`
 * operandRef would be ambiguous between them — unlike
 * `SUBTRACT_STANDARD_DEDUCTION`, which has exactly one implicit target.
 *
 * Filing status is used state-native, exactly as `APPLY_BRACKETS` and
 * `SUBTRACT_STANDARD_DEDUCTION` already use it — never mapped through
 * `WITHHOLDING_FILING_STATUS_MAP`. Amount resolution reuses the existing,
 * unmodified `requireForFilingStatus()` against `PIT_PERSONAL_EXEMPTION`'s
 * `AMOUNT_BY_FILING_STATUS` detail — the identical call shape
 * `subtractStandardDeduction()` already uses for a different rule key.
 *
 * UNIT HANDLING IS EXPLICITLY OUT OF SCOPE: the schema's `unit` field
 * (`ANNUAL`/`PER_PERIOD`) is never read, and no annualize/deannualize
 * conversion is performed — a disclosed, project-wide contract gap, not
 * something this operation invents a fix for. The rule is only correctly
 * usable when authored in the basis the calling formula expects.
 *
 * `PIT_DEPENDENT_EXEMPTION` remains unresolved and unimplemented: presenting
 * it as `operandRef` fails `RULE_DETAIL_INVALID`, exactly like any other
 * unsupported operand — it is never treated as merely unsupported-but-
 * tolerated, and no dependent-count/allowance-multiplication logic exists
 * here or anywhere in this module.
 */
function subtractExemptions(
  ruleSet: ResolvedStateRuleSet,
  filingStatus: string | null,
  operandRef: string | null,
  runningValue: Money,
): Read<FormulaStepResult> {
  if (operandRef !== StateRuleKey.PIT_PERSONAL_EXEMPTION) {
    return readFail(
      invalidDetail(
        'SUBTRACT_EXEMPTIONS requires operandRef to equal StateRuleKey.PIT_PERSONAL_EXEMPTION ' +
          'exactly; the dependent-exemption path (PIT_DEPENDENT_EXEMPTION) remains unresolved ' +
          'and is not supported by this operation',
      ),
    );
  }

  if (filingStatus === null) {
    return readFail(
      stateUnavailable(
        StateReason.SCENARIO_UNSUPPORTED,
        'SUBTRACT_EXEMPTIONS requires a filing status; none is available and none is assumed',
        StateRuleKey.PIT_PERSONAL_EXEMPTION,
      ),
    );
  }

  const found = readDetail(ruleSet, StateRuleKey.PIT_PERSONAL_EXEMPTION);
  if (!found.ok) {
    return readFail(found.problem);
  }

  const detail = found.value.detail as StateAmountByFilingStatusDetail;
  const exemption = requireForFilingStatus(
    detail.amounts,
    filingStatus,
    StateRuleKey.PIT_PERSONAL_EXEMPTION,
    'amounts',
  );
  if (!exemption.ok) {
    return readFail(exemption.problem);
  }

  return readOk({
    value: subtract(runningValue, exemption.value),
    reference: ruleReference(ruleSet, StateRuleKey.PIT_PERSONAL_EXEMPTION),
  });
}

/**
 * `FLOOR_AT_ZERO` — contract-locked null `operandRef`. Pure arithmetic on the
 * running value; no rule lookup, no rounding.
 */
function floorAtZero(operandRef: string | null, runningValue: Money): Read<FormulaStepResult> {
  if (operandRef !== null) {
    return readFail(invalidDetail('FLOOR_AT_ZERO requires a null operandRef; it takes no operand'));
  }
  return readOk({ value: max(runningValue, zero()), reference: undefined });
}

/**
 * `APPLY_BRACKETS` — contract-locked required `operandRef` naming a
 * `StateRuleKey`.
 *
 * `stateBracketTableDetailSchema` carries no cumulative base-amount column
 * (unlike `stateWithholdingTableDetailSchema`), so the tax is computed by
 * summing the taxed slice of every applicable bracket — the identical
 * pattern already shipped for federal's own base-less bracket schema
 * (`lib/tax/federal/fit/annualLiability.ts`'s `calculateAnnualLiability()`,
 * whose own comment states: "Track A brackets carry no base-amount column,
 * so the tax is summed across slices rather than read off a 'tax on the
 * first X' figure"). This reuses that ARCHITECTURAL PATTERN only — no
 * federal code, rates, or thresholds are imported or copied.
 */
function applyBrackets(
  ruleSet: ResolvedStateRuleSet,
  filingStatus: string | null,
  operandRef: string | null,
  runningValue: Money,
): Read<FormulaStepResult> {
  if (operandRef === null) {
    return readFail(
      invalidDetail('APPLY_BRACKETS requires a non-null operandRef naming a StateRuleKey'),
    );
  }
  if (!VALID_RULE_KEYS.has(operandRef)) {
    return readFail(
      invalidDetail(`APPLY_BRACKETS operandRef "${operandRef}" does not name a known StateRuleKey`),
    );
  }
  const bracketRuleKey = operandRef as StateRuleKey;

  if (filingStatus === null) {
    return readFail(
      stateUnavailable(
        StateReason.SCENARIO_UNSUPPORTED,
        'APPLY_BRACKETS requires a filing status; none is available and none is assumed',
        bracketRuleKey,
      ),
    );
  }

  const found = readDetail(ruleSet, bracketRuleKey);
  if (!found.ok) {
    return readFail(found.problem);
  }

  const detail = found.value.detail as { shape: string };
  if (detail.shape !== 'BRACKET_TABLE') {
    return readFail(
      invalidDetail(
        `APPLY_BRACKETS operandRef "${operandRef}" resolved a "${detail.shape}" rule, not a ` +
          'BRACKET_TABLE',
      ),
    );
  }
  const bracketDetail = found.value.detail as StateBracketTableDetail;

  const bracketSet = bracketDetail.bracketSets.find(
    (candidate) => candidate.filingStatus === filingStatus,
  );
  if (bracketSet === undefined || bracketSet.brackets.length === 0) {
    return readFail(
      stateUnavailable(
        StateReason.COMPONENT_NOT_STATED,
        `No bracket set for filing status ${filingStatus} in ${operandRef}; the amount is ` +
          "unavailable rather than borrowing another status's table",
        bracketRuleKey,
        `bracketSets[${filingStatus}]`,
      ),
    );
  }

  const ordered = [...bracketSet.brackets].sort((a, b) => a.ordinal - b.ordinal);
  const slices: Money[] = [];

  for (const bracket of ordered) {
    const lower = bracket.atLeast === null ? zero() : money(bracket.atLeast);
    if (compare(runningValue, lower) <= 0) {
      continue;
    }
    const upper = bracket.lessThan === null ? runningValue : money(bracket.lessThan);
    const ceiling = compare(runningValue, upper) < 0 ? runningValue : upper;
    const slice = max(subtract(ceiling, lower), zero());
    if (slice.isZero()) {
      continue;
    }

    const rate = readRate(
      bracket.rate,
      bracket.unit,
      bracketRuleKey,
      `bracketSets[${filingStatus}].brackets[${String(bracket.ordinal)}].rate`,
    );
    if (!rate.ok) {
      return readFail(rate.problem);
    }
    slices.push(multiply(slice, rate.value));
  }

  return readOk({
    value: slices.length === 0 ? zero() : sum(slices),
    reference: ruleReference(ruleSet, bracketRuleKey),
  });
}

/**
 * `SUBTRACT_AMOUNT` — Task 4O-6R4/4O-6R5/4O-6R6 contract-locked, GENERIC
 * SCALAR AMOUNT PRIMITIVE.
 *
 * `operandRef` is REQUIRED and must name a real `StateRuleKey` (validated
 * against the same `VALID_RULE_KEYS` membership set `applyBrackets()` already
 * uses). The referenced rule must resolve to `SCALAR_AMOUNT`
 * (`stateScalarAmountDetailSchema`, Task 4O-6R5) — any other resolved shape
 * fails `RULE_DETAIL_INVALID`, exactly mirroring `applyBrackets()`'s own
 * `detail.shape !== 'BRACKET_TABLE'` check.
 *
 * This operation carries NO built-in real-world tax meaning (Task 4O-6R3):
 * it is a mechanism, not a concept. It performs no filing-status lookup (the
 * `SCALAR_AMOUNT` shape has no filing-status dependence), and the schema's
 * `unit` field (`ANNUAL`/`PER_PERIOD`) is read by nobody and never converted
 * — the authored amount is subtracted exactly as stated, on the standing
 * assumption (disclosed, project-wide, unchanged by this operation) that it
 * was authored in the basis the calling formula expects.
 *
 * Amount resolution reuses the existing, unmodified `requireComponent()` —
 * not `requireForFilingStatus()`, since `SCALAR_AMOUNT` carries a single
 * amount, not a per-filing-status row — so a `null` amount is reported as
 * `COMPONENT_NOT_STATED` rather than treated as zero.
 */
function subtractAmount(
  ruleSet: ResolvedStateRuleSet,
  operandRef: string | null,
  runningValue: Money,
): Read<FormulaStepResult> {
  if (operandRef === null) {
    return readFail(
      invalidDetail('SUBTRACT_AMOUNT requires a non-null operandRef naming a StateRuleKey'),
    );
  }
  if (!VALID_RULE_KEYS.has(operandRef)) {
    return readFail(
      invalidDetail(
        `SUBTRACT_AMOUNT operandRef "${operandRef}" does not name a known StateRuleKey`,
      ),
    );
  }
  const amountRuleKey = operandRef as StateRuleKey;

  const found = readDetail(ruleSet, amountRuleKey);
  if (!found.ok) {
    return readFail(found.problem);
  }

  const detail = found.value.detail as { shape: string };
  if (detail.shape !== 'SCALAR_AMOUNT') {
    return readFail(
      invalidDetail(
        `SUBTRACT_AMOUNT operandRef "${operandRef}" resolved a "${detail.shape}" rule, not a ` +
          'SCALAR_AMOUNT',
      ),
    );
  }
  const scalarDetail = found.value.detail as StateScalarAmountDetail;

  const amount = requireComponent(scalarDetail.amount, amountRuleKey, 'amount');
  if (!amount.ok) {
    return readFail(amount.problem);
  }

  return readOk({
    value: subtract(runningValue, amount.value),
    reference: ruleReference(ruleSet, amountRuleKey),
  });
}

/**
 * `APPLY_FLAT_RATE` — Task 4O-6R9/4O-6R10/4O-6R11 contract-locked, GENERIC
 * OVER `RATE`-SHAPED `StateRuleKey`s.
 *
 * `operandRef` is REQUIRED and validated against the same `VALID_RULE_KEYS`
 * membership set `applyBrackets()`/`subtractAmount()` already use — it is
 * NOT hard-coded to `StateRuleKey.PIT_FLAT_RATE`. The referenced rule must
 * resolve to `RATE` (`stateRateDetailSchema`) — any other resolved shape
 * fails `RULE_DETAIL_INVALID`, exactly mirroring `applyBrackets()`'s own
 * `detail.shape !== 'BRACKET_TABLE'` check. `PIT_FLAT_RATE` is currently the
 * only plausible production operand, but is never required to be the exact
 * key (Task 4O-6R10 found no real formula example proving that exact
 * requirement).
 *
 * `applicability`/`appliesTo` are OWNER-LOCKED DECISIONS (Task 4O-6R11), not
 * pre-existing repository behavior: no other `RATE` consumer in this engine
 * (or federal's) has ever consulted either field before. `NOT_APPLICABLE`
 * and an `EMPLOYER`-tagged rate both report `SCENARIO_UNSUPPORTED` — never
 * silently zeroed, never `COMPONENT_NOT_STATED`, and the accumulator is
 * never mutated in either case.
 *
 * Rate normalization reuses the existing, unmodified `readRate()` — the
 * same helper `applyBrackets()` already uses for a bracket row's `rate`/
 * `unit` pair, here applied to a top-level `RATE` detail's own `rate`/
 * `unit` instead. No second `PERCENT`→`DECIMAL_FRACTION` conversion path is
 * introduced. No `ANNUAL`/`PER_PERIOD` semantics apply to this schema at
 * all, and none are added here.
 */
function applyFlatRate(
  ruleSet: ResolvedStateRuleSet,
  operandRef: string | null,
  runningValue: Money,
): Read<FormulaStepResult> {
  if (operandRef === null) {
    return readFail(
      invalidDetail('APPLY_FLAT_RATE requires a non-null operandRef naming a StateRuleKey'),
    );
  }
  if (!VALID_RULE_KEYS.has(operandRef)) {
    return readFail(
      invalidDetail(
        `APPLY_FLAT_RATE operandRef "${operandRef}" does not name a known StateRuleKey`,
      ),
    );
  }
  const rateRuleKey = operandRef as StateRuleKey;

  const found = readDetail(ruleSet, rateRuleKey);
  if (!found.ok) {
    return readFail(found.problem);
  }

  const detail = found.value.detail as { shape: string };
  if (detail.shape !== 'RATE') {
    return readFail(
      invalidDetail(
        `APPLY_FLAT_RATE operandRef "${operandRef}" resolved a "${detail.shape}" rule, not a RATE`,
      ),
    );
  }
  const rateDetail = found.value.detail as StateRateDetail;

  if (rateDetail.applicability === 'NOT_APPLICABLE') {
    return readFail(
      stateUnavailable(
        StateReason.SCENARIO_UNSUPPORTED,
        `APPLY_FLAT_RATE operandRef "${operandRef}" is NOT_APPLICABLE in this jurisdiction; no ` +
          'rate is assumed',
        rateRuleKey,
      ),
    );
  }

  if (rateDetail.appliesTo === 'EMPLOYER') {
    return readFail(
      stateUnavailable(
        StateReason.SCENARIO_UNSUPPORTED,
        `APPLY_FLAT_RATE operandRef "${operandRef}" applies to EMPLOYER, not EMPLOYEE; this ` +
          'withholding formula does not calculate employer income tax',
        rateRuleKey,
      ),
    );
  }

  const rate = readRate(rateDetail.rate, rateDetail.unit, rateRuleKey, 'rate');
  if (!rate.ok) {
    return readFail(rate.problem);
  }

  return readOk({
    value: multiply(runningValue, rate.value),
    reference: ruleReference(ruleSet, rateRuleKey),
  });
}

/**
 * `APPLY_PERCENTAGE_OF` — Task 4O-6R24/4O-6R25/4O-6R26 contract-locked,
 * GENERIC OVER `RATE`-SHAPED `StateRuleKey`s.
 *
 * ARITHMETIC IS AN EXPLICIT OWNER DECISION (Task 4O-6R26-OWNER), NOT A
 * REPOSITORY-EVIDENCED FACT: `runningValue = runningValue × (1 +
 * normalizedRate)`. Tasks 4O-6R24/4O-6R25 found no fixture, comment, or
 * production data anywhere resolving whether this operation meant plain
 * multiplication (which would make it a byte-for-byte duplicate of
 * `applyFlatRate()`) or this gross-up form — the owner explicitly selected
 * the gross-up form, and this is the one and only respect in which this
 * function differs from `applyFlatRate()`.
 *
 * Every other mechanic is TRANSFERRED, DISCLOSED AS SUCH, from
 * `applyFlatRate()` — not independently re-derived — because it attaches to
 * the shared `RATE` shape itself, not to either operation's arithmetic:
 * `operandRef` validation against `VALID_RULE_KEYS` (never hard-coded to a
 * specific key), the `RATE` shape check, `applicability === 'NOT_APPLICABLE'`
 * → `SCENARIO_UNSUPPORTED`, `appliesTo === 'EMPLOYER'` →
 * `SCENARIO_UNSUPPORTED`, and rate normalization via the existing,
 * unmodified `readRate()`. Task 4O-6R24 §7 explicitly noted this transfer is
 * analogous, not itself repository-evidenced for this specific operation —
 * recorded here for the same reason it was recorded on `applyFlatRate()`'s
 * own `applicability`/`appliesTo` handling (Task 4O-6R11): so a future
 * reader does not mistake an analogy for a rediscovered fact.
 *
 * The base quantity is the current running accumulator — the only
 * quantity `runStateWithholdingFormula()`'s single-accumulator architecture
 * exposes to any step (Task 4O-6R25 §2, re-confirmed Task 4O-6R26 Step 1.D)
 * — never a second, separately-named base.
 */
function applyPercentageOf(
  ruleSet: ResolvedStateRuleSet,
  operandRef: string | null,
  runningValue: Money,
): Read<FormulaStepResult> {
  if (operandRef === null) {
    return readFail(
      invalidDetail('APPLY_PERCENTAGE_OF requires a non-null operandRef naming a StateRuleKey'),
    );
  }
  if (!VALID_RULE_KEYS.has(operandRef)) {
    return readFail(
      invalidDetail(
        `APPLY_PERCENTAGE_OF operandRef "${operandRef}" does not name a known StateRuleKey`,
      ),
    );
  }
  const rateRuleKey = operandRef as StateRuleKey;

  const found = readDetail(ruleSet, rateRuleKey);
  if (!found.ok) {
    return readFail(found.problem);
  }

  const detail = found.value.detail as { shape: string };
  if (detail.shape !== 'RATE') {
    return readFail(
      invalidDetail(
        `APPLY_PERCENTAGE_OF operandRef "${operandRef}" resolved a "${detail.shape}" rule, not a ` +
          'RATE',
      ),
    );
  }
  const rateDetail = found.value.detail as StateRateDetail;

  if (rateDetail.applicability === 'NOT_APPLICABLE') {
    return readFail(
      stateUnavailable(
        StateReason.SCENARIO_UNSUPPORTED,
        `APPLY_PERCENTAGE_OF operandRef "${operandRef}" is NOT_APPLICABLE in this jurisdiction; ` +
          'no rate is assumed',
        rateRuleKey,
      ),
    );
  }

  if (rateDetail.appliesTo === 'EMPLOYER') {
    return readFail(
      stateUnavailable(
        StateReason.SCENARIO_UNSUPPORTED,
        `APPLY_PERCENTAGE_OF operandRef "${operandRef}" applies to EMPLOYER, not EMPLOYEE; this ` +
          'withholding formula does not calculate employer income tax',
        rateRuleKey,
      ),
    );
  }

  const rate = readRate(rateDetail.rate, rateDetail.unit, rateRuleKey, 'rate');
  if (!rate.ok) {
    return readFail(rate.problem);
  }

  return readOk({
    value: multiply(runningValue, add(money('1'), rate.value)),
    reference: ruleReference(ruleSet, rateRuleKey),
  });
}

/**
 * `SUBTRACT_ALLOWANCES` — Task 4O-6R14/4O-6R15/4O-6R16/4O-6R17 contract-locked,
 * GENERIC OVER `AMOUNT_PER_ALLOWANCE`-SHAPED `StateRuleKey`s.
 *
 * `operandRef` is REQUIRED and validated against the same `VALID_RULE_KEYS`
 * membership set every other generic operation already uses — it is NOT
 * hard-coded to `StateRuleKey.WITHHOLDING_ALLOWANCE_VALUE`. The referenced
 * rule must resolve to `AMOUNT_PER_ALLOWANCE` — any other resolved shape
 * fails `RULE_DETAIL_INVALID`, mirroring `applyBrackets()`/`applyFlatRate()`.
 *
 * `allowanceType` is DESCRIPTIVE METADATA ONLY (Task 4O-6R15 §7) — it never
 * participates in lookup. The allowance COUNT is matched by `operandRef`/
 * `StateRuleKey` alone: `allowanceCounts[allowanceRuleKey]`, read from the
 * already-resolved, already-validated map `runStateWithholdingFormula()`
 * receives (Task 4O-6R16's `StateCalculationContext.allowanceCounts`
 * shape, passed in narrowly — never the whole context). A missing OR `null`
 * count for that specific key reports `COMPONENT_NOT_STATED` (Task 4O-6R15
 * §13's failure table; `null` mirrors `requireComponent()`'s own
 * null-defensive style even though the locked, non-negative-integer-Zod-
 * validated `StateCalculationContext.allowanceCounts` type never actually
 * produces one on the normal input path). It is never defaulted to `0` or
 * `1`, and a count already validated non-negative-integer by the input
 * layer is never re-validated here (Task 4O-6R15 §13).
 *
 * `applicability === 'NOT_APPLICABLE'` reports `SCENARIO_UNSUPPORTED`,
 * directly transferring the `APPLY_FLAT_RATE` owner-locked pattern (Task
 * 4O-6R11) for the identical `StateApplicability` enum. The schema's `unit`
 * field is never read — no `ANNUAL`/`PER_PERIOD` conversion is performed,
 * the same standing, disclosed, project-wide gap every other amount-bearing
 * operation in this interpreter already carries.
 *
 * The integer count is converted to `Money` via `money(String(count))` —
 * never `money(count)`, which the project's `money()` explicitly refuses
 * for a JS `number` (Task 4O-6R15 §14 arithmetic note).
 */
function subtractAllowances(
  ruleSet: ResolvedStateRuleSet,
  operandRef: string | null,
  runningValue: Money,
  allowanceCounts: Readonly<Partial<Record<StateRuleKey, number | null>>>,
): Read<FormulaStepResult> {
  if (operandRef === null) {
    return readFail(
      invalidDetail('SUBTRACT_ALLOWANCES requires a non-null operandRef naming a StateRuleKey'),
    );
  }
  if (!VALID_RULE_KEYS.has(operandRef)) {
    return readFail(
      invalidDetail(
        `SUBTRACT_ALLOWANCES operandRef "${operandRef}" does not name a known StateRuleKey`,
      ),
    );
  }
  const allowanceRuleKey = operandRef as StateRuleKey;

  const found = readDetail(ruleSet, allowanceRuleKey);
  if (!found.ok) {
    return readFail(found.problem);
  }

  const detail = found.value.detail as { shape: string };
  if (detail.shape !== 'AMOUNT_PER_ALLOWANCE') {
    return readFail(
      invalidDetail(
        `SUBTRACT_ALLOWANCES operandRef "${operandRef}" resolved a "${detail.shape}" rule, not ` +
          'an AMOUNT_PER_ALLOWANCE',
      ),
    );
  }
  const allowanceDetail = found.value.detail as StateAmountPerAllowanceDetail;

  if (allowanceDetail.applicability === 'NOT_APPLICABLE') {
    return readFail(
      stateUnavailable(
        StateReason.SCENARIO_UNSUPPORTED,
        `SUBTRACT_ALLOWANCES operandRef "${operandRef}" is NOT_APPLICABLE in this jurisdiction; ` +
          'no allowance value is assumed',
        allowanceRuleKey,
      ),
    );
  }

  const amount = requireComponent(allowanceDetail.amount, allowanceRuleKey, 'amount');
  if (!amount.ok) {
    return readFail(amount.problem);
  }

  const count = allowanceCounts[allowanceRuleKey];
  if (count === undefined || count === null) {
    return readFail(
      stateUnavailable(
        StateReason.COMPONENT_NOT_STATED,
        `SUBTRACT_ALLOWANCES operandRef "${operandRef}" has no allowance count supplied; it is ` +
          'not stated, and none is assumed',
        allowanceRuleKey,
        'allowanceCount',
      ),
    );
  }

  const countMoney = money(String(count));
  return readOk({
    value: subtract(runningValue, multiply(amount.value, countMoney)),
    reference: ruleReference(ruleSet, allowanceRuleKey),
  });
}

/**
 * `ADD_AMOUNT` — Task 4O-6R21/4O-6R22/4O-6R23 contract-locked, GENERIC OVER
 * `WITHHOLDING_ELECTION_FORM`'S DECLARED `AMOUNT` FIELDS.
 *
 * Unlike every other operand-referencing operation in this module,
 * `operandRef` here is NOT a `StateRuleKey` — it is an election `fieldKey`
 * (Task 4O-6R21 §3/§4 found no composite-identifier convention anywhere in
 * the repository, and Task 4O-6R22 explicitly forbids treating an employee
 * election as a `StateRuleKey`). It is therefore never checked against
 * `VALID_RULE_KEYS`.
 *
 * Deep validation against the registered `WITHHOLDING_ELECTION_FORM` rule
 * (Task 4O-6R22 Decision #2) reuses the existing `readDetail()` machinery
 * exactly as every other operation already does — no new generic election
 * reader is introduced. `operandRef` must name a field the resolved
 * `ELECTION_FORM_SCHEMA` actually declares, and that field's declared `type`
 * must be `AMOUNT`; anything else fails `RULE_DETAIL_INVALID`, mirroring
 * `applyBrackets()`/`applyFlatRate()`/`subtractAllowances()`'s identical
 * "resolved the wrong concept" pattern, generalized here to "resolved a
 * non-existent or non-AMOUNT field."
 *
 * The submitted value itself is read from `resolvedElections` — an
 * already-resolved, `fieldKey`-keyed map of the current WORK jurisdiction's
 * election values (never residence — `resolveWorkJurisdictionElections()`,
 * `lib/tax/state/context.ts`), passed in narrowly, exactly as
 * `allowanceCounts` already is. A missing or `null` entry reports
 * `COMPONENT_NOT_STATED` (Task 4O-6R22 §H). Duplicate `fieldKey`s are never
 * this operation's concern: they are rejected upstream by
 * `validateStateContext()` before a calculation ever reaches the
 * interpreter (Task 4O-6R22 Decision #1) — this function does not attempt
 * to detect one.
 *
 * The current input/context validation layers guarantee `value` is one of
 * `DecimalString | number | boolean`, but never guarantee that a `number`/
 * `boolean` value wasn't submitted under a `fieldKey` the form declares as
 * `AMOUNT` (Task 4O-6R22 §G) — this operation therefore owns its own
 * `typeof value === 'string'` check, failing `RULE_DETAIL_INVALID` on
 * anything else, exactly as `subtractAmount()`/`subtractAllowances()` each
 * own their own resolved-detail shape check rather than trusting an earlier
 * layer.
 *
 * `unit` is never converted (the same standing, disclosed, project-wide gap
 * every other amount-bearing operation in this interpreter already
 * carries) — but per Task 4O-6R22 Decision #3, the form's DECLARED unit and
 * the submitted value's OWN unit must agree, or this reports `RULE_CONFLICT`
 * (CLAUDE.md §3: conflicting sources are never silently resolved). Neither
 * unit is ever preferred over the other, and no annualize/deannualize
 * conversion is performed in either branch.
 */
function addAmount(
  ruleSet: ResolvedStateRuleSet,
  operandRef: string | null,
  runningValue: Money,
  resolvedElections: Readonly<Partial<Record<string, StateElectionValue | null>>>,
): Read<FormulaStepResult> {
  if (operandRef === null) {
    return readFail(
      invalidDetail('ADD_AMOUNT requires a non-null operandRef naming an election fieldKey'),
    );
  }

  const found = readDetail(ruleSet, StateRuleKey.WITHHOLDING_ELECTION_FORM);
  if (!found.ok) {
    return readFail(found.problem);
  }

  const detail = found.value.detail as { shape: string };
  if (detail.shape !== 'ELECTION_FORM_SCHEMA') {
    return readFail(
      invalidDetail(
        `ADD_AMOUNT resolved a "${detail.shape}" rule for ${StateRuleKey.WITHHOLDING_ELECTION_FORM}, ` +
          'not an ELECTION_FORM_SCHEMA',
      ),
    );
  }
  const formDetail = found.value.detail as StateElectionFormSchemaDetail;

  const field = formDetail.fields.find((candidate) => candidate.fieldKey === operandRef);
  if (field === undefined) {
    return readFail(
      invalidDetail(
        `ADD_AMOUNT operandRef "${operandRef}" does not name a field declared by ` +
          `${StateRuleKey.WITHHOLDING_ELECTION_FORM}`,
      ),
    );
  }

  if (field.type !== 'AMOUNT') {
    return readFail(
      invalidDetail(
        `ADD_AMOUNT operandRef "${operandRef}" names a field declared as "${field.type}", not AMOUNT`,
      ),
    );
  }

  const election = resolvedElections[operandRef];
  if (election === undefined || election === null) {
    return readFail(
      stateUnavailable(
        StateReason.COMPONENT_NOT_STATED,
        `ADD_AMOUNT operandRef "${operandRef}" has no submitted election value; it is not stated, ` +
          'and none is assumed',
        StateRuleKey.WITHHOLDING_ELECTION_FORM,
        operandRef,
      ),
    );
  }

  if (typeof election.value !== 'string') {
    return readFail(
      invalidDetail(
        `ADD_AMOUNT operandRef "${operandRef}" resolved a submitted value of type ` +
          `"${typeof election.value}", not a DecimalString`,
      ),
    );
  }

  if (field.unit !== election.unit) {
    return readFail(
      stateUnavailable(
        StateReason.RULE_CONFLICT,
        `ADD_AMOUNT operandRef "${operandRef}" declares unit "${String(field.unit)}" on ` +
          `${StateRuleKey.WITHHOLDING_ELECTION_FORM}, but the submitted election value declares ` +
          `unit "${String(election.unit)}"; the conflict is never silently resolved`,
        StateRuleKey.WITHHOLDING_ELECTION_FORM,
        operandRef,
      ),
    );
  }

  return readOk({
    value: add(runningValue, money(election.value)),
    reference: ruleReference(ruleSet, StateRuleKey.WITHHOLDING_ELECTION_FORM),
  });
}

/**
 * `ANNUALIZE` — Task 4O-6R32/4O-6R33 contract-locked, null `operandRef`.
 *
 * `runningValue = runningValue × periodsPerYear`, matching federal's own
 * real, shipped precedent (`lib/tax/federal/fit/pay-periods.ts`'s
 * `annualize()`, cited here as ARCHITECTURAL PRECEDENT only — no federal
 * code is imported). `WITHHOLDING_PAY_PERIODS_PER_YEAR` is the sole
 * `StateRuleKey` ever registered against `COUNT_BY_PAY_PERIOD` — no
 * disambiguation between competing keys is possible, so `operandRef` is
 * required to be `null`, exactly mirroring `subtractStandardDeduction()`'s
 * single-implicit-target pattern rather than the generic `VALID_RULE_KEYS`
 * pattern the multi-key operations use.
 *
 * The periods-per-year factor comes EXCLUSIVELY from the existing,
 * unmodified `resolveStatePayPeriodsPerYear(ruleSet, payFrequency)` — no
 * fallback to the generic calculator `periodsPerYear()`, no federal rule
 * keys, no hardcoded frequency table. `payFrequency` is a new, explicit,
 * narrow interpreter parameter (Task 4O-6R33 Decision 3), structurally
 * identical in role to the existing `filingStatus` parameter: a
 * per-calculation runtime fact, not rule data, never read from
 * `StateCalculationContext` inside this pure interpreter. A `null`
 * `payFrequency` reports `SCENARIO_UNSUPPORTED`, mirroring exactly how
 * `subtractStandardDeduction()`/`applyBrackets()`/`subtractExemptions()`
 * each treat a `null` `filingStatus`.
 *
 * `resolveStatePayPeriodsPerYear()`'s own existing, tested failure
 * semantics are propagated verbatim and unchanged: `RULE_MISSING`/
 * `RULE_UNVERIFIED`/`RULE_DETAIL_INVALID` via `readDetail()`, and
 * `SCENARIO_UNSUPPORTED` for both "no row for this frequency" and "row
 * present with a null count." Zero/negative/non-integer counts are already
 * structurally impossible per that rule's own schema — no runtime check is
 * added here for them.
 *
 * NO ROUNDING, NO `WITHHOLDING_ROUNDING_POLICY`: Task 4O-6R31 locked
 * rounding entirely outside the formula interpreter, and this operation's
 * pure multiplication needs no precision decision to begin with — unlike
 * `DEANNUALIZE`'s division, which uses `divideHighPrecision()` (see
 * `deannualize()` below) rather than any scale/`RoundingMode`-bearing
 * `divide()` call, for the identical reason.
 *
 * The integer count is converted to `Money` via `money(String(count))` —
 * the same established pattern `subtractAllowances()` already uses for its
 * own integer count, never `money(count)`.
 */
function annualize(
  ruleSet: ResolvedStateRuleSet,
  operandRef: string | null,
  runningValue: Money,
  payFrequency: string | null,
): Read<FormulaStepResult> {
  if (operandRef !== null) {
    return readFail(
      invalidDetail(
        'ANNUALIZE requires a null operandRef; the periods-per-year rule is resolved implicitly',
      ),
    );
  }

  if (payFrequency === null) {
    return readFail(
      stateUnavailable(
        StateReason.SCENARIO_UNSUPPORTED,
        'ANNUALIZE requires a pay frequency; none is available and none is assumed',
        StateRuleKey.WITHHOLDING_PAY_PERIODS_PER_YEAR,
      ),
    );
  }

  const periodsPerYear = resolveStatePayPeriodsPerYear(ruleSet, payFrequency);
  if (!periodsPerYear.ok) {
    return readFail(periodsPerYear.problem);
  }

  return readOk({
    value: multiply(runningValue, money(String(periodsPerYear.value))),
    reference: ruleReference(ruleSet, StateRuleKey.WITHHOLDING_PAY_PERIODS_PER_YEAR),
  });
}

/**
 * `DEANNUALIZE` — Task 4O-6R38/4O-6R43 contract-locked, null `operandRef`.
 *
 * `runningValue = runningValue ÷ periodsPerYear`, the inverse of
 * `annualize()`'s multiplication, using an IDENTICAL contract shape:
 * `operandRef` must be `null` (the same single-implicit-target reasoning —
 * `WITHHOLDING_PAY_PERIODS_PER_YEAR` is the sole `StateRuleKey` ever
 * registered against `COUNT_BY_PAY_PERIOD`), the periods-per-year factor
 * comes EXCLUSIVELY from the existing, unmodified
 * `resolveStatePayPeriodsPerYear(ruleSet, payFrequency)` — no fallback to
 * the generic calculator `periodsPerYear()`, no federal rule keys, no
 * hardcoded frequency table — and `payFrequency` is the same, already-
 * existing interpreter parameter `annualize()` already consumes, never a
 * second/duplicated parameter.
 *
 * `resolveStatePayPeriodsPerYear()`'s own existing, tested failure
 * semantics are propagated verbatim and unchanged: `RULE_MISSING`/
 * `RULE_UNVERIFIED`/`RULE_DETAIL_INVALID` via `readDetail()`, and
 * `SCENARIO_UNSUPPORTED` for both "no row for this frequency" and "row
 * present with a null count," plus `SCENARIO_UNSUPPORTED` for a `null`
 * `payFrequency` itself — identical to `annualize()`'s own null-check.
 *
 * NO ROUNDING: Task 4O-6R31/4O-6R38 lock rounding entirely outside the
 * formula interpreter. Division here uses `divideHighPrecision()`
 * (`lib/core/money.ts`, Task 4O-6R41/4O-6R44) rather than `divide()` —
 * high-precision Decimal arithmetic at this module's configured working
 * precision, explicitly NOT mathematically exact, and never consuming
 * `WITHHOLDING_ROUNDING_POLICY` or any scale/`RoundingMode` of any kind.
 * `resolveStatePayPeriodsPerYear()` already guarantees a strictly positive
 * integer count on its `ok: true` path (schema-enforced), so
 * `divideHighPrecision()`'s zero-divisor throw is structurally unreachable
 * here and is not defensively caught (Task 4O-6R43 Error Propagation Lock).
 *
 * The integer count is converted to `Money` via `money(String(count))` —
 * the same established pattern `annualize()`/`subtractAllowances()` already
 * use for their own integer counts, never `money(count)`.
 */
function deannualize(
  ruleSet: ResolvedStateRuleSet,
  operandRef: string | null,
  runningValue: Money,
  payFrequency: string | null,
): Read<FormulaStepResult> {
  if (operandRef !== null) {
    return readFail(
      invalidDetail(
        'DEANNUALIZE requires a null operandRef; the periods-per-year rule is resolved implicitly',
      ),
    );
  }

  if (payFrequency === null) {
    return readFail(
      stateUnavailable(
        StateReason.SCENARIO_UNSUPPORTED,
        'DEANNUALIZE requires a pay frequency; none is available and none is assumed',
        StateRuleKey.WITHHOLDING_PAY_PERIODS_PER_YEAR,
      ),
    );
  }

  const periodsPerYear = resolveStatePayPeriodsPerYear(ruleSet, payFrequency);
  if (!periodsPerYear.ok) {
    return readFail(periodsPerYear.problem);
  }

  return readOk({
    value: divideHighPrecision(runningValue, money(String(periodsPerYear.value))),
    reference: ruleReference(ruleSet, StateRuleKey.WITHHOLDING_PAY_PERIODS_PER_YEAR),
  });
}

/**
 * Runs a `WITHHOLDING_FORMULA`'s steps, in ascending `ordinal` order, over a
 * single running accumulator, starting from `initialValue`.
 *
 * `SUBTRACT_STANDARD_DEDUCTION`, `FLOOR_AT_ZERO`, `APPLY_BRACKETS`,
 * `SUBTRACT_EXEMPTIONS` (personal-exemption path only), `SUBTRACT_AMOUNT`,
 * `APPLY_FLAT_RATE`, `SUBTRACT_ALLOWANCES`, `ADD_AMOUNT`,
 * `APPLY_PERCENTAGE_OF`, `ANNUALIZE`, and `DEANNUALIZE` are implemented. Any
 * other operation — including `SUBTRACT_EXEMPTIONS` with an operandRef other
 * than `PIT_PERSONAL_EXEMPTION`, or `SUBTRACT_AMOUNT`/`APPLY_FLAT_RATE`/
 * `SUBTRACT_ALLOWANCES`/`ADD_AMOUNT`/`APPLY_PERCENTAGE_OF` with an invalid
 * operandRef, or `ANNUALIZE`/`DEANNUALIZE` with a non-null operandRef —
 * reports `METHOD_NOT_IMPLEMENTED` or `RULE_DETAIL_INVALID` respectively,
 * rather than being silently skipped or executed. Duplicate ordinals are
 * never silently ordered — they report `RULE_CONFLICT`, mirroring
 * `selectStateWithholdingTableRow()`'s identical treatment of ambiguous,
 * contradictory rule data (Task 4N-R).
 *
 * Pure, synchronous, DB-free: `ruleSet` is only read via `readDetail()`,
 * never mutated; `filingStatus` is read, never mutated or mapped;
 * `allowanceCounts` (Task 4O-6R17) is an already-resolved, narrow,
 * `StateRuleKey`-keyed map; `resolvedElections` (Task 4O-6R23) is an
 * already-resolved, narrow, `fieldKey`-keyed map of the current WORK
 * jurisdiction's submitted election values (`resolveWorkJurisdictionElections()`,
 * `lib/tax/state/context.ts`); `payFrequency` (Task 4O-6R33) is a plain
 * per-calculation runtime fact, structurally identical in role to
 * `filingStatus` — never the whole `StateCalculationContext`, and never
 * parsed or validated here (that is the input/context layer's job, Tasks
 * 4O-6R16/4O-6R22).
 */
export function runStateWithholdingFormula(
  detail: StateFormulaStepsDetail,
  ruleSet: ResolvedStateRuleSet,
  initialValue: Money,
  filingStatus: string | null,
  allowanceCounts: Readonly<Partial<Record<StateRuleKey, number | null>>>,
  resolvedElections: Readonly<Partial<Record<string, StateElectionValue | null>>>,
  payFrequency: string | null,
): Read<{ readonly amount: Money; readonly rules: readonly RuleReference[] }> {
  const ordinals = detail.steps.map((step) => step.ordinal);
  if (new Set(ordinals).size !== ordinals.length) {
    return readFail(
      conflict(
        'WITHHOLDING_FORMULA has duplicate step ordinals; execution order is never chosen by preference',
      ),
    );
  }

  const ordered = [...detail.steps].sort((a, b) => a.ordinal - b.ordinal);

  let value = initialValue;
  // DM-03 Slice 23 — accumulates references in first-successful-occurrence
  // order, deduplicated by `ruleId@version`, exactly as `mergeReferences()`
  // already does in `index.ts`/`deriveResolvedStateWageBuckets.ts`.
  // `WITHHOLDING_FORMULA`'s own reference is deliberately never added here
  // (Slice 22, Question A): this interpreter never reads that rule itself —
  // it receives `detail` as an already-resolved parameter — so its own
  // reference belongs to whichever future caller reads it, merged in at
  // that caller's own layer, exactly like `bucket.rules` already is.
  const references = new Map<string, RuleReference>();

  function addReference(reference: RuleReference | undefined): void {
    if (reference === undefined) return;
    references.set(`${reference.ruleId}@${String(reference.version)}`, reference);
  }

  for (const step of ordered) {
    switch (step.operation) {
      case 'FLOOR_AT_ZERO': {
        const result = floorAtZero(step.operandRef, value);
        if (!result.ok) return result;
        value = result.value.value;
        addReference(result.value.reference);
        break;
      }
      case 'SUBTRACT_STANDARD_DEDUCTION': {
        const result = subtractStandardDeduction(ruleSet, filingStatus, step.operandRef, value);
        if (!result.ok) return result;
        value = result.value.value;
        addReference(result.value.reference);
        break;
      }
      case 'APPLY_BRACKETS': {
        const result = applyBrackets(ruleSet, filingStatus, step.operandRef, value);
        if (!result.ok) return result;
        value = result.value.value;
        addReference(result.value.reference);
        break;
      }
      case 'SUBTRACT_EXEMPTIONS': {
        const result = subtractExemptions(ruleSet, filingStatus, step.operandRef, value);
        if (!result.ok) return result;
        value = result.value.value;
        addReference(result.value.reference);
        break;
      }
      case 'SUBTRACT_AMOUNT': {
        const result = subtractAmount(ruleSet, step.operandRef, value);
        if (!result.ok) return result;
        value = result.value.value;
        addReference(result.value.reference);
        break;
      }
      case 'APPLY_FLAT_RATE': {
        const result = applyFlatRate(ruleSet, step.operandRef, value);
        if (!result.ok) return result;
        value = result.value.value;
        addReference(result.value.reference);
        break;
      }
      case 'SUBTRACT_ALLOWANCES': {
        const result = subtractAllowances(ruleSet, step.operandRef, value, allowanceCounts);
        if (!result.ok) return result;
        value = result.value.value;
        addReference(result.value.reference);
        break;
      }
      case 'ADD_AMOUNT': {
        const result = addAmount(ruleSet, step.operandRef, value, resolvedElections);
        if (!result.ok) return result;
        value = result.value.value;
        addReference(result.value.reference);
        break;
      }
      case 'APPLY_PERCENTAGE_OF': {
        const result = applyPercentageOf(ruleSet, step.operandRef, value);
        if (!result.ok) return result;
        value = result.value.value;
        addReference(result.value.reference);
        break;
      }
      case 'ANNUALIZE': {
        const result = annualize(ruleSet, step.operandRef, value, payFrequency);
        if (!result.ok) return result;
        value = result.value.value;
        addReference(result.value.reference);
        break;
      }
      case 'DEANNUALIZE': {
        const result = deannualize(ruleSet, step.operandRef, value, payFrequency);
        if (!result.ok) return result;
        value = result.value.value;
        addReference(result.value.reference);
        break;
      }
      default: {
        return readFail(
          stateUnavailable(
            StateReason.METHOD_NOT_IMPLEMENTED,
            `WITHHOLDING_FORMULA step ${String(step.ordinal)} uses operation "${step.operation}", ` +
              'which this interpreter does not implement yet; no amount is invented',
            FORMULA_RULE_KEY,
            `steps[${String(step.ordinal)}].operation`,
          ),
        );
      }
    }
  }

  return readOk({ amount: value, rules: [...references.values()] });
}

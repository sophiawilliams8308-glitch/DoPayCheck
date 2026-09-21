import { compare, max, money, multiply, subtract, sum, zero, type Money } from '@/lib/core/money';

import { StateReason, stateUnavailable, type StateUnavailable } from '../errors/stateErrors';
import { StateRuleKey } from '../ruleKeys';
import type {
  StateAmountByFilingStatusDetail,
  StateBracketTableDetail,
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
import type { ResolvedStateRuleSet } from './stateRuleSet';

/**
 * State withholding formula interpreter — Task 4O-3A, extended by Tasks
 * 4O-5, 4O-6R6, and 4O-6R12.
 *
 * ===========================================================================
 * IMPLEMENTS SIX OPERATIONS: THE THREE TASK 4O-2 CONTRACT-LOCKED ONES
 * (`SUBTRACT_STANDARD_DEDUCTION`, `FLOOR_AT_ZERO`, `APPLY_BRACKETS`), PLUS
 * `SUBTRACT_EXEMPTIONS`'S PERSONAL-EXEMPTION PATH ONLY (Task 4O-4/4O-5),
 * PLUS `SUBTRACT_AMOUNT` (Task 4O-6R3/4O-6R4/4O-6R5/4O-6R6) — a GENERIC
 * SCALAR AMOUNT PRIMITIVE with no built-in real-world tax meaning: it
 * subtracts whatever `SCALAR_AMOUNT`-shaped rule its `operandRef` names —
 * PLUS `APPLY_FLAT_RATE` (Task 4O-6R9/4O-6R10/4O-6R11/4O-6R12), generic over
 * any `RATE`-shaped `StateRuleKey`.
 *
 * `SUBTRACT_EXEMPTIONS` supports ONLY `operandRef ===
 * StateRuleKey.PIT_PERSONAL_EXEMPTION`. The dependent-exemption path
 * (`PIT_DEPENDENT_EXEMPTION`) remains unresolved — presenting it, or any
 * other operandRef, to `SUBTRACT_EXEMPTIONS` fails `RULE_DETAIL_INVALID`
 * rather than being tolerated or treated as merely unsupported.
 *
 * The remaining six operations (`SUBTRACT_ALLOWANCES`, `ADD_AMOUNT`,
 * `APPLY_PERCENTAGE_OF`, `ANNUALIZE`, `DEANNUALIZE`, `ROUND`) remain
 * contractually unresolved (Task 4O-2 §3/§8) and are never silently
 * executed — encountering one reports `METHOD_NOT_IMPLEMENTED`, mirroring
 * the exact, already-established meaning of that reason elsewhere in the
 * project
 * (`lib/calculator/pipeline/tax-stages.ts`'s `evaluateComponent()`: "the
 * calculation methodology for this category is delivered in a later phase").
 *
 * Execution model (Task 4O-2 §1, locked): steps run in strict `ordinal`
 * order over a single running `Money` accumulator. There is no named
 * intermediate variable and no step-to-step reference — each step reads only
 * the current accumulator and, for `APPLY_BRACKETS`, one named `StateRuleKey`.
 *
 * `operandRef` vocabulary (Task 4O-2 §2, locked): a non-null `operandRef`
 * names a `StateRuleKey` and nothing else — no context-field-name
 * convention is supported.
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
): Read<Money> {
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

  return readOk(subtract(runningValue, deduction.value));
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
): Read<Money> {
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

  return readOk(subtract(runningValue, exemption.value));
}

/**
 * `FLOOR_AT_ZERO` — contract-locked null `operandRef`. Pure arithmetic on the
 * running value; no rule lookup, no rounding.
 */
function floorAtZero(operandRef: string | null, runningValue: Money): Read<Money> {
  if (operandRef !== null) {
    return readFail(invalidDetail('FLOOR_AT_ZERO requires a null operandRef; it takes no operand'));
  }
  return readOk(max(runningValue, zero()));
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
): Read<Money> {
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

  return readOk(slices.length === 0 ? zero() : sum(slices));
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
): Read<Money> {
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

  return readOk(subtract(runningValue, amount.value));
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
): Read<Money> {
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

  return readOk(multiply(runningValue, rate.value));
}

/**
 * Runs a `WITHHOLDING_FORMULA`'s steps, in ascending `ordinal` order, over a
 * single running accumulator, starting from `initialValue`.
 *
 * `SUBTRACT_STANDARD_DEDUCTION`, `FLOOR_AT_ZERO`, `APPLY_BRACKETS`,
 * `SUBTRACT_EXEMPTIONS` (personal-exemption path only), `SUBTRACT_AMOUNT`,
 * and `APPLY_FLAT_RATE` are implemented. Any other operation — including
 * `SUBTRACT_EXEMPTIONS` with an operandRef other than
 * `PIT_PERSONAL_EXEMPTION`, or `SUBTRACT_AMOUNT`/`APPLY_FLAT_RATE` with an
 * invalid operandRef — reports `METHOD_NOT_IMPLEMENTED` or
 * `RULE_DETAIL_INVALID` respectively, rather than being silently skipped or
 * executed. Duplicate ordinals are never silently ordered — they report
 * `RULE_CONFLICT`, mirroring `selectStateWithholdingTableRow()`'s identical
 * treatment of ambiguous, contradictory rule data (Task 4N-R).
 *
 * Pure, synchronous, DB-free: `ruleSet` is only read via `readDetail()`,
 * never mutated; `filingStatus` is read, never mutated or mapped.
 */
export function runStateWithholdingFormula(
  detail: StateFormulaStepsDetail,
  ruleSet: ResolvedStateRuleSet,
  initialValue: Money,
  filingStatus: string | null,
): Read<Money> {
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
  for (const step of ordered) {
    switch (step.operation) {
      case 'FLOOR_AT_ZERO': {
        const result = floorAtZero(step.operandRef, value);
        if (!result.ok) return result;
        value = result.value;
        break;
      }
      case 'SUBTRACT_STANDARD_DEDUCTION': {
        const result = subtractStandardDeduction(ruleSet, filingStatus, step.operandRef, value);
        if (!result.ok) return result;
        value = result.value;
        break;
      }
      case 'APPLY_BRACKETS': {
        const result = applyBrackets(ruleSet, filingStatus, step.operandRef, value);
        if (!result.ok) return result;
        value = result.value;
        break;
      }
      case 'SUBTRACT_EXEMPTIONS': {
        const result = subtractExemptions(ruleSet, filingStatus, step.operandRef, value);
        if (!result.ok) return result;
        value = result.value;
        break;
      }
      case 'SUBTRACT_AMOUNT': {
        const result = subtractAmount(ruleSet, step.operandRef, value);
        if (!result.ok) return result;
        value = result.value;
        break;
      }
      case 'APPLY_FLAT_RATE': {
        const result = applyFlatRate(ruleSet, step.operandRef, value);
        if (!result.ok) return result;
        value = result.value;
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

  return readOk(value);
}

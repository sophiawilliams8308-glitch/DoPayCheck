import { compare, max, money, multiply, subtract, sum, zero, type Money } from '@/lib/core/money';

import { StateReason, stateUnavailable, type StateUnavailable } from '../errors/stateErrors';
import { StateRuleKey } from '../ruleKeys';
import type {
  StateAmountByFilingStatusDetail,
  StateBracketTableDetail,
  StateFormulaStepsDetail,
} from './detailSchemas';
import {
  readDetail,
  readFail,
  readOk,
  readRate,
  requireForFilingStatus,
  type Read,
} from './read-detail';
import type { ResolvedStateRuleSet } from './stateRuleSet';

/**
 * State withholding formula interpreter — Task 4O-3A.
 *
 * ===========================================================================
 * IMPLEMENTS ONLY THE THREE OPERATIONS THE TASK 4O-2 CONTRACT LOCK FULLY
 * ESTABLISHED: `SUBTRACT_STANDARD_DEDUCTION`, `FLOOR_AT_ZERO`,
 * `APPLY_BRACKETS`.
 *
 * The remaining nine operations (`SUBTRACT_EXEMPTIONS`, `SUBTRACT_ALLOWANCES`,
 * `SUBTRACT_AMOUNT`, `ADD_AMOUNT`, `APPLY_FLAT_RATE`, `APPLY_PERCENTAGE_OF`,
 * `ANNUALIZE`, `DEANNUALIZE`, `ROUND`) remain contractually unresolved
 * (Task 4O-2 §3/§8) and are never silently executed — encountering one
 * reports `METHOD_NOT_IMPLEMENTED`, mirroring the exact, already-established
 * meaning of that reason elsewhere in the project
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
 * Runs a `WITHHOLDING_FORMULA`'s steps, in ascending `ordinal` order, over a
 * single running accumulator, starting from `initialValue`.
 *
 * Only `SUBTRACT_STANDARD_DEDUCTION`, `FLOOR_AT_ZERO`, and `APPLY_BRACKETS`
 * are implemented (Task 4O-2's fully locked operations). Any other operation
 * reports `METHOD_NOT_IMPLEMENTED` rather than being silently skipped or
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

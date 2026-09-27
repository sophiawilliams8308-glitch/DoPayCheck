import { add, max, money, multiply, subtract, zero, type Money } from '@/lib/core/money';
import type { RuleReference } from '@/lib/calculator/types/rules';

import { StateReason, stateUnavailable } from '../errors/stateErrors';
import { StateRuleKey } from '../ruleKeys';
import type {
  StateAmountByFilingStatusDetail,
  StateAmountPerAllowanceDetail,
  StateWithholdingTableDetail,
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
import { selectStateWithholdingTableRow } from './withholdingTable';

/**
 * State withholding TABLE arithmetic — DM-03 Slice 33, implementing the
 * Slice 32 LOCKED architecture (OPTION C — TABLE-SIDE AUTHORING MECHANISM)
 * and the Slice 30 locked arithmetic formula.
 *
 * ===========================================================================
 * WHAT THIS MODULE DOES.
 *
 * Given an already-read `WITHHOLDING_TABLE` detail, this module:
 *   1. Applies every jurisdiction-DECLARED adjustment (`detail.adjustments`)
 *      to the supplied wage, in declaration order — never automatically,
 *      never universally. An absent/empty `adjustments` array means no
 *      adjustment runs, and the wage passed to row selection is unchanged.
 *   2. Selects exactly one row via the existing, UNMODIFIED
 *      `selectStateWithholdingTableRow()` — this module never duplicates
 *      filing-status, pay-frequency, or wage-interval matching.
 *   3. Computes the Slice 30 LOCKED, unrounded formula:
 *        excess = max(wage - (wageFrom ?? 0), 0)
 *        withholding = requireStated(baseWithholding) + rate * excess
 *
 * It does NOT round (that is the shared `TAX_LEVEL` step in `index.ts`, per
 * Slice 28), does NOT read `WITHHOLDING_ROUNDING_POLICY`, does NOT capture
 * `WITHHOLDING_TABLE`'s own container reference (captured at the orchestrator
 * layer in `index.ts`, exactly mirroring how `WITHHOLDING_FORMULA`'s
 * container reference is captured there and never inside the formula
 * interpreter — Slice 22 Question A / Slice 23 / Slice 30 §10), and does NOT
 * implement `WITHHOLDING_PAY_PERIODS_PER_YEAR`, annualization, or
 * deannualization for TABLE (Slice 29/30: TABLE rows are per-period, matched
 * by exact `payFrequency` equality, never converted).
 *
 * ===========================================================================
 * WHY THIS IS NOT A SECOND FORMULA INTERPRETER.
 *
 * `detail.adjustments` is a closed, two-member vocabulary
 * (`WITHHOLDING_ALLOWANCE_VALUE`, `WITHHOLDING_STANDARD_DEDUCTION`),
 * schema-enforced (`detailSchemas.ts`'s `StateTableAdjustmentRuleKey`) —
 * never a free-form `operandRef` validated at runtime against the full
 * `VALID_RULE_KEYS` set the way `WITHHOLDING_FORMULA.steps[]` is. There is no
 * `operation`, no expression, no arbitrary sequence of primitives: each
 * declared entry names WHICH of exactly two existing rules supplies an
 * amount, and this module applies that one rule's own, already-established
 * subtraction semantics (mirrored from, not imported from,
 * `withholdingFormulaInterpreter.ts`'s `SUBTRACT_STANDARD_DEDUCTION`/
 * `SUBTRACT_ALLOWANCES` — that module is never imported here, and this one
 * is never imported there). `PIT_STANDARD_DEDUCTION`, `PIT_PERSONAL_EXEMPTION`,
 * and `PIT_DEPENDENT_EXEMPTION` cannot be named by a TABLE adjustment at all
 * — the schema itself has no member for them (Slice 31/32, reaffirmed).
 *
 * ===========================================================================
 * NO IMPLICIT CLAMP.
 *
 * Neither adjustment clamps the running wage at zero after subtracting —
 * mirroring `subtractStandardDeduction()`/`subtractAllowances()`'s own
 * unclamped behavior in the formula interpreter (verified before writing
 * this module, per Slice 33 §21): FORMULA defers clamping to a separately
 * jurisdiction-authored `FLOOR_AT_ZERO` step, which TABLE has no equivalent
 * declaration for. A wage driven negative by a declared adjustment simply
 * will not match any real row's `[wageFrom, wageTo)` interval, and
 * `selectStateWithholdingTableRow()` reports that as `RULE_CONFLICT` ("the
 * table has a gap") — a correct, existing, non-fabricated failure mode, not
 * a new one invented here.
 * ===========================================================================
 */

/**
 * Fetches a rule's `RuleReference` via a second, independent `stateRule()`
 * call — the same established pattern already used identically in
 * `withholdingFormulaInterpreter.ts`, `index.ts`, `calculateSuta.ts`, and
 * `calculateSdi.ts`, reused here rather than reinvented.
 */
function ruleReference(
  ruleSet: ResolvedStateRuleSet,
  key: StateRuleKey,
): RuleReference | undefined {
  const entry = stateRule(ruleSet, key);
  return entry.available ? entry.rule.reference : undefined;
}

interface AdjustmentStepResult {
  readonly wage: Money;
  readonly reference: RuleReference | undefined;
}

/**
 * Mirrors `withholdingFormulaInterpreter.ts`'s `subtractStandardDeduction()`
 * semantics exactly (filing-status-keyed amount, `requireForFilingStatus()`,
 * plain subtraction, no clamp) against `WITHHOLDING_STANDARD_DEDUCTION`
 * instead of `WITHHOLDING_FORMULA`'s own operand — never
 * `PIT_STANDARD_DEDUCTION`, which this function never reads.
 */
function applyStandardDeductionAdjustment(
  ruleSet: ResolvedStateRuleSet,
  filingStatus: string | null,
  wage: Money,
): Read<AdjustmentStepResult> {
  const key = StateRuleKey.WITHHOLDING_STANDARD_DEDUCTION;

  if (filingStatus === null) {
    return readFail(
      stateUnavailable(
        StateReason.SCENARIO_UNSUPPORTED,
        'A declared WITHHOLDING_STANDARD_DEDUCTION table adjustment requires a filing status; ' +
          'none is available and none is assumed',
        key,
      ),
    );
  }

  const found = readDetail(ruleSet, key);
  if (!found.ok) {
    return readFail(found.problem);
  }

  const detail = found.value.detail as StateAmountByFilingStatusDetail;
  const deduction = requireForFilingStatus(detail.amounts, filingStatus, key, 'amounts');
  if (!deduction.ok) {
    return readFail(deduction.problem);
  }

  return readOk({
    wage: subtract(wage, deduction.value),
    reference: ruleReference(ruleSet, key),
  });
}

/**
 * Mirrors `withholdingFormulaInterpreter.ts`'s `subtractAllowances()`
 * semantics exactly (`AMOUNT_PER_ALLOWANCE` shape, `NOT_APPLICABLE` check,
 * required amount, required allowance count, multiply-then-subtract, no
 * clamp) against `WITHHOLDING_ALLOWANCE_VALUE` — the one allowance rule key
 * Slice 32 locked as TABLE-eligible.
 */
function applyAllowanceAdjustment(
  ruleSet: ResolvedStateRuleSet,
  allowanceCounts: Readonly<Partial<Record<StateRuleKey, number | null>>>,
  wage: Money,
): Read<AdjustmentStepResult> {
  const key = StateRuleKey.WITHHOLDING_ALLOWANCE_VALUE;

  const found = readDetail(ruleSet, key);
  if (!found.ok) {
    return readFail(found.problem);
  }

  const detail = found.value.detail as StateAmountPerAllowanceDetail;
  if (detail.applicability === 'NOT_APPLICABLE') {
    return readFail(
      stateUnavailable(
        StateReason.SCENARIO_UNSUPPORTED,
        'A declared WITHHOLDING_ALLOWANCE_VALUE table adjustment is NOT_APPLICABLE in this ' +
          'jurisdiction; no allowance value is assumed',
        key,
      ),
    );
  }

  const amount = requireComponent(detail.amount, key, 'amount');
  if (!amount.ok) {
    return readFail(amount.problem);
  }

  const count = allowanceCounts[key];
  if (count === undefined || count === null) {
    return readFail(
      stateUnavailable(
        StateReason.COMPONENT_NOT_STATED,
        'A declared WITHHOLDING_ALLOWANCE_VALUE table adjustment has no allowance count ' +
          'supplied; it is not stated, and none is assumed',
        key,
        'allowanceCount',
      ),
    );
  }

  return readOk({
    wage: subtract(wage, multiply(amount.value, money(String(count)))),
    reference: ruleReference(ruleSet, key),
  });
}

/**
 * Runs the declared TABLE adjustments (if any), selects the row via the
 * existing selector, and computes the Slice 30 locked, UNROUNDED withholding
 * amount.
 *
 * @param detail Already-read `WITHHOLDING_TABLE` detail.
 * @param ruleSet The resolved rule set — used only to read a declared
 *   adjustment's own rule (`WITHHOLDING_STANDARD_DEDUCTION`/
 *   `WITHHOLDING_ALLOWANCE_VALUE`), never to read `WITHHOLDING_TABLE` again.
 * @param initialWage The wage `stateIncomeTaxWages` bucket amount, before any
 *   TABLE-declared adjustment.
 * @param filingStatus State-native, exactly as supplied — never mapped
 *   through `WITHHOLDING_FILING_STATUS_MAP`.
 * @param payFrequency Matched by exact equality against each row's own
 *   `payFrequency` — no conversion, no `WITHHOLDING_PAY_PERIODS_PER_YEAR`.
 * @param allowanceCounts Consulted ONLY if a `WITHHOLDING_ALLOWANCE_VALUE`
 *   adjustment is declared — never read otherwise.
 */
export function runStateWithholdingTable(
  detail: StateWithholdingTableDetail,
  ruleSet: ResolvedStateRuleSet,
  initialWage: Money,
  filingStatus: string | null,
  payFrequency: string,
  allowanceCounts: Readonly<Partial<Record<StateRuleKey, number | null>>>,
): Read<{ readonly amount: Money; readonly rules: readonly RuleReference[] }> {
  const adjustments = detail.adjustments ?? [];

  let wage = initialWage;
  const references = new Map<string, RuleReference>();
  function addReference(reference: RuleReference | undefined): void {
    if (reference === undefined) {
      return;
    }
    references.set(`${reference.ruleId}@${String(reference.version)}`, reference);
  }

  for (const adjustment of adjustments) {
    // `application` is schema-restricted to exactly 'BEFORE_TABLE' today
    // (detailSchemas.ts) — applied to the wage before row selection, never
    // re-checked here, since no other value can pass schema validation.
    const result =
      adjustment.ruleKey === StateRuleKey.WITHHOLDING_STANDARD_DEDUCTION
        ? applyStandardDeductionAdjustment(ruleSet, filingStatus, wage)
        : applyAllowanceAdjustment(ruleSet, allowanceCounts, wage);

    if (!result.ok) {
      return readFail(result.problem);
    }
    wage = result.value.wage;
    addReference(result.value.reference);
  }

  const rowResult = selectStateWithholdingTableRow(detail, filingStatus, payFrequency, wage);
  if (!rowResult.ok) {
    return readFail(rowResult.problem);
  }
  const row = rowResult.value;

  // Slice 30 LOCKED FORMULA — never reopened:
  //   excess = max(wage - (wageFrom ?? 0), 0)
  //   withholding = requireStated(baseWithholding) + rate * excess
  const baseWithholding = requireComponent(
    row.baseWithholding,
    StateRuleKey.WITHHOLDING_TABLE,
    `rows[${String(row.ordinal)}].baseWithholding`,
  );
  if (!baseWithholding.ok) {
    return readFail(baseWithholding.problem);
  }

  const rate = readRate(
    row.rate,
    row.unit,
    StateRuleKey.WITHHOLDING_TABLE,
    `rows[${String(row.ordinal)}].rate`,
  );
  if (!rate.ok) {
    return readFail(rate.problem);
  }

  const lowerBound = row.wageFrom === null ? zero() : money(row.wageFrom);
  const excess = max(subtract(wage, lowerBound), zero());
  const withholding = add(baseWithholding.value, multiply(excess, rate.value));

  return readOk({
    amount: withholding,
    rules: [...references.values()],
  });
}

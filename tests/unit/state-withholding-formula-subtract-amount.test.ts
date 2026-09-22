import { describe, expect, it } from 'vitest';

import { money } from '@/lib/core/money';
import type { RuleReference } from '@/lib/calculator/types/rules';
import { runStateWithholdingFormula } from '@/lib/tax/state/rules/withholdingFormulaInterpreter';
import {
  freezeStateRuleSet,
  type ResolvedStateRule,
  type ResolvedStateRuleSet,
  type StateRuleEntry,
} from '@/lib/tax/state/rules/stateRuleSet';
import { StateRuleKey } from '@/lib/tax/state/ruleKeys';
import type { StateFormulaStepsDetail } from '@/lib/tax/state/rules/detailSchemas';

/**
 * `SUBTRACT_AMOUNT` — generic scalar amount primitive (Task 4O-6R3-4O-6R6).
 *
 * ===========================================================================
 * KNOWN, DISCLOSED TESTING GAP — READ BEFORE EXTENDING THIS FILE.
 *
 * `SUBTRACT_AMOUNT` requires its `operandRef` to resolve to a rule whose
 * detail is `SCALAR_AMOUNT`-shaped (`stateScalarAmountDetailSchema`, Task
 * 4O-6R5). `readDetail()` validates a resolved rule's detail against
 * whichever schema is REGISTERED for that specific `StateRuleKey` in
 * `STATE_DETAIL_SCHEMAS` (`detailSchemas.ts`) — and, per the Task 4O-6R4
 * lock, NO `StateRuleKey` is registered against `SCALAR_AMOUNT` (inventing
 * one "solely to exercise this architecture" is explicitly forbidden).
 * `readDetail()`'s own generic type constraint
 * (`K extends keyof StateDetailSchemas & StateRuleKey`) further means it can
 * only ever be called with an already-registered production key — there is
 * no admissible "test-only key" that bypasses this.
 *
 * CONSEQUENCE: no test in this file can exercise a SUCCESSFUL
 * `SUBTRACT_AMOUNT` resolution (a real subtraction happening), because doing
 * so requires at least one `StateRuleKey` whose registered schema is
 * `SCALAR_AMOUNT`, and none exists. This file therefore covers every
 * FAILURE path reachable without such a key (operandRef validation, missing/
 * unverified/wrong-shape referenced rule) and the operation's correct wiring
 * into formula dispatch. The success-path tests (basic subtraction, decimal
 * precision, ANNUAL/PER_PERIOD acceptance, null-amount ->
 * COMPONENT_NOT_STATED, multiple steps, zero amount, negative amount) are
 * BLOCKED pending an explicit owner decision — see the Task 4O-6R6 report.
 * ===========================================================================
 *
 * Fixtures use RESERVED TEST jurisdiction/source ids and no real tax value.
 */

const JURISDICTION_CODE = 'TEST-SUBTRACT-AMOUNT';
const JURISDICTION_ID = 'test-subtract-amount-jurisdiction-id';
const TAX_YEAR = 2099;
const EFFECTIVE = '2099-06-15T00:00:00.000Z';
const SINGLE = 'SINGLE';

function reference(ruleKey: string): RuleReference {
  return {
    ruleId: `synthetic-${ruleKey}`,
    ruleKey,
    version: 1,
    category: 'STATE_WITHHOLDING',
    taxYear: TAX_YEAR,
    jurisdictionId: JURISDICTION_ID,
    jurisdictionCode: JURISDICTION_CODE,
    effectiveFrom: new Date('2099-01-01T00:00:00.000Z'),
    effectiveTo: null,
    sourceIds: [`synthetic-source-${ruleKey}`],
    verified: true,
  };
}

function availableEntry(
  key: StateRuleKey,
  detail: unknown,
  overrides: { verificationStatus?: string } = {},
): { available: true; rule: ResolvedStateRule } {
  return {
    available: true,
    rule: {
      key,
      reference: reference(key),
      detail,
      verificationStatus: overrides.verificationStatus ?? 'VERIFIED',
    },
  };
}

function buildRuleSet(
  entries: Partial<Record<StateRuleKey, StateRuleEntry>>,
): ResolvedStateRuleSet {
  return freezeStateRuleSet({
    taxYear: TAX_YEAR,
    effectiveDate: EFFECTIVE,
    jurisdictionCode: JURISDICTION_CODE,
    engineVersion: 'test-engine',
    resolvedAt: EFFECTIVE,
    missing: [],
    entries,
    ruleReferences: [],
    sourceIds: [],
  });
}

function formulaDetail(steps: readonly Record<string, unknown>[]): StateFormulaStepsDetail {
  return { shape: 'FORMULA_STEPS', steps } as StateFormulaStepsDetail;
}

const step = (
  ordinal: number,
  operation: string,
  operandRef: string | null = null,
): Record<string, unknown> => ({ ordinal, operation, operandRef, note: null });

describe('SUBTRACT_AMOUNT — operandRef validation', () => {
  it('reports RULE_DETAIL_INVALID for a null operandRef', () => {
    const ruleSet = buildRuleSet({});
    const detail = formulaDetail([step(0, 'SUBTRACT_AMOUNT', null)]);

    const result = runStateWithholdingFormula(detail, ruleSet, money('1000'), SINGLE, {}, {});

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.problem.reason).toBe('RULE_DETAIL_INVALID');
  });

  it('reports RULE_DETAIL_INVALID for an operandRef that is not a known StateRuleKey', () => {
    const ruleSet = buildRuleSet({});
    const detail = formulaDetail([step(0, 'SUBTRACT_AMOUNT', 'NOT_A_REAL_STATE_RULE_KEY')]);

    const result = runStateWithholdingFormula(detail, ruleSet, money('1000'), SINGLE, {}, {});

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.problem.reason).toBe('RULE_DETAIL_INVALID');
  });

  it('does not treat a valid operandRef string as an election field, filing status, or database id', () => {
    // A syntactically plausible but non-StateRuleKey identifier must still
    // fail — this operation never interprets operandRef as anything but a
    // StateRuleKey reference.
    const ruleSet = buildRuleSet({});
    const detail = formulaDetail([step(0, 'SUBTRACT_AMOUNT', 'extra_withholding_amount')]);

    const result = runStateWithholdingFormula(detail, ruleSet, money('1000'), SINGLE, {}, {});

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.problem.reason).toBe('RULE_DETAIL_INVALID');
  });
});

describe('SUBTRACT_AMOUNT — referenced rule missing', () => {
  it('reports RULE_MISSING when the named rule was never resolved', () => {
    const ruleSet = buildRuleSet({});
    const detail = formulaDetail([step(0, 'SUBTRACT_AMOUNT', StateRuleKey.PIT_FLAT_RATE)]);

    const result = runStateWithholdingFormula(detail, ruleSet, money('1000'), SINGLE, {}, {});

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.problem.reason).toBe('RULE_MISSING');
  });
});

describe('SUBTRACT_AMOUNT — referenced rule unverified', () => {
  it('reports RULE_UNVERIFIED for a PENDING referenced rule, checked before any shape validation', () => {
    const key = StateRuleKey.PIT_FLAT_RATE;
    const ruleSet = buildRuleSet({
      [key]: availableEntry(
        key,
        {
          shape: 'RATE',
          rate: '0.05',
          unit: 'DECIMAL_FRACTION',
          appliesTo: 'EMPLOYEE',
          applicability: 'APPLIES',
        },
        { verificationStatus: 'PENDING' },
      ),
    });
    const detail = formulaDetail([step(0, 'SUBTRACT_AMOUNT', key)]);

    const result = runStateWithholdingFormula(detail, ruleSet, money('1000'), SINGLE, {}, {});

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.problem.reason).toBe('RULE_UNVERIFIED');
  });
});

describe('SUBTRACT_AMOUNT — referenced rule has the wrong detail shape', () => {
  it('reports RULE_DETAIL_INVALID when the referenced rule resolves to RATE, not SCALAR_AMOUNT', () => {
    const key = StateRuleKey.PIT_FLAT_RATE;
    const ruleSet = buildRuleSet({
      [key]: availableEntry(key, {
        shape: 'RATE',
        rate: '0.05',
        unit: 'DECIMAL_FRACTION',
        appliesTo: 'EMPLOYEE',
        applicability: 'APPLIES',
      }),
    });
    const detail = formulaDetail([step(0, 'SUBTRACT_AMOUNT', key)]);

    const result = runStateWithholdingFormula(detail, ruleSet, money('1000'), SINGLE, {}, {});

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.problem.reason).toBe('RULE_DETAIL_INVALID');
  });

  it('reports RULE_DETAIL_INVALID when the referenced rule resolves to AMOUNT_BY_FILING_STATUS, not SCALAR_AMOUNT', () => {
    const key = StateRuleKey.WITHHOLDING_STANDARD_DEDUCTION;
    const ruleSet = buildRuleSet({
      [key]: availableEntry(key, {
        shape: 'AMOUNT_BY_FILING_STATUS',
        unit: 'ANNUAL',
        amounts: [{ filingStatus: SINGLE, amount: '1000' }],
      }),
    });
    const detail = formulaDetail([step(0, 'SUBTRACT_AMOUNT', key)]);

    const result = runStateWithholdingFormula(detail, ruleSet, money('1000'), SINGLE, {}, {});

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.problem.reason).toBe('RULE_DETAIL_INVALID');
  });

  it('reports RULE_DETAIL_INVALID for a detail that claims SCALAR_AMOUNT shape but is malformed for its registered key', () => {
    // No StateRuleKey is registered against SCALAR_AMOUNT (Task 4O-6R4), so
    // readDetail() validates this payload against PIT_FLAT_RATE's own
    // registered RATE schema, which it fails regardless of its claimed
    // "shape" value.
    const key = StateRuleKey.PIT_FLAT_RATE;
    const ruleSet = buildRuleSet({
      [key]: availableEntry(key, {
        shape: 'SCALAR_AMOUNT',
        unit: 'BOGUS_UNIT',
        amount: 'not-a-decimal',
      }),
    });
    const detail = formulaDetail([step(0, 'SUBTRACT_AMOUNT', key)]);

    const result = runStateWithholdingFormula(detail, ruleSet, money('1000'), SINGLE, {}, {});

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.problem.reason).toBe('RULE_DETAIL_INVALID');
  });
});

describe('SUBTRACT_AMOUNT — formula dispatch wiring', () => {
  it('is actually routed through runStateWithholdingFormula(), not silently skipped', () => {
    // Proves SUBTRACT_AMOUNT reaches its own handler rather than falling
    // through to the generic METHOD_NOT_IMPLEMENTED default: an operandRef
    // validation failure (RULE_DETAIL_INVALID) is only possible if the
    // dedicated handler ran.
    const ruleSet = buildRuleSet({});
    const detail = formulaDetail([step(0, 'SUBTRACT_AMOUNT', null)]);

    const result = runStateWithholdingFormula(detail, ruleSet, money('500'), SINGLE, {}, {});

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.problem.reason).not.toBe('METHOD_NOT_IMPLEMENTED');
    expect(result.problem.reason).toBe('RULE_DETAIL_INVALID');
  });

  it('short-circuits a later step once SUBTRACT_AMOUNT fails', () => {
    const ruleSet = buildRuleSet({});
    const detail = formulaDetail([
      step(0, 'SUBTRACT_AMOUNT', StateRuleKey.PIT_FLAT_RATE),
      step(1, 'FLOOR_AT_ZERO'),
    ]);

    const result = runStateWithholdingFormula(detail, ruleSet, money('1000'), SINGLE, {}, {});

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.problem.reason).toBe('RULE_MISSING');
  });
});

describe('SUBTRACT_AMOUNT — unrelated operations remain unaffected', () => {
  it('still reports METHOD_NOT_IMPLEMENTED for APPLY_PERCENTAGE_OF, unaffected by SUBTRACT_AMOUNT support', () => {
    const ruleSet = buildRuleSet({});
    const detail = formulaDetail([step(0, 'APPLY_PERCENTAGE_OF')]);

    const result = runStateWithholdingFormula(detail, ruleSet, money('100'), SINGLE, {}, {});

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.problem.reason).toBe('METHOD_NOT_IMPLEMENTED');
  });
});

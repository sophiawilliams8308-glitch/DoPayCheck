import { describe, expect, it } from 'vitest';

import { money, toStorageString } from '@/lib/core/money';
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
 * `SUBTRACT_ALLOWANCES` — generic over `AMOUNT_PER_ALLOWANCE`-shaped
 * `StateRuleKey`s (Task 4O-6R14/4O-6R15/4O-6R16/4O-6R17).
 *
 * ===========================================================================
 * SCOPE NOTE.
 *
 * `operandRef` is validated generically against `VALID_RULE_KEYS`, never
 * hard-coded to `StateRuleKey.WITHHOLDING_ALLOWANCE_VALUE` (Task 4O-6R15 §6).
 * `WITHHOLDING_ALLOWANCE_VALUE` is used below only because it is the one
 * existing, already-registered `AMOUNT_PER_ALLOWANCE`-shaped production key —
 * its synthetic fixture data here is not authoritative tax data, exactly as
 * `PIT_RATE_BRACKETS`/`PIT_FLAT_RATE` are already used synthetically in the
 * `APPLY_BRACKETS`/`APPLY_FLAT_RATE` tests. `allowanceType` is descriptive
 * metadata only (Task 4O-6R15 §7) — never a lookup key; the allowance count
 * is matched by `operandRef`/`StateRuleKey` alone, via the fifth
 * `allowanceCounts` parameter `runStateWithholdingFormula()` now takes (Task
 * 4O-6R17 interpreter signature change).
 * ===========================================================================
 *
 * Fixtures use RESERVED TEST jurisdiction/source ids and no real tax value.
 */

const JURISDICTION_CODE = 'TEST-SUBTRACT-ALLOWANCES';
const JURISDICTION_ID = 'test-subtract-allowances-jurisdiction-id';
const TAX_YEAR = 2099;
const EFFECTIVE = '2099-06-15T00:00:00.000Z';
const ALLOWANCE_KEY = StateRuleKey.WITHHOLDING_ALLOWANCE_VALUE;
const OTHER_KEY = StateRuleKey.PIT_FLAT_RATE;
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

function allowanceDetail(overrides: {
  amount: string | null;
  unit?: 'ANNUAL' | 'PER_PERIOD';
  allowanceType?: string;
  applicability?: 'APPLIES' | 'NOT_APPLICABLE';
}) {
  return {
    shape: 'AMOUNT_PER_ALLOWANCE',
    unit: overrides.unit ?? 'ANNUAL',
    allowanceType: overrides.allowanceType ?? 'PERSONAL',
    amount: overrides.amount,
    applicability: overrides.applicability ?? 'APPLIES',
  };
}

const step = (
  ordinal: number,
  operation: string,
  operandRef: string | null = null,
): Record<string, unknown> => ({ ordinal, operation, operandRef, note: null });

describe('SUBTRACT_ALLOWANCES — arithmetic', () => {
  it('subtracts amount x count for a single allowance', () => {
    const ruleSet = buildRuleSet({
      [ALLOWANCE_KEY]: availableEntry(ALLOWANCE_KEY, allowanceDetail({ amount: '100' })),
    });
    const detail = formulaDetail([step(0, 'SUBTRACT_ALLOWANCES', ALLOWANCE_KEY)]);

    const result = runStateWithholdingFormula(
      detail,
      ruleSet,
      money('1000'),
      SINGLE,
      {
        [ALLOWANCE_KEY]: 1,
      },
      {},
      null,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    // 1000 - (100 * 1) = 900.
    expect(toStorageString(result.value.amount)).toBe('900');
  });

  it('subtracts amount x count for a count greater than one', () => {
    const ruleSet = buildRuleSet({
      [ALLOWANCE_KEY]: availableEntry(ALLOWANCE_KEY, allowanceDetail({ amount: '100' })),
    });
    const detail = formulaDetail([step(0, 'SUBTRACT_ALLOWANCES', ALLOWANCE_KEY)]);

    const result = runStateWithholdingFormula(
      detail,
      ruleSet,
      money('1000'),
      SINGLE,
      {
        [ALLOWANCE_KEY]: 4,
      },
      {},
      null,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    // 1000 - (100 * 4) = 600.
    expect(toStorageString(result.value.amount)).toBe('600');
  });

  it('subtracts zero and leaves the running value unchanged for a count of zero', () => {
    const ruleSet = buildRuleSet({
      [ALLOWANCE_KEY]: availableEntry(ALLOWANCE_KEY, allowanceDetail({ amount: '100' })),
    });
    const detail = formulaDetail([step(0, 'SUBTRACT_ALLOWANCES', ALLOWANCE_KEY)]);

    const result = runStateWithholdingFormula(
      detail,
      ruleSet,
      money('1000'),
      SINGLE,
      {
        [ALLOWANCE_KEY]: 0,
      },
      {},
      null,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(toStorageString(result.value.amount)).toBe('1000');
  });
});

describe('SUBTRACT_ALLOWANCES — sequential accumulator behavior', () => {
  it('operates on the running value left by a preceding formula step', () => {
    const deductionKey = StateRuleKey.WITHHOLDING_STANDARD_DEDUCTION;
    const ruleSet = buildRuleSet({
      [deductionKey]: availableEntry(deductionKey, {
        shape: 'AMOUNT_BY_FILING_STATUS',
        unit: 'ANNUAL',
        amounts: [{ filingStatus: SINGLE, amount: '200' }],
      }),
      [ALLOWANCE_KEY]: availableEntry(ALLOWANCE_KEY, allowanceDetail({ amount: '50' })),
    });
    const detail = formulaDetail([
      step(0, 'SUBTRACT_STANDARD_DEDUCTION'),
      step(1, 'SUBTRACT_ALLOWANCES', ALLOWANCE_KEY),
    ]);

    const result = runStateWithholdingFormula(
      detail,
      ruleSet,
      money('1000'),
      SINGLE,
      {
        [ALLOWANCE_KEY]: 2,
      },
      {},
      null,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    // 1000 - 200 = 800; 800 - (50 * 2) = 700.
    expect(toStorageString(result.value.amount)).toBe('700');
  });
});

describe('SUBTRACT_ALLOWANCES — allowance count resolution', () => {
  it('reports COMPONENT_NOT_STATED when no count is supplied for the operandRef key', () => {
    const ruleSet = buildRuleSet({
      [ALLOWANCE_KEY]: availableEntry(ALLOWANCE_KEY, allowanceDetail({ amount: '100' })),
    });
    const detail = formulaDetail([step(0, 'SUBTRACT_ALLOWANCES', ALLOWANCE_KEY)]);

    const result = runStateWithholdingFormula(detail, ruleSet, money('1000'), SINGLE, {}, {}, null);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.problem.reason).toBe('COMPONENT_NOT_STATED');
  });

  it('reports COMPONENT_NOT_STATED when the supplied count map holds null for the key', () => {
    const ruleSet = buildRuleSet({
      [ALLOWANCE_KEY]: availableEntry(ALLOWANCE_KEY, allowanceDetail({ amount: '100' })),
    });
    const detail = formulaDetail([step(0, 'SUBTRACT_ALLOWANCES', ALLOWANCE_KEY)]);

    const result = runStateWithholdingFormula(
      detail,
      ruleSet,
      money('1000'),
      SINGLE,
      {
        [ALLOWANCE_KEY]: null,
      },
      {},
      null,
    );

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.problem.reason).toBe('COMPONENT_NOT_STATED');
  });

  it('does not re-validate a negative count; that is rejected by input validation before the handler runs', () => {
    // Negative counts are rejected by the input/context validation layer
    // (Task 4O-6R16's non-negative-integer Zod schema) before this map is
    // ever constructed. This handler performs no independent range check —
    // it simply converts whatever integer it is given via money(String(count)).
    const ruleSet = buildRuleSet({
      [ALLOWANCE_KEY]: availableEntry(ALLOWANCE_KEY, allowanceDetail({ amount: '100' })),
    });
    const detail = formulaDetail([step(0, 'SUBTRACT_ALLOWANCES', ALLOWANCE_KEY)]);

    const result = runStateWithholdingFormula(
      detail,
      ruleSet,
      money('1000'),
      SINGLE,
      {
        [ALLOWANCE_KEY]: -1,
      },
      {},
      null,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    // 1000 - (100 * -1) = 1100 — not a rejection, since no second validation
    // layer exists here by design.
    expect(toStorageString(result.value.amount)).toBe('1100');
  });

  it('does not re-validate a fractional count; that is rejected by input validation before the handler runs', () => {
    const ruleSet = buildRuleSet({
      [ALLOWANCE_KEY]: availableEntry(ALLOWANCE_KEY, allowanceDetail({ amount: '100' })),
    });
    const detail = formulaDetail([step(0, 'SUBTRACT_ALLOWANCES', ALLOWANCE_KEY)]);

    const result = runStateWithholdingFormula(
      detail,
      ruleSet,
      money('1000'),
      SINGLE,
      {
        [ALLOWANCE_KEY]: 1.5,
      },
      {},
      null,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    // 1000 - (100 * 1.5) = 850 — money(String(1.5)) converts exactly; no
    // fractional-count rejection exists in this handler by design.
    expect(toStorageString(result.value.amount)).toBe('850');
  });

  it('uses only the count keyed to the operandRef actually used, ignoring an unrelated key in the same map', () => {
    const ruleSet = buildRuleSet({
      [ALLOWANCE_KEY]: availableEntry(ALLOWANCE_KEY, allowanceDetail({ amount: '100' })),
    });
    const detail = formulaDetail([step(0, 'SUBTRACT_ALLOWANCES', ALLOWANCE_KEY)]);

    const result = runStateWithholdingFormula(
      detail,
      ruleSet,
      money('1000'),
      SINGLE,
      {
        [ALLOWANCE_KEY]: 2,
        [OTHER_KEY]: 99,
      },
      {},
      null,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    // 1000 - (100 * 2) = 800 — the decoy count under an unrelated key (99)
    // must never be substituted for the operandRef's own count.
    expect(toStorageString(result.value.amount)).toBe('800');
  });

  it('does not use allowanceType to look up the count, even when it coincidentally matches a key in the map', () => {
    const ruleSet = buildRuleSet({
      [ALLOWANCE_KEY]: availableEntry(
        ALLOWANCE_KEY,
        allowanceDetail({ amount: '100', allowanceType: 'PIT_FLAT_RATE' }),
      ),
    });
    const detail = formulaDetail([step(0, 'SUBTRACT_ALLOWANCES', ALLOWANCE_KEY)]);

    const result = runStateWithholdingFormula(
      detail,
      ruleSet,
      money('1000'),
      SINGLE,
      {
        [ALLOWANCE_KEY]: 3,
        [OTHER_KEY]: 99,
      },
      {},
      null,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    // allowanceType is 'PIT_FLAT_RATE', matching OTHER_KEY's map entry (99)
    // by string coincidence — the count used must still be ALLOWANCE_KEY's
    // own (3), proving lookup is by StateRuleKey/operandRef only.
    // 1000 - (100 * 3) = 700.
    expect(toStorageString(result.value.amount)).toBe('700');
  });
});

describe('SUBTRACT_ALLOWANCES — operandRef validation', () => {
  it('reports RULE_DETAIL_INVALID for a null operandRef', () => {
    const ruleSet = buildRuleSet({});
    const detail = formulaDetail([step(0, 'SUBTRACT_ALLOWANCES', null)]);

    const result = runStateWithholdingFormula(detail, ruleSet, money('1000'), SINGLE, {}, {}, null);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.problem.reason).toBe('RULE_DETAIL_INVALID');
  });

  it('reports RULE_DETAIL_INVALID for an operandRef that is not a known StateRuleKey', () => {
    const ruleSet = buildRuleSet({});
    const detail = formulaDetail([step(0, 'SUBTRACT_ALLOWANCES', 'NOT_A_REAL_STATE_RULE_KEY')]);

    const result = runStateWithholdingFormula(detail, ruleSet, money('1000'), SINGLE, {}, {}, null);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.problem.reason).toBe('RULE_DETAIL_INVALID');
  });
});

describe('SUBTRACT_ALLOWANCES — referenced rule missing/unverified/malformed', () => {
  it('reports RULE_MISSING when the named rule was never resolved', () => {
    const ruleSet = buildRuleSet({});
    const detail = formulaDetail([step(0, 'SUBTRACT_ALLOWANCES', ALLOWANCE_KEY)]);

    const result = runStateWithholdingFormula(
      detail,
      ruleSet,
      money('1000'),
      SINGLE,
      {
        [ALLOWANCE_KEY]: 1,
      },
      {},
      null,
    );

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.problem.reason).toBe('RULE_MISSING');
  });

  it('reports RULE_UNVERIFIED for a PENDING referenced rule', () => {
    const ruleSet = buildRuleSet({
      [ALLOWANCE_KEY]: availableEntry(ALLOWANCE_KEY, allowanceDetail({ amount: '100' }), {
        verificationStatus: 'PENDING',
      }),
    });
    const detail = formulaDetail([step(0, 'SUBTRACT_ALLOWANCES', ALLOWANCE_KEY)]);

    const result = runStateWithholdingFormula(
      detail,
      ruleSet,
      money('1000'),
      SINGLE,
      {
        [ALLOWANCE_KEY]: 1,
      },
      {},
      null,
    );

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.problem.reason).toBe('RULE_UNVERIFIED');
  });

  it('reports RULE_DETAIL_INVALID when the referenced rule resolves to a non-AMOUNT_PER_ALLOWANCE shape', () => {
    const ruleSet = buildRuleSet({
      [ALLOWANCE_KEY]: availableEntry(ALLOWANCE_KEY, {
        shape: 'RATE',
        rate: '0.05',
        unit: 'DECIMAL_FRACTION',
        appliesTo: 'EMPLOYEE',
        applicability: 'APPLIES',
      }),
    });
    const detail = formulaDetail([step(0, 'SUBTRACT_ALLOWANCES', ALLOWANCE_KEY)]);

    const result = runStateWithholdingFormula(
      detail,
      ruleSet,
      money('1000'),
      SINGLE,
      {
        [ALLOWANCE_KEY]: 1,
      },
      {},
      null,
    );

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.problem.reason).toBe('RULE_DETAIL_INVALID');
  });
});

describe('SUBTRACT_ALLOWANCES — null amount', () => {
  it('reports COMPONENT_NOT_STATED for a null amount, never treating it as zero', () => {
    const ruleSet = buildRuleSet({
      [ALLOWANCE_KEY]: availableEntry(ALLOWANCE_KEY, allowanceDetail({ amount: null })),
    });
    const detail = formulaDetail([step(0, 'SUBTRACT_ALLOWANCES', ALLOWANCE_KEY)]);

    const result = runStateWithholdingFormula(
      detail,
      ruleSet,
      money('1000'),
      SINGLE,
      {
        [ALLOWANCE_KEY]: 1,
      },
      {},
      null,
    );

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.problem.reason).toBe('COMPONENT_NOT_STATED');
  });

  it('subtracts nothing for a zero amount, without rejecting it', () => {
    const ruleSet = buildRuleSet({
      [ALLOWANCE_KEY]: availableEntry(ALLOWANCE_KEY, allowanceDetail({ amount: '0' })),
    });
    const detail = formulaDetail([step(0, 'SUBTRACT_ALLOWANCES', ALLOWANCE_KEY)]);

    const result = runStateWithholdingFormula(
      detail,
      ruleSet,
      money('1000'),
      SINGLE,
      {
        [ALLOWANCE_KEY]: 5,
      },
      {},
      null,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(toStorageString(result.value.amount)).toBe('1000');
  });

  it('subtracts a negative amount exactly as normalized, following existing structural Decimal behavior', () => {
    const ruleSet = buildRuleSet({
      [ALLOWANCE_KEY]: availableEntry(ALLOWANCE_KEY, allowanceDetail({ amount: '-50' })),
    });
    const detail = formulaDetail([step(0, 'SUBTRACT_ALLOWANCES', ALLOWANCE_KEY)]);

    const result = runStateWithholdingFormula(
      detail,
      ruleSet,
      money('1000'),
      SINGLE,
      {
        [ALLOWANCE_KEY]: 2,
      },
      {},
      null,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    // 1000 - (-50 * 2) = 1100 — no restriction against a negative amount is
    // added here beyond whatever the shared amount/Decimal helpers already
    // enforce.
    expect(toStorageString(result.value.amount)).toBe('1100');
  });
});

describe('SUBTRACT_ALLOWANCES — applicability (owner-locked, Task 4O-6R17)', () => {
  it('reports SCENARIO_UNSUPPORTED for applicability = NOT_APPLICABLE, never zero or COMPONENT_NOT_STATED', () => {
    const ruleSet = buildRuleSet({
      [ALLOWANCE_KEY]: availableEntry(
        ALLOWANCE_KEY,
        allowanceDetail({ amount: '100', applicability: 'NOT_APPLICABLE' }),
      ),
    });
    const detail = formulaDetail([step(0, 'SUBTRACT_ALLOWANCES', ALLOWANCE_KEY)]);

    const result = runStateWithholdingFormula(
      detail,
      ruleSet,
      money('1000'),
      SINGLE,
      {
        [ALLOWANCE_KEY]: 1,
      },
      {},
      null,
    );

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.problem.reason).toBe('SCENARIO_UNSUPPORTED');
  });
});

describe('SUBTRACT_ALLOWANCES — unit is not converted', () => {
  it('consumes a PER_PERIOD amount exactly as authored, with no annual/per-period conversion', () => {
    const ruleSet = buildRuleSet({
      [ALLOWANCE_KEY]: availableEntry(
        ALLOWANCE_KEY,
        allowanceDetail({ amount: '10', unit: 'PER_PERIOD' }),
      ),
    });
    const detail = formulaDetail([step(0, 'SUBTRACT_ALLOWANCES', ALLOWANCE_KEY)]);

    const result = runStateWithholdingFormula(
      detail,
      ruleSet,
      money('1000'),
      SINGLE,
      {
        [ALLOWANCE_KEY]: 3,
      },
      {},
      null,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    // 1000 - (10 * 3) = 970 — the PER_PERIOD unit is never scaled against
    // ANNUAL or any period count; it is consumed as authored.
    expect(toStorageString(result.value.amount)).toBe('970');
  });
});

describe('SUBTRACT_ALLOWANCES — precision', () => {
  it('performs no rounding, preserving exact Decimal precision', () => {
    const ruleSet = buildRuleSet({
      [ALLOWANCE_KEY]: availableEntry(ALLOWANCE_KEY, allowanceDetail({ amount: '33.33' })),
    });
    const detail = formulaDetail([step(0, 'SUBTRACT_ALLOWANCES', ALLOWANCE_KEY)]);

    const result = runStateWithholdingFormula(
      detail,
      ruleSet,
      money('1000'),
      SINGLE,
      {
        [ALLOWANCE_KEY]: 3,
      },
      {},
      null,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    // 1000 - (33.33 * 3) = 1000 - 99.99 = 900.01 exactly.
    expect(toStorageString(result.value.amount)).toBe('900.01');
  });
});

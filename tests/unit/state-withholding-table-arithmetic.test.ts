import { describe, expect, it } from 'vitest';

import { money } from '@/lib/core/money';
import type { RuleReference } from '@/lib/calculator/types/rules';
import { runStateWithholdingTable } from '@/lib/tax/state/rules/withholdingTableArithmetic';
import type { StateWithholdingTableRow } from '@/lib/tax/state/rules/withholdingTable';
import type { StateWithholdingTableDetail } from '@/lib/tax/state/rules/detailSchemas';
import {
  freezeStateRuleSet,
  type ResolvedStateRule,
  type ResolvedStateRuleSet,
  type StateRuleEntry,
} from '@/lib/tax/state/rules/stateRuleSet';
import { StateRuleKey } from '@/lib/tax/state/ruleKeys';

/**
 * State withholding TABLE arithmetic — DM-03 Slice 33, implementing the
 * Slice 30-locked formula and the Slice 32-locked (OPTION C) adjustment
 * architecture.
 *
 * ===========================================================================
 * SCOPE NOTE.
 *
 * This file covers `runStateWithholdingTable()` directly: declared-adjustment
 * application, the locked `base + rate * excess` formula, and the provenance
 * it produces. It does not retest `selectStateWithholdingTableRow()`'s own
 * selection semantics (covered by `state-withholding-table.test.ts`,
 * unmodified) or the orchestrator-level wiring/rounding convergence
 * (covered by `state-calculate-income-tax-withholding.test.ts`).
 *
 * Fixtures use RESERVED TEST jurisdiction/source ids and no real tax value.
 * ===========================================================================
 */

const JURISDICTION_CODE = 'TEST-TABLE-ARITHMETIC';
const JURISDICTION_ID = 'test-table-arithmetic-jurisdiction-id';
const TAX_YEAR = 2099;
const EFFECTIVE = '2099-06-15T00:00:00.000Z';
const SINGLE = 'SINGLE';

function reference(ruleKey: string, overrides: { version?: number } = {}): RuleReference {
  return {
    ruleId: `synthetic-${ruleKey}`,
    ruleKey,
    version: overrides.version ?? 1,
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

function row(overrides: Partial<StateWithholdingTableRow> = {}): StateWithholdingTableRow {
  return {
    ordinal: 0,
    filingStatus: SINGLE,
    payFrequency: 'BIWEEKLY',
    wageFrom: '0',
    wageTo: null,
    baseWithholding: '10',
    rate: '0.05',
    unit: 'DECIMAL_FRACTION',
    ...overrides,
  };
}

function tableDetail(
  rows: readonly StateWithholdingTableRow[],
  adjustments?: StateWithholdingTableDetail['adjustments'],
): StateWithholdingTableDetail {
  return {
    shape: 'WITHHOLDING_TABLE',
    tableCode: 'TEST-TABLE',
    method: 'Synthetic',
    rows: [...rows],
    ...(adjustments === undefined ? {} : { adjustments }),
  };
}

function standardDeductionDetail(amount: string) {
  return {
    shape: 'AMOUNT_BY_FILING_STATUS',
    unit: 'ANNUAL',
    amounts: [{ filingStatus: SINGLE, amount }],
  };
}

function allowanceValueDetail(
  amount: string | null,
  overrides: { applicability?: 'APPLIES' | 'NOT_APPLICABLE' } = {},
) {
  return {
    shape: 'AMOUNT_PER_ALLOWANCE',
    unit: 'ANNUAL',
    allowanceType: 'PERSONAL',
    amount,
    applicability: overrides.applicability ?? 'APPLIES',
  };
}

describe('runStateWithholdingTable — locked arithmetic (Slice 30), no adjustment declared', () => {
  it('computes base + rate * excess exactly (Test 15)', () => {
    const detail = tableDetail([
      row({ wageFrom: '500', wageTo: null, baseWithholding: '25', rate: '0.1' }),
    ]);
    const ruleSet = buildRuleSet({});
    const result = runStateWithholdingTable(detail, ruleSet, money('1500'), SINGLE, 'BIWEEKLY', {});

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // excess = 1500 - 500 = 1000; withholding = 25 + 0.1 * 1000 = 125.
    expect(result.value.amount.toString()).toBe('125');
  });

  it('treats wageFrom = null as 0 for excess arithmetic (Test 16)', () => {
    const detail = tableDetail([
      row({ wageFrom: null, wageTo: null, baseWithholding: '0', rate: '0.05' }),
    ]);
    const ruleSet = buildRuleSet({});
    const result = runStateWithholdingTable(detail, ruleSet, money('200'), SINGLE, 'BIWEEKLY', {});

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // excess = 200 - 0 = 200; withholding = 0 + 0.05 * 200 = 10.
    expect(result.value.amount.toString()).toBe('10');
  });

  it('fails COMPONENT_NOT_STATED when baseWithholding is null — never coerced to zero (Test 17)', () => {
    const detail = tableDetail([row({ baseWithholding: null })]);
    const ruleSet = buildRuleSet({});
    const result = runStateWithholdingTable(detail, ruleSet, money('100'), SINGLE, 'BIWEEKLY', {});

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problem.reason).toBe('COMPONENT_NOT_STATED');
  });

  it('normalizes a PERCENT rate through the existing readRate() boundary (Test 18)', () => {
    const detail = tableDetail([
      row({ wageFrom: '0', wageTo: null, baseWithholding: '0', rate: '10', unit: 'PERCENT' }),
    ]);
    const ruleSet = buildRuleSet({});
    const result = runStateWithholdingTable(detail, ruleSet, money('100'), SINGLE, 'BIWEEKLY', {});

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // 10 PERCENT -> 0.1; withholding = 0 + 0.1 * 100 = 10.
    expect(result.value.amount.toString()).toBe('10');
  });

  it('uses a DECIMAL_FRACTION rate directly, with no conversion (Test 19)', () => {
    const detail = tableDetail([
      row({
        wageFrom: '0',
        wageTo: null,
        baseWithholding: '0',
        rate: '0.1',
        unit: 'DECIMAL_FRACTION',
      }),
    ]);
    const ruleSet = buildRuleSet({});
    const result = runStateWithholdingTable(detail, ruleSet, money('100'), SINGLE, 'BIWEEKLY', {});

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.amount.toString()).toBe('10');
  });

  it('matches a wage exactly at the lower boundary, inclusive (Test 20)', () => {
    const rows = [
      row({ ordinal: 0, wageFrom: '0', wageTo: '500', baseWithholding: '0', rate: '0.05' }),
      row({ ordinal: 1, wageFrom: '500', wageTo: null, baseWithholding: '25', rate: '0.1' }),
    ];
    const detail = tableDetail(rows);
    const ruleSet = buildRuleSet({});
    const result = runStateWithholdingTable(detail, ruleSet, money('500'), SINGLE, 'BIWEEKLY', {});

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // 500 belongs to the second row (wageFrom inclusive): 25 + 0.1*(500-500) = 25.
    expect(result.value.amount.toString()).toBe('25');
  });

  it('matches a wage just below the upper boundary, which is exclusive (Test 21)', () => {
    const rows = [
      row({ ordinal: 0, wageFrom: '0', wageTo: '500', baseWithholding: '0', rate: '0.05' }),
      row({ ordinal: 1, wageFrom: '500', wageTo: null, baseWithholding: '25', rate: '0.1' }),
    ];
    const detail = tableDetail(rows);
    const ruleSet = buildRuleSet({});
    const result = runStateWithholdingTable(
      detail,
      ruleSet,
      money('499.99'),
      SINGLE,
      'BIWEEKLY',
      {},
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // 499.99 belongs to the first row: 0 + 0.05*499.99 = 24.9995.
    expect(result.value.amount.toString()).toBe('24.9995');
  });

  it('fails RULE_CONFLICT when no row matches — a table gap (Test 22)', () => {
    const detail = tableDetail([row({ wageFrom: '0', wageTo: '500' })]);
    const ruleSet = buildRuleSet({});
    const result = runStateWithholdingTable(detail, ruleSet, money('999'), SINGLE, 'BIWEEKLY', {});

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problem.reason).toBe('RULE_CONFLICT');
  });

  it('fails RULE_CONFLICT when multiple rows match — overlapping data (Test 23)', () => {
    const detail = tableDetail([
      row({ ordinal: 0, wageFrom: '0', wageTo: '1000' }),
      row({ ordinal: 1, wageFrom: '0', wageTo: '1000' }),
    ]);
    const ruleSet = buildRuleSet({});
    const result = runStateWithholdingTable(detail, ruleSet, money('500'), SINGLE, 'BIWEEKLY', {});

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problem.reason).toBe('RULE_CONFLICT');
  });
});

describe('runStateWithholdingTable — no declaration means no adjustment (Test 9, 14)', () => {
  it('an absent adjustments field never consults allowanceCounts or any adjustment rule', () => {
    const detail = tableDetail([
      row({ wageFrom: '0', wageTo: null, baseWithholding: '0', rate: '0.1' }),
    ]);
    const ruleSet = buildRuleSet({});
    const result = runStateWithholdingTable(detail, ruleSet, money('1000'), SINGLE, 'BIWEEKLY', {
      [StateRuleKey.WITHHOLDING_ALLOWANCE_VALUE]: 5,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // No adjustment applied: 0 + 0.1*1000 = 100, unaffected by the supplied count.
    expect(result.value.amount.toString()).toBe('100');
    expect(result.value.rules).toEqual([]);
  });

  it('an explicit empty adjustments array behaves identically to an absent one', () => {
    const detail = tableDetail(
      [row({ wageFrom: '0', wageTo: null, baseWithholding: '0', rate: '0.1' })],
      [],
    );
    const ruleSet = buildRuleSet({});
    const result = runStateWithholdingTable(detail, ruleSet, money('1000'), SINGLE, 'BIWEEKLY', {});

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.amount.toString()).toBe('100');
  });
});

describe('runStateWithholdingTable — declared WITHHOLDING_STANDARD_DEDUCTION adjustment', () => {
  it('executes and reduces the wage before row selection (Test 12)', () => {
    const detail = tableDetail(
      [row({ wageFrom: '0', wageTo: null, baseWithholding: '0', rate: '0.1' })],
      [{ ruleKey: StateRuleKey.WITHHOLDING_STANDARD_DEDUCTION, application: 'BEFORE_TABLE' }],
    );
    const ruleSet = buildRuleSet({
      [StateRuleKey.WITHHOLDING_STANDARD_DEDUCTION]: availableEntry(
        StateRuleKey.WITHHOLDING_STANDARD_DEDUCTION,
        standardDeductionDetail('200'),
      ),
    });
    const result = runStateWithholdingTable(detail, ruleSet, money('1000'), SINGLE, 'BIWEEKLY', {});

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // wage 1000 - 200 = 800; withholding = 0 + 0.1*800 = 80.
    expect(result.value.amount.toString()).toBe('80');
    expect(result.value.rules.map((r) => r.ruleKey)).toEqual([
      StateRuleKey.WITHHOLDING_STANDARD_DEDUCTION,
    ]);
  });

  it("propagates the rule reader's own failure when the declared rule is missing (Test 13)", () => {
    const detail = tableDetail(
      [row()],
      [{ ruleKey: StateRuleKey.WITHHOLDING_STANDARD_DEDUCTION, application: 'BEFORE_TABLE' }],
    );
    const ruleSet = buildRuleSet({});
    const result = runStateWithholdingTable(detail, ruleSet, money('1000'), SINGLE, 'BIWEEKLY', {});

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problem.reason).toBe('RULE_MISSING');
  });

  it('never reads PIT_STANDARD_DEDUCTION as a substitute', () => {
    const detail = tableDetail(
      [row({ wageFrom: '0', wageTo: null, baseWithholding: '0', rate: '0.1' })],
      [{ ruleKey: StateRuleKey.WITHHOLDING_STANDARD_DEDUCTION, application: 'BEFORE_TABLE' }],
    );
    // Only PIT_STANDARD_DEDUCTION is available — WITHHOLDING_STANDARD_DEDUCTION is not.
    const ruleSet = buildRuleSet({
      [StateRuleKey.PIT_STANDARD_DEDUCTION]: availableEntry(
        StateRuleKey.PIT_STANDARD_DEDUCTION,
        standardDeductionDetail('9999'),
      ),
    });
    const result = runStateWithholdingTable(detail, ruleSet, money('1000'), SINGLE, 'BIWEEKLY', {});

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problem.reason).toBe('RULE_MISSING');
  });
});

describe('runStateWithholdingTable — declared WITHHOLDING_ALLOWANCE_VALUE adjustment', () => {
  it('executes and reduces the wage before row selection (Test 7)', () => {
    const detail = tableDetail(
      [row({ wageFrom: '0', wageTo: null, baseWithholding: '0', rate: '0.1' })],
      [{ ruleKey: StateRuleKey.WITHHOLDING_ALLOWANCE_VALUE, application: 'BEFORE_TABLE' }],
    );
    const ruleSet = buildRuleSet({
      [StateRuleKey.WITHHOLDING_ALLOWANCE_VALUE]: availableEntry(
        StateRuleKey.WITHHOLDING_ALLOWANCE_VALUE,
        allowanceValueDetail('100'),
      ),
    });
    const result = runStateWithholdingTable(detail, ruleSet, money('1000'), SINGLE, 'BIWEEKLY', {
      [StateRuleKey.WITHHOLDING_ALLOWANCE_VALUE]: 3,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // wage 1000 - (100*3) = 700; withholding = 0 + 0.1*700 = 70.
    expect(result.value.amount.toString()).toBe('70');
    expect(result.value.rules.map((r) => r.ruleKey)).toEqual([
      StateRuleKey.WITHHOLDING_ALLOWANCE_VALUE,
    ]);
  });

  it('the allowance count is consumed ONLY when the adjustment is declared (Test 8)', () => {
    const declared = tableDetail(
      [row({ wageFrom: '0', wageTo: null, baseWithholding: '0', rate: '0.1' })],
      [{ ruleKey: StateRuleKey.WITHHOLDING_ALLOWANCE_VALUE, application: 'BEFORE_TABLE' }],
    );
    const undeclared = tableDetail([
      row({ wageFrom: '0', wageTo: null, baseWithholding: '0', rate: '0.1' }),
    ]);
    const ruleSet = buildRuleSet({
      [StateRuleKey.WITHHOLDING_ALLOWANCE_VALUE]: availableEntry(
        StateRuleKey.WITHHOLDING_ALLOWANCE_VALUE,
        allowanceValueDetail('100'),
      ),
    });
    const counts = { [StateRuleKey.WITHHOLDING_ALLOWANCE_VALUE]: 3 };

    const withDeclaration = runStateWithholdingTable(
      declared,
      ruleSet,
      money('1000'),
      SINGLE,
      'BIWEEKLY',
      counts,
    );
    const withoutDeclaration = runStateWithholdingTable(
      undeclared,
      ruleSet,
      money('1000'),
      SINGLE,
      'BIWEEKLY',
      counts,
    );

    expect(withDeclaration.ok && withDeclaration.value.amount.toString()).toBe('70');
    expect(withoutDeclaration.ok && withoutDeclaration.value.amount.toString()).toBe('100');
  });

  it('fails COMPONENT_NOT_STATED when no allowance count is supplied (Test 10)', () => {
    const detail = tableDetail(
      [row()],
      [{ ruleKey: StateRuleKey.WITHHOLDING_ALLOWANCE_VALUE, application: 'BEFORE_TABLE' }],
    );
    const ruleSet = buildRuleSet({
      [StateRuleKey.WITHHOLDING_ALLOWANCE_VALUE]: availableEntry(
        StateRuleKey.WITHHOLDING_ALLOWANCE_VALUE,
        allowanceValueDetail('100'),
      ),
    });
    const result = runStateWithholdingTable(detail, ruleSet, money('1000'), SINGLE, 'BIWEEKLY', {});

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problem.reason).toBe('COMPONENT_NOT_STATED');
  });

  it('a null allowance count is treated identically to a missing one, never zero (Test 11)', () => {
    const detail = tableDetail(
      [row()],
      [{ ruleKey: StateRuleKey.WITHHOLDING_ALLOWANCE_VALUE, application: 'BEFORE_TABLE' }],
    );
    const ruleSet = buildRuleSet({
      [StateRuleKey.WITHHOLDING_ALLOWANCE_VALUE]: availableEntry(
        StateRuleKey.WITHHOLDING_ALLOWANCE_VALUE,
        allowanceValueDetail('100'),
      ),
    });
    const result = runStateWithholdingTable(detail, ruleSet, money('1000'), SINGLE, 'BIWEEKLY', {
      [StateRuleKey.WITHHOLDING_ALLOWANCE_VALUE]: null,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problem.reason).toBe('COMPONENT_NOT_STATED');
  });

  it('fails SCENARIO_UNSUPPORTED when the allowance rule is NOT_APPLICABLE', () => {
    const detail = tableDetail(
      [row()],
      [{ ruleKey: StateRuleKey.WITHHOLDING_ALLOWANCE_VALUE, application: 'BEFORE_TABLE' }],
    );
    const ruleSet = buildRuleSet({
      [StateRuleKey.WITHHOLDING_ALLOWANCE_VALUE]: availableEntry(
        StateRuleKey.WITHHOLDING_ALLOWANCE_VALUE,
        allowanceValueDetail(null, { applicability: 'NOT_APPLICABLE' }),
      ),
    });
    const result = runStateWithholdingTable(detail, ruleSet, money('1000'), SINGLE, 'BIWEEKLY', {
      [StateRuleKey.WITHHOLDING_ALLOWANCE_VALUE]: 2,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problem.reason).toBe('SCENARIO_UNSUPPORTED');
  });
});

describe('runStateWithholdingTable — provenance (Test 30, 32, 33)', () => {
  it('includes the executed adjustment reference alongside no partial credit on failure', () => {
    const detail = tableDetail(
      [row({ wageFrom: '0', wageTo: null, baseWithholding: '0', rate: '0.1' })],
      [{ ruleKey: StateRuleKey.WITHHOLDING_STANDARD_DEDUCTION, application: 'BEFORE_TABLE' }],
    );
    const ruleSet = buildRuleSet({
      [StateRuleKey.WITHHOLDING_STANDARD_DEDUCTION]: availableEntry(
        StateRuleKey.WITHHOLDING_STANDARD_DEDUCTION,
        standardDeductionDetail('100'),
      ),
    });
    const result = runStateWithholdingTable(detail, ruleSet, money('1000'), SINGLE, 'BIWEEKLY', {});
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.rules).toHaveLength(1);
    expect(result.value.rules[0]?.ruleKey).toBe(StateRuleKey.WITHHOLDING_STANDARD_DEDUCTION);
  });

  it('deduplicates a ruleId@version shared between two declared adjustments', () => {
    const sharedRuleId = 'shared-adjustment-rule-id';
    const detail = tableDetail(
      [row({ wageFrom: '0', wageTo: null, baseWithholding: '0', rate: '0.1' })],
      [
        { ruleKey: StateRuleKey.WITHHOLDING_STANDARD_DEDUCTION, application: 'BEFORE_TABLE' },
        { ruleKey: StateRuleKey.WITHHOLDING_ALLOWANCE_VALUE, application: 'BEFORE_TABLE' },
      ],
    );
    const sharedReference = reference(StateRuleKey.WITHHOLDING_STANDARD_DEDUCTION, {
      version: 7,
    });
    const ruleSet = buildRuleSet({
      [StateRuleKey.WITHHOLDING_STANDARD_DEDUCTION]: {
        available: true,
        rule: {
          key: StateRuleKey.WITHHOLDING_STANDARD_DEDUCTION,
          reference: { ...sharedReference, ruleId: sharedRuleId },
          detail: standardDeductionDetail('50'),
          verificationStatus: 'VERIFIED',
        },
      },
      [StateRuleKey.WITHHOLDING_ALLOWANCE_VALUE]: {
        available: true,
        rule: {
          key: StateRuleKey.WITHHOLDING_ALLOWANCE_VALUE,
          reference: { ...sharedReference, ruleId: sharedRuleId },
          detail: allowanceValueDetail('25'),
          verificationStatus: 'VERIFIED',
        },
      },
    });
    const result = runStateWithholdingTable(detail, ruleSet, money('1000'), SINGLE, 'BIWEEKLY', {
      [StateRuleKey.WITHHOLDING_ALLOWANCE_VALUE]: 2,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const matching = result.value.rules.filter((r) => r.ruleId === sharedRuleId);
    expect(matching).toHaveLength(1);
  });

  it('a failed declared adjustment returns no partial provenance', () => {
    const detail = tableDetail(
      [row()],
      [{ ruleKey: StateRuleKey.WITHHOLDING_STANDARD_DEDUCTION, application: 'BEFORE_TABLE' }],
    );
    const ruleSet = buildRuleSet({});
    const result = runStateWithholdingTable(detail, ruleSet, money('1000'), SINGLE, 'BIWEEKLY', {});

    expect(result.ok).toBe(false);
  });
});

describe('runStateWithholdingTable — filing status', () => {
  it('null filing status reports SCENARIO_UNSUPPORTED when a standard-deduction adjustment is declared', () => {
    const detail = tableDetail(
      [row()],
      [{ ruleKey: StateRuleKey.WITHHOLDING_STANDARD_DEDUCTION, application: 'BEFORE_TABLE' }],
    );
    const ruleSet = buildRuleSet({
      [StateRuleKey.WITHHOLDING_STANDARD_DEDUCTION]: availableEntry(
        StateRuleKey.WITHHOLDING_STANDARD_DEDUCTION,
        standardDeductionDetail('100'),
      ),
    });
    const result = runStateWithholdingTable(detail, ruleSet, money('1000'), null, 'BIWEEKLY', {});

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problem.reason).toBe('SCENARIO_UNSUPPORTED');
  });

  it('null filing status still reports SCENARIO_UNSUPPORTED via the selector when no adjustment is declared', () => {
    const detail = tableDetail([row()]);
    const ruleSet = buildRuleSet({});
    const result = runStateWithholdingTable(detail, ruleSet, money('1000'), null, 'BIWEEKLY', {});

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problem.reason).toBe('SCENARIO_UNSUPPORTED');
  });
});

describe('runStateWithholdingTable — no clamp on adjustment (documented, non-fabricated behavior)', () => {
  it('an adjustment driving the wage negative fails via the selector (RULE_CONFLICT), never a silent clamp', () => {
    const detail = tableDetail(
      [row({ wageFrom: '0', wageTo: '1000' })],
      [{ ruleKey: StateRuleKey.WITHHOLDING_STANDARD_DEDUCTION, application: 'BEFORE_TABLE' }],
    );
    const ruleSet = buildRuleSet({
      [StateRuleKey.WITHHOLDING_STANDARD_DEDUCTION]: availableEntry(
        StateRuleKey.WITHHOLDING_STANDARD_DEDUCTION,
        standardDeductionDetail('5000'),
      ),
    });
    // wage 100 - 5000 = -4900, which matches no row starting at wageFrom >= 0.
    const result = runStateWithholdingTable(detail, ruleSet, money('100'), SINGLE, 'BIWEEKLY', {});

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problem.reason).toBe('RULE_CONFLICT');
  });
});

describe('runStateWithholdingTable — pay frequency (Slice 29/30, unchanged)', () => {
  it('matches exactly, never converting between frequencies', () => {
    const detail = tableDetail([row({ payFrequency: 'MONTHLY' })]);
    const ruleSet = buildRuleSet({});
    const result = runStateWithholdingTable(detail, ruleSet, money('100'), SINGLE, 'BIWEEKLY', {});

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problem.reason).toBe('RULE_CONFLICT');
  });
});

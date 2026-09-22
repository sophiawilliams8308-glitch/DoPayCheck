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
 * `SUBTRACT_EXEMPTIONS` — personal-exemption path (Task 4O-4/4O-5).
 *
 * ===========================================================================
 * SCOPE NOTE.
 *
 * Only `operandRef === StateRuleKey.PIT_PERSONAL_EXEMPTION` is implemented.
 * `PIT_DEPENDENT_EXEMPTION` remains unresolved (no locked dependent-count
 * source exists anywhere in the architecture) and is asserted here to fail
 * `RULE_DETAIL_INVALID`, exactly like any other unsupported operand — never
 * silently tolerated. `unit` (`ANNUAL`/`PER_PERIOD`) conversion is out of
 * scope and is asserted NOT to be performed, without this file inventing a
 * new unit-validation requirement of its own.
 * ===========================================================================
 *
 * Fixtures use RESERVED TEST jurisdiction/source ids and no real tax value.
 */

const JURISDICTION_CODE = 'TEST-SUBTRACT-EXEMPTIONS';
const JURISDICTION_ID = 'test-subtract-exemptions-jurisdiction-id';
const TAX_YEAR = 2099;
const EFFECTIVE = '2099-06-15T00:00:00.000Z';
const EXEMPTION_KEY = StateRuleKey.PIT_PERSONAL_EXEMPTION;
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

function exemptionDetail(amounts: readonly { filingStatus: string; amount: string | null }[]) {
  return { shape: 'AMOUNT_BY_FILING_STATUS', unit: 'ANNUAL', amounts };
}

const step = (
  ordinal: number,
  operation: string,
  operandRef: string | null = null,
): Record<string, unknown> => ({ ordinal, operation, operandRef, note: null });

describe('SUBTRACT_EXEMPTIONS — valid personal exemption', () => {
  it('subtracts the resolved filing-status exemption amount from the running value', () => {
    const ruleSet = buildRuleSet({
      [EXEMPTION_KEY]: availableEntry(
        EXEMPTION_KEY,
        exemptionDetail([{ filingStatus: SINGLE, amount: '4300' }]),
      ),
    });
    const detail = formulaDetail([step(0, 'SUBTRACT_EXEMPTIONS', EXEMPTION_KEY)]);

    const result = runStateWithholdingFormula(detail, ruleSet, money('10000'), SINGLE, {}, {});

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(toStorageString(result.value)).toBe('5700');
  });
});

describe('SUBTRACT_EXEMPTIONS — operandRef validation', () => {
  it('succeeds when operandRef equals StateRuleKey.PIT_PERSONAL_EXEMPTION', () => {
    const ruleSet = buildRuleSet({
      [EXEMPTION_KEY]: availableEntry(
        EXEMPTION_KEY,
        exemptionDetail([{ filingStatus: SINGLE, amount: '1000' }]),
      ),
    });
    const detail = formulaDetail([
      step(0, 'SUBTRACT_EXEMPTIONS', StateRuleKey.PIT_PERSONAL_EXEMPTION),
    ]);

    const result = runStateWithholdingFormula(detail, ruleSet, money('5000'), SINGLE, {}, {});

    expect(result.ok).toBe(true);
  });

  it('reports RULE_DETAIL_INVALID for a null operandRef', () => {
    const ruleSet = buildRuleSet({
      [EXEMPTION_KEY]: availableEntry(
        EXEMPTION_KEY,
        exemptionDetail([{ filingStatus: SINGLE, amount: '1000' }]),
      ),
    });
    const detail = formulaDetail([step(0, 'SUBTRACT_EXEMPTIONS', null)]);

    const result = runStateWithholdingFormula(detail, ruleSet, money('5000'), SINGLE, {}, {});

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.problem.reason).toBe('RULE_DETAIL_INVALID');
  });

  it('reports RULE_DETAIL_INVALID for an arbitrary wrong StateRuleKey', () => {
    const ruleSet = buildRuleSet({
      [EXEMPTION_KEY]: availableEntry(
        EXEMPTION_KEY,
        exemptionDetail([{ filingStatus: SINGLE, amount: '1000' }]),
      ),
    });
    const detail = formulaDetail([
      step(0, 'SUBTRACT_EXEMPTIONS', StateRuleKey.PIT_STANDARD_DEDUCTION),
    ]);

    const result = runStateWithholdingFormula(detail, ruleSet, money('5000'), SINGLE, {}, {});

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.problem.reason).toBe('RULE_DETAIL_INVALID');
  });

  it('reports RULE_DETAIL_INVALID for an arbitrary non-StateRuleKey string', () => {
    const ruleSet = buildRuleSet({});
    const detail = formulaDetail([step(0, 'SUBTRACT_EXEMPTIONS', 'NOT_A_REAL_STATE_RULE_KEY')]);

    const result = runStateWithholdingFormula(detail, ruleSet, money('5000'), SINGLE, {}, {});

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.problem.reason).toBe('RULE_DETAIL_INVALID');
  });

  it('reports RULE_DETAIL_INVALID for PIT_DEPENDENT_EXEMPTION, never treating it as merely unsupported', () => {
    const ruleSet = buildRuleSet({});
    const detail = formulaDetail([
      step(0, 'SUBTRACT_EXEMPTIONS', StateRuleKey.PIT_DEPENDENT_EXEMPTION),
    ]);

    const result = runStateWithholdingFormula(detail, ruleSet, money('5000'), SINGLE, {}, {});

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    // Must be a validation failure on this operation, not the generic
    // "operation not implemented" fallthrough — SUBTRACT_EXEMPTIONS IS
    // implemented; only this operand is unsupported.
    expect(result.problem.reason).toBe('RULE_DETAIL_INVALID');
    expect(result.problem.reason).not.toBe('METHOD_NOT_IMPLEMENTED');
  });
});

describe('SUBTRACT_EXEMPTIONS — filing status', () => {
  it('reports SCENARIO_UNSUPPORTED when no filing status is available', () => {
    const ruleSet = buildRuleSet({
      [EXEMPTION_KEY]: availableEntry(
        EXEMPTION_KEY,
        exemptionDetail([{ filingStatus: SINGLE, amount: '1000' }]),
      ),
    });
    const detail = formulaDetail([step(0, 'SUBTRACT_EXEMPTIONS', EXEMPTION_KEY)]);

    const result = runStateWithholdingFormula(detail, ruleSet, money('5000'), null, {}, {});

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.problem.reason).toBe('SCENARIO_UNSUPPORTED');
  });

  it('reports COMPONENT_NOT_STATED when no row matches the supplied filing status', () => {
    const ruleSet = buildRuleSet({
      [EXEMPTION_KEY]: availableEntry(
        EXEMPTION_KEY,
        exemptionDetail([{ filingStatus: 'MARRIED', amount: '2000' }]),
      ),
    });
    const detail = formulaDetail([step(0, 'SUBTRACT_EXEMPTIONS', EXEMPTION_KEY)]);

    const result = runStateWithholdingFormula(detail, ruleSet, money('5000'), SINGLE, {}, {});

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.problem.reason).toBe('COMPONENT_NOT_STATED');
  });

  it('reports COMPONENT_NOT_STATED, not zero, when the matched row amount is null', () => {
    const ruleSet = buildRuleSet({
      [EXEMPTION_KEY]: availableEntry(
        EXEMPTION_KEY,
        exemptionDetail([{ filingStatus: SINGLE, amount: null }]),
      ),
    });
    const detail = formulaDetail([step(0, 'SUBTRACT_EXEMPTIONS', EXEMPTION_KEY)]);

    const result = runStateWithholdingFormula(detail, ruleSet, money('5000'), SINGLE, {}, {});

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.problem.reason).toBe('COMPONENT_NOT_STATED');
  });
});

describe('SUBTRACT_EXEMPTIONS — missing / unverified / invalid rule', () => {
  it('reports RULE_MISSING when PIT_PERSONAL_EXEMPTION was never resolved', () => {
    const ruleSet = buildRuleSet({});
    const detail = formulaDetail([step(0, 'SUBTRACT_EXEMPTIONS', EXEMPTION_KEY)]);

    const result = runStateWithholdingFormula(detail, ruleSet, money('5000'), SINGLE, {}, {});

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.problem.reason).toBe('RULE_MISSING');
  });

  it('reports RULE_UNVERIFIED for a PENDING exemption rule', () => {
    const ruleSet = buildRuleSet({
      [EXEMPTION_KEY]: availableEntry(
        EXEMPTION_KEY,
        exemptionDetail([{ filingStatus: SINGLE, amount: '1000' }]),
        { verificationStatus: 'PENDING' },
      ),
    });
    const detail = formulaDetail([step(0, 'SUBTRACT_EXEMPTIONS', EXEMPTION_KEY)]);

    const result = runStateWithholdingFormula(detail, ruleSet, money('5000'), SINGLE, {}, {});

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.problem.reason).toBe('RULE_UNVERIFIED');
  });

  it('reports RULE_DETAIL_INVALID for an exemption detail failing its schema', () => {
    const ruleSet = buildRuleSet({
      [EXEMPTION_KEY]: availableEntry(EXEMPTION_KEY, {
        shape: 'WAGE_BASE',
        amount: '1',
        basis: 'ANNUAL',
        applicability: 'APPLIES',
      }),
    });
    const detail = formulaDetail([step(0, 'SUBTRACT_EXEMPTIONS', EXEMPTION_KEY)]);

    const result = runStateWithholdingFormula(detail, ruleSet, money('5000'), SINGLE, {}, {});

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.problem.reason).toBe('RULE_DETAIL_INVALID');
  });
});

describe('SUBTRACT_EXEMPTIONS — arithmetic', () => {
  it('does not floor a result that goes negative', () => {
    const ruleSet = buildRuleSet({
      [EXEMPTION_KEY]: availableEntry(
        EXEMPTION_KEY,
        exemptionDetail([{ filingStatus: SINGLE, amount: '150' }]),
      ),
    });
    const detail = formulaDetail([step(0, 'SUBTRACT_EXEMPTIONS', EXEMPTION_KEY)]);

    const result = runStateWithholdingFormula(detail, ruleSet, money('100'), SINGLE, {}, {});

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(toStorageString(result.value)).toBe('-50');
  });

  it('floors only when a subsequent FLOOR_AT_ZERO step is present, at its own ordinal', () => {
    const ruleSet = buildRuleSet({
      [EXEMPTION_KEY]: availableEntry(
        EXEMPTION_KEY,
        exemptionDetail([{ filingStatus: SINGLE, amount: '150' }]),
      ),
    });
    const detail = formulaDetail([
      step(0, 'SUBTRACT_EXEMPTIONS', EXEMPTION_KEY),
      step(1, 'FLOOR_AT_ZERO'),
    ]);

    const result = runStateWithholdingFormula(detail, ruleSet, money('100'), SINGLE, {}, {});

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(toStorageString(result.value)).toBe('0');
  });
});

describe('SUBTRACT_EXEMPTIONS — unit is not interpreted', () => {
  it('subtracts the stated amount unchanged regardless of the declared unit', () => {
    // PER_PERIOD here is deliberately inconsistent with an ANNUAL running
    // value: this operation performs no unit check and no conversion, so the
    // amount is used exactly as stated, not scaled by any pay-period count.
    const ruleSet = buildRuleSet({
      [EXEMPTION_KEY]: availableEntry(EXEMPTION_KEY, {
        shape: 'AMOUNT_BY_FILING_STATUS',
        unit: 'PER_PERIOD',
        amounts: [{ filingStatus: SINGLE, amount: '4300' }],
      }),
    });
    const detail = formulaDetail([step(0, 'SUBTRACT_EXEMPTIONS', EXEMPTION_KEY)]);

    const result = runStateWithholdingFormula(detail, ruleSet, money('10000'), SINGLE, {}, {});

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(toStorageString(result.value)).toBe('5700');
  });

  it('does not call resolveStatePayPeriodsPerYear or any pay-period reader', async () => {
    const fs = await import('node:fs');
    const source = fs.readFileSync(
      new URL('../../lib/tax/state/rules/withholdingFormulaInterpreter.ts', import.meta.url),
      'utf8',
    );
    expect(source).not.toMatch(/resolveStatePayPeriodsPerYear/);
    expect(source).not.toMatch(/withholdingPayPeriods/);
  });
});

describe('SUBTRACT_EXEMPTIONS — existing operations remain unchanged', () => {
  it('still subtracts the standard deduction identically alongside a personal exemption step', () => {
    const deductionKey = StateRuleKey.WITHHOLDING_STANDARD_DEDUCTION;
    const ruleSet = buildRuleSet({
      [deductionKey]: availableEntry(
        deductionKey,
        exemptionDetail([{ filingStatus: SINGLE, amount: '1000' }]),
      ),
      [EXEMPTION_KEY]: availableEntry(
        EXEMPTION_KEY,
        exemptionDetail([{ filingStatus: SINGLE, amount: '500' }]),
      ),
    });
    const detail = formulaDetail([
      step(0, 'SUBTRACT_STANDARD_DEDUCTION'),
      step(1, 'SUBTRACT_EXEMPTIONS', EXEMPTION_KEY),
      step(2, 'FLOOR_AT_ZERO'),
    ]);

    const result = runStateWithholdingFormula(detail, ruleSet, money('5000'), SINGLE, {}, {});

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    // 5000 - 1000 (standard deduction) - 500 (personal exemption) = 3500; floor no-op.
    expect(toStorageString(result.value)).toBe('3500');
  });
});

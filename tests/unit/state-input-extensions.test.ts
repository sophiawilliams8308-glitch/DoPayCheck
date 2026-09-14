import { describe, expect, it } from 'vitest';

import { GENERIC_CURRENCY_POLICY, calculatePaycheck } from '@/lib/calculator';
import type { CalculationInput } from '@/lib/calculator/types/input';
import type { ResolvedRuleSet } from '@/lib/calculator/types/rules';
import { validateInput } from '@/lib/calculator/validation/input-schema';

import { syntheticRuleSet } from '../fixtures/federal/synthetic-rules';

/**
 * Phase 5 input extensions (Step 1).
 *
 * The whole point of these: the state block is ADDITIVE. A Phase 1-4 caller
 * that has never heard of it must behave exactly as before.
 */

const noRules: ResolvedRuleSet = { byCategory: {} };

/** A Phase 3/4-era input, written exactly as it was before Phase 5 existed. */
const legacyInput: CalculationInput = {
  taxYear: 2099,
  effectiveDate: new Date('2099-06-15T00:00:00.000Z'),
  employee: { workLocation: { stateCode: 'US-ZZ' } },
  pay: { basis: 'SALARY', payFrequency: 'BIWEEKLY', annualSalary: '2600' },
  w4: { filingStatus: 'SINGLE_OR_MFS' },
};

describe('backward compatibility', () => {
  it('accepts an input with no state block at all', () => {
    expect(validateInput(legacyInput).valid).toBe(true);
  });

  it('tolerates an explicitly undefined state block from an untyped caller', () => {
    // `exactOptionalPropertyTypes` makes an ABSENT key and an explicit
    // `undefined` different types, and the compiler is right to reject the
    // latter. A JSON or JavaScript caller can still hand us one, so the cast
    // below deliberately simulates that and asserts the runtime is unbothered.
    const options = {
      rounding: GENERIC_CURRENCY_POLICY,
      rules: noRules,
      federal: { ruleSet: syntheticRuleSet() },
    };
    const fromUntypedCaller = { ...legacyInput, state: undefined } as unknown as CalculationInput;

    const before = calculatePaycheck(legacyInput, options);
    const after = calculatePaycheck(fromUntypedCaller, options);
    expect(JSON.stringify(after)).toBe(JSON.stringify(before));
    expect(validateInput(fromUntypedCaller).valid).toBe(true);
  });

  it('leaves W4Input untouched — no state field was added to it', () => {
    // D-W4-1: one W-4 type in the project. A state certificate is a different
    // form and arrives through `state.stateElections`, not as extra W-4 fields.
    const w4Keys = Object.keys(legacyInput.w4);
    expect(w4Keys).toEqual(['filingStatus']);

    const withEverything: CalculationInput = {
      ...legacyInput,
      w4: {
        filingStatus: 'SINGLE_OR_MFS',
        multipleJobs: false,
        dependentsAmount: '0',
        otherIncome: '0',
        deductionsAmount: '0',
        additionalWithholding: '0',
        w4Revision: 'REVISION_2020_PLUS',
        claimsExemption: false,
        isNonresidentAlien: false,
        pre2020Allowances: 0,
      },
    };
    expect(validateInput(withEverything).valid).toBe(true);
  });
});

describe('state block is additive and optional', () => {
  it('accepts an empty state block', () => {
    expect(validateInput({ ...legacyInput, state: {} }).valid).toBe(true);
  });

  it('accepts every approved optional state field', () => {
    const result = validateInput({
      ...legacyInput,
      state: {
        workState: 'TEST-WORK',
        residenceState: 'TEST-RESIDENCE',
        residencyStatus: 'NONRESIDENT',
        stateElections: {
          'TEST-WORK': {
            formCode: 'SYNTHETIC-FORM',
            filingStatus: 'SYNTHETIC_STATUS',
            values: [
              { fieldKey: 'allowances', value: 2 },
              { fieldKey: 'extra', value: '10', unit: 'PER_PERIOD' },
              { fieldKey: 'exempt', value: false },
            ],
          },
        },
        employerEmployeeCount: 10,
        employerSutaRate: '1',
        employerPlanElection: true,
        reciprocityCertificateFiled: true,
      },
    });
    expect(result.valid).toBe(true);
  });

  it('rejects an amount election that does not declare its unit', () => {
    const result = validateInput({
      ...legacyInput,
      state: {
        stateElections: {
          'TEST-WORK': {
            formCode: 'SYNTHETIC-FORM',
            values: [{ fieldKey: 'extra', value: '10' }],
          },
        },
      },
    });
    expect(result.valid).toBe(false);
    if (result.valid) return;
    expect(result.issues.some((issue) => issue.path.endsWith('unit'))).toBe(true);
  });

  it('rejects an unknown residency status rather than defaulting to resident', () => {
    const result = validateInput({ ...legacyInput, state: { residencyStatus: 'VISITOR' } });
    expect(result.valid).toBe(false);
  });

  it('rejects a floating-point SUTA rate', () => {
    const result = validateInput({ ...legacyInput, state: { employerSutaRate: 0.034 } });
    expect(result.valid).toBe(false);
  });

  it('supplying a state block does not change the calculated result', () => {
    // Step 1 adds CONTRACTS only. No state calculation exists yet, so the
    // numbers must be untouched — anything else would mean logic leaked in.
    const options = {
      rounding: GENERIC_CURRENCY_POLICY,
      rules: noRules,
      federal: { ruleSet: syntheticRuleSet() },
    };
    const without = calculatePaycheck(legacyInput, options);
    const withState = calculatePaycheck(
      { ...legacyInput, state: { workState: 'TEST-WORK', residencyStatus: 'RESIDENT' } },
      options,
    );
    expect(JSON.stringify(withState.federal)).toBe(JSON.stringify(without.federal));
    expect(JSON.stringify(withState.fica)).toBe(JSON.stringify(without.fica));
    expect(JSON.stringify(withState.state)).toBe(JSON.stringify(without.state));
    expect(withState.netPay).toBe(without.netPay);
    expect(withState.status).toBe(without.status);
  });
});

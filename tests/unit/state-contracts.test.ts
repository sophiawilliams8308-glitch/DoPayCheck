import { describe, expect, it } from 'vitest';

import type { RuleReference } from '@/lib/calculator/types/rules';
import { statusForStateReason, StateReason } from '@/lib/tax/state/errors/stateErrors';
import { StateRuleKey } from '@/lib/tax/state/ruleKeys';
import {
  freezeStateRuleSet,
  stateRule,
  type ResolvedStateRuleSet,
} from '@/lib/tax/state/rules/stateRuleSet';
import {
  resolveWorkJurisdictionElections,
  soleWorkJurisdiction,
  stateYtdAssumedZero,
  validateStateContext,
  type StateCalculationContext,
} from '@/lib/tax/state/context';
import {
  asAnnual,
  asPerPeriod,
  ResidencyStatus,
  SUPPORTED_WORK_JURISDICTION_COUNT,
  type AnnualAmount,
  type PerPeriodAmount,
  type StateEmployeeResult,
  type StateEmployerResult,
} from '@/lib/tax/state/types';

/**
 * State contract tests (Phase 5 Step 1).
 *
 * Jurisdiction codes below are RESERVED TEST codes (`TEST-*`), matching the
 * convention every integration suite uses. No real state code appears.
 */

const TEST_WORK = 'TEST-WORK';
const TEST_RESIDENCE = 'TEST-RESIDENCE';
const TEST_YEAR = 2099;
const TEST_INSTANT = '2099-06-15T00:00:00.000Z';

function reference(ruleKey: string): RuleReference {
  return {
    ruleId: `synthetic-${ruleKey}`,
    ruleKey,
    version: 1,
    category: 'STATE_WITHHOLDING',
    taxYear: TEST_YEAR,
    jurisdictionId: 'synthetic-jurisdiction',
    jurisdictionCode: TEST_WORK,
    effectiveFrom: new Date('2099-01-01T00:00:00.000Z'),
    effectiveTo: null,
    sourceIds: [`synthetic-source-${ruleKey}`],
    verified: true,
  };
}

function ruleSet(overrides: Partial<ResolvedStateRuleSet> = {}): ResolvedStateRuleSet {
  const key = StateRuleKey.WITHHOLDING_METHOD;
  return freezeStateRuleSet({
    taxYear: TEST_YEAR,
    effectiveDate: TEST_INSTANT,
    jurisdictionCode: TEST_WORK,
    engineVersion: 'test-engine',
    resolvedAt: TEST_INSTANT,
    missing: [],
    entries: {
      [key]: {
        available: true,
        rule: {
          key,
          reference: reference(key),
          detail: null,
          verificationStatus: 'VERIFIED',
        },
      },
    },
    ruleReferences: [reference(key)],
    sourceIds: [`synthetic-source-${key}`],
    ...overrides,
  });
}

function context(overrides: Partial<StateCalculationContext> = {}): StateCalculationContext {
  return {
    taxYear: TEST_YEAR,
    effectiveDate: TEST_INSTANT,
    payFrequency: 'BIWEEKLY',
    workJurisdictions: [{ jurisdictionCode: TEST_WORK, allocation: '1' }],
    residenceJurisdictionCode: TEST_WORK,
    residencyStatus: ResidencyStatus.RESIDENT,
    wages: { regular: '100', supplemental: '0' },
    deductions: [],
    taxabilityProfiles: {},
    ytd: stateYtdAssumedZero(),
    workRuleSet: ruleSet(),
    residenceRuleSet: null,
    elections: {},
    allowanceCounts: {},
    employer: {},
    reciprocityCertificateFiled: false,
    includeEmployerTaxes: true,
    ...overrides,
  };
}

describe('failure taxonomy', () => {
  it('maps every reason to a project calculation status', () => {
    for (const reason of Object.values(StateReason)) {
      expect(typeof statusForStateReason(reason)).toBe('string');
    }
  });

  it('never reports a missing rule as COMPLETE', () => {
    expect(statusForStateReason(StateReason.RULE_MISSING)).toBe('INCOMPLETE');
    expect(statusForStateReason(StateReason.CAPABILITY_NOT_DECLARED)).toBe('INCOMPLETE');
    expect(statusForStateReason(StateReason.RULE_CONFLICT)).toBe('RULE_CONFLICT');
    expect(statusForStateReason(StateReason.METHOD_NOT_IMPLEMENTED)).toBe('UNSUPPORTED_SCENARIO');
    expect(statusForStateReason(StateReason.INVARIANT_BREACH)).toBe('CALCULATION_ERROR');
  });
});

describe('employee and employer branches are structurally separate', () => {
  it('shares no field name between the two branches', () => {
    // Compile-time separation, asserted structurally: an employer amount has
    // nowhere to land on the employee branch.
    const employeeFields: (keyof StateEmployeeResult)[] = [
      'incomeTaxWithheld',
      'supplementalWithheld',
      'sdiEmployee',
      'pfmlEmployee',
      'sutaEmployee',
      'totalEmployeeStateTaxes',
      'components',
    ];
    const employerFields: (keyof StateEmployerResult)[] = [
      'sdiEmployer',
      'pfmlEmployer',
      'sutaEmployer',
      'totalEmployerStateTaxes',
      'components',
      'disclosures',
    ];
    const overlap = employeeFields.filter((field) =>
      (employerFields as string[]).includes(field as string),
    );
    // `components` is the one shared NAME, and it is a per-branch list.
    expect(overlap).toEqual(['components']);
  });

  it('names no employer amount on the employee branch', () => {
    const employeeAmountFields = [
      'incomeTaxWithheld',
      'supplementalWithheld',
      'sdiEmployee',
      'pfmlEmployee',
      'sutaEmployee',
      'totalEmployeeStateTaxes',
    ];
    for (const field of employeeAmountFields) {
      expect(field.toLowerCase()).not.toContain('employer');
    }
  });
});

describe('branded election units', () => {
  it('keeps annual and per-period amounts distinct at the type level', () => {
    const annual: AnnualAmount = asAnnual('100');
    const perPeriod: PerPeriodAmount = asPerPeriod('100');

    // Same string, different types. The next two lines must not compile if the
    // brands are ever removed, which `npm run typecheck` enforces.
    // @ts-expect-error an annual amount is not a per-period amount
    const wrong: PerPeriodAmount = annual;
    void wrong;

    expect(String(annual)).toBe(String(perPeriod));
  });

  it('does not convert between units', () => {
    // Branding is a labelling discipline, never an implicit conversion.
    expect(String(asAnnual('26'))).toBe('26');
    expect(String(asPerPeriod('26'))).toBe('26');
  });
});

describe('ResolvedStateRuleSet', () => {
  it('is frozen after construction', () => {
    const set = ruleSet();
    expect(Object.isFrozen(set)).toBe(true);
    expect(Object.isFrozen(set.entries)).toBe(true);
    expect(Object.isFrozen(set.ruleReferences)).toBe(true);
    expect(Object.isFrozen(set.missing)).toBe(true);
  });

  it('represents a missing rule as an explained absence, never undefined', () => {
    const entry = stateRule(ruleSet(), StateRuleKey.SDI_EMPLOYEE_RATE);
    expect(entry.available).toBe(false);
    if (entry.available) return;
    expect(entry.problem.reason).toBe('RULE_MISSING');
    expect(entry.problem.ruleKey).toBe(StateRuleKey.SDI_EMPLOYEE_RATE);
    // The jurisdiction is named, because "which state is missing this?" is the
    // first question anyone asks.
    expect(entry.problem.detail).toContain(TEST_WORK);
  });

  it('offers no fallback path of any kind', () => {
    const set = ruleSet();
    const absent = stateRule(set, StateRuleKey.PIT_FLAT_RATE);
    expect(absent.available).toBe(false);
    // No alternate jurisdiction, year or version is consulted, and no zero is
    // produced: the only thing available is the reason.
    expect(Object.keys(absent)).toEqual(['available', 'problem']);
  });

  it('speaks for exactly one jurisdiction', () => {
    expect(ruleSet().jurisdictionCode).toBe(TEST_WORK);
  });
});

describe('state context', () => {
  it('accepts one work jurisdiction and one residence jurisdiction', () => {
    expect(validateStateContext(context())).toEqual([]);
    expect(SUPPORTED_WORK_JURISDICTION_COUNT).toBe(1);
  });

  it('reports a second work jurisdiction as UNSUPPORTED_SCENARIO, never averaging', () => {
    const issues = validateStateContext(
      context({
        workJurisdictions: [
          { jurisdictionCode: TEST_WORK, allocation: '0.5' },
          { jurisdictionCode: TEST_RESIDENCE, allocation: '0.5' },
        ],
      }),
    );
    expect(issues.length).toBeGreaterThan(0);
    expect(issues[0]?.kind).toBe('UNSUPPORTED_SCENARIO');
    expect(issues[0]?.message).toContain('Multi-state allocation is not supported');
  });

  it('returns no sole work jurisdiction when allocation would be required', () => {
    expect(
      soleWorkJurisdiction(
        context({
          workJurisdictions: [
            { jurisdictionCode: TEST_WORK, allocation: '0.5' },
            { jurisdictionCode: TEST_RESIDENCE, allocation: '0.5' },
          ],
        }),
      ),
    ).toBeNull();
    expect(soleWorkJurisdiction(context())?.jurisdictionCode).toBe(TEST_WORK);
  });

  it('rejects a rule set resolved for a different jurisdiction', () => {
    const issues = validateStateContext(
      context({ workJurisdictions: [{ jurisdictionCode: TEST_RESIDENCE, allocation: '1' }] }),
    );
    expect(issues.map((issue) => issue.path)).toContain('workRuleSet');
  });

  it('rejects cross-year mixing', () => {
    const issues = validateStateContext(context({ taxYear: TEST_YEAR + 1 }));
    expect(issues.map((issue) => issue.path)).toContain('workRuleSet.taxYear');
  });

  it('requires an amount election to declare its unit', () => {
    const issues = validateStateContext(
      context({
        elections: {
          [TEST_WORK]: {
            formCode: 'SYNTHETIC-FORM',
            filingStatus: null,
            values: [{ fieldKey: 'extra', value: '10' }],
          },
        },
      }),
    );
    expect(issues.length).toBe(1);
    expect(issues[0]?.message).toContain('ANNUAL or PER_PERIOD');
  });

  describe('duplicate election fieldKey', () => {
    it('accepts unique fieldKeys within one jurisdiction', () => {
      const issues = validateStateContext(
        context({
          elections: {
            [TEST_WORK]: {
              formCode: 'SYNTHETIC-FORM',
              filingStatus: null,
              values: [
                { fieldKey: 'additionalAmount', value: '10', unit: 'PER_PERIOD' },
                { fieldKey: 'allowances', value: 2 },
              ],
            },
          },
        }),
      );
      expect(issues).toEqual([]);
    });

    it('rejects a duplicate fieldKey within one jurisdiction as INPUT_INVALID', () => {
      const issues = validateStateContext(
        context({
          elections: {
            [TEST_WORK]: {
              formCode: 'SYNTHETIC-FORM',
              filingStatus: null,
              values: [
                { fieldKey: 'additionalAmount', value: '10', unit: 'PER_PERIOD' },
                { fieldKey: 'additionalAmount', value: '20', unit: 'PER_PERIOD' },
              ],
            },
          },
        }),
      );
      expect(issues.length).toBe(1);
      expect(issues[0]?.kind).toBe('INPUT_INVALID');
      expect(issues[0]?.message).toContain('Duplicate election fieldKey');
      expect(issues[0]?.path).toBe(`elections.${TEST_WORK}.additionalAmount`);
    });

    it('detects duplicates independently per jurisdiction', () => {
      const issues = validateStateContext(
        context({
          elections: {
            [TEST_WORK]: {
              formCode: 'SYNTHETIC-FORM',
              filingStatus: null,
              values: [
                { fieldKey: 'additionalAmount', value: '10', unit: 'PER_PERIOD' },
                { fieldKey: 'additionalAmount', value: '20', unit: 'PER_PERIOD' },
              ],
            },
            [TEST_RESIDENCE]: {
              formCode: 'OTHER-SYNTHETIC-FORM',
              filingStatus: null,
              values: [{ fieldKey: 'otherAmount', value: '5', unit: 'ANNUAL' }],
            },
          },
        }),
      );
      // Only the work jurisdiction's own duplicate is reported; the
      // residence jurisdiction's distinct, non-duplicated values are unaffected.
      expect(issues.length).toBe(1);
      expect(issues[0]?.path).toBe(`elections.${TEST_WORK}.additionalAmount`);
    });

    it('allows the same fieldKey to appear once in each of two different jurisdictions', () => {
      const issues = validateStateContext(
        context({
          elections: {
            [TEST_WORK]: {
              formCode: 'SYNTHETIC-FORM',
              filingStatus: null,
              values: [{ fieldKey: 'additionalAmount', value: '10', unit: 'PER_PERIOD' }],
            },
            [TEST_RESIDENCE]: {
              formCode: 'OTHER-SYNTHETIC-FORM',
              filingStatus: null,
              values: [{ fieldKey: 'additionalAmount', value: '5', unit: 'ANNUAL' }],
            },
          },
        }),
      );
      expect(issues).toEqual([]);
    });

    it('does not mutate the original values[] array while detecting duplicates', () => {
      const values = [
        { fieldKey: 'additionalAmount', value: '10', unit: 'PER_PERIOD' as const },
        { fieldKey: 'additionalAmount', value: '20', unit: 'PER_PERIOD' as const },
      ];
      const before = [...values];

      validateStateContext(
        context({
          elections: {
            [TEST_WORK]: { formCode: 'SYNTHETIC-FORM', filingStatus: null, values },
          },
        }),
      );

      expect(values).toEqual(before);
      expect(values.length).toBe(2);
    });

    it('still reports the existing unit requirement alongside duplicate detection', () => {
      const issues = validateStateContext(
        context({
          elections: {
            [TEST_WORK]: {
              formCode: 'SYNTHETIC-FORM',
              filingStatus: null,
              values: [
                { fieldKey: 'additionalAmount', value: '10' },
                { fieldKey: 'additionalAmount', value: '20' },
              ],
            },
          },
        }),
      );
      expect(issues.length).toBe(3);
      expect(issues.filter((issue) => issue.message.includes('ANNUAL or PER_PERIOD'))).toHaveLength(
        2,
      );
      expect(
        issues.filter((issue) => issue.message.includes('Duplicate election fieldKey')),
      ).toHaveLength(1);
    });
  });

  it('carries YTD that excludes the current period, and flags an assumed zero', () => {
    const ytd = stateYtdAssumedZero();
    expect(ytd.assumedZero).toBe(true);
    // Zero is permitted but must be visible; a silent zero would misstate every
    // mid-year paycheck that crosses a wage base.
    expect(ytd.sdiWages).toBe('0');
  });

  describe('resolveWorkJurisdictionElections', () => {
    it('resolves the work jurisdiction election values, keyed by fieldKey', () => {
      const resolved = resolveWorkJurisdictionElections(
        context({
          elections: {
            [TEST_WORK]: {
              formCode: 'SYNTHETIC-FORM',
              filingStatus: null,
              values: [
                { fieldKey: 'additionalAmount', value: '10', unit: 'PER_PERIOD' },
                { fieldKey: 'allowances', value: 2 },
              ],
            },
          },
        }),
      );

      expect(resolved).toEqual({
        additionalAmount: { fieldKey: 'additionalAmount', value: '10', unit: 'PER_PERIOD' },
        allowances: { fieldKey: 'allowances', value: 2 },
      });
    });

    it('never resolves the residence jurisdiction, even when it carries elections', () => {
      const resolved = resolveWorkJurisdictionElections(
        context({
          elections: {
            [TEST_RESIDENCE]: {
              formCode: 'RESIDENCE-FORM',
              filingStatus: null,
              values: [{ fieldKey: 'additionalAmount', value: '999', unit: 'ANNUAL' }],
            },
          },
        }),
      );

      expect(resolved).toEqual({});
    });

    it('resolves an empty map when the work jurisdiction has no election object', () => {
      const resolved = resolveWorkJurisdictionElections(context({ elections: {} }));
      expect(resolved).toEqual({});
    });

    it('preserves fieldKey, value, and unit exactly as submitted', () => {
      const resolved = resolveWorkJurisdictionElections(
        context({
          elections: {
            [TEST_WORK]: {
              formCode: 'SYNTHETIC-FORM',
              filingStatus: null,
              values: [{ fieldKey: 'flag', value: true }],
            },
          },
        }),
      );

      expect(resolved.flag).toEqual({ fieldKey: 'flag', value: true });
    });

    it('does not mutate the source values[] array', () => {
      const values = [{ fieldKey: 'additionalAmount', value: '10', unit: 'PER_PERIOD' as const }];
      const before = [...values];

      resolveWorkJurisdictionElections(
        context({
          elections: {
            [TEST_WORK]: { formCode: 'SYNTHETIC-FORM', filingStatus: null, values },
          },
        }),
      );

      expect(values).toEqual(before);
    });

    it('resolves multiple distinct election fields correctly', () => {
      const resolved = resolveWorkJurisdictionElections(
        context({
          elections: {
            [TEST_WORK]: {
              formCode: 'SYNTHETIC-FORM',
              filingStatus: null,
              values: [
                { fieldKey: 'additionalAmount', value: '10', unit: 'PER_PERIOD' },
                { fieldKey: 'allowances', value: 3 },
                { fieldKey: 'exempt', value: false },
              ],
            },
          },
        }),
      );

      expect(Object.keys(resolved).sort()).toEqual(['additionalAmount', 'allowances', 'exempt']);
    });
  });
});

import { describe, expect, it } from 'vitest';

import { equals, money } from '@/lib/core/money';
import type { StateTaxabilityProfileDetail } from '@/lib/tax/state/rules/detailSchemas';
import type { StateDeductionLine } from '@/lib/tax/state/types';
import { deriveStateWageBuckets } from '@/lib/tax/state/wages/stateWageBuckets';

/**
 * State wage-bucket derivation (Task 4C, implementing the locked Task 4B
 * contract, Option A: Context-Driven State Taxability).
 *
 * Fixtures use synthetic deduction-type keys and no real tax value. This
 * module consumes context-supplied `deductions`/`taxabilityProfiles`
 * directly — no `ResolvedStateRuleSet`, no database, no rule resolution.
 */

function profile(
  deductionTypeKey: string,
  overrides: Partial<Omit<StateTaxabilityProfileDetail, 'shape' | 'deductionTypeKey'>> = {},
): StateTaxabilityProfileDetail {
  return {
    shape: 'TAXABILITY_PROFILE',
    deductionTypeKey,
    reducesStateIncomeTaxWages: 'FALSE',
    reducesSdiWages: 'FALSE',
    reducesPfmlWages: 'FALSE',
    reducesSutaWages: 'FALSE',
    ...overrides,
  };
}

function deduction(deductionTypeKey: string, amount: string): StateDeductionLine {
  return { deductionTypeKey, amount };
}

const WAGES = { regular: money('5000'), supplemental: money('1000') };

describe('deriveStateWageBuckets — no deductions', () => {
  it('reports regular-only for state income tax and regular+supplemental for the rest', () => {
    const result = deriveStateWageBuckets(WAGES, [], {});

    expect(result.stateIncomeTaxWages.status).toBe('COMPLETE');
    expect(result.stateIncomeTaxWages.amount).not.toBeNull();
    expect(equals(money(result.stateIncomeTaxWages.amount ?? '0'), money('5000'))).toBe(true);

    for (const bucket of ['sdiWages', 'pfmlWages', 'sutaWages'] as const) {
      expect(result[bucket].status).toBe('COMPLETE');
      expect(equals(money(result[bucket].amount ?? '0'), money('6000'))).toBe(true);
    }
  });
});

describe('deriveStateWageBuckets — one deduction, all flags FALSE', () => {
  it('leaves every bucket unchanged from gross', () => {
    const deductions = [deduction('POST_TAX', '100')];
    const profiles = { POST_TAX: profile('POST_TAX') };

    const result = deriveStateWageBuckets(WAGES, deductions, profiles);

    expect(equals(money(result.stateIncomeTaxWages.amount ?? '0'), money('5000'))).toBe(true);
    expect(equals(money(result.sdiWages.amount ?? '0'), money('6000'))).toBe(true);
    expect(equals(money(result.pfmlWages.amount ?? '0'), money('6000'))).toBe(true);
    expect(equals(money(result.sutaWages.amount ?? '0'), money('6000'))).toBe(true);
  });
});

describe('deriveStateWageBuckets — one deduction, all flags TRUE', () => {
  it('reduces every bucket by the same amount', () => {
    const deductions = [deduction('SECTION_125', '100')];
    const profiles = {
      SECTION_125: profile('SECTION_125', {
        reducesStateIncomeTaxWages: 'TRUE',
        reducesSdiWages: 'TRUE',
        reducesPfmlWages: 'TRUE',
        reducesSutaWages: 'TRUE',
      }),
    };

    const result = deriveStateWageBuckets(WAGES, deductions, profiles);

    expect(equals(money(result.stateIncomeTaxWages.amount ?? '0'), money('4900'))).toBe(true);
    expect(equals(money(result.sdiWages.amount ?? '0'), money('5900'))).toBe(true);
    expect(equals(money(result.pfmlWages.amount ?? '0'), money('5900'))).toBe(true);
    expect(equals(money(result.sutaWages.amount ?? '0'), money('5900'))).toBe(true);
  });
});

describe('deriveStateWageBuckets — independent TRUE/FALSE per bucket', () => {
  it('reduces only the buckets flagged TRUE, leaving FALSE-flagged buckets untouched', () => {
    const deductions = [deduction('MIXED', '250')];
    const profiles = {
      MIXED: profile('MIXED', {
        reducesStateIncomeTaxWages: 'TRUE',
        reducesSdiWages: 'FALSE',
        reducesPfmlWages: 'TRUE',
        reducesSutaWages: 'FALSE',
      }),
    };

    const result = deriveStateWageBuckets(WAGES, deductions, profiles);

    expect(equals(money(result.stateIncomeTaxWages.amount ?? '0'), money('4750'))).toBe(true);
    expect(equals(money(result.sdiWages.amount ?? '0'), money('6000'))).toBe(true);
    expect(equals(money(result.pfmlWages.amount ?? '0'), money('5750'))).toBe(true);
    expect(equals(money(result.sutaWages.amount ?? '0'), money('6000'))).toBe(true);
  });
});

describe('deriveStateWageBuckets — multiple deductions aggregate before one subtraction', () => {
  it('sums two TRUE-flagged deductions for the same bucket', () => {
    const deductions = [deduction('D1', '100'), deduction('D2', '50')];
    const profiles = {
      D1: profile('D1', { reducesSdiWages: 'TRUE' }),
      D2: profile('D2', { reducesSdiWages: 'TRUE' }),
    };

    const result = deriveStateWageBuckets(WAGES, deductions, profiles);

    expect(equals(money(result.sdiWages.amount ?? '0'), money('5850'))).toBe(true);
    // Untouched buckets remain at full gross.
    expect(equals(money(result.stateIncomeTaxWages.amount ?? '0'), money('5000'))).toBe(true);
  });
});

describe('deriveStateWageBuckets — missing profile', () => {
  it('reports SCENARIO_UNSUPPORTED naming the unknown deduction type, never assuming a treatment', () => {
    const deductions = [deduction('UNKNOWN_TYPE', '100')];
    const result = deriveStateWageBuckets(WAGES, deductions, {});

    for (const bucket of ['stateIncomeTaxWages', 'sdiWages', 'pfmlWages', 'sutaWages'] as const) {
      expect(result[bucket].amount).toBeNull();
      expect(result[bucket].status).toBe('UNSUPPORTED_SCENARIO');
      expect(result[bucket].problem?.reason).toBe('SCENARIO_UNSUPPORTED');
      expect(result[bucket].problem?.detail).toContain('UNKNOWN_TYPE');
    }
  });

  it('does not affect buckets once the unprofiled deduction is removed', () => {
    const result = deriveStateWageBuckets(WAGES, [], {});
    expect(result.stateIncomeTaxWages.status).toBe('COMPLETE');
  });
});

describe('deriveStateWageBuckets — NOT_STATED', () => {
  it('makes only the affected bucket unavailable, leaving fully-known buckets available', () => {
    const deductions = [deduction('PARTIAL', '100')];
    const profiles = {
      PARTIAL: profile('PARTIAL', {
        reducesStateIncomeTaxWages: 'TRUE',
        reducesSdiWages: 'NOT_STATED',
        reducesPfmlWages: 'FALSE',
        reducesSutaWages: 'FALSE',
      }),
    };

    const result = deriveStateWageBuckets(WAGES, deductions, profiles);

    // Only sdiWages is affected by the NOT_STATED flag.
    expect(result.sdiWages.amount).toBeNull();
    expect(result.sdiWages.status).toBe('INCOMPLETE');
    expect(result.sdiWages.problem?.reason).toBe('TAXABILITY_NOT_STATED');

    // The other three buckets have fully-known flags and remain available.
    expect(result.stateIncomeTaxWages.status).toBe('COMPLETE');
    expect(equals(money(result.stateIncomeTaxWages.amount ?? '0'), money('4900'))).toBe(true);
    expect(result.pfmlWages.status).toBe('COMPLETE');
    expect(equals(money(result.pfmlWages.amount ?? '0'), money('6000'))).toBe(true);
    expect(result.sutaWages.status).toBe('COMPLETE');
    expect(equals(money(result.sutaWages.amount ?? '0'), money('6000'))).toBe(true);
  });

  it('never coerces NOT_STATED to TRUE or FALSE', () => {
    const deductions = [deduction('X', '9999')];
    const profiles = { X: profile('X', { reducesSutaWages: 'NOT_STATED' }) };

    const result = deriveStateWageBuckets(WAGES, deductions, profiles);

    // Neither "reduced by 9999" (TRUE) nor "unchanged at 6000" (FALSE) — unavailable.
    expect(result.sutaWages.amount).toBeNull();
  });
});

describe('deriveStateWageBuckets — deductions exceeding gross wages', () => {
  it('floors at exactly zero, never negative', () => {
    const deductions = [deduction('HUGE', '999999')];
    const profiles = { HUGE: profile('HUGE', { reducesStateIncomeTaxWages: 'TRUE' }) };

    const result = deriveStateWageBuckets(WAGES, deductions, profiles);

    expect(result.stateIncomeTaxWages.status).toBe('COMPLETE');
    expect(equals(money(result.stateIncomeTaxWages.amount ?? '-1'), money('0'))).toBe(true);
  });
});

describe('deriveStateWageBuckets — regular vs supplemental basis', () => {
  it('excludes supplemental wages from stateIncomeTaxWages but includes them in SDI/PFML/SUTA', () => {
    const result = deriveStateWageBuckets(WAGES, [], {});

    expect(equals(money(result.stateIncomeTaxWages.amount ?? '0'), WAGES.regular)).toBe(true);
    expect(equals(money(result.sdiWages.amount ?? '0'), money('6000'))).toBe(true);
  });
});

describe('deriveStateWageBuckets — zero-dollar deduction', () => {
  it('remains a valid, applied deduction rather than being discarded', () => {
    const deductions = [deduction('ZERO', '0')];
    const profiles = { ZERO: profile('ZERO', { reducesStateIncomeTaxWages: 'TRUE' }) };

    const result = deriveStateWageBuckets(WAGES, deductions, profiles);

    expect(result.stateIncomeTaxWages.status).toBe('COMPLETE');
    expect(equals(money(result.stateIncomeTaxWages.amount ?? '-1'), money('5000'))).toBe(true);
  });
});

describe('deriveStateWageBuckets — exact decimal arithmetic', () => {
  it('produces no floating-point drift on repeating-decimal-prone inputs', () => {
    const wages = { regular: money('100.10'), supplemental: money('0') };
    const deductions = [deduction('D', '0.03'), deduction('D2', '0.03'), deduction('D3', '0.04')];
    const profiles = {
      D: profile('D', { reducesStateIncomeTaxWages: 'TRUE' }),
      D2: profile('D2', { reducesStateIncomeTaxWages: 'TRUE' }),
      D3: profile('D3', { reducesStateIncomeTaxWages: 'TRUE' }),
    };

    const result = deriveStateWageBuckets(wages, deductions, profiles);

    // 100.10 - 0.03 - 0.03 - 0.04 = 100.00 exactly, not 99.99999999999997.
    expect(equals(money(result.stateIncomeTaxWages.amount ?? '0'), money('100'))).toBe(true);
  });
});

describe('purity', () => {
  it('does not mutate the supplied wages, deductions, or profiles', () => {
    const deductions = [deduction('D', '100')];
    const profiles = { D: profile('D', { reducesStateIncomeTaxWages: 'TRUE' }) };
    const deductionsCopy = JSON.parse(JSON.stringify(deductions)) as unknown;
    const profilesCopy = JSON.parse(JSON.stringify(profiles)) as unknown;

    deriveStateWageBuckets(WAGES, deductions, profiles);

    expect(JSON.parse(JSON.stringify(deductions))).toEqual(deductionsCopy);
    expect(JSON.parse(JSON.stringify(profiles))).toEqual(profilesCopy);
  });

  it('is synchronous and deterministic — identical inputs produce identical output', () => {
    const deductions = [deduction('D', '100')];
    const profiles = { D: profile('D', { reducesStateIncomeTaxWages: 'TRUE' }) };

    const first = deriveStateWageBuckets(WAGES, deductions, profiles);
    const second = deriveStateWageBuckets(WAGES, deductions, profiles);

    expect(first).not.toBeInstanceOf(Promise);
    expect(first).toEqual(second);
  });
});

describe('no forbidden responsibilities', () => {
  it('imports no database client, Prisma, or rule-resolution/assembly module', async () => {
    const fs = await import('node:fs');
    const source = fs.readFileSync(
      new URL('../../lib/tax/state/wages/stateWageBuckets.ts', import.meta.url),
      'utf8',
    );
    const importLines = source
      .split('\n')
      .filter((line) => /^import\b/.test(line.trim()))
      .join('\n');
    expect(importLines).not.toMatch(/getPrisma|PrismaClient|from '@\/lib\/db\//);
    expect(importLines).not.toMatch(
      /candidateRetrieval|resolveCandidates|assembleStateRuleSet|stateRuleSet/,
    );
    expect(importLines).not.toMatch(/from '@\/lib\/rules\/resolution'/);
    expect(importLines).not.toMatch(/from '@\/lib\/jurisdictions\/repository'/);
    expect(importLines).not.toMatch(/tax\/federal/);
  });
});

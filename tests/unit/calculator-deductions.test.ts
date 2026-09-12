import { describe, expect, it } from 'vitest';

import { money, toStorageString } from '@/lib/core/money';
import { calculateDeductions } from '@/lib/calculator/pipeline/deductions';
import { WAGE_BUCKETS, determineTaxableWages } from '@/lib/calculator/pipeline/taxable-wages';
import { GENERIC_CURRENCY_POLICY } from '@/lib/calculator/rounding/policy';
import type { DeductionInput } from '@/lib/calculator/types/input';

/**
 * Deductions and independent taxable wage buckets (spec §5, §13).
 *
 * The amounts are generic arithmetic fixtures. No value here is a tax rate or threshold.
 */

const policy = GENERIC_CURRENCY_POLICY;
const gross = money('2000.00');

/** Reduces federal income tax wages only — the classic 401(k) shape. */
const federalOnly: DeductionInput = {
  id: 'retirement',
  basis: 'FIXED_AMOUNT',
  amount: '200.00',
  taxability: { federalIncomeTax: true, stateIncomeTax: true },
};

/** Reduces every bucket — the classic Section 125 shape. */
const allBuckets: DeductionInput = {
  id: 'health',
  basis: 'FIXED_AMOUNT',
  amount: '100.00',
  taxability: {
    federalIncomeTax: true,
    socialSecurity: true,
    medicare: true,
    stateIncomeTax: true,
    localIncomeTax: true,
    futa: true,
    suta: true,
  },
};

describe('calculateDeductions', () => {
  it('returns an empty result when there are no deductions', () => {
    const result = calculateDeductions(undefined, gross, policy);
    expect(result.items).toEqual([]);
    expect(toStorageString(result.total)).toBe('0');
  });

  it('computes fixed amounts', () => {
    const result = calculateDeductions([federalOnly], gross, policy);
    expect(toStorageString(result.total)).toBe('200');
  });

  it('computes a percentage of gross', () => {
    const percent: DeductionInput = {
      id: 'pct',
      basis: 'PERCENT_OF_GROSS',
      percent: '0.05',
      taxability: { federalIncomeTax: true },
    };
    const result = calculateDeductions([percent], gross, policy);
    expect(toStorageString(result.total)).toBe('100');
  });

  it('skips disabled deductions entirely rather than adding zero', () => {
    const disabled: DeductionInput = { ...federalOnly, enabled: false };
    const result = calculateDeductions([disabled, allBuckets], gross, policy);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.id).toBe('health');
  });

  it('applies deductions in ordinal order', () => {
    const a: DeductionInput = { ...federalOnly, id: 'a', ordinal: 2 };
    const b: DeductionInput = { ...allBuckets, id: 'b', ordinal: 1 };
    const result = calculateDeductions([a, b], gross, policy);
    expect(result.items.map((item) => item.id)).toEqual(['b', 'a']);
  });

  it('falls back to array order when ordinals tie', () => {
    const a: DeductionInput = { ...federalOnly, id: 'a' };
    const b: DeductionInput = { ...allBuckets, id: 'b' };
    expect(calculateDeductions([a, b], gross, policy).items.map((item) => item.id)).toEqual([
      'a',
      'b',
    ]);
  });

  it('sums fractional amounts exactly', () => {
    const items: DeductionInput[] = Array.from({ length: 3 }, (_, index) => ({
      id: `d${String(index)}`,
      basis: 'FIXED_AMOUNT',
      amount: '0.10',
      taxability: {},
    }));
    expect(toStorageString(calculateDeductions(items, gross, policy).total)).toBe('0.3');
  });
});

describe('independent taxable wage buckets', () => {
  it('derives all seven buckets', () => {
    const wages = determineTaxableWages(gross, [], policy);
    expect(Object.keys(wages).sort()).toEqual([...WAGE_BUCKETS].sort());
  });

  it('NEVER assumes one deduction reduces every bucket', () => {
    // The central guarantee of spec §5: a retirement deduction reduces federal income tax
    // wages but must NOT reduce Social Security or Medicare wages.
    const deductions = calculateDeductions([federalOnly], gross, policy);
    const wages = determineTaxableWages(gross, deductions.items, policy);

    expect(toStorageString(wages.federalIncomeTax.taxableWages)).toBe('1800');
    expect(toStorageString(wages.stateIncomeTax.taxableWages)).toBe('1800');
    // Untouched — this is what collapsing the buckets would get wrong.
    expect(toStorageString(wages.socialSecurity.taxableWages)).toBe('2000');
    expect(toStorageString(wages.medicare.taxableWages)).toBe('2000');
    expect(toStorageString(wages.futa.taxableWages)).toBe('2000');
    expect(toStorageString(wages.suta.taxableWages)).toBe('2000');
  });

  it('reduces every bucket when the deduction says so', () => {
    const deductions = calculateDeductions([allBuckets], gross, policy);
    const wages = determineTaxableWages(gross, deductions.items, policy);
    for (const bucket of WAGE_BUCKETS) {
      expect(toStorageString(wages[bucket].taxableWages)).toBe('1900');
    }
  });

  it('combines deductions per bucket correctly', () => {
    const deductions = calculateDeductions([federalOnly, allBuckets], gross, policy);
    const wages = determineTaxableWages(gross, deductions.items, policy);
    // federal: 2000 - 200 - 100 ; social security: 2000 - 100
    expect(toStorageString(wages.federalIncomeTax.taxableWages)).toBe('1700');
    expect(toStorageString(wages.socialSecurity.taxableWages)).toBe('1900');
  });

  it('treats an absent taxability flag as "does not reduce", never inferring true', () => {
    const noFlags: DeductionInput = {
      id: 'unflagged',
      basis: 'FIXED_AMOUNT',
      amount: '500.00',
      taxability: {},
    };
    const deductions = calculateDeductions([noFlags], gross, policy);
    const wages = determineTaxableWages(gross, deductions.items, policy);
    for (const bucket of WAGE_BUCKETS) {
      expect(toStorageString(wages[bucket].taxableWages)).toBe('2000');
    }
  });

  it('floors a bucket at zero rather than going negative', () => {
    const huge: DeductionInput = {
      id: 'huge',
      basis: 'FIXED_AMOUNT',
      amount: '9999.00',
      taxability: { federalIncomeTax: true },
    };
    const deductions = calculateDeductions([huge], gross, policy);
    const wages = determineTaxableWages(gross, deductions.items, policy);
    expect(toStorageString(wages.federalIncomeTax.taxableWages)).toBe('0');
  });

  it('records the derivation so the trace can show it', () => {
    const deductions = calculateDeductions([federalOnly], gross, policy);
    const wages = determineTaxableWages(gross, deductions.items, policy);
    const derivation = wages.federalIncomeTax;
    expect(toStorageString(derivation.grossWages)).toBe('2000');
    expect(derivation.deductionsApplied.map((d) => d.id)).toEqual(['retirement']);
    expect(toStorageString(derivation.totalDeductions)).toBe('200');
  });
});

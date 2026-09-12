import { describe, expect, it } from 'vitest';

import {
  compareDecimalStrings,
  validateBracketSchedule,
  validateWithholdingRows,
} from '@/lib/rules/validation';

/**
 * Bracket and withholding-table structural validation (Phase 2 extension).
 *
 * The bound values below are arbitrary ordering fixtures ("100", "200"), NOT tax thresholds.
 * No real bracket, rate or wage base appears in this file.
 */

describe('compareDecimalStrings', () => {
  it('compares without converting through a JS number', () => {
    // 16-digit values differing in the last digit are indistinguishable as float64.
    expect(compareDecimalStrings('9007199254740993', '9007199254740992')).toBe(1);
    expect(compareDecimalStrings('0.1', '0.2')).toBe(-1);
    expect(compareDecimalStrings('1.10', '1.1')).toBe(0);
  });

  it('handles differing scales and leading zeros', () => {
    expect(compareDecimalStrings('007', '7')).toBe(0);
    expect(compareDecimalStrings('1.005', '1.05')).toBe(-1);
    expect(compareDecimalStrings('10', '9.999999')).toBe(1);
  });

  it('orders negatives correctly', () => {
    expect(compareDecimalStrings('-5', '3')).toBe(-1);
    expect(compareDecimalStrings('-1', '-2')).toBe(1);
    expect(compareDecimalStrings('-2', '-2.0')).toBe(0);
  });
});

describe('validateBracketSchedule', () => {
  const contiguous = [
    { ordinal: 0, lowerBound: '0', upperBound: '100', filingStatus: 'SINGLE' },
    { ordinal: 1, lowerBound: '100', upperBound: '200', filingStatus: 'SINGLE' },
    { ordinal: 2, lowerBound: '200', upperBound: null, filingStatus: 'SINGLE' },
  ];

  it('accepts a contiguous schedule ending open-ended', () => {
    expect(validateBracketSchedule(contiguous).valid).toBe(true);
  });

  it('accepts an empty schedule (PENDING DATA)', () => {
    expect(validateBracketSchedule([]).valid).toBe(true);
  });

  it('rejects a gap between brackets', () => {
    const withGap = [
      { ordinal: 0, lowerBound: '0', upperBound: '100', filingStatus: 'SINGLE' },
      { ordinal: 1, lowerBound: '150', upperBound: null, filingStatus: 'SINGLE' },
    ];
    const result = validateBracketSchedule(withGap);
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.message.includes('contiguous'))).toBe(true);
  });

  it('rejects an overlap between brackets', () => {
    const overlapping = [
      { ordinal: 0, lowerBound: '0', upperBound: '100', filingStatus: 'SINGLE' },
      { ordinal: 1, lowerBound: '50', upperBound: null, filingStatus: 'SINGLE' },
    ];
    expect(validateBracketSchedule(overlapping).valid).toBe(false);
  });

  it('rejects an upper bound not greater than its lower bound', () => {
    const inverted = [{ ordinal: 0, lowerBound: '100', upperBound: '100', filingStatus: 'S' }];
    const result = validateBracketSchedule(inverted);
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.path.endsWith('upperBound'))).toBe(true);
  });

  it('rejects an open-ended bracket that is not last', () => {
    const badOpen = [
      { ordinal: 0, lowerBound: '0', upperBound: null, filingStatus: 'S' },
      { ordinal: 1, lowerBound: '100', upperBound: '200', filingStatus: 'S' },
    ];
    const result = validateBracketSchedule(badOpen);
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.message.includes('final bracket'))).toBe(true);
  });

  it('rejects non-consecutive ordinals', () => {
    const gappedOrdinals = [
      { ordinal: 0, lowerBound: '0', upperBound: '100', filingStatus: 'S' },
      { ordinal: 5, lowerBound: '100', upperBound: null, filingStatus: 'S' },
    ];
    const result = validateBracketSchedule(gappedOrdinals);
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.path.includes('ordinal'))).toBe(true);
  });

  it('rejects duplicate ordinals', () => {
    const duplicates = [
      { ordinal: 0, lowerBound: '0', upperBound: '100', filingStatus: 'S' },
      { ordinal: 0, lowerBound: '100', upperBound: null, filingStatus: 'S' },
    ];
    expect(validateBracketSchedule(duplicates).valid).toBe(false);
  });

  it('accepts a schedule supplied out of order', () => {
    expect(validateBracketSchedule([...contiguous].reverse()).valid).toBe(true);
  });
});

describe('validateWithholdingRows', () => {
  const rows = [
    { ordinal: 0, wageFrom: '0', wageTo: '500' },
    { ordinal: 1, wageFrom: '500', wageTo: '1000' },
    { ordinal: 2, wageFrom: '1000', wageTo: null },
  ];

  it('accepts contiguous rows ending open-ended', () => {
    expect(validateWithholdingRows(rows).valid).toBe(true);
  });

  it('accepts an empty table (PENDING DATA)', () => {
    expect(validateWithholdingRows([]).valid).toBe(true);
  });

  it('rejects a gap between wage rows', () => {
    const gap = [
      { ordinal: 0, wageFrom: '0', wageTo: '500' },
      { ordinal: 1, wageFrom: '600', wageTo: null },
    ];
    const result = validateWithholdingRows(gap);
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.message.includes('contiguous'))).toBe(true);
  });

  it('rejects overlapping wage rows', () => {
    const overlap = [
      { ordinal: 0, wageFrom: '0', wageTo: '500' },
      { ordinal: 1, wageFrom: '400', wageTo: null },
    ];
    expect(validateWithholdingRows(overlap).valid).toBe(false);
  });

  it('rejects wageTo not greater than wageFrom', () => {
    expect(validateWithholdingRows([{ ordinal: 0, wageFrom: '500', wageTo: '100' }]).valid).toBe(
      false,
    );
  });

  it('rejects an open-ended row that is not last', () => {
    const badOpen = [
      { ordinal: 0, wageFrom: '0', wageTo: null },
      { ordinal: 1, wageFrom: '500', wageTo: '1000' },
    ];
    expect(validateWithholdingRows(badOpen).valid).toBe(false);
  });

  it('rejects duplicate ordinals', () => {
    const duplicates = [
      { ordinal: 0, wageFrom: '0', wageTo: '500' },
      { ordinal: 0, wageFrom: '500', wageTo: null },
    ];
    expect(validateWithholdingRows(duplicates).valid).toBe(false);
  });
});

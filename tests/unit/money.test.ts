import { describe, expect, it } from 'vitest';

import {
  MoneyError,
  RoundingMode,
  add,
  compare,
  divide,
  divideHighPrecision,
  equals,
  max,
  min,
  money,
  multiply,
  round,
  subtract,
  sum,
  toFixedString,
  toStorageString,
  zero,
} from '@/lib/core/money';

/**
 * Foundation tests for authoritative money arithmetic (spec §4).
 *
 * NOTE: these contain NO tax values, rates or thresholds. They test arithmetic behaviour
 * only. Verified, source-based tax fixtures arrive with the engine in Phase 4+.
 */

describe('money()', () => {
  it('accepts exact string input', () => {
    expect(toStorageString(money('1234.56'))).toBe('1234.56');
  });

  it('accepts bigint input', () => {
    expect(toStorageString(money(1234n))).toBe('1234');
  });

  it('rejects JavaScript numbers, which may already have lost precision', () => {
    // @ts-expect-error — numbers are intentionally not assignable to MoneyInput.
    expect(() => money(0.1)).toThrow(MoneyError);
  });

  it('rejects non-numeric strings', () => {
    expect(() => money('not-a-number')).toThrow(MoneyError);
  });

  it('rejects non-finite values', () => {
    expect(() => money('Infinity')).toThrow(MoneyError);
  });
});

describe('floating-point safety', () => {
  it('computes 0.1 + 0.2 exactly as 0.3 (native JS does not)', () => {
    expect(0.1 + 0.2).not.toBe(0.3); // documents the hazard being avoided
    expect(toStorageString(add(money('0.1'), money('0.2')))).toBe('0.3');
  });

  it('sums many fractional cents without drift', () => {
    const values = Array.from({ length: 1000 }, () => money('0.01'));
    expect(toStorageString(sum(values))).toBe('10');
  });

  it('subtracts without representation error', () => {
    expect(toStorageString(subtract(money('1.00'), money('0.90')))).toBe('0.1');
  });
});

describe('arithmetic', () => {
  it('multiplies exactly', () => {
    expect(toStorageString(multiply(money('1234.56'), money('0.0765')))).toBe('94.44384');
  });

  it('divides to an explicit scale with an explicit rounding mode', () => {
    const result = divide(money('10'), money('3'), 4, RoundingMode.HALF_UP);
    expect(toStorageString(result)).toBe('3.3333');
  });

  it('throws on division by zero', () => {
    expect(() => divide(money('1'), zero(), 2, RoundingMode.HALF_UP)).toThrow(MoneyError);
  });

  it('sums an empty list to zero', () => {
    expect(toStorageString(sum([]))).toBe('0');
  });
});

describe('rounding', () => {
  it('HALF_UP and HALF_EVEN differ at the midpoint, as expected', () => {
    expect(toFixedString(money('2.345'), 2, RoundingMode.HALF_UP)).toBe('2.35');
    expect(toFixedString(money('2.345'), 2, RoundingMode.HALF_EVEN)).toBe('2.34');
  });

  it('rejects an invalid scale', () => {
    expect(() => round(money('1.5'), -1, RoundingMode.HALF_UP)).toThrow(MoneyError);
    expect(() => round(money('1.5'), 1.5, RoundingMode.HALF_UP)).toThrow(MoneyError);
  });
});

describe('divideHighPrecision()', () => {
  /**
   * `divideHighPrecision()` — Task 4O-6R41/4O-6R44. High-precision Decimal
   * division at this module's configured working precision (34 significant
   * digits), with NO currency or intermediate rounding applied. This is NOT
   * mathematically exact — a non-terminating quotient is a finite
   * approximation, never an infinitely precise rational value. Intended for
   * intermediate arithmetic ahead of a later, separate rounding decision.
   */

  it('divides a terminating decimal exactly', () => {
    expect(toStorageString(divideHighPrecision(money('100'), money('4')))).toBe('25');
  });

  it('divides a non-terminating decimal to the configured working precision, not currency rounding', () => {
    const result = divideHighPrecision(money('100'), money('3'));
    // 34 significant digits under this module's configured Decimal.js
    // precision — a finite approximation, never described as exact.
    expect(toStorageString(result)).toBe('33.33333333333333333333333333333333');
    // Far more decimal places than any currencyScale (max 6) or
    // intermediateScale (max 20) this project's schemas ever permit —
    // demonstrating no currency/intermediate rounding was applied.
    const decimalPlaces = toStorageString(result).split('.')[1]?.length ?? 0;
    expect(decimalPlaces).toBeGreaterThan(20);
  });

  it('returns zero for a zero numerator', () => {
    expect(toStorageString(divideHighPrecision(money('0'), money('7')))).toBe('0');
  });

  it('preserves sign for a negative numerator', () => {
    expect(toStorageString(divideHighPrecision(money('-100'), money('4')))).toBe('-25');
  });

  it('preserves sign for a negative denominator', () => {
    expect(toStorageString(divideHighPrecision(money('100'), money('-4')))).toBe('-25');
  });

  it('produces a positive result when both operands are negative', () => {
    expect(toStorageString(divideHighPrecision(money('-100'), money('-4')))).toBe('25');
  });

  it('throws on division by zero, matching the existing divide() convention', () => {
    expect(() => divideHighPrecision(money('100'), zero())).toThrow(MoneyError);
    expect(() => divideHighPrecision(money('100'), zero())).toThrow('Division by zero');
  });

  it('throws on division by zero regardless of the numerator sign or value', () => {
    expect(() => divideHighPrecision(zero(), zero())).toThrow(MoneyError);
    expect(() => divideHighPrecision(money('-5'), zero())).toThrow(MoneyError);
  });

  it('does not truncate a large monetary value to a fixed scale', () => {
    const result = divideHighPrecision(money('123456789.987654321'), money('3'));
    // Full working-precision quotient, not rounded to 2/4/6 places.
    expect(toStorageString(result)).toBe('41152263.329218107');
  });

  it('does not truncate a small monetary value to a fixed scale', () => {
    const result = divideHighPrecision(money('0.01'), money('3'));
    expect(toStorageString(result)).toBe('0.003333333333333333333333333333333333');
  });

  it('accepts no scale argument (type-level: two Money parameters only)', () => {
    // @ts-expect-error — divideHighPrecision takes exactly two arguments;
    // a third (scale) argument is not part of its signature.
    divideHighPrecision(money('10'), money('3'), 4);
  });

  it('accepts no RoundingMode argument (type-level: two Money parameters only)', () => {
    // @ts-expect-error — divideHighPrecision takes exactly two arguments;
    // a third (RoundingMode) argument is not part of its signature.
    divideHighPrecision(money('10'), money('3'), RoundingMode.HALF_UP);
  });

  it('reflects a repeating-decimal quotient at the configured working precision, not mathematical exactness', () => {
    const result = divideHighPrecision(money('1'), money('7'));
    // 1/7 has no terminating decimal expansion; this is a finite,
    // 34-significant-digit approximation, not the true infinite repeating
    // value 0.142857142857...
    expect(toStorageString(result)).toBe('0.1428571428571428571428571428571429');
  });

  it('leaves the existing divide() function and its behavior unchanged', () => {
    const result = divide(money('10'), money('3'), 4, RoundingMode.HALF_UP);
    expect(toStorageString(result)).toBe('3.3333');
    expect(() => divide(money('1'), zero(), 2, RoundingMode.HALF_UP)).toThrow(MoneyError);
  });
});

describe('comparison', () => {
  it('orders values correctly', () => {
    expect(compare(money('1.10'), money('1.20'))).toBe(-1);
    expect(compare(money('1.20'), money('1.10'))).toBe(1);
    expect(compare(money('1.10'), money('1.10'))).toBe(0);
  });

  it('treats differing representations of the same value as equal', () => {
    expect(equals(money('1.10'), money('1.1000'))).toBe(true);
  });

  it('selects min and max', () => {
    expect(toStorageString(min(money('5'), money('3')))).toBe('3');
    expect(toStorageString(max(money('5'), money('3')))).toBe('5');
  });
});

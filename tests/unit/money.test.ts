import { describe, expect, it } from 'vitest';

import {
  MoneyError,
  RoundingMode,
  add,
  compare,
  divide,
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

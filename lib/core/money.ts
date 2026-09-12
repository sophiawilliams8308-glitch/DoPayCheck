import { Decimal } from 'decimal.js';

/**
 * DoPayCheck — authoritative money arithmetic.
 *
 * ===========================================================================
 * ARCHITECTURAL RULE (spec §4; CLAUDE.md §6)
 *
 *   Money calculations MUST use Decimal / NUMERIC-safe financial arithmetic.
 *   JavaScript floating-point arithmetic MUST NOT be used for authoritative
 *   financial calculations.
 *
 * This module is the single approved entry point for that arithmetic. Later
 * phases (3+) build the calculation engine on top of it.
 * ===========================================================================
 *
 * How the rule is enforced structurally rather than by convention:
 *
 * 1. `money()` accepts `string | bigint | Money` only. It deliberately does NOT
 *    accept `number`. A JS `number` may already have lost precision before this
 *    module ever sees it (`0.1 + 0.2 === 0.30000000000000004`), so accepting one
 *    would import that error rather than prevent it.
 * 2. Rounding is never implicit. `round()` requires an explicit `RoundingMode`,
 *    because rounding direction is a tax-methodology decision, not a formatting
 *    detail.
 * 3. Division requires an explicit scale, since exact division is not always
 *    representable.
 *
 * PENDING DECISION — per-tax rounding policy.
 *   The correct rounding mode and precision differ by tax, jurisdiction and
 *   official methodology (for example IRS withholding tables vs. percentage
 *   method). No default rounding policy is chosen here, and none may be
 *   invented. Each rule/methodology must specify its own rounding when the
 *   engine is built in Phase 3/4, sourced from official documentation.
 */

/** Local Decimal constructor so global Decimal configuration cannot leak between modules. */
const D = Decimal.clone({
  // Generous working precision; results are rounded explicitly at defined boundaries.
  precision: 34,
  // No implicit exponential formatting for values in normal monetary ranges.
  toExpNeg: -34,
  toExpPos: 34,
});

/** Explicit rounding modes. Names mirror the arithmetic, not a tax rule. */
export const RoundingMode = {
  /** 0.5 rounds away from zero — the common "round half up" for positive amounts. */
  HALF_UP: Decimal.ROUND_HALF_UP,
  /** 0.5 rounds toward the nearest even neighbour ("banker's rounding"). */
  HALF_EVEN: Decimal.ROUND_HALF_EVEN,
  /** Always toward zero. */
  DOWN: Decimal.ROUND_DOWN,
  /** Always away from zero. */
  UP: Decimal.ROUND_UP,
  /** Toward negative infinity. */
  FLOOR: Decimal.ROUND_FLOOR,
  /** Toward positive infinity. */
  CEIL: Decimal.ROUND_CEIL,
} as const;

export type RoundingMode = (typeof RoundingMode)[keyof typeof RoundingMode];

/** An exact decimal monetary value. Immutable. */
export type Money = Decimal;

/** Values that may be converted into `Money` without precision loss. */
export type MoneyInput = string | bigint | Money;

export class MoneyError extends Error {
  public override readonly name = 'MoneyError';
}

/**
 * Creates an exact `Money` value.
 *
 * @throws {MoneyError} if the input is not a finite, exactly-representable value.
 */
export function money(value: MoneyInput): Money {
  if (typeof value === 'number') {
    // Unreachable for TypeScript callers; guards untyped/JS boundaries.
    throw new MoneyError(
      'money() does not accept a JavaScript number: floating-point input may already have lost ' +
        'precision. Pass a string (e.g. money("1234.56")) instead.',
    );
  }

  let decimal: Decimal;
  try {
    decimal = typeof value === 'bigint' ? new D(value.toString()) : new D(value);
  } catch {
    throw new MoneyError(`Invalid money value: ${String(value)}`);
  }

  if (!decimal.isFinite()) {
    throw new MoneyError(`Money value must be finite, received: ${String(value)}`);
  }

  return decimal;
}

/** Exact zero. */
export function zero(): Money {
  return new D(0);
}

export function add(a: Money, b: Money): Money {
  return a.plus(b);
}

export function subtract(a: Money, b: Money): Money {
  return a.minus(b);
}

export function multiply(a: Money, b: Money): Money {
  return a.times(b);
}

/**
 * Divides `a` by `b` to an explicit number of decimal places.
 * Scale and rounding are required because exact division is not always representable.
 *
 * @throws {MoneyError} on division by zero.
 */
export function divide(a: Money, b: Money, scale: number, mode: RoundingMode): Money {
  if (b.isZero()) {
    throw new MoneyError('Division by zero');
  }
  assertValidScale(scale);
  return a.dividedBy(b).toDecimalPlaces(scale, mode);
}

/** Sums a list exactly. An empty list sums to zero. */
export function sum(values: readonly Money[]): Money {
  return values.reduce<Money>((total, value) => total.plus(value), zero());
}

/**
 * Rounds to `scale` decimal places using an explicitly chosen mode.
 * There is intentionally no default mode — see PENDING DECISION above.
 */
export function round(value: Money, scale: number, mode: RoundingMode): Money {
  assertValidScale(scale);
  return value.toDecimalPlaces(scale, mode);
}

export function isNegative(value: Money): boolean {
  return value.isNegative() && !value.isZero();
}

export function isZero(value: Money): boolean {
  return value.isZero();
}

export function compare(a: Money, b: Money): -1 | 0 | 1 {
  return a.comparedTo(b) as -1 | 0 | 1;
}

export function equals(a: Money, b: Money): boolean {
  return a.equals(b);
}

/** Returns the smaller of two values. */
export function min(a: Money, b: Money): Money {
  return a.lessThan(b) ? a : b;
}

/** Returns the larger of two values. */
export function max(a: Money, b: Money): Money {
  return a.greaterThan(b) ? a : b;
}

/**
 * Exact, lossless string form — the ONLY safe way to persist or transport a monetary value.
 * Use this for database NUMERIC columns and API payloads; never `Number(value)`.
 */
export function toStorageString(value: Money): string {
  return value.toFixed();
}

/**
 * Human-readable string at a fixed scale, with explicit rounding.
 * Presentation only — never feed the result back into a calculation.
 */
export function toFixedString(value: Money, scale: number, mode: RoundingMode): string {
  assertValidScale(scale);
  return value.toDecimalPlaces(scale, mode).toFixed(scale);
}

function assertValidScale(scale: number): void {
  if (!Number.isInteger(scale) || scale < 0 || scale > 20) {
    throw new MoneyError(`Scale must be an integer between 0 and 20, received: ${String(scale)}`);
  }
}

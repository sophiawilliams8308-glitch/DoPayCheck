import { describe, expect, it } from 'vitest';

import { money, multiply, toStorageString } from '@/lib/core/money';

/**
 * DM-03 Slice 9 — generic rate-application primitive, SDI/PFML/SUTA readiness.
 *
 * ===========================================================================
 * NO NEW PRIMITIVE WAS CREATED. THIS FILE DOCUMENTS THE EXISTING ONE.
 *
 * Repository inspection (Slice 9 discovery) found that `multiply(a, b)`
 * (`lib/core/money.ts`) already IS the generic, Decimal-safe
 * `taxableBase x rate = amount` primitive every existing rate-application
 * site in this repository uses, with no dedicated wrapper anywhere:
 *
 *   - lib/tax/federal/fica/social-security.ts:
 *       roundTax(multiply(taxable, employeeRate.value), policy)
 *   - lib/tax/federal/fica/medicare.ts:
 *       roundTax(multiply(taxable, employeeRate.value), policy)
 *   - lib/tax/state/rules/withholdingFormulaInterpreter.ts (APPLY_FLAT_RATE):
 *       multiply(runningValue, rate.value)
 *   - lib/tax/state/rules/withholdingFormulaInterpreter.ts (APPLY_PERCENTAGE_OF):
 *       multiply(runningValue, add(money('1'), rate.value))
 *
 * Every one of those four sites calls `multiply()` directly, inline, with no
 * intermediate wrapper function. Introducing one here for Slice 9 would be
 * the first such abstraction in the codebase, adding no behavior beyond what
 * `multiply()` already provides — so Slice 9 REUSES `multiply()` rather than
 * duplicating it, per its own "do not duplicate an existing primitive"
 * instruction. These tests exist because `multiply()`'s own test coverage
 * (`tests/unit/money.test.ts`) is generic arithmetic coverage, not framed
 * around this specific future SDI/PFML/SUTA "taxableBase x rate" role.
 *
 * ===========================================================================
 * RATE REPRESENTATION — ALREADY ESTABLISHED, NOT RE-DECIDED HERE.
 *
 * `rate` must be an already-normalized DECIMAL FRACTION `Money` value (e.g.
 * "0.062" for 6.2%), never a raw PERCENT figure ("6.2"). That conversion
 * happens in exactly one place, `readRate()`
 * (`lib/tax/state/rules/read-detail.ts`, "THE ONE PLACE A STATE RATE UNIT IS
 * CONVERTED") — every rate-shaped state rule (`SDI_EMPLOYEE_RATE`,
 * `PFML_EMPLOYEE_RATE`, `SUTA_EMPLOYER_RATE`, etc.) already routes through
 * it. This file does not retest `readRate()` (out of scope, already covered
 * elsewhere, e.g. `tests/unit/state-withholding-formula-apply-flat-rate.test.ts`)
 * — it only documents that a rate reaching `multiply()` is expected to
 * already be in this form.
 *
 * ===========================================================================
 * ROUNDING — INTENTIONALLY NOT APPLIED HERE.
 *
 * `multiply()` never rounds; it preserves full Decimal precision. Every
 * existing caller treats rounding as a distinct, explicit, separately
 * parameterized step: federal wraps the product in `roundTax(product,
 * policy)`; the state formula interpreter leaves the running value unrounded
 * entirely (state's own `ROUND` formula operation remains a deliberately
 * separate, not-yet-implemented step — see CLAUDE.md's DM-03/Phase 5 Step 4
 * history). This file follows the same convention: it asserts exact,
 * unrounded products only.
 *
 * ===========================================================================
 * WHAT THIS FILE DOES NOT COVER (by the Slice 9 task's own scope).
 *
 * No SDI, PFML, SUTA, wage-base capping, employer-vs-employee rate
 * selection, or withholding logic. No calculator/orchestrator wiring. Only
 * the bare `taxableBase x rate` arithmetic.
 * ===========================================================================
 */

describe('DM-03 Slice 9 — rate application primitive (multiply, reused)', () => {
  it('positive taxable base x positive rate', () => {
    // $50,000 taxable wages x a 0.9%-equivalent decimal-fraction rate.
    expect(toStorageString(multiply(money('50000'), money('0.009')))).toBe('450');
  });

  it('zero taxable base yields zero, never a fabricated non-zero amount', () => {
    expect(toStorageString(multiply(money('0'), money('0.062')))).toBe('0');
  });

  it('zero rate yields zero, never a fabricated non-zero amount', () => {
    expect(toStorageString(multiply(money('1000'), money('0')))).toBe('0');
  });

  it('applies a decimal (non-integer) rate exactly', () => {
    // A 0.86% rate, exactly as a jurisdiction might publish it.
    expect(toStorageString(multiply(money('1000'), money('0.0086')))).toBe('8.6');
  });

  it('applies to a decimal (non-integer) taxable base exactly', () => {
    expect(toStorageString(multiply(money('1234.56'), money('0.05')))).toBe('61.728');
  });

  it('is precision-sensitive: many-decimal-place inputs multiply exactly, no silent truncation', () => {
    expect(toStorageString(multiply(money('333.33'), money('0.333')))).toBe('110.99889');
  });

  it('rejects a malformed rate or taxable base before multiply() is ever reached', () => {
    // money() is the one boundary that converts external input into `Money`;
    // an invalid decimal string never becomes a value multiply() can see, so
    // there is no "malformed input" case inside multiply() itself to invent
    // behavior for.
    expect(() => money('not-a-number')).toThrow();
    expect(() => money('12.34.56')).toThrow();
  });

  it('does not clamp or reject a negative taxable base — unclamped, per established convention', () => {
    // No existing project contract forbids a negative taxableBase at this
    // layer (the same "not validated here" discipline
    // lib/tax/state/rules/wageBase.ts documents for negative wages) — this
    // is establishing multiply()'s actual behavior, not inventing a policy.
    expect(toStorageString(multiply(money('-500'), money('0.05')))).toBe('-25');
  });

  it('does not clamp or reject a negative rate — unclamped, per established convention', () => {
    expect(toStorageString(multiply(money('1000'), money('-0.05')))).toBe('-50');
  });

  it('is deterministic: identical inputs produce an identical result on repeated calls', () => {
    const first = toStorageString(multiply(money('842.17'), money('0.0765')));
    const second = toStorageString(multiply(money('842.17'), money('0.0765')));
    const third = toStorageString(multiply(money('842.17'), money('0.0765')));
    expect(first).toBe(second);
    expect(second).toBe(third);
  });

  it('uses Decimal arithmetic, not JavaScript floating point, for the actual calculation', () => {
    // A classic JS float-multiplication hazard: 19.9 * 100 !== 1990 natively.
    expect(19.9 * 100).not.toBe(1990);
    expect(toStorageString(multiply(money('19.9'), money('100')))).toBe('1990');
  });

  it('leaves the product unrounded — full Decimal precision, no implicit scale', () => {
    // A quotient-free case (multiplication always terminates exactly for
    // finite decimal inputs) with more fractional digits than any published
    // currency scale, proving no rounding was silently applied.
    expect(toStorageString(multiply(money('100.001'), money('0.00333')))).toBe('0.33300333');
  });
});

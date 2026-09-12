import { describe, expect, it } from 'vitest';

import { VerificationStatus } from '@/lib/db/generated/index';
import {
  VerificationConsistencyError,
  assertValueConsistency,
  isDecided,
  mayCarryNumericValue,
} from '@/lib/rules/verification';

/**
 * Verification semantics (spec §19).
 *
 * The central guarantee: NOT_STATED and NOT_APPLICABLE never become zero.
 */

describe('NOT_APPLICABLE vs NOT_STATED', () => {
  it('treats both as decided, but neither may carry a value', () => {
    expect(isDecided(VerificationStatus.NOT_APPLICABLE)).toBe(true);
    expect(isDecided(VerificationStatus.NOT_STATED)).toBe(true);
    expect(mayCarryNumericValue(VerificationStatus.NOT_APPLICABLE)).toBe(false);
    expect(mayCarryNumericValue(VerificationStatus.NOT_STATED)).toBe(false);
  });

  it('they are distinct statuses, not aliases', () => {
    expect(VerificationStatus.NOT_APPLICABLE).not.toBe(VerificationStatus.NOT_STATED);
  });

  it('treats PENDING, CONFLICT and PARTIALLY_VERIFIED as undecided', () => {
    expect(isDecided(VerificationStatus.PENDING)).toBe(false);
    expect(isDecided(VerificationStatus.CONFLICT)).toBe(false);
    expect(isDecided(VerificationStatus.PARTIALLY_VERIFIED)).toBe(false);
  });
});

describe('assertValueConsistency', () => {
  it('REJECTS writing zero for NOT_STATED — the core anti-fabrication rule', () => {
    expect(() => assertValueConsistency(VerificationStatus.NOT_STATED, '0', null)).toThrow(
      VerificationConsistencyError,
    );
  });

  it('rejects writing zero for NOT_APPLICABLE', () => {
    expect(() => assertValueConsistency(VerificationStatus.NOT_APPLICABLE, '0', null)).toThrow(
      VerificationConsistencyError,
    );
  });

  it('rejects any value for NOT_STATED, not just zero', () => {
    expect(() => assertValueConsistency(VerificationStatus.NOT_STATED, '0.062', null)).toThrow(
      VerificationConsistencyError,
    );
    expect(() => assertValueConsistency(VerificationStatus.NOT_STATED, null, 'some text')).toThrow(
      VerificationConsistencyError,
    );
  });

  it('accepts NOT_STATED and NOT_APPLICABLE with no value at all', () => {
    expect(() => assertValueConsistency(VerificationStatus.NOT_STATED, null, null)).not.toThrow();
    expect(() =>
      assertValueConsistency(VerificationStatus.NOT_APPLICABLE, null, null),
    ).not.toThrow();
  });

  it('requires a VERIFIED component to carry the value that was verified', () => {
    expect(() => assertValueConsistency(VerificationStatus.VERIFIED, null, null)).toThrow(
      VerificationConsistencyError,
    );
    expect(() => assertValueConsistency(VerificationStatus.VERIFIED, '123.45', null)).not.toThrow();
  });

  it('allows an explicitly sourced zero when the source states zero', () => {
    // A source that explicitly states 0 yields 0 with status VERIFIED. That is legitimate —
    // what is forbidden is inferring 0 from silence.
    expect(() => assertValueConsistency(VerificationStatus.VERIFIED, '0', null)).not.toThrow();
  });

  it('allows PENDING to be empty while research continues', () => {
    expect(() => assertValueConsistency(VerificationStatus.PENDING, null, null)).not.toThrow();
  });
});

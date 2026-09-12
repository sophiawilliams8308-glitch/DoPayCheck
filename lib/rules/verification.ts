import { VerificationStatus } from '@/lib/db/generated/index';

/**
 * Verification semantics (spec §19).
 *
 * The distinction this module protects:
 *
 *   NOT_APPLICABLE — the rule or component genuinely does not apply
 *                    (e.g. a state with no income tax has no bracket set).
 *   NOT_STATED     — the official source is silent on the value.
 *
 * They are different facts, and NEITHER is zero. A zero may be recorded only when an official
 * source explicitly states zero — in which case the value is 0 with status VERIFIED.
 */

/** Statuses that represent a decided outcome (no further research pending). */
export const DECIDED_STATUSES: readonly VerificationStatus[] = [
  VerificationStatus.VERIFIED,
  VerificationStatus.NOT_APPLICABLE,
  VerificationStatus.NOT_STATED,
];

/** Statuses that still require human work before a rule can be published. */
export const UNDECIDED_STATUSES: readonly VerificationStatus[] = [
  VerificationStatus.PENDING,
  VerificationStatus.PARTIALLY_VERIFIED,
  VerificationStatus.CONFLICT,
];

export function isDecided(status: VerificationStatus): boolean {
  return DECIDED_STATUSES.includes(status);
}

/**
 * True when a component is permitted to carry a numeric value.
 *
 * NOT_APPLICABLE and NOT_STATED must carry NULL — writing 0 for either would fabricate a tax
 * value and is rejected by `assertValueConsistency`.
 */
export function mayCarryNumericValue(status: VerificationStatus): boolean {
  return status !== VerificationStatus.NOT_APPLICABLE && status !== VerificationStatus.NOT_STATED;
}

export class VerificationConsistencyError extends Error {
  public override readonly name = 'VerificationConsistencyError';
}

/**
 * Rejects the two ways a missing value can silently become a fabricated one:
 *   - a NOT_APPLICABLE / NOT_STATED component carrying a number (including 0)
 *   - a VERIFIED component carrying no value at all
 *
 * @throws {VerificationConsistencyError}
 */
export function assertValueConsistency(
  status: VerificationStatus,
  numericValue: unknown,
  textValue: unknown,
): void {
  const hasNumeric = numericValue !== null && numericValue !== undefined;
  const hasText = textValue !== null && textValue !== undefined && textValue !== '';

  if (!mayCarryNumericValue(status) && (hasNumeric || hasText)) {
    throw new VerificationConsistencyError(
      `A component marked ${status} must not carry a value. ` +
        `${status} means the value is absent, not zero (spec §19).`,
    );
  }

  if (status === VerificationStatus.VERIFIED && !hasNumeric && !hasText) {
    throw new VerificationConsistencyError(
      'A component marked VERIFIED must carry the value that was verified.',
    );
  }
}

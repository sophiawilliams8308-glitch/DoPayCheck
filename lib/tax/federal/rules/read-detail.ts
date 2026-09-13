import { type Money, RoundingMode, divide, money } from '@/lib/core/money';

import { FederalReason, type FederalUnavailable, unavailable } from '../errors/federal-errors';
import type { FederalRuleKey } from '../rule-keys';
import { federalRule, type ResolvedFederalRuleSet } from './resolved-rule-set';
import { validateFederalDetail, type FederalDetailSchemas } from './detail-schemas';

/**
 * Safe readers for resolved rule detail — the ONLY way a tax value enters the engine.
 *
 * Every read returns a value or an explained absence. There is deliberately no
 * overload that returns a default, because a default is exactly the fabricated
 * number the specification forbids (§28.2).
 */

export type Read<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly problem: FederalUnavailable };

export function readOk<T>(value: T): Read<T> {
  return { ok: true, value };
}

export function readFail<T>(problem: FederalUnavailable): Read<T> {
  return { ok: false, problem };
}

/**
 * Verification statuses the engine may compute from.
 *
 * `NOT_APPLICABLE` is usable because it is a positive, source-backed statement
 * that the concept does not apply (§14.3) — the Medicare wage base being the
 * canonical case. `PENDING`, `NOT_STATED`, `CONFLICT` and `PARTIALLY_VERIFIED`
 * are not usable.
 */
const USABLE_VERIFICATION = new Set(['VERIFIED', 'NOT_APPLICABLE']);

export interface ResolvedDetail<K extends keyof FederalDetailSchemas> {
  readonly detail: unknown;
  readonly ruleKey: K;
  readonly verificationStatus: string;
}

/**
 * Fetches a rule's detail, checking availability, verification and schema — in
 * that order. Verification is checked BEFORE values are read: an unverified
 * rule must never produce a figure, however complete its data looks.
 */
export function readDetail<K extends keyof FederalDetailSchemas & FederalRuleKey>(
  ruleSet: ResolvedFederalRuleSet,
  key: K,
): Read<ResolvedDetail<K>> {
  const entry = federalRule(ruleSet, key);
  if (!entry.available) {
    return readFail(entry.problem);
  }

  if (!USABLE_VERIFICATION.has(entry.rule.verificationStatus)) {
    return readFail(
      unavailable(
        FederalReason.RULE_UNVERIFIED,
        `Rule ${key} is ${entry.rule.verificationStatus}; only VERIFIED or NOT_APPLICABLE data may be used`,
        key,
      ),
    );
  }

  const validation = validateFederalDetail(key, entry.rule.detail);
  if (!validation.ok) {
    const first = validation.issues[0];
    return readFail(
      unavailable(
        FederalReason.RULE_DETAIL_INVALID,
        `Rule ${key} detail failed its schema${first === undefined ? '' : ` at ${first.path}: ${first.message}`}`,
        key,
      ),
    );
  }

  return readOk({
    detail: entry.rule.detail,
    ruleKey: key,
    verificationStatus: entry.rule.verificationStatus,
  });
}

/**
 * Converts a nullable decimal component into Money.
 *
 * `null` becomes COMPONENT_NOT_STATED naming the exact component, so an
 * operator goes straight to the field that needs sourcing.
 */
export function requireComponent(
  value: string | null | undefined,
  ruleKey: string,
  component: string,
): Read<Money> {
  if (value === null || value === undefined) {
    return readFail(
      unavailable(
        FederalReason.COMPONENT_NOT_STATED,
        `${ruleKey}.${component} is not stated by the official source; it is not zero`,
        ruleKey,
        component,
      ),
    );
  }
  return readOk(money(value));
}

/**
 * THE ONE PLACE A RATE UNIT IS CONVERTED (§6.4).
 *
 * Always returns a DECIMAL FRACTION. A percent/fraction mix-up is a 100x error,
 * so the unit is read from the data and converted here exactly once, rather
 * than being assumed at each call site.
 */
export function readRate(
  rate: string | null,
  unit: 'PERCENT' | 'DECIMAL_FRACTION',
  ruleKey: string,
  component = 'rate',
): Read<Money> {
  const raw = requireComponent(rate, ruleKey, component);
  if (!raw.ok) {
    return raw;
  }
  if (unit === 'DECIMAL_FRACTION') {
    return readOk(raw.value);
  }
  // Exact division; 18 places is far beyond any published rate's precision.
  return readOk(divide(raw.value, money('100'), 18, RoundingMode.HALF_UP));
}

/** Finds a per-filing-status amount, or explains its absence. */
export function requireForFilingStatus(
  rows: readonly { readonly filingStatus: string; readonly amount: string | null }[],
  filingStatus: string,
  ruleKey: string,
  component: string,
): Read<Money> {
  const row = rows.find((candidate) => candidate.filingStatus === filingStatus);
  if (row === undefined) {
    return readFail(
      unavailable(
        FederalReason.COMPONENT_NOT_STATED,
        `${ruleKey}.${component} has no entry for filing status ${filingStatus}`,
        ruleKey,
        component,
      ),
    );
  }
  return requireComponent(row.amount, ruleKey, `${component}[${filingStatus}]`);
}

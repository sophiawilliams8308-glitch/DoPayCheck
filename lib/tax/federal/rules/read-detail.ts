import { type Money, money } from '@/lib/core/money';

import { FederalReason, type FederalUnavailable, unavailable } from '../errors/federal-errors';
import type { FederalRuleKey } from '../rule-keys';
import { federalRule, type ResolvedFederalRuleSet } from './resolved-rule-set';
import { validateFederalDetail, type FederalDetailSchemas } from './detail-schemas';

/**
 * Safe readers for resolved rule detail (Phase 4).
 *
 * ===========================================================================
 * THE ONLY WAY A TAX VALUE ENTERS THE ENGINE.
 *
 * Every read returns either a value or an explained absence. There is no overload that
 * returns a default, because a default is exactly the fabricated number the specification
 * forbids: `null` in a rule detail means the official source does not state the value, and
 * that is not zero.
 * ===========================================================================
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
 * Fetches a rule's detail, checking availability, verification and schema in that order.
 *
 * Verification is checked BEFORE the values are read: an unverified rule must never produce a
 * figure, however complete its data looks.
 */
export function readDetail<K extends keyof FederalDetailSchemas>(
  ruleSet: ResolvedFederalRuleSet,
  key: K & FederalRuleKey,
): Read<{ detail: unknown; ruleKey: string }> {
  const entry = federalRule(ruleSet, key);
  if (!entry.available) {
    return readFail(entry.problem);
  }

  if (entry.rule.verificationStatus !== 'VERIFIED') {
    return readFail(
      unavailable(
        FederalReason.RULE_UNVERIFIED,
        `Rule ${key} is ${entry.rule.verificationStatus}; an unverified rule is never treated as authoritative`,
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

  return readOk({ detail: entry.rule.detail, ruleKey: key });
}

/**
 * Converts a nullable decimal component into Money.
 *
 * `null` becomes COMPONENT_NOT_STATED, naming the exact component so an operator can go
 * straight to the field that needs sourcing.
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

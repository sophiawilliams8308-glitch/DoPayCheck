import { type Money, RoundingMode, divide, money } from '@/lib/core/money';

import { StateReason, stateUnavailable, type StateUnavailable } from '../errors/stateErrors';
import type { StateRuleKey } from '../ruleKeys';
import { validateStateDetail, type StateDetailSchemas } from './detailSchemas';
import { stateRule, type ResolvedStateRuleSet } from './stateRuleSet';

/**
 * Safe readers for resolved STATE rule detail — the state-namespaced analog of
 * `lib/tax/federal/rules/read-detail.ts`.
 *
 * ===========================================================================
 * THIS IS NOT A CALCULATION MODULE.
 *
 * It answers exactly one question per call: "is this rule key's detail safe to
 * read, and if so, here it is." It never computes a tax, a withholding amount,
 * a wage-base cap, or a rounded figure — those are later modules' jobs. Every
 * read returns a value or an explained absence; there is deliberately no
 * overload that returns a default, because a default is exactly the
 * fabricated number this project's rules forbid.
 * ===========================================================================
 *
 * NOT A NEW SOURCE OF TRUTH. This module reads from an already-frozen
 * `ResolvedStateRuleSet` (Step 3.7's output) via the existing `stateRule()`
 * accessor — it never queries `TaxRule`, never calls `retrieveCandidates` or
 * `resolveCandidates`, never assembles a rule set, never selects or
 * re-resolves a jurisdiction, and never mutates the resolved set or its
 * entries. Provenance (`reference`, `verificationStatus`) is returned exactly
 * as `assembleStateRuleSet` already produced it — never re-derived here.
 *
 * ===========================================================================
 * WHY THIS IS NOT A COPY OF THE FEDERAL READER.
 *
 * The shape of the problem is identical (existence -> verification -> schema
 * validation, in that order), so the control flow mirrors federal's. But the
 * types are state's own throughout: `StateUnavailable`/`StateReason` (not
 * `FederalUnavailable`/`FederalReason`), `STATE_DETAIL_SCHEMAS` (not
 * `FederalDetailSchemas`), and `stateRule()`/`ResolvedStateRuleSet` (not
 * `federalRule()`/`ResolvedFederalRuleSet`). No federal module is imported.
 * ===========================================================================
 */

export type Read<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly problem: StateUnavailable };

export function readOk<T>(value: T): Read<T> {
  return { ok: true, value };
}

export function readFail<T>(problem: StateUnavailable): Read<T> {
  return { ok: false, problem };
}

/**
 * Verification statuses the engine may compute from.
 *
 * `NOT_APPLICABLE` is usable because it is a positive, source-backed statement
 * that the concept does not apply here (e.g. a state with no SDI programme at
 * all) — not an absence of research. `PENDING`, `NOT_STATED`, `CONFLICT` and
 * `PARTIALLY_VERIFIED` are not usable; this mirrors the same
 * `TaxRule.verificationStatus` vocabulary the federal reader already applies
 * this identical rule to (same Prisma enum, same column), reimplemented here
 * rather than imported, per the state/federal namespace boundary.
 */
const USABLE_VERIFICATION = new Set(['VERIFIED', 'NOT_APPLICABLE']);

export interface ResolvedDetail<K extends keyof StateDetailSchemas> {
  readonly detail: unknown;
  readonly ruleKey: K;
  readonly verificationStatus: string;
}

/**
 * Fetches a state rule's detail, checking availability, verification and
 * schema — in that order. Verification is checked BEFORE the detail is
 * exposed: an unverified rule must never produce a figure, however complete
 * its data looks.
 *
 * `detail` is returned as `unknown`, validated but not narrowed to a specific
 * TypeScript shape — exactly as the federal reader does. A calculation module
 * that reads a specific key already knows, from `STATE_DETAIL_SCHEMAS`, which
 * of the `detailSchemas.ts` inferred types applies, and casts accordingly.
 * Inventing a generic narrowing here would require guessing which shape a
 * caller wants; this module does not decide that.
 */
export function readDetail<K extends keyof StateDetailSchemas & StateRuleKey>(
  ruleSet: ResolvedStateRuleSet,
  key: K,
): Read<ResolvedDetail<K>> {
  const entry = stateRule(ruleSet, key);
  if (!entry.available) {
    return readFail(entry.problem);
  }

  if (!USABLE_VERIFICATION.has(entry.rule.verificationStatus)) {
    return readFail(
      stateUnavailable(
        StateReason.RULE_UNVERIFIED,
        `Rule ${key} is ${entry.rule.verificationStatus}; only VERIFIED or NOT_APPLICABLE data may be used`,
        key,
      ),
    );
  }

  const validation = validateStateDetail(key, entry.rule.detail);
  if (!validation.ok) {
    const first = validation.issues[0];
    return readFail(
      stateUnavailable(
        StateReason.RULE_DETAIL_INVALID,
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
 * Converts a nullable decimal component into `Money`.
 *
 * `null` (and `undefined`, for a component that may be absent from an older
 * detail shape) becomes `COMPONENT_NOT_STATED`, naming the exact component, so
 * an operator goes straight to the field that needs sourcing. `null` is never
 * treated as zero — every `nullableDecimal` field in `detailSchemas.ts` uses
 * `null` to mean "the source does not state this", which this function
 * preserves rather than reinterprets.
 */
export function requireComponent(
  value: string | null | undefined,
  ruleKey: string,
  component: string,
): Read<Money> {
  if (value === null || value === undefined) {
    return readFail(
      stateUnavailable(
        StateReason.COMPONENT_NOT_STATED,
        `${ruleKey}.${component} is not stated by the official source; it is not zero`,
        ruleKey,
        component,
      ),
    );
  }
  return readOk(money(value));
}

/**
 * THE ONE PLACE A STATE RATE UNIT IS CONVERTED.
 *
 * `stateRateDetailSchema` establishes one common rate shape (`rate` +
 * mandatory `unit`), reused verbatim across every rate-shaped state rule key
 * (`PIT_FLAT_RATE`, `SDI_EMPLOYEE_RATE`, `SDI_EMPLOYER_RATE`,
 * `PFML_EMPLOYEE_RATE`, `PFML_EMPLOYER_RATE`, `SUTA_EMPLOYER_RATE`,
 * `SUTA_NEW_EMPLOYER_RATE`, `SUTA_EMPLOYEE_RATE`) — so one conversion function
 * here, rather than one per rate-bearing rule key, is justified by the schema
 * itself, not assumed. Always returns a DECIMAL FRACTION: a percent/fraction
 * mix-up is a 100x error, so the unit is read from the data and converted
 * here exactly once, rather than being assumed at each call site.
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

/**
 * Finds a per-filing-status amount, or explains its absence.
 *
 * Matches the `AMOUNT_BY_FILING_STATUS` shape (`stateAmountByFilingStatusDetailSchema`:
 * `{ filingStatus, amount }` rows), which is itself reused across
 * `PIT_STANDARD_DEDUCTION`, `PIT_PERSONAL_EXEMPTION` and
 * `WITHHOLDING_STANDARD_DEDUCTION` — the repeated shape is what justifies one
 * shared helper.
 *
 * NOT the same schema as `WITHHOLDING_FILING_STATUS_MAP`
 * (`stateFilingStatusMapDetailSchema`), which maps a jurisdiction's own filing
 * status names onto the federal vocabulary — a different question with a
 * different row shape. No helper for that lookup is exposed here: no state
 * calculation primitive currently consumes it, and adding one now would be a
 * speculative API.
 */
export function requireForFilingStatus(
  rows: readonly { readonly filingStatus: string; readonly amount: string | null }[],
  filingStatus: string,
  ruleKey: string,
  component: string,
): Read<Money> {
  const row = rows.find((candidate) => candidate.filingStatus === filingStatus);
  if (row === undefined) {
    return readFail(
      stateUnavailable(
        StateReason.COMPONENT_NOT_STATED,
        `${ruleKey}.${component} has no entry for filing status ${filingStatus}`,
        ruleKey,
        component,
      ),
    );
  }
  return requireComponent(row.amount, ruleKey, `${component}[${filingStatus}]`);
}

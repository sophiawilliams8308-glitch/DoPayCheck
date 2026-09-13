import type { FederalRuleKey } from '../rule-keys';

/**
 * Domain contracts for the Phase 8 federal admin screens (Phase 4).
 *
 * ===========================================================================
 * DATA SHAPES ONLY — NO UI, NO ROUTES, NO QUERIES.
 *
 * Phase 4 does not build the admin. It defines what the admin will need to READ, so those
 * screens can be assembled later without reshaping the engine to fit them. Every type here
 * describes information the engine or the rule tables already hold.
 * ===========================================================================
 *
 * Screens these serve: Federal Withholding Schedules · Schedule Compare · Federal Rates &
 * Bases · Deduction Taxability Matrix · Federal Sources · Federal Verification Queue ·
 * Publish Gate · Federal Test Runner · Federal Rule Audit.
 */

/** A row in the Federal Withholding Schedules list. */
export interface FederalScheduleSummary {
  readonly ruleKey: FederalRuleKey;
  readonly version: number;
  readonly taxYear: number;
  readonly effectiveFrom: string;
  readonly effectiveTo: string | null;
  readonly status: string;
  readonly verificationStatus: string;
  readonly filingStatuses: readonly string[];
  readonly rowCount: number;
  readonly sourceCount: number;
}

/** Schedule Compare: one field differing between two rule versions. */
export interface FederalScheduleDifference {
  readonly path: string;
  readonly leftValue: string | null;
  readonly rightValue: string | null;
  /** True when one side is NOT_STATED — different from a changed value. */
  readonly involvesNotStated: boolean;
}

export interface FederalScheduleComparison {
  readonly ruleKey: FederalRuleKey;
  readonly leftVersion: number;
  readonly rightVersion: number;
  readonly differences: readonly FederalScheduleDifference[];
}

/** Federal Rates & Bases: one authoritative component and its state. */
export interface FederalRateOrBase {
  readonly ruleKey: FederalRuleKey;
  readonly component: string;
  /** Exact decimal string, or null when the source does not state it. Never zero-filled. */
  readonly value: string | null;
  readonly unit: string | null;
  readonly verificationStatus: string;
  readonly sourceIds: readonly string[];
}

/** Deduction Taxability Matrix: which buckets a deduction type reduces. */
export interface DeductionTaxabilityRow {
  readonly deductionType: string;
  readonly federalIncomeTax: boolean | null;
  readonly socialSecurity: boolean | null;
  readonly medicare: boolean | null;
  readonly futa: boolean | null;
  /** `null` in any column means the treatment is not yet verified — never assumed false. */
  readonly verificationStatus: string;
}

/** Federal Verification Queue: what still needs a human decision. */
export interface FederalVerificationItem {
  readonly ruleKey: FederalRuleKey;
  readonly component: string;
  readonly currentStatus: string;
  readonly blocking: boolean;
  readonly reason: string;
}

/** Publish Gate: why a federal rule may or may not be activated. */
export interface FederalPublishGate {
  readonly ruleKey: FederalRuleKey;
  readonly version: number;
  readonly canPublish: boolean;
  readonly blockers: readonly string[];
}

/** Federal Test Runner: the outcome of one engine check against a rule set. */
export interface FederalTestRun {
  readonly engineVersion: string;
  readonly ruleKey: FederalRuleKey;
  readonly scenario: string;
  readonly status: string;
  readonly detail: string;
}

/** Federal Rule Audit: what a historical calculation actually used. */
export interface FederalAuditRow {
  readonly snapshotId: string;
  readonly calculatedAt: string;
  readonly engineVersion: string;
  readonly taxYear: number;
  readonly effectiveDate: string;
  readonly ruleKeys: readonly string[];
  readonly ruleVersions: readonly number[];
  readonly sourceIds: readonly string[];
  readonly status: string;
}

import { StateCapability } from './coverage/capabilities';
import { StateRuleKey } from './ruleKeys';
import type { CapabilityCode } from './resolutionContext';

/**
 * F-02 — capability -> required rule keys — Phase 5 Step 3.4.
 *
 * ===========================================================================
 * THIS IS THE APPROVED MAPPING, NOT A DERIVED ONE.
 *
 * Every entry below was explicitly approved as the project's F-02 design
 * decision. Nothing here is inferred from `StateRuleKey`'s naming prefixes,
 * from `CAPABILITY_PROGRAM` (Step 2's unrelated capability->programme
 * grouping), or from any other existing structure — an inspection performed
 * before this file existed found no naming-convention shortcut that could
 * stand in for a human decision, and this file is that decision, recorded.
 * ===========================================================================
 *
 * SEPARATE FROM STEP 3.3. `consultCoverage` (coverageGate.ts) answers "may
 * candidate retrieval proceed for this (jurisdiction, capability)?" — a
 * question about a jurisdiction's recorded readiness. This file answers a
 * different question that has nothing to do with any jurisdiction: "which
 * rule keys does a capability need, everywhere?" Neither seam reads the
 * other's module.
 *
 * NOT A CLAIM ABOUT ANY JURISDICTION. A capability requiring
 * `PIT_RATE_BRACKETS` does not mean every state has that rule populated —
 * that is Step 2 coverage's and later stages' concern, never this file's.
 *
 * SHARED KEYS ARE INTENTIONAL AND NOT DEDUPLICATED ACROSS CAPABILITIES.
 * `WITHHOLDING_SUPPLEMENTAL` appears under both `WITHHOLDING` and
 * `SUPPLEMENTAL_WAGES`; `WITHHOLDING_ELECTION_FORM` appears under both
 * `WITHHOLDING` and `ELECTIONS`. Each capability's list is independent.
 *
 * `CAPABILITY_DECLARATION` DELIBERATELY NEVER APPEARS BELOW. It is
 * foundational metadata read before any capability-specific lookup, not a
 * per-capability calculation requirement.
 */

/**
 * The approved F-02 mapping. A `Record`, not a `Partial` — TypeScript refuses
 * to compile this file if any of the 13 `StateCapability` values is missing,
 * so a future capability added to Step 2 without an F-02 entry is a build
 * failure, never a silent gap.
 */
export const CAPABILITY_RULE_KEYS: Readonly<Record<CapabilityCode, readonly StateRuleKey[]>> =
  Object.freeze({
    [StateCapability.INCOME_TAX]: Object.freeze([
      StateRuleKey.PIT_RATE_BRACKETS,
      StateRuleKey.PIT_STANDARD_DEDUCTION,
      StateRuleKey.PIT_PERSONAL_EXEMPTION,
      StateRuleKey.PIT_DEPENDENT_EXEMPTION,
      StateRuleKey.PIT_FLAT_RATE,
    ]),
    [StateCapability.WITHHOLDING]: Object.freeze([
      StateRuleKey.WITHHOLDING_METHOD,
      StateRuleKey.WITHHOLDING_TABLE,
      StateRuleKey.WITHHOLDING_FORMULA,
      StateRuleKey.WITHHOLDING_ALLOWANCE_VALUE,
      StateRuleKey.WITHHOLDING_STANDARD_DEDUCTION,
      StateRuleKey.WITHHOLDING_PAY_PERIODS_PER_YEAR,
      StateRuleKey.WITHHOLDING_ROUNDING_POLICY,
      StateRuleKey.WITHHOLDING_SUPPLEMENTAL,
      StateRuleKey.WITHHOLDING_FILING_STATUS_MAP,
      StateRuleKey.WITHHOLDING_ELECTION_FORM,
    ]),
    [StateCapability.SUPPLEMENTAL_WAGES]: Object.freeze([StateRuleKey.WITHHOLDING_SUPPLEMENTAL]),
    [StateCapability.DISABILITY_SDI]: Object.freeze([
      StateRuleKey.SDI_PROGRAM,
      StateRuleKey.SDI_EMPLOYEE_RATE,
      StateRuleKey.SDI_EMPLOYER_RATE,
      StateRuleKey.SDI_WAGE_BASE,
      StateRuleKey.SDI_MAX_CONTRIBUTION,
    ]),
    [StateCapability.PAID_LEAVE]: Object.freeze([
      StateRuleKey.PFML_PROGRAM,
      StateRuleKey.PFML_EMPLOYEE_RATE,
      StateRuleKey.PFML_EMPLOYER_RATE,
      StateRuleKey.PFML_WAGE_BASE,
      StateRuleKey.PFML_MAX_CONTRIBUTION,
    ]),
    [StateCapability.SUTA]: Object.freeze([
      StateRuleKey.SUTA_PROGRAM,
      StateRuleKey.SUTA_EMPLOYER_RATE,
      StateRuleKey.SUTA_NEW_EMPLOYER_RATE,
      StateRuleKey.SUTA_EMPLOYEE_RATE,
      StateRuleKey.SUTA_WAGE_BASE,
    ]),
    [StateCapability.RECIPROCITY]: Object.freeze([StateRuleKey.RECIPROCITY_AGREEMENT]),
    [StateCapability.TAXABILITY]: Object.freeze([StateRuleKey.TAXABILITY_PROFILE]),
    [StateCapability.WAGE_BASES]: Object.freeze([
      StateRuleKey.SDI_WAGE_BASE,
      StateRuleKey.PFML_WAGE_BASE,
      StateRuleKey.SUTA_WAGE_BASE,
    ]),
    [StateCapability.FILING_STATUSES]: Object.freeze([StateRuleKey.WITHHOLDING_FILING_STATUS_MAP]),
    [StateCapability.ELECTIONS]: Object.freeze([StateRuleKey.WITHHOLDING_ELECTION_FORM]),
    [StateCapability.ROUNDING]: Object.freeze([StateRuleKey.WITHHOLDING_ROUNDING_POLICY]),
    [StateCapability.EMPLOYER_PROGRAMS]: Object.freeze([
      StateRuleKey.SDI_PROGRAM,
      StateRuleKey.PFML_PROGRAM,
      StateRuleKey.SUTA_PROGRAM,
    ]),
  });

/**
 * Looks up the required rule keys for one capability — the F-02 seam.
 *
 * PURE, SYNCHRONOUS, DETERMINISTIC. Reads only the frozen canonical map
 * above; performs no I/O, no coverage lookup, no rule retrieval, no
 * calculation. `capability` is typed `CapabilityCode` (the closed 13-member
 * vocabulary), exactly as `consultCoverage` types its own capability
 * parameter — this function makes the same trust decision Step 3.3 already
 * made, rather than adding a second, inconsistent runtime-validation
 * convention for the same vocabulary. A value that crosses the type boundary
 * (e.g. via an unchecked cast) is not a case this function's contract covers.
 *
 * The return value is the SAME frozen array the canonical map holds — frozen
 * so a caller's attempt to mutate it (`.push`, index assignment) fails rather
 * than silently corrupting the mapping for every subsequent caller.
 */
export function requiredRuleKeys(capability: CapabilityCode): readonly StateRuleKey[] {
  return CAPABILITY_RULE_KEYS[capability];
}

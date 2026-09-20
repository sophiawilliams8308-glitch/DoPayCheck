# Activity

Date: 2026-09-19
Phase: 5 — 50-State Engine
Step: 3.4 (F-02 capability → rule-key mapping + candidate retrieval seam)
Status: BLOCKED — not implemented

## Objective

Implement Phase 5 Step 3.4, whose stated primary purpose was resolving F-02: the deterministic
mapping from each of the 13 `StateCapability` values to the specific `StateRuleKey`s it
requires.

## What Was Done

Inspected before writing any code, as instructed:

- Verified checkpoint: `HEAD 95f3456`, branch `claude/upbeat-dirac-qqhuye`, working tree
  carrying only the intentional uncommitted Step 3.3 files plus the memory-system update —
  matched expectations exactly.
- Read `lib/tax/state/ruleKeys.ts` in full: 33 `StateRuleKey` members across 8 naming groups
  (CAPABILITY_DECLARATION, PIT_*, WITHHOLDING_*, TAXABILITY_PROFILE, SDI_*, PFML_*, SUTA_*,
  RECIPROCITY_AGREEMENT), plus `StateProgram` (4 members) and `CAPABILITY_PROGRAM` (Step 2's
  existing partial capability→program mapping, covering 6 of 13 capabilities).
- Searched the entire repository (source and `docs/`) for any existing capability→rule-key
  mapping, a "required keys" list, or F-02 content: none exists anywhere except my own prior
  project-memory notes describing F-02 as deferred.
- Re-read this task's own instructions for the actual mapping content: found none. The task
  states requirements about the mapping (must be deterministic, must not be invented, must not
  silently default to empty, must follow "the authoritative specification" for capability
  identifiers/rule-key namespace/ordering/unknown-capability behavior) but never supplies the
  actual pairing of any capability to any rule key.

## Why This Blocks

F-02 is specifically the missing DECISION of which rule keys each capability needs — that is
domain content (analogous to tax data), not an architectural pattern I can derive. The only way
to produce something without it being supplied would be to infer it from `StateRuleKey`'s naming
conventions (e.g., guessing that capability `WITHHOLDING` needs every `WITHHOLDING_*` key, that
`DISABILITY_SDI` needs every `SDI_*` key, and so on). This task's own text explicitly forbids
exactly that: "Do NOT infer tax-rule keys from filenames, database records, or current state
data." Six of the thirteen capabilities (`SUPPLEMENTAL_WAGES`, `WAGE_BASES`, `FILING_STATUSES`,
`ELECTIONS`, `ROUNDING`, `EMPLOYER_PROGRAMS`) also have no obvious single naming group to
pattern-match against at all — several rule keys plausibly serve more than one of them (e.g.
`WAGE_BASES` cuts across `SDI_WAGE_BASE`, `PFML_WAGE_BASE`, `SUTA_WAGE_BASE`), which is exactly
the kind of judgment call CLAUDE.md §8 already identifies as needing a human decision, not an
inference.

This task's own text anticipates this outcome directly: "A capability must not silently receive
an empty or invented rule-key list merely because its mapping has not yet been defined" — i.e.
it treats "not yet defined" as a live possibility to be handled by stopping, not papered over.

## Files Changed

None. No implementation file, test file, or guard was created or modified for Step 3.4. The
working tree's Step 3.3 files (`lib/tax/state/coverageGate.ts`,
`tests/unit/state-coverage-gate.test.ts`, the `state-guards.test.ts` additions) are untouched by
this attempt.

## Tests / Verification

Not applicable — no implementation attempted.

## Decisions

Decided to stop and report rather than derive a mapping from `StateRuleKey`'s naming
conventions, consistent with this task's own explicit prohibition and with how the first Step
3.3 attempt (also correctly blocked for a missing concrete contract) was handled earlier this
session.

## Blockers

- F-02 (capability → rule-key mapping): still blocking, now confirmed a second time that no
  content for it exists anywhere accessible. See `CLAUDE.md` §8 for the durable record.

## Git

- No commit. No push. HEAD unchanged at `95f3456`. Working tree unchanged from before this
  attempt except for this log entry and the `CLAUDE.md` update.

## Next Action

Obtain the actual F-02 mapping table (capability → required `StateRuleKey`s, with any ordering/
unknown-capability rules) from the project owner, supplied the same way Step 3.1/3.2/3.3's
contracts were — pasted inline with concrete content — before attempting Step 3.4 again.

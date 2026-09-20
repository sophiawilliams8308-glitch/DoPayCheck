# Activity

Date: 2026-09-20
Phase: 5 — 50-State Engine
Step: 3.7 (`assembleStateRuleSet` — final rule-set assembly)
Status: COMPLETE, uncommitted

## Objective

Implement Phase 5 Step 3.7 exactly as explicitly locked by the project owner in this task's
prompt: consume Step 3.6's `StateRuleResolutionResult`, plus explicit caller-supplied
metadata, and assemble the frozen `ResolvedStateRuleSet` (Step 1's existing type) — without any
database access, since the Step 3.5 provenance-preservation fix already made that possible.

## Historical evidence vs. this task's contract

A first Step 3.7 implementation attempt (same day, earlier task) inspected `ResolvableRule`
(Step 3.6's then-payload shape) against `ResolvedStateRule`/`RuleReference` and found it
lacked `jurisdictionCode`, `sourceIds`, `verified`, `detail`, and `verificationStatus` — fields
required to construct them honestly. That attempt correctly reported BLOCKED rather than
fabricating those fields, with three remediation options. The project owner selected **Option
1** (extend Step 3.5's candidate representation) in a follow-up task, implemented as the
`StateResolvableRule` type in `candidateRetrieval.ts` and carried through `resolveCandidates.ts`
(see `docs/claude-log/2026-09-20-step-3-5-retrieve-candidates.md`'s follow-up correction
section). **This task's own contract explicitly confirms that fix is in place** and requires
Step 3.7 to consume it directly, with no database re-fetch — which is what was implemented.

## What Was Locked (this task's contract)

1. `assembleStateRuleSet(resolution: StateRuleResolutionResult, metadata:
StateRuleSetAssemblyMetadata): ResolvedStateRuleSet` — pure, in-memory, no DB access.
2. `StateRuleSetAssemblyMetadata` — a small, explicit, caller-supplied metadata type
   (`taxYear`, `effectiveDate`, `jurisdictionCode`, `engineVersion`, `resolvedAt`), never
   derived or defaulted internally.
3. Mapping: `RESOLVED` → available `ResolvedStateRule` (provenance preserved verbatim);
   `NOT_FOUND` → unavailable entry, `StateReason.RULE_MISSING`; `AMBIGUOUS` → unavailable
   entry, `StateReason.RULE_CONFLICT`, never arbitrated.
4. No re-fetch, no re-derivation of provenance from IDs, no fabricated `sourceIds`/`verified`.
5. Verification status is carried through exactly as given — never upgraded, downgraded, or
   re-derived from `sourceIds` a second time (a deliberate, explicit divergence from the
   federal assembler's own pattern, called out in this task's own contract).
6. Every rule key in `resolution.results` must be represented in the final `entries`; none
   dropped, none invented, none merged across keys.
7. Use the existing `freezeStateRuleSet()` as the final construction step; no parallel
   rule-set implementation.
8. No re-resolution (`resolveApplicableRules` never imported/called here), no tax calculation,
   no readiness/coverage-scoring engine, no Step 3.8+ implementation.

## What Was Done

- Verified checkpoint matched expectations (`HEAD 95f3456`, branch
  `claude/upbeat-dirac-qqhuye`, working tree carrying only the intentional prior Steps
  3.3-3.6 files) before editing.
- Inspected, before writing any code: `lib/tax/state/rules/stateRuleSet.ts`
  (`ResolvedStateRule`, `StateRuleEntry`, `ResolvedStateRuleSet`, `stateRule()`,
  `freezeStateRuleSet()`), `lib/tax/state/rules/candidateRetrieval.ts` (`StateResolvableRule`,
  confirming the provenance fix's exact shape), `lib/tax/state/rules/resolveCandidates.ts`
  (`StateRuleResolution`, `StateRuleResolutionResult`), `lib/tax/state/errors/stateErrors.ts`
  (`StateReason`, `StateUnavailable`, `stateUnavailable()`, `StateMissingRuleIssue`), and
  `lib/calculator/types/rules.ts` (`RuleReference`'s exact field list/types). Also re-read
  `lib/tax/federal/rules/resolver.ts` as a precedent to adapt from, not copy verbatim — this
  task's own contract explicitly diverges from it on verification handling (see below).
- Created `lib/tax/state/rules/assembleStateRuleSet.ts`: `assembleStateRuleSet(resolution,
metadata)`. Iterates `resolution.results` once; for `RESOLVED`, builds a `RuleReference`
  directly from the carried `StateResolvableRule` fields (`ruleId`, `ruleKey`, `version`,
  `category`, `taxYear`, `jurisdictionId`, `jurisdictionCode`, `effectiveFrom`, `effectiveTo`,
  `sourceIds`, `verified`) and a `ResolvedStateRule` (`key`, `reference`, `detail`,
  `verificationStatus`) — both fields read verbatim, never re-derived; for `NOT_FOUND`/
  `AMBIGUOUS`, builds an unavailable `StateRuleEntry` via the existing `stateUnavailable()`
  helper with `RULE_MISSING`/`RULE_CONFLICT` respectively. Ends with `freezeStateRuleSet()`.
- **Zero dependency on `candidateRetrieval.ts`, type-only or otherwise.** Rather than import
  `StateResolvableRule` directly, the resolved-candidate type is derived structurally via
  `Extract<StateRuleResolutionResult['results'][number], { status: 'RESOLVED' }>['rule']` —
  satisfying this task's explicit "MUST NOT import candidateRetrieval" rule (§14/§19) to the
  letter, not just in spirit (a first draft did import the type and a guard test caught it —
  see "Errors and fixes" below).
- **Zero dependency on `lib/rules/resolution.ts`.** `ResolutionStatus`'s three values are
  matched as plain string literals (`'RESOLVED'`/`'NOT_FOUND'`/`'AMBIGUOUS'`) rather than by
  importing the `ResolutionStatus` const object, so this module names no import from that
  module at all — stronger than strictly required, but unambiguous under the "no re-resolution"
  guard.
- **Jurisdiction consistency check.** Per this task's §11, since nothing in the type contract
  prevents a caller from supplying `metadata.jurisdictionCode` inconsistent with a resolved
  rule's own `jurisdictionCode` (even though today's actual call pattern cannot produce this,
  since Step 3.5 only ever queries one jurisdiction per call), a mismatch is detected and
  reported via the EXISTING `StateReason.INVARIANT_BREACH` vocabulary for that one key, rather
  than silently substituting or rewriting the rule's jurisdiction. No new error mechanism was
  invented.
- **Disclosed gap: `ResolvedStateRuleSet.missing` is left `[]`.** Its entries
  (`StateMissingRuleIssue`) require a `category: string`, and no `StateRuleKey -> RuleCategory`
  mapping exists anywhere in the repository (confirmed by inspection — federal's own
  `KEY_CATEGORY` map in `resolver.ts` is federal-key-scoped). `StateRuleResolutionResult`'s
  `NOT_FOUND` outcome also carries no candidate row to read a category from, even if a mapping
  existed. Inventing a state key→category mapping here would be an unapproved new design
  decision, exactly what this project's rules forbid. `entries` itself is fully populated for
  every key including every unavailable one with its real reason, so no per-key gap
  information is actually lost — only the separate `missing` aggregate convenience list is
  not populated. Flagged as a PENDING DECISION for the project owner, not fabricated around.
- Added `tests/unit/state-rule-set-assembly.test.ts` (15 tests: the 10 minimum scenarios this
  task specified, plus a jurisdiction-mismatch test and an every-key-round-trips test).
- Extended `tests/unit/state-guards.test.ts` with 9 new scanner tests scoped to
  `assembleStateRuleSet.ts` (no DB/Prisma/repository import, no `candidateRetrieval` import at
  all, no `resolveApplicableRules` import/call, no F-02/coverage-model import, no tax value, use
  of the canonical `freezeStateRuleSet()` exactly once, no ambiguity-arbitration heuristic,
  synchronous export).

## Errors and fixes

- **First draft imported `StateResolvableRule` as a type from `candidateRetrieval.ts`** (needed
  for the `buildRuleReference` helper's parameter type). The new "Test 8 — no database access"
  guard (written from this task's own §14/§19, which lists `candidateRetrieval` as a forbidden
  import with no type-only exception) caught this immediately. Fixed by deriving the resolved
  candidate's type structurally from `StateRuleResolutionResult` itself via `Extract<...>`
  instead of importing the name directly — the module now has zero import of any kind from
  `candidateRetrieval.ts`, satisfying the strictest reading of the contract.
- Two TypeScript narrowing issues in the new test file (repeated computed member access on a
  `Partial<Record<...>>` does not narrow across statements) were fixed by capturing each looked
  up entry into a local `const` before narrowing on it, matching the same fix already used in
  the Step 3.5 integration test suite for an analogous issue.
- `rule.ruleKey` (from `StateResolvableRule`, which extends `ResolvableRule` where `ruleKey:
string`) needed an explicit `as StateRuleKey` cast at each point a test fixture indexed
  `ResolvedStateRuleSet.entries` or built a `StateRuleResolution`, since `entries` is keyed by
  the narrower `StateRuleKey` union, not generic `string`.

## Tests / Verification

- Focused Step 3.7 tests: 15/15 passed
- Guard tests (`state-guards.test.ts`): 86/86 passed (9 new)
- All Phase 5 state suites (15 files): 372/372 passed
- Full suite with database (`npm test`, `.env` sourced, Postgres live): 938 passed, 1 skipped,
  0 failed
- `npx tsc --noEmit`, `npm run lint`, `npm run build`, `npx prisma validate`: all clean
- `npm run format:check`: clean for every file this task touched (`prettier --write` applied
  only to the two files created by this task); three pre-existing, previously-unformatted
  `docs/claude-log/*.md` files remain untouched, out of scope (consistent with prior-task
  precedent)
- `git diff --check`: clean

## Boundary confirmation

- No database access (no Prisma, no `getPrisma`, no repository import)
- No import of `candidateRetrieval.ts`, type-only or otherwise
- No re-resolution (no import of `lib/rules/resolution.ts`, no call to
  `resolveApplicableRules`)
- No fallback (an unrecognized/mismatched jurisdiction is reported, never substituted)
- No ambiguity arbitration (every `AMBIGUOUS` outcome is reported as unavailable; no candidate
  is ever selected)
- No fabricated provenance (every `RuleReference`/`ResolvedStateRule` field is read verbatim
  from the resolved `StateResolvableRule` or from explicit caller-supplied metadata)
- No tax calculation, no readiness/coverage-scoring engine
- No Step 3.8+ implementation

## Blockers

None. The one disclosed limitation (`ResolvedStateRuleSet.missing` left empty pending a
`StateRuleKey -> RuleCategory` mapping decision) is not a blocker for Step 3.7's own job —
`entries` carries the same gap information per-key already — but is recorded here and in
CLAUDE.md §7/§15 as a PENDING DECISION for whoever picks up a future step that wants it
populated.

## Git

- No commit. No push. HEAD unchanged at `95f3456`.

## Next Action

Awaiting an explicit instruction to commit and push Steps 3.3-3.7 together as a checkpoint
(Step 3, the State Rule Resolver, is now implemented end to end), or to begin a further step
(e.g. wiring `assembleStateRuleSet()` into an actual caller/Stage B, or resolving the
`StateRuleKey -> RuleCategory` mapping decision noted above) once its own concrete contract is
supplied.

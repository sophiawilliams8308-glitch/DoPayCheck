# Activity

Date: 2026-09-20
Phase: 5 — 50-State Engine
Step: 3.6 (`resolveCandidates` — candidate resolution decision)
Status: COMPLETE, uncommitted

## Objective

Implement Phase 5 Step 3.6 exactly as explicitly locked by the project owner in this task's
prompt — the first Step 3 sub-step whose contract was authored and approved directly, rather
than recovered from repository archaeology. This is distinct from every prior "specification
recovery" finding: earlier read-only inspections found no historical/owner-supplied Step 3.6
specification anywhere in the repository or git history; this task's own prompt IS that
specification, newly approved.

## What Was Locked

1. Step 3.6 is the candidate-resolution DECISION stage only — it consumes Step 3.5's
   `StateRuleCandidates[]` and decides, per rule key, `RESOLVED` / `NOT_FOUND` / `AMBIGUOUS`.
2. It delegates that decision entirely to Phase 2's existing `resolveApplicableRules()`
   (`lib/rules/resolution.ts`) — no second resolution algorithm.
3. `RESOLVED`, `NOT_FOUND`, `AMBIGUOUS` are preserved as distinguishable outcomes — never
   collapsed into a boolean or nullable value.
4. Ambiguity is never silently arbitrated — every candidate is preserved, none selected.
5. No database access, no coverage consultation, no F-02 mapping duplication, no tax
   calculation.
6. No `ResolvedStateRuleSet` construction or `freezeStateRuleSet`/`stateRule()` call — that is
   explicitly a later stage's responsibility.

## What Was Done

- Verified checkpoint matched expectations (`HEAD 95f3456`, branch
  `claude/upbeat-dirac-qqhuye`, working tree carrying only the intentional prior Steps
  3.3-3.5 files) before editing.
- Inspected `lib/rules/resolution.ts` (`resolveApplicableRules`, `ResolutionStatus`,
  `ResolutionResult`, `ResolvableRule`) and `lib/tax/federal/rules/resolver.ts` (the federal
  precedent for calling it once per key) before writing any code.
- Created `lib/tax/state/rules/resolveCandidates.ts`: `resolveCandidates(candidateGroups)` —
  pure, synchronous. Maps each `StateRuleCandidates` group through `resolveApplicableRules`
  independently, in input order, never merging duplicate keys.
- Added `tests/unit/state-candidate-resolution.test.ts` (11 tests: resolved/not-found/
  ambiguous/mixed/multi-key/purity/delegation/duplicate-key preservation).
- Extended `tests/unit/state-guards.test.ts` with 7 new scanner tests scoped to
  `resolveCandidates.ts`.

## A necessary bridging decision — disclosed, not silently made

`resolveApplicableRules` requires a `ResolutionQuery` (`{jurisdictionId, category,
effectiveDate}`) to re-apply its own filters. Step 3.6's locked signature receives only
`StateRuleCandidates[]` — no such query is passed in alongside it. Rather than treating this
as a blocker, the query fields were derived directly from the candidates themselves:

- `jurisdictionId` and `category`: read from the group's own first candidate (Step 3.5
  guarantees homogeneity — one jurisdiction per retrieval call, one category per rule key).
- `effectiveDate`: reconstructed as the LATEST `effectiveFrom` among the group's own
  candidates. This is provably a no-op re-filter, not a new date-selection decision: Step
  3.5's SQL query already guarantees every returned candidate's window contains the true
  calculation instant, so every candidate's `effectiveFrom <= trueInstant < effectiveTo`. The
  latest `effectiveFrom` in the group is therefore also `<= trueInstant`, and transitively
  still `< every candidate's effectiveTo` — so re-checking against it can never exclude a
  candidate Step 3.5 already correctly retrieved. Verified with worked examples for the
  ambiguous (overlapping-window) case in the module's own doc comment.
- An EMPTY candidate group needs no such query at all: filtering zero candidates is
  unconditionally `NOT_FOUND` regardless of any query field, and there is nothing in an empty
  array to derive `jurisdictionId`/`category` from. This case returns `NOT_FOUND` directly
  rather than inventing placeholder values to force a call that cannot change the outcome.

This reasoning is documented in full in `resolveCandidates.ts`'s own module-level comment, not
just here.

## Files Changed

- `lib/tax/state/rules/resolveCandidates.ts` (new)
- `tests/unit/state-candidate-resolution.test.ts` (new)
- `tests/unit/state-guards.test.ts` (modified — new Step 3.6 guard block)

## Tests / Verification

- Focused Step 3.6: 11/11 passed
- Guard tests: part of `state-guards.test.ts`'s 77/77 passed
- All Phase 5 state suites (14 files): 341/341 passed
- Full suite with database (`npm test`, `.env` sourced, Postgres live): 907 passed, 1 skipped,
  0 failed
- `npx tsc --noEmit`, `npm run lint`, `npm run format:check`, `npm run build`,
  `npx prisma validate`: all clean
- `git diff --check`: clean

## Blockers

None. F-02 remains resolved. Pipeline positions 3-4 remain intentionally open.

## Git

- No commit. No push. HEAD unchanged at `95f3456`.

## Next Action

Awaiting an explicit instruction to commit and push Steps 3.3-3.6 together as a checkpoint, or
to begin Step 3.7+ (final `ResolvedStateRuleSet` assembly, consuming
`resolveCandidates()`'s output) once its own concrete contract is supplied.

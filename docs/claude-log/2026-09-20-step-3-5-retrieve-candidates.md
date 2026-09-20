# Activity

Date: 2026-09-20
Phase: 5 — 50-State Engine
Step: 3.5 (`retrieveCandidates` — candidate retrieval)
Status: COMPLETE, uncommitted

## Objective

Implement Phase 5 Step 3.5 once the project owner explicitly approved `retrieveCandidates`
(pipeline position 7) as the next seam, deliberately choosing not to backfill the earlier-
skipped pipeline positions 3-4 (`fixEffectiveInstant`, `identifyJurisdictions`).

## Why positions 3-4 were not implemented here

This was an explicit owner sequencing decision, not an oversight or a default. The prior
read-only inspection (see the Step 3.5 specification-recovery report earlier this session)
found `Step 3.3 -> pipeline position 5` and `Step 3.4 -> pipeline position 6`, meaning
positions 3-4 had already been skipped once before this task began. The owner's instruction
for this task explicitly reaffirmed skipping them again and forbade treating this task as
license to implement them.

## What Was Done

- Verified checkpoint matched expectations (`HEAD 95f3456`, branch
  `claude/upbeat-dirac-qqhuye`) before editing.
- Inspected the Prisma schema (`TaxRule`, `Jurisdiction` models), the existing Phase 2
  repository/resolution abstractions (`lib/rules/repository.ts`, `lib/rules/resolution.ts`),
  the existing jurisdiction lookup (`lib/jurisdictions/repository.ts`'s `findByCode`), and the
  Phase 4 federal precedent (`lib/tax/federal/rules/resolver.ts`,
  `docs/PHASE-4-FEDERAL-TAX-ENGINE-SPEC.md` §3.1) before writing any code.
- Created `lib/tax/state/rules/candidateRetrieval.ts`: `retrieveCandidates(jurisdictionCode,
  calculationDate, ruleKeys)` — an async function (the first DB-touching module in Phase 5
  Step 3). Mirrors Phase 4's query shape (jurisdiction + rule key + `status: 'ACTIVE'` +
  effective-date window, one `findMany` for every requested key) but stops before any
  resolution decision. Reuses Phase 2's existing `ResolvableRule` type rather than inventing a
  new candidate shape.
- Added `tests/integration/state-candidate-retrieval.test.ts` (10 tests against a real
  PostgreSQL database, following the exact `federal-rule-resolution.test.ts` fixture pattern):
  key-preservation/ordering, missing-candidate representation, DRAFT/not-yet-effective
  exclusion, no-fallback-jurisdiction, database-failure propagation, and empty-input short
  circuit.
- Extended `tests/unit/state-guards.test.ts` with 7 new scanner tests scoped to
  `candidateRetrieval.ts`, and updated the pre-existing "imports no database client" guard
  (Step 1 era) to carve out exactly this one intentional exception rather than weakening it.

## Real findings surfaced during implementation

1. **`TaxRule_no_overlapping_active_versions` is scoped to `ruleKey` alone, not
   `(ruleKey, jurisdictionId)`.** Discovered when a test attempting to create two ACTIVE
   overlapping-window rows for the same key failed unexpectedly at the database. Confirmed by
   reading the actual migration SQL (`prisma/migrations/20260912151038_.../migration.sql`).
   This means two different states can never both hold an ACTIVE rule under the same literal
   `StateRuleKey` string with overlapping effective windows — in tension with Step 1's
   explicit "no key names a state" design. `retrieveCandidates` itself is unaffected (read-
   only), but this is a real risk for future rule-authoring/activation tooling. Flagged, not
   fixed — out of scope for a retrieval-only seam.
2. **Pre-existing test-isolation flake surfaced under added parallel load.** Adding one more
   DB-touching integration test file occasionally reproduces a known, self-documented race in
   `tests/integration/state-coverage-matrix.test.ts` (its own comment: "the race is real").
   Confirmed via repeated full-suite runs (2 of 3 clean) and via isolating variables (changing
   this task's own fixture off `type: 'STATE'` removed one definite collision; the residual
   flake reproduces even so, tied to overall DB connection/scheduling load, not to this task's
   logic). Not modified — that test's design intentionally exercises this exact race.

## Files Changed

- `lib/tax/state/rules/candidateRetrieval.ts` (new)
- `tests/integration/state-candidate-retrieval.test.ts` (new)
- `tests/unit/state-guards.test.ts` (modified — new Step 3.5 guard block + one Step-1-era guard
  updated to permit exactly this one intentional DB-access exception)

## Tests / Verification

- Focused Step 3.5 integration tests: 10/10 passed (real PostgreSQL)
- Guard tests: all passing as part of `state-guards.test.ts`'s 69 tests
- All Phase 5 state suites (13 files, unit + integration): 322/322 passed
- Full suite with database (`npm test`, `.env` sourced, Postgres live): 888 passed, 1 skipped,
  0 failed (occasional unrelated flake noted above; clean on the reported run)
- `npx tsc --noEmit`, `npm run lint`, `npm run format:check`, `npm run build`,
  `npx prisma validate`: all clean
- `git diff --check`: clean

## Decisions

- Reused Phase 2's `ResolvableRule` type directly rather than inventing a new candidate type,
  since it is already jurisdiction/category-agnostic and used by Phase 4.
- Performed the jurisdiction code -> id lookup inline (via the existing `findByCode`), matching
  exactly how Phase 4's own resolver does the same lookup inline — judged to be a mechanical
  query-boundary translation, not the skipped `identifyJurisdictions` decision (which is about
  *which* jurisdiction code applies, a decision made upstream of this function).
- Did not filter by `taxYear` in the query (mirroring Phase 4, where only the effective-date
  window filters, per the schema's own "effective dates decide applicability, not taxYear").

## Blockers

None new. F-02 remains resolved (§9). Pipeline positions 3-4 remain open, by explicit choice,
not by gap.

## Git

- No commit. No push. HEAD unchanged at `95f3456`.

## Next Action

Awaiting an explicit instruction to commit and push Steps 3.3-3.5 together as a checkpoint, or
to begin Step 3.6+ (final rule resolution, consuming `retrieveCandidates()`'s output) once its
own concrete contract is supplied.

---

## Follow-up correction (2026-09-20 — Provenance Preservation Fix)

**This section is an addendum. Nothing above this line has been rewritten — the original
Step 3.5 record stands as-is.**

### What exposed the gap

A subsequent Step 3.7 (`assembleStateRuleSet`) implementation attempt inspected this module's
output type (`StateRuleCandidates` → bare Phase 2 `ResolvableRule`) against what
`ResolvedStateRuleSet`/`RuleReference` (`lib/tax/state/rules/stateRuleSet.ts`,
`lib/calculator/types/rules.ts`) require to be constructed honestly, and found `ResolvableRule`
alone carries none of: `jurisdictionCode`, `sourceIds`, `verified`, the rule's own
`detail`/payload, or its own `verificationStatus`.

### Why this was originally discarded

Step 3.5 deliberately reused Phase 2's existing, minimal `ResolvableRule` shape (see
"Decisions" above) because it is the exact type `resolveApplicableRules` (Step 3.6's sole
decision primitive) requires, and no broader shape was requested at the time. This was a
correct, non-fabricating choice for Step 3.5 and Step 3.6's own needs — the gap only became
visible once a later stage needed to construct a fully-provenanced, presentable rule.

### Why nothing was fabricated instead

`verified: false` or `sourceIds: []` as placeholders would misrepresent a genuinely-verified,
properly-sourced rule as unverified/unsourced — a direct violation of this project's "never
present unverified data as authoritative" rule (CLAUDE.md §13). Step 3.7 was therefore
reported BLOCKED rather than implemented with invented values.

### Owner decision

The project owner explicitly selected **Option 1**: extend Step 3.5's candidate
representation to preserve the required provenance data, rather than adding database access
to Step 3.7 or redesigning Step 3.6's algorithm.

### What changed

- `lib/tax/state/rules/candidateRetrieval.ts`: added `StateResolvableRule` — an interface that
  `extends ResolvableRule` with `jurisdictionCode: string`, `sourceIds: readonly string[]`,
  `verified: boolean`, `detail: unknown`, and `verificationStatus: string`. `StateRuleCandidates
  .candidates` is now `readonly StateResolvableRule[]`. The existing `findMany` query (still
  exactly one call) now also selects `sources: { sourceId, verificationStatus }`; the row-mapping
  closure derives `sourceIds` (every linked source id) and `verified` (true only if at least one
  linked source is itself `VERIFIED`) from those rows — the same derivation
  `lib/tax/federal/rules/resolver.ts` and `lib/calculator/rule-provider.ts` already use for the
  same reason. `jurisdictionCode` comes from the already-looked-up `Jurisdiction` row;
  `detail` is the rule's own `payload` column, unmodified; `verificationStatus` is the rule
  row's own column (distinct from any source's verification status).
- `lib/tax/state/rules/resolveCandidates.ts`: the `StateRuleResolution` union's `RESOLVED.rule`
  and `AMBIGUOUS.candidates` fields are now typed as `StateResolvableRule`/`readonly
  StateResolvableRule[]`. Two narrow, documented type assertions were added at the point where
  `resolveApplicableRules`'s result (still declared, correctly, in terms of the shared/plain
  `ResolvableRule`, since that primitive is also used by the federal engine and was not
  modified) is passed through — justified because `resolveApplicableRules` returns its own
  input elements verbatim/unmodified, so a `StateResolvableRule` array in is provably a
  `StateResolvableRule` array (or one element of it) out; the assertions restore an
  already-true runtime fact to the type checker without changing any value or inventing any
  field.

### Retrieval semantics — confirmed unchanged

Jurisdiction lookup, requested-rule-key set, `status: 'ACTIVE'` filter, effective-date window,
one-`findMany`-per-call shape, result ordering (one entry per requested key, input order),
empty-candidate representation, unrecognized-jurisdiction handling (empty candidates for every
key, no substitution), and database-error propagation (rejected promise, never swallowed) are
all identical to the original Step 3.5 implementation. The full focused integration suite
(now 14 tests, up from 10) passes, including every original assertion unmodified plus four new
ones proving real, database-seeded provenance values are returned (not fabricated
placeholders).

### Resolution semantics — confirmed unchanged

`resolveCandidates`'s algorithm (delegation to `resolveApplicableRules`, per-key
RESOLVED/NOT_FOUND/AMBIGUOUS mapping, the disclosed `effectiveDate`/`jurisdictionId`/`category`
bridging derivation, no arbitration of ambiguity, input-order preservation, duplicate-key
independence) is untouched. The focused unit suite (now 14 tests, up from 11) passes,
including every original assertion unmodified plus three new tests proving provenance fields
survive a RESOLVED result and every candidate in an AMBIGUOUS result unchanged, and that
outcomes themselves (RESOLVED/NOT_FOUND/AMBIGUOUS) are identical to before the enrichment.

### Tests changed

- `tests/unit/state-candidate-resolution.test.ts`: the `rule()` fixture now returns a full
  `StateResolvableRule` (added `jurisdictionCode`, `sourceIds`, `verified`, `detail`,
  `verificationStatus`); `group()`'s parameter type updated to match. Added a new "Test 8 —
  provenance survives resolution unchanged" block (3 tests).
- `tests/integration/state-candidate-retrieval.test.ts`: `makeStateRule()` extended to accept
  `payload`, `verificationStatus`, `withSource`, and `sourceVerificationStatus` overrides, and
  `beforeAll` now seeds one real `Source` row (mirroring `federal-rule-resolution.test.ts`'s
  `makeFederalRule` pattern). Added a new "provenance preservation" `describe` block (4 tests)
  asserting real seeded `jurisdictionCode`, `sourceIds`, `verified` (both true and false cases),
  `detail`, and `verificationStatus` values are returned unchanged.
- `tests/unit/state-guards.test.ts`: inspected; no change needed — its Step 3.5/3.6 guards check
  import boundaries, export shapes, and purity, none of which reference the candidate type's
  field list.

### Verification (this fix)

- Focused Step 3.5 integration tests: 14/14 passed
- Focused Step 3.6 unit tests: 14/14 passed
- Guard tests (`state-guards.test.ts`): all passing, unchanged
- All Phase 5 state suites (14 files): 348/348 passed
- Full suite with database (`npm test`, `.env` sourced, Postgres live): 914 passed, 1 skipped,
  0 failed (7 more than the prior 907, matching the 3+4 new tests added)
- `npx tsc --noEmit`, `npm run lint`, `npm run build`, `npx prisma validate`: all clean
- `npm run format:check`: clean for every file touched by this fix (`prettier --write` applied
  only to `tests/integration/state-candidate-retrieval.test.ts`); three pre-existing,
  previously-unformatted `docs/claude-log/*.md` files remain untouched, out of scope
- `git diff --check`: clean

### Blockers

None. Step 3.7 remains genuinely not implemented (out of scope for this fix) but is no longer
blocked on missing provenance data — a future Step 3.7 task can now honestly construct
`RuleReference`/`ResolvedStateRule` from `StateResolvableRule`.

### Git

- No commit. No push. HEAD unchanged at `95f3456`.

### Next Action

Awaiting an explicit instruction to commit and push Steps 3.3-3.6 (provenance-corrected)
together as a checkpoint, or to begin Step 3.7 (final `ResolvedStateRuleSet` assembly,
consuming the now-provenance-enriched `resolveCandidates()` output) once its own concrete
contract is supplied.

# DoPayCheck — Claude Project Memory & Operating Rules

Persistent memory and operating manual for Claude sessions (Claude Code and Claude Projects)
working on this repository. Read this file first, every session, before doing anything else.

**Purpose:** let a fresh session understand what this project is, what phase it's in, what's
already done, what's blocked, and what to do next — without re-reading old conversations.

This file is deliberately short. Full specifications live in `docs/`. Full historical detail
lives in `docs/claude-log/`. Do not paste specifications, test output, or conversation history
into this file — reference them instead.

---

## 1. Project Identity

- **Project:** DoPayCheck
- **Domain:** https://dopaycheck.com/
- **What it is:** A production-grade US Paycheck & Payroll Tax Transparency Platform.
- **Core promise:** "Know What You'll Take Home."
- **Audience:** US employees and employers who want to understand exactly how a paycheck is
  calculated (gross → deductions → federal/FICA/state/local taxes → net).
- Must be: accurate, transparent, source-traceable, auditable, secure, mobile-first,
  SEO-friendly, fast, accessible, maintainable, annually updatable.
- **Development stage:** Mid-build. Phases 1–4 complete. Phase 5 (50-State Engine) in progress.

---

## 2. User / Communication Rules

The project owner is **non-technical**. Every Claude session must:

- Explain things in plain language. If a technical term is unavoidable, add a one-sentence
  explanation.
- Never say just "it's done." Always state: what was done, whether it passed, what (if
  anything) is blocked, whether Git was committed/pushed, and what the owner should do next.
- Give **one controlled step at a time** — do not bundle multiple unrelated actions.
- Never make silent assumptions. If something is unclear or unspecified, say so explicitly
  rather than guessing.
- Follow: **implement → test → verify → report → stop.** Do not auto-continue to further work
  without explicit instruction.
- Clearly distinguish which surface an instruction applies to: **Claude Project** (planning/
  spec discussion), **Claude Code** (this repository), or **Mac Terminal** (local shell) — and
  give exact copy/paste commands or prompts when the owner needs to run something themselves.
- Do not store sensitive personal information (real names, real financial data, credentials)
  in this file or in `docs/claude-log/`.

**Every Claude Code task should be framed with this header** (the owner may paste it, or a
session may restate it when handing off work):

```text
MODEL:
THINKING LEVEL:
TASK:
SCOPE:
DO NOT DO:
TEST:
REPORT:
STOP CONDITION:
```

---

## 3. Development Principles

Non-negotiable rules, condensed. Full detail: `docs/SPECIFICATION.md`.

- Never invent requirements, tax rules, tax values, or missing contract details. If a spec gap
  exists, flag it (`PENDING DECISION` / `PENDING DATA` / `PENDING VERIFICATION`) — never fill it
  with a guess.
- `NOT_STATED` ≠ `NOT_APPLICABLE` ≠ zero. Never silently convert one into another.
- Never silently resolve conflicting tax sources or requirements — mark `CONFLICT` and escalate
  to the human.
- Historical tax rules and published calculations are never destructively overwritten — version,
  supersede, archive, or roll back instead.
- AI-extracted tax data is never production-authoritative without human verification and
  approval.
- Money uses Decimal/NUMERIC-safe arithmetic everywhere authoritative — never JS floating point.
- Independent taxability buckets: one deduction does not automatically reduce every tax; one
  taxable-wage figure does not automatically apply to every tax.
- No unrelated refactoring. No scope expansion beyond what was explicitly assigned.
- No fallback/default behavior unless the specification explicitly calls for one — an empty or
  missing value is reported as missing, never quietly substituted.
- Inspect existing code/docs before changing anything; preserve valid existing work.
- Development proceeds **phase-by-phase and step-by-step**. Implement only the assigned scope,
  test it, verify it, report it, then **stop** — never auto-advance to the next phase/step/sub-
  step without explicit instruction.

---

## 4. Architecture Summary

- **One integrated Next.js App Router application.** No separate `/frontend` or `/backend` app.
- Conceptual layout: `/app`, `/components`, `/lib`, `/prisma`, `/data`, `/public`, `/tests`,
  `/docs`.
- Stack (verified from `package.json`): Next.js 16 (Turbopack), React 19, TypeScript 5.9
  (strict mode), Prisma 7 + `@prisma/adapter-pg`, PostgreSQL 16, Zod 4, Vitest 5.
- The calculation engine (`lib/calculator/`, `lib/tax/federal/`, `lib/tax/state/`) is kept
  independent and testable: pure, deterministic, no I/O, no database access. Database access,
  external services, and UI concerns must never contaminate calculation methodology.
- Tax rule data is versioned, sourced, and jurisdiction/tax-year scoped — never hardcoded into
  UI or scattered through calculation files. See `docs/DATA-MODEL.md`.
- Two-stage engine pattern (established in Phase 4, reused as precedent for Phase 5): an impure
  Stage A resolver fetches/assembles rules; a pure Stage B calculator computes from them.

---

## 5. Current Repository State

*(Verify with Git before trusting this — it is a snapshot, updated after each meaningful task.)*

```text
Branch:              claude/upbeat-dirac-qqhuye
HEAD:                3d6302c
Working tree:        Clean — nothing uncommitted.
Last verified checkpoint: 3d6302c — feat: implement deannualize formula operation
Current phase:       Phase 5 — 50-State Engine
Current step:        Step 3 (State Rule Resolver) COMPLETE and committed. Step 4 (State Tax
                      Calculation) is well underway: the withholding-formula interpreter
                      implements 11 of its 12 operations (only `ROUND` remains unresolved,
                      by design — see §7).
```

**Disclosure note (2026-09-24 reconciliation):** this section previously stated `HEAD: 95f3456`
with Steps 3.3–3.7 "implemented, uncommitted" long after the repository had moved ~18 commits
past that point (all the way through `3d6302c`), with the intervening commits never recorded
anywhere in this file. That staleness was first noticed during an unrelated task (DM-04) and a
correction to this section was made in that session, but — because this file's own rule (§19,
project git discipline) is to leave a documentation-only edit uncommitted unless a commit is
explicitly requested, and the session's container is ephemeral — that fix never reached a commit
and was lost when the container recycled. This is the second, now-committed correction; §7 and
§11 below have also been reconciled against `git log` for the full `95f3456..3d6302c` range.
**Lesson for future sessions: if a correction to this file matters, say so explicitly and ask for
it to be committed — an uncommitted fix in a cloud session does not survive.**

---

## 6. Current Phase / Step

**Phase 5 — 50-State Engine.** Step 3 (State Rule Resolver) is COMPLETE and committed
(`7717e6a`). Step 4 (State Tax Calculation) is now the active step and is substantially
implemented across 18 further commits (`7717e6a`..`3d6302c` — see §7 for the full,
commit-by-commit breakdown; §11 for the checkpoint table).

Completed within Step 3: 3.1 (Resolution Context), 3.2 (Context Validation), Amendment 2
(structural-only jurisdiction validation), Amendment 3 (explicit capability request source),
3.3 (Coverage Gate), 3.4 (F-02 capability → rule-key mapping), 3.5 (candidate retrieval,
provenance-corrected), 3.6 (candidate resolution decision — RESOLVED/NOT_FOUND/AMBIGUOUS per
key), 3.7 (final `ResolvedStateRuleSet` assembly). Pipeline positions "fixEffectiveInstant"
and "identifyJurisdictions" remain intentionally skipped (owner decision) — see §9.

Completed within Step 4 so far (Tasks 4A–4O-6R45, per the commits' own doc-comment task
numbering — see §7 for detail on each): the safe rule-detail reader primitives, the
Context-Driven State Taxability wage-bucket derivation (Option A), the Phase 3↔Phase 5 state
options/deduction bridge, `buildStateCalculationContext()`, dedicated readers for
`WITHHOLDING_METHOD`/`WITHHOLDING_PAY_PERIODS_PER_YEAR`/`WITHHOLDING_FILING_STATUS_MAP`/
`WITHHOLDING_TABLE` (row selection)/`WITHHOLDING_FORMULA`, and the `WITHHOLDING_FORMULA`
interpreter itself, which as of `3d6302c` implements 11 of its 12 contract operations
(`SUBTRACT_STANDARD_DEDUCTION`, `FLOOR_AT_ZERO`, `APPLY_BRACKETS`, `SUBTRACT_EXEMPTIONS`
[personal-exemption path only], `SUBTRACT_AMOUNT`, `APPLY_FLAT_RATE`, `SUBTRACT_ALLOWANCES`,
`ADD_AMOUNT`, `APPLY_PERCENTAGE_OF`, `ANNUALIZE`, `DEANNUALIZE`). `ROUND` remains
architecturally excluded from this interpreter by an explicit owner decision (Task 4O-6R31) —
it belongs to a future, separate state rounding stage, not a formula-step operation. The
dependent-exemption path of `SUBTRACT_EXEMPTIONS` (`PIT_DEPENDENT_EXEMPTION`) also remains
unresolved. Wiring `runStateWithholdingFormula()` into an actual end-to-end caller/Stage B is
NOT started, and was not requested.

---

## 7. Completed Work

### Phase 1–3 — Foundation, Rule & Data System, Calculation Engine
Status: COMPLETE (pre-dates current session detail; see `docs/DATA-MODEL.md`,
`docs/CALCULATION-ENGINE.md` for architecture).

### Phase 4 — Federal Tax Engine
Status: COMPLETE
Commits: `df825f6`, `dfa7d9c`, `cf9a485`, `2ba4557` (implementation + fixes)
Scope: Federal income tax withholding, FICA, employer taxes; snapshot/replay for historical
reproducibility; full trace of every calculation stage.
Verification: Full suite, typecheck, lint, build all passed at merge to `main`.

### Phase 5 — Step 1: State Contracts
Status: COMPLETE — Commit `af980f5`
Scope: State types, rule-key namespace, detail schemas, `StateCalculationContext`.

### Phase 5 — Step 2: State Coverage Model
Status: COMPLETE — Commit `ae988ac` (+ fixes `979c7f3`, `11b4ae0`)
Scope: 13-capability × 51-jurisdiction coverage matrix; `CoverageStatus` vocabulary
(`SUPPORTED`, `NOT_APPLICABLE`, `NOT_STATED`, `PENDING_RESEARCH`, `PENDING_VERIFICATION`,
`CONFLICT`, `PARTIALLY_SUPPORTED`, `UNSUPPORTED_SCENARIO`).
Important: coverage records READINESS, not rule values. No jurisdiction list is hardcoded.

### Phase 5 — Step 3.1: Resolution Context
Status: COMPLETE — Commit `fd42c98`
Scope: `StateRuleResolutionContext` (8 fields), `StateResolutionScenario`, `WageType` (6
members), `CapabilityCode` (alias of Step 2's `StateCapability`), `projectResolutionContext()`.
Important: structurally excludes money/YTD/deductions — the resolver cannot see wage amounts.

### Phase 5 — Step 3.2 + Amendment 3: Context Validation + Explicit Capability Source
Status: COMPLETE — Commit `8f7952a`
Scope:
- `validateResolutionContext()` — structural validation only (taxYear plausibility,
  calculationDate format/consistency, jurisdiction non-blank, capability membership/non-empty).
- Returns `INVALID_CONTEXT` issues; never throws.
- Amendment 3: `projectResolutionContext(calcContext, capabilitiesRequested)` — the capability
  set is now an explicit, caller-supplied, defensively-copied argument. No derivation, no
  default, no fallback.
Verification: 118 focused tests, 226 Phase 5 state tests, 720 full-suite tests passed;
typecheck/lint/format/build/Prisma validate all clean.
Important: F-02 (capability → rule-key mapping) remains untouched and blocking.

### Phase 5 — Step 3.3: Coverage Gate
Status: COMPLETE — committed in `7717e6a` (2026-09-20), bundled together with Steps 3.4–3.7
below and with the Task 1–4C foundational primitives (see the dedicated entry after §7's
Step 3.7 entry).
Scope:
- New module `lib/tax/state/coverageGate.ts`: `consultCoverage(matrix, jurisdictionCode,
  capability)` — pure, synchronous, zero-query. Consults Step 2's `CoverageMatrix` via the
  existing `findCoverageCell` and decides whether candidate retrieval (Step 3.4, not yet built)
  may proceed for one `(jurisdiction, capability)` pair.
- All 8 `CoverageStatus` values handled explicitly (no `default:` branch): `SUPPORTED` permits;
  the other 7 block with an outcome. `PARTIALLY_SUPPORTED` blocks the entire capability (never
  split, no per-key mapping) with outcome `PENDING_VERIFICATION`, recording the true
  `PARTIALLY_SUPPORTED` status in a minimal `CoverageConsultationEntry` (state, capability,
  status, action) for the trace.
- Unknown jurisdiction (no coverage cell recorded): reuses Step 2's existing
  `findCoverageCell` default (synthesizes `PENDING_RESEARCH`) — no new jurisdiction-existence
  logic was added.
Verification: 21 focused tests (all 8 statuses + unknown-jurisdiction + zero-query proofs) +
5 new guard/scanner tests; 253 Phase 5 state tests passed; 747 full-suite tests passed;
typecheck/lint/format/build/Prisma validate all clean.
Important: F-02 remains untouched and blocking — no capability → rule-key mapping exists
anywhere in this module. Step 3.4 (candidate retrieval) was not started.

### Phase 5 — Step 3.4: F-02 Capability → Rule-Key Mapping
Status: COMPLETE — committed in `7717e6a` (2026-09-20), bundled with Steps 3.3, 3.5–3.7.
Scope:
- New module `lib/tax/state/capabilityRuleKeys.ts`: `CAPABILITY_RULE_KEYS` — a complete,
  frozen `Record<CapabilityCode, readonly StateRuleKey[]>` covering all 13 `StateCapability`
  values (TypeScript refuses to compile if one is missing), and `requiredRuleKeys(capability)`,
  a pure lookup function.
- The mapping is the explicitly approved project design decision (two prior inspection attempts
  found no authoritative mapping anywhere in the repo, git history, branches, or docs — see the
  now-superseded F-02 blocker below and `docs/claude-log/2026-09-19-step-3-4-blocked.md`).
- `CAPABILITY_DECLARATION` deliberately appears in no capability's list (foundational metadata,
  not a per-capability requirement). Several `StateRuleKey`s are intentionally shared across
  more than one capability (e.g. `WITHHOLDING_SUPPLEMENTAL` under both `WITHHOLDING` and
  `SUPPLEMENTAL_WAGES`) and are not deduplicated globally.
- Independent of Step 3.3: `capabilityRuleKeys.ts` never imports `coverageGate.ts`, the
  `CoverageMatrix`, or any `CoverageStatus` — the two seams (`consultCoverage` and
  `requiredRuleKeys`) answer unrelated questions and stay unrelated in code.
Verification: 36 focused tests (per-capability exact-match, no duplicates, complete coverage,
shared-key intent, determinism/immutability) + 7 new guard/scanner tests; 296 Phase 5 state
tests passed; 790 full-suite tests passed; typecheck/lint/format/build/Prisma validate all
clean.
Important: Step 3.5 (candidate retrieval, which will consume this mapping) was NOT started.

### Phase 5 — Step 3.5: Candidate Retrieval (`retrieveCandidates`)
Status: COMPLETE — committed in `7717e6a` (2026-09-20), bundled with Steps 3.3, 3.4, 3.6, 3.7
(including the provenance-preservation fix below).
Scope:
- New module `lib/tax/state/rules/candidateRetrieval.ts`: `retrieveCandidates(jurisdictionCode,
  calculationDate, ruleKeys)` — the first Phase 5 Step 3 module that touches the database.
  Queries `TaxRule` filtered by jurisdiction (via `lib/jurisdictions/repository.ts`'s existing
  `findByCode`), the requested `StateRuleKey`s, `status: 'ACTIVE'`, and the effective-date
  window — mirroring Phase 4's `resolveFederalRuleSet` query shape exactly, but stopping
  before any resolution decision.
- Returns `readonly StateRuleCandidates[]` (one entry per requested key, in order, always
  present even when empty) — reuses Phase 2's existing `ResolvableRule` type
  (`lib/rules/resolution.ts`) rather than inventing a new candidate shape. Never constructs
  `ResolvedStateRuleSet` and never calls `resolveApplicableRules`.
- No fallback: an unrecognized jurisdiction code yields an empty candidate list for every
  requested key (not a substitution); a database error propagates as a rejected promise, never
  silently converted to an empty result.
- Owner decision recorded for this step: `retrieveCandidates` (pipeline position 7) was
  explicitly approved as Step 3.5, deliberately skipping pipeline positions 3-4
  (`fixEffectiveInstant`, `identifyJurisdictions`), which remain unimplemented.
Verification: 10 focused integration tests (real PostgreSQL) + 7 new guard/scanner tests;
322 Phase 5 state tests passed; 888 full-suite tests passed (1 skipped by design);
typecheck/lint/format/build/Prisma validate all clean.
**Important finding (real, not hypothetical):** the database's own
`TaxRule_no_overlapping_active_versions` exclusion constraint (Phase 2 migration
`20260912151038`) is scoped to `ruleKey` ALONE, with no jurisdiction term — confirmed by this
step's own integration test. This means the schema currently prevents two different STATES
from ever having simultaneously-ACTIVE rules under the same literal `StateRuleKey` string
(e.g. `STATE.WITHHOLDING.METHOD`) with overlapping effective windows, which conflicts with
Step 1's explicit "no key names a state" design. `retrieveCandidates` itself works correctly
regardless (it only reads, never writes), but this is a real risk for whoever builds the
rule-authoring/activation admin tooling for more than one state — flagged here, not fixed
(out of scope for a read-only retrieval seam).
**Also noted:** `tests/integration/state-coverage-matrix.test.ts` has one pre-existing test
with an intentionally unscoped `listByType('STATE')` assertion (its own comments call this
"the race is real"); running the full integration suite with one more concurrent DB-touching
file occasionally reproduces that documented race. Confirmed via repeated runs that this is
pre-existing and unrelated to Step 3.5's own logic — not modified, per scope.

**Follow-up correction (2026-09-20 — Provenance Preservation Fix, committed in `7717e6a`
alongside Step 3.7 itself):** A Step 3.7
implementation attempt found that the original candidate shape here (bare Phase 2
`ResolvableRule`) discarded `jurisdictionCode`, `sourceIds`, `verified`, the rule's
`detail`/payload, and its own `verificationStatus` — fields required to honestly construct
`ResolvedStateRuleSet`/`RuleReference` later, and which cannot be fabricated (`verified` in
particular gates whether a rule may ever be presented as authoritative). Step 3.7 was
correctly NOT implemented rather than inventing placeholder values. The owner selected
**Option 1**: extend Step 3.5's candidate representation. `candidateRetrieval.ts` now exports
`StateResolvableRule` (a strict superset of `ResolvableRule`, adding the five fields above,
read once from the database — `sources` included in the existing `findMany` query, same
pattern as `lib/tax/federal/rules/resolver.ts`), and `StateRuleCandidates.candidates` is now
typed `readonly StateResolvableRule[]`. Retrieval semantics (query shape, ordering, empty/
missing-jurisdiction handling, error propagation) are unchanged. `resolveCandidates.ts` (Step
3.6) was updated to carry the enriched type through its `RESOLVED`/`AMBIGUOUS` outcomes (two
narrow, documented type casts restoring a runtime-true fact — `resolveApplicableRules` returns
input elements verbatim — since the shared Phase 2 resolver's own declared type was
deliberately left untouched); its resolution algorithm was not changed. Step 3.7 remains
unimplemented and out of scope for this fix. See
`docs/claude-log/2026-09-20-step-3-5-retrieve-candidates.md`'s follow-up correction section for
full detail.

### Phase 5 — Step 3.6: Candidate Resolution (`resolveCandidates`)
Status: COMPLETE — committed in `7717e6a` (2026-09-20), bundled with Steps 3.3–3.5, 3.7.
Scope:
- New module `lib/tax/state/rules/resolveCandidates.ts`: `resolveCandidates(candidateGroups:
  readonly StateRuleCandidates[]): StateRuleResolutionResult` — pure, synchronous,
  database-independent. Delegates the actual decision to Phase 2's existing
  `resolveApplicableRules()` (no second resolution algorithm), producing
  `RESOLVED` / `NOT_FOUND` / `AMBIGUOUS` per rule key, one result per input group, in input
  order, with duplicate keys resolved independently rather than merged.
- `AMBIGUOUS` is never arbitrated — every candidate is preserved, none selected.
- Owner-locked boundary: no DB access, no coverage consultation, no F-02 mapping, no tax
  calculation, and no `ResolvedStateRuleSet` construction/freezing — that belongs to a later
  stage.
- **Disclosed bridging decision:** `resolveApplicableRules` needs a `{jurisdictionId,
  category, effectiveDate}` query, which Step 3.6's locked signature does not receive
  directly. These are derived from the candidates themselves (jurisdictionId/category from
  the group's first candidate; effectiveDate as the latest `effectiveFrom` among the group) —
  provably a no-op re-filter given Step 3.5's own retrieval guarantees, not a new
  date-selection decision. An empty candidate group returns `NOT_FOUND` directly, without
  attempting to construct a query from no data.
Verification: 11 focused tests + 7 new guard tests; 341 Phase 5 state tests passed; 907
full-suite tests passed (1 skipped by design); typecheck/lint/format/build/Prisma validate
all clean.

### Phase 5 — Step 3.7: Final Assembly (`assembleStateRuleSet`)
Status: COMPLETE — committed in `7717e6a` (2026-09-20), bundled with Steps 3.3–3.6. This
single commit's message is `feat: complete state tax foundation through task 4c` — it commits
Step 3.3–3.7 (State Rule Resolver, end to end) together with the first wave of Step 4 (State
Tax Calculation) foundational primitives, documented as their own entry immediately below.
Scope:
- New module `lib/tax/state/rules/assembleStateRuleSet.ts`: `assembleStateRuleSet(resolution:
  StateRuleResolutionResult, metadata: StateRuleSetAssemblyMetadata): ResolvedStateRuleSet` —
  pure, synchronous, database-independent. Maps every Step 3.6 outcome onto Step 1's existing
  `ResolvedStateRuleSet`/`StateRuleEntry` representation (`stateRuleSet.ts`) and freezes the
  result via the existing `freezeStateRuleSet()`. No parallel rule-set implementation.
- Input:  `StateRuleResolutionResult` + explicit `StateRuleSetAssemblyMetadata` (`taxYear`,
  `effectiveDate`, `jurisdictionCode`, `engineVersion`, `resolvedAt` — caller-supplied, never
  derived or clock-read internally).
  Output: `ResolvedStateRuleSet`.
- Mapping: `RESOLVED` → available `ResolvedStateRule` (provenance preserved verbatim from the
  Step 3.5-corrected `StateResolvableRule`, no DB re-fetch); `NOT_FOUND` → unavailable entry,
  `StateReason.RULE_MISSING`; `AMBIGUOUS` → unavailable entry, `StateReason.RULE_CONFLICT`,
  no candidate ever selected.
- This is the module that finally proves the Step 3.5 provenance-preservation fix (§9) reaches
  the finished product: `jurisdictionCode`, `sourceIds`, `verified`, `detail`, and
  `verificationStatus` are read straight off the resolved `StateResolvableRule` into the
  `RuleReference`/`ResolvedStateRule` this step constructs — no re-fetch, no re-derivation, no
  fabrication. Verification status/`verified` are carried through exactly as given, never
  upgraded or downgraded (a deliberate difference from the federal assembler, which computes
  them itself because it reads the database directly — this module does not).
- Jurisdiction consistency: if a resolved rule's own `jurisdictionCode` ever disagreed with the
  caller-supplied assembly metadata's `jurisdictionCode`, that key is reported unavailable via
  the existing `StateReason.INVARIANT_BREACH` vocabulary rather than silently substituted or
  rewritten. Not reachable under today's call pattern (Step 3.5 only ever queries one
  jurisdiction per call) but the type contract does not itself prevent inconsistent metadata,
  so it is checked rather than assumed.
- **Disclosed gap:** `ResolvedStateRuleSet.missing` (the separate operator-facing gap list)
  is left `[]`. Its entries require a `category` field that no `StateRuleKey -> RuleCategory`
  mapping exists anywhere in the repository to supply, and `StateRuleResolutionResult`'s
  `NOT_FOUND` outcome carries no candidate row to read one from either way. Inventing such a
  mapping here would be an unapproved new design decision. `entries` itself is fully populated
  for every key regardless (including every unavailable one, with its real reason), so no gap
  information is actually lost — only the separate `missing` aggregate view is not populated.
  Flagged for the project owner as a PENDING DECISION, not fixed.
- No DB access, no re-resolution (does not import or call `resolveApplicableRules`, and does
  not import `lib/rules/resolution.ts` at all), no ambiguity arbitration, no tax calculation,
  no readiness/coverage-scoring engine. Does not import `candidateRetrieval.ts`, type-only or
  otherwise — the enriched candidate type is referenced structurally through
  `StateRuleResolutionResult` instead, so this module names no dependency on that module.
Verification: 15 focused tests (including a dedicated provenance-survival test and a
jurisdiction-mismatch test) + 9 new guard/scanner tests; 372 Phase 5 state tests passed; 938
full-suite tests passed (1 skipped by design); typecheck/lint/format/build/Prisma validate all
clean.

**Reconciliation note (2026-09-24):** the five Step 3.3–3.7 entries above, and everything
below through the end of Step 4's current work, were reconstructed from `git log`/`git show`
against the `95f3456..3d6302c` commit range after this file was found ~18 commits stale (see
§5's disclosure note). Every "Verification" line below states exactly what a commit's own
message or diff records — where a commit adds or modifies test files but its message/diff
states no pass/fail counts, that is written explicitly as **"Verification: not recorded in
commit history"** rather than a guessed number, per this project's own rule against inventing
verification claims (§4, §9 of `docs/SPECIFICATION.md`; CLAUDE.md §3 above).

### Phase 5 — Step 4, Tasks 1–4C: State Rule-Detail Readers & Wage-Bucket Foundation
Status: COMPLETE — committed in `7717e6a` (2026-09-20), the same commit as Steps 3.3–3.7 above.
Scope (per the commit's own message and the new files' doc comments):
- `lib/tax/state/rules/read-detail.ts`: safe, schema-validated, verification-checked rule
  detail reader for the state namespace — `readOk`/`readFail`/`readDetail`/`requireComponent`/
  `readRate`/`requireForFilingStatus`. The state-namespaced analog of
  `lib/tax/federal/rules/read-detail.ts`; answers only "is this rule key's detail safe to read,
  and if so, here it is" — never computes a tax, withholding amount, wage-base cap, or rounded
  figure. Reads only from an already-frozen `ResolvedStateRuleSet` (Step 3.7's output) via the
  existing `stateRule()` accessor — no database access, no re-resolution.
- `lib/tax/state/rules/withholdingRoundingPolicy.ts`: `readWithholdingRoundingPolicy()` — a
  dedicated reader for `STATE.WITHHOLDING.ROUNDING_POLICY`, built on `readDetail()`. Reads the
  policy only; does not itself round any `Money` value (that belongs to a later calculation
  stage, mirroring the federal engine's own read/apply split).
- `lib/tax/state/rules/wageBase.ts`: `applyStateWageBase()` — one generic wage-base/cap
  primitive shared by `SDI_WAGE_BASE`, `PFML_WAGE_BASE`, and `SUTA_WAGE_BASE` (all validate
  under the same `stateWageBaseDetailSchema`). A simple current-input clamp, not a YTD
  wage-base tracker; explicitly wage-base only, never a contribution-cap or rate calculation.
- `lib/tax/state/rules/taxabilityProfile.ts`: `readTaxabilityProfile()` — reader only for
  `STATE.TAXABILITY_PROFILE`; wage-bucket derivation from it is explicitly NOT implemented
  here (disclosed as needing more architecture than the repository yet supplies — see the
  module's own doc comment for the enumerated gaps).
- **Task 4B decision — Option A, Context-Driven State Taxability:** `StateCalculationContext`
  gained `deductions`/`taxabilityProfiles` fields (`lib/tax/state/context.ts`) and
  `lib/tax/state/types.ts` gained `StateDeductionLine`. Taxability is supplied by the caller as
  context, not resolved internally by this stage.
- `lib/tax/state/wages/stateWageBuckets.ts`: `deriveStateWageBuckets()` — Task 4C, the pure
  calculation half of the Task 4B Option A contract. Derives the four independent state wage
  buckets (`stateIncomeTaxWages`, `sdiWages`, `pfmlWages`, `sutaWages`) from context-supplied
  `deductions`/`taxabilityProfiles` only — does not resolve where those inputs come from.
Verification: not recorded in commit history. The commit's own diff adds four new test files
(`state-read-detail.test.ts`, `state-rounding-policy-reader.test.ts`,
`state-rule-set-assembly.test.ts`, and extensions to `state-guards.test.ts`) totaling roughly
1,200 added test lines, but neither the commit message nor its body states a pass/fail count
for this range — the last stated total in this file (938 full-suite tests passed, 1 skipped)
predates these additions and should not be read as covering them.
Important: `taxabilityProfile.ts` explicitly defers wage-bucket derivation logic to
`stateWageBuckets.ts` rather than implementing it inline — the two-module split is a stated
design choice, not an oversight.

### Phase 5 — Step 4, Task 4G/4H: State Options & Deduction Bridge (`state-bridge.ts`)
Status: COMPLETE — Commit `ff0616f` (2026-09-21)
Scope: New module `lib/calculator/state-bridge.ts`, mirroring `federal-bridge.ts`'s existing
shape (not its data): `StateOptions` (carries a resolved `ResolvedStateRuleSet` plus optional
caller-supplied `taxabilityProfiles`, per Task 4B Option A — never resolved via
`TAXABILITY_PROFILE` internally) and `toStateDeductions()`, which maps the same
`DeductionResult[]` already computed once by `calculateDeductions()` onto
`StateDeductionLine[]` — one output per input, no re-derivation, no re-rounding, no taxability
read at this stage (taxability inclusion was already decided upstream; state taxability is a
separate, later input). `CalculationOptions.state` is not yet read by `calculatePaycheck()` —
this commit implements only the bridge contract, not its wiring.
Verification: not recorded in commit history. Adds `tests/unit/state-bridge.test.ts` (271
lines) and a small `lib/calculator/index.ts` addition, but the commit message states no
pass/fail counts.
Important: never reuses the federal engine's own deduction/taxability values — a state
deduction line is always produced from this bridge's own inputs.

### Phase 5 — Step 4, Task 4I: State Calculation Context Builder
Status: COMPLETE — Commit `56b2d0f` (2026-09-21)
Scope: New module `lib/calculator/state-context.ts`: `buildStateCalculationContext()` —
structural assembly only, not a calculation. Assembles an already-known `CalculationInput`, an
already-resolved `StateOptions`, and an already-computed `DeductionResult[]` into a
`StateCalculationContext`. Resolves no rules, calculates no tax, derives no wage bucket.
Disclosed deviation from the Task 4G-sketched signature: takes `grossRegular`/
`grossSupplemental` as two additional explicit parameters, mirroring
`runFederalEngine(input, grossRegular, grossSupplemental, ...)` exactly, because
`CalculationInput` carries no pre-computed gross-wage figures.
Explicitly refuses to guess: `residencyStatus` (throws if absent — no default), the residence
jurisdiction (no fallback when unresolvable), and `residenceRuleSet` when the residence
jurisdiction differs from the one resolved rule set's own jurisdiction (a disclosed, unresolved
architecture gap, not invented around). Two purely operational flags ARE defaulted, mirroring
`FederalOptions`' own established convention: `reciprocityCertificateFiled` defaults to
`false`, and `includeEmployerTaxes` is hardcoded `true` (no equivalent field exists yet on
`StateOptions`).
Verification: not recorded in commit history. Adds `tests/unit/state-context.test.ts` (358
lines); commit message states no pass/fail counts.
Important: the residence-rule-set gap (one resolved rule set can only ever represent one
jurisdiction, but residence and work jurisdiction can differ) is flagged as a genuine,
unresolved architecture question in the module's own doc comment — not fixed here.

### Phase 5 — Step 4, Task 4J: Withholding Method Reader
Status: COMPLETE — Commit `31b4b4d` (2026-09-21)
Scope: New module `lib/tax/state/rules/withholdingMethod.ts`: `readWithholdingMethod()` —
reads `STATE.WITHHOLDING.METHOD` verbatim via `readDetail()`. Reader only: does not dispatch
on the resolved `structure` (`NONE | FLAT | PROGRESSIVE | TABLE | FORMULA | HYBRID`) to any
calculation path — that dispatch, and every downstream calculation it would select, remains
future work.
Verification: not recorded in commit history. Adds `tests/unit/state-withholding-method.test.ts`
(297 lines); commit message states no pass/fail counts.

### Phase 5 — Step 4, Task 4K: Withholding Pay-Periods-Per-Year Reader
Status: COMPLETE — Commit `939e37c` (2026-09-21)
Scope: New module `lib/tax/state/rules/withholdingPayPeriods.ts`:
`resolveStatePayPeriodsPerYear()` — reads `STATE.WITHHOLDING.PAY_PERIODS_PER_YEAR` as a
separate, jurisdiction-published, rule-sourced fact. Explicitly has NO dependency on and NO
fallback to the generic Phase 3 calendar table (`lib/calculator/pipeline/pay-frequency.ts`'s
`periodsPerYear()`) — the two sources are never reconciled. A missing row, or a row whose
`periodsPerYear` is `null`, reports `SCENARIO_UNSUPPORTED` — never inferred from the generic
calendar table, never treated as zero. Reader only — does not implement `ANNUALIZE`/
`DEANNUALIZE` execution (later commits `3d7a9a5`/`3d6302c` do).
Verification: not recorded in commit history. Adds
`tests/unit/state-withholding-pay-periods.test.ts` (294 lines); commit message states no
pass/fail counts.

### Phase 5 — Step 4, Task 4L: Withholding Filing-Status-Map Reader
Status: COMPLETE — Commit `6e53d68` (2026-09-21)
Scope: New module `lib/tax/state/rules/withholdingFilingStatusMap.ts`:
`readWithholdingFilingStatusMap()` — reads `STATE.WITHHOLDING.FILING_STATUS_MAP` verbatim.
Reader only: does not look up a status, does not translate a state filing status into a
federal one, does not touch `StateCalculationContext`. The module's own doc comment discloses
that an audit found NO current consumer of this rule key anywhere in the repository, and
whether/how a future TABLE or FORMULA implementation should use this data remains an
explicitly open question. (In practice, every later formula-interpreter operation that needs a
filing status — `SUBTRACT_STANDARD_DEDUCTION`, `SUBTRACT_EXEMPTIONS`, `APPLY_BRACKETS` — uses
the state-native filing status directly, never mapped through this rule.)
Verification: not recorded in commit history. Adds
`tests/unit/state-withholding-filing-status-map.test.ts` (298 lines); commit message states no
pass/fail counts.

### Phase 5 — Step 4, Task 4N-R: Withholding Table Row Selector
Status: COMPLETE — Commit `f175747` (2026-09-21)
Scope: New module `lib/tax/state/rules/withholdingTable.ts`:
`selectStateWithholdingTableRow()` — selection only; does not compute
`baseWithholding + rate × excess` or any withholding amount. Filing status matched
state-native, directly (never via `WITHHOLDING_FILING_STATUS_MAP`) — a `null` filing status
reports `SCENARIO_UNSUPPORTED`. Wage ranges use half-open `[wageFrom, wageTo)` semantics,
evidenced by `lib/rules/validation.ts`'s existing contiguity check. The supplied wage is the
current pay-period wage for the row's own `payFrequency` — never annualized here, never
multiplied by a periods-per-year factor. Zero matches or multiple matches both report
`RULE_CONFLICT` — never resolved by `ordinal` or array order.
Verification: not recorded in commit history. Adds `tests/unit/state-withholding-table.test.ts`
(313 lines); commit message states no pass/fail counts.

### Phase 5 — Step 4, Task 4O-1: Withholding Formula Reader
Status: COMPLETE — Commit `9fe279f` (2026-09-21)
Scope: New module `lib/tax/state/rules/withholdingFormula.ts`: `readWithholdingFormula()` —
reads `STATE.WITHHOLDING.FORMULA` verbatim (every step's `ordinal`, `operation`, `operandRef`
— including `null` — and `note`, in exactly the stored order). Reader only. The module's doc
comment records that a preceding Task 4O contract audit found the interpreter itself BLOCKED
BY SPEC GAPS (an unconstrained `operandRef` vocabulary, an undecided execution model, undecided
filing-status consumption, undecided `ANNUALIZE`/`DEANNUALIZE` periods-per-year source) — none
of that is decided by this reader; the interpreter contract was locked afterward as "Task 4O-2"
and implemented starting with the next commit.
Verification: not recorded in commit history. Adds
`tests/unit/state-withholding-formula.test.ts` (339 lines); commit message states no pass/fail
counts.

### Phase 5 — Step 4, Task 4O-2/4O-3A: Withholding Formula Core Interpreter
Status: COMPLETE — Commit `d19e1b3` (2026-09-21)
Scope: New module `lib/tax/state/rules/withholdingFormulaInterpreter.ts`, implementing the
three operations the Task 4O-2 contract lock fully established: `SUBTRACT_STANDARD_DEDUCTION`
(resolves `WITHHOLDING_STANDARD_DEDUCTION` via the existing `requireForFilingStatus()`; no
`PER_PERIOD` annualize/deannualize conversion invented), `FLOOR_AT_ZERO`, and `APPLY_BRACKETS`.
Execution model (Task 4O-2 §1, locked): steps run in strict `ordinal` order over a single
running `Money` accumulator — no named intermediate variable, no step-to-step reference.
`operandRef` vocabulary (Task 4O-2 §2, locked): names a `StateRuleKey` and nothing else at
this point (the later `ADD_AMOUNT` exception to this rule is a separately-locked deviation —
see the `ff808ac` entry below). Filing status (Task 4O-2 §5) is used state-native, directly,
never mapped through `WITHHOLDING_FILING_STATUS_MAP`. The nine remaining operations
(`SUBTRACT_EXEMPTIONS`, `SUBTRACT_ALLOWANCES`, `SUBTRACT_AMOUNT`, `ADD_AMOUNT`,
`APPLY_FLAT_RATE`, `APPLY_PERCENTAGE_OF`, `ANNUALIZE`, `DEANNUALIZE`, `ROUND`) are contractually
unresolved at this commit and report `METHOD_NOT_IMPLEMENTED` rather than being silently
skipped or executed. Exports `runStateWithholdingFormula()`.
Verification: not recorded in commit history. Adds
`tests/unit/state-withholding-formula-interpreter.test.ts` (678 lines); commit message states
no pass/fail counts.
Important: duplicate `ordinal`s are never silently ordered — reported, not tolerated (per the
function's own doc comment).

### Phase 5 — Step 4, Task 4O-4/4O-5: `SUBTRACT_EXEMPTIONS` (Personal-Exemption Path)
Status: COMPLETE — Commit `f8b2814` (2026-09-21)
Scope: Extends `withholdingFormulaInterpreter.ts` with `SUBTRACT_EXEMPTIONS`, PERSONAL
EXEMPTION PATH ONLY. `operandRef` is required and must equal exactly
`StateRuleKey.PIT_PERSONAL_EXEMPTION` — never `null`, never `PIT_DEPENDENT_EXEMPTION` — because
two independently-shaped exemption rule keys exist and a `null` operandRef would be ambiguous
between them (unlike `SUBTRACT_STANDARD_DEDUCTION`, which has exactly one implicit target).
Filing status used state-native, via the same `requireForFilingStatus()` call shape already
used for the standard deduction. Unit handling (`ANNUAL`/`PER_PERIOD`) is explicitly out of
scope — no conversion performed, a disclosed project-wide gap. `PIT_DEPENDENT_EXEMPTION`
remains unresolved and unimplemented: presenting it as `operandRef` fails
`RULE_DETAIL_INVALID`, never tolerated as merely unsupported.
Verification: not recorded in commit history. Adds
`tests/unit/state-withholding-formula-subtract-exemptions.test.ts` (393 lines) and extends the
core interpreter test file; commit message states no pass/fail counts.

### Phase 5 — Step 4, Task 4O-6R4/4O-6R5/4O-6R6: Scalar Amount Infrastructure + `SUBTRACT_AMOUNT`
Status: COMPLETE — Commit `37d5506` (2026-09-21)
Scope:
- `lib/tax/state/rules/detailSchemas.ts`: new `stateScalarAmountDetailSchema`/
  `StateScalarAmountDetail` — a single generic scalar monetary amount (`{ shape:
  'SCALAR_AMOUNT', unit, amount }`), explicitly generic infrastructure with no built-in tax
  meaning, mirroring federal's own `scalarAmountDetailSchema` as architectural precedent only
  (no federal code imported). Deliberately NOT yet registered in `STATE_DETAIL_SCHEMAS` — no
  `StateRuleKey` for a generic scalar amount exists yet, and Task 4O-6R4 explicitly locked that
  none may be invented merely to exercise this schema.
- `withholdingFormulaInterpreter.ts`: new `SUBTRACT_AMOUNT` operation — a generic scalar-amount
  primitive with no built-in real-world tax meaning; `operandRef` is required, validated
  against the full `StateRuleKey` membership set, and must resolve to a `SCALAR_AMOUNT`
  shape (any other shape fails `RULE_DETAIL_INVALID`). Amount resolution uses the existing
  `requireComponent()` (not `requireForFilingStatus()`, since `SCALAR_AMOUNT` has no
  filing-status dependence) — a `null` amount reports `COMPONENT_NOT_STATED`, never zero.
Verification: not recorded in commit history. Adds
`tests/unit/state-detail-schemas.test.ts` (134 lines) and
`tests/unit/state-withholding-formula-subtract-amount.test.ts` (294 lines); commit message
states no pass/fail counts.

### Phase 5 — Step 4, Task 4O-6R9–4O-6R12: `APPLY_FLAT_RATE`
Status: COMPLETE — Commit `7dc01d0` (2026-09-21)
Scope: Extends `withholdingFormulaInterpreter.ts` with `APPLY_FLAT_RATE` — generic over any
`RATE`-shaped `StateRuleKey`. `operandRef` required, validated against `VALID_RULE_KEYS`, must
resolve to a `RATE` shape. Consults the rate's own `applicability`/`appliesTo` fields: a
`NOT_APPLICABLE` operandRef in the jurisdiction, or a rate that `appliesTo` EMPLOYER rather
than EMPLOYEE, both fail rather than being silently applied — these two checks are flagged as
OWNER-LOCKED DECISIONS (Task 4O-6R11), not derived from an existing precedent (Task 4O-6R10
found no real formula example proving the exact shape needed).
Verification: not recorded in commit history. Adds
`tests/unit/state-withholding-formula-apply-flat-rate.test.ts` (377 lines); commit message
states no pass/fail counts.

### Phase 5 — Step 4, Task 4O-6R14–4O-6R16: Allowance-Count Context
Status: COMPLETE — Commit `f248350` (2026-09-21)
Scope: Plumbs allowance counts through the input/context layers ahead of implementing
`SUBTRACT_ALLOWANCES` itself:
- `lib/calculator/types/input.ts`: new `StateInput.allowanceCounts?: Readonly<Record<string,
  number>>` — keyed by the exact state rule key an allowance-value rule resolves under (e.g.
  `STATE.WITHHOLDING.ALLOWANCE_VALUE`), never by allowance type, never one global formula-wide
  count. State-native only — never derived from `w4.pre2020Allowances`.
- `lib/calculator/validation/input-schema.ts`: validates each count as a non-negative integer
  — no coercion, no rounding, no default.
- `lib/tax/state/context.ts`: `StateCalculationContext.allowanceCounts:
  Readonly<Partial<Record<StateRuleKey, number>>>` — required (not optional); an empty object
  is the valid representation of "no counts supplied," matching the context's existing
  `taxabilityProfiles`/`deductions` convention.
- `lib/calculator/state-context.ts`: `mapAllowanceCounts()` — a pure passthrough of the input's
  free-string keys onto the context's `StateRuleKey`-keyed shape; deliberately does NOT
  validate keys against `StateRuleKey` membership (that remains `readDetail()`'s job at actual
  resolution time, avoiding a second, independently-drifting membership check).
Verification: not recorded in commit history. Adds `tests/unit/state-input-extensions.test.ts`
(48 lines) and extends four existing test files; commit message states no pass/fail counts.

### Phase 5 — Step 4, Task 4O-6R14–4O-6R17: `SUBTRACT_ALLOWANCES`
Status: COMPLETE — Commit `04ba18c` (2026-09-21)
Scope: Extends `withholdingFormulaInterpreter.ts` with `SUBTRACT_ALLOWANCES` — generic over any
`AMOUNT_PER_ALLOWANCE`-shaped `StateRuleKey`, consuming the `allowanceCounts` map plumbed
through in the prior commit as the function's fifth parameter. `operandRef` required, validated
against `VALID_RULE_KEYS`. `allowanceType` on the resolved detail is DESCRIPTIVE METADATA ONLY
(Task 4O-6R15 §7) — matching is by `operandRef`/rule key, never by `allowanceType`. A
`NOT_APPLICABLE` rate in the jurisdiction fails (mirrors `APPLY_FLAT_RATE`'s own check). No
allowance count supplied for the specific key reports `COMPONENT_NOT_STATED` — never treated as
zero. The re-validation of the context layer (`validateStateContext()`) is explicitly assumed
already done, not repeated here (Task 4O-6R15 §13).
Verification: not recorded in commit history. Adds
`tests/unit/state-withholding-formula-subtract-allowances.test.ts` (489 lines) and extends
three existing test files; commit message states no pass/fail counts.

### Phase 5 — Step 4, Task 4O-6R20–4O-6R23: `ADD_AMOUNT`
Status: COMPLETE — Commit `ff808ac` (2026-09-22)
Scope:
- `lib/tax/state/context.ts`: `resolveWorkJurisdictionElections()` — resolves the current WORK
  jurisdiction's (never residence) submitted election values into a narrow `fieldKey`-keyed
  map; pure passthrough, no form-schema validation, no unit conversion. Also hardens
  `validateStateContext()` to detect a duplicate election `fieldKey` within one jurisdiction's
  own `values[]` (`INPUT_INVALID`) — a duplicate is never arbitrated, only reported, and the
  same `fieldKey` may still legitimately appear once in each of two different jurisdictions.
- `withholdingFormulaInterpreter.ts`: new `ADD_AMOUNT` operation — the one deliberate exception
  to the "`operandRef` names a `StateRuleKey`" rule locked in Task 4O-2 §2: here `operandRef`
  names an election **`fieldKey`** instead, and is never checked against `VALID_RULE_KEYS`
  (Task 4O-6R21 §3/§4 found no composite-identifier convention anywhere in the repository to
  do otherwise). Consumes the resolved, `fieldKey`-keyed election map as its sixth parameter. A
  field absent from the resolved `WITHHOLDING_ELECTION_FORM`, or with no submitted value,
  reports `COMPONENT_NOT_STATED`, never zero.
Verification: not recorded in commit history. Adds
`tests/unit/state-withholding-formula-add-amount.test.ts` (740 lines) and
`tests/unit/state-contracts.test.ts` extensions (227 lines); commit message states no pass/fail
counts (this commit has no commit-message body at all, unlike most others in this range).

### Phase 5 — Step 4, Task 4O-6R24–4O-6R26: `APPLY_PERCENTAGE_OF`
Status: COMPLETE — Commit `c4559d1` (2026-09-22)
Scope: Extends `withholdingFormulaInterpreter.ts` with `APPLY_PERCENTAGE_OF` — generic over any
`RATE`-shaped `StateRuleKey`, like `APPLY_FLAT_RATE`, reusing its `operandRef` validation and
`applicability`/`appliesTo` handling, but computing `runningValue × (1 + rate)` rather than
`runningValue × rate`. **This arithmetic choice is an explicit owner decision (Task
4O-6R26-OWNER)** — the commit's own doc comment records that no repository evidence resolved
which of the two formulas ("percentage of" vs. "plus a percentage") was intended, so it was
not inferred or guessed.
Verification: not recorded in commit history. Adds
`tests/unit/state-withholding-formula-apply-percentage-of.test.ts` (413 lines); commit message
states no pass/fail counts (this commit also has no commit-message body).

### Phase 5 — Step 4, Task 4O-6R32/4O-6R33: `ANNUALIZE`
Status: COMPLETE — Commit `3d7a9a5` (2026-09-22)
Scope: Extends `withholdingFormulaInterpreter.ts` with `ANNUALIZE` — contract-locked null
`operandRef` (no disambiguation between competing keys is possible, so none is accepted).
Computes `runningValue × periodsPerYear` via the existing, unmodified
`resolveStatePayPeriodsPerYear()` (`939e37c`), consuming a new, narrow `payFrequency` parameter
(the function's seventh parameter) — structurally identical in role to `filingStatus`, never
the whole `StateCalculationContext`. `DEANNUALIZE`'s own division was explicitly left
unresolved by this commit (Task 4O-6R33 §5) pending a separate precision decision — implemented
next, in `3d6302c`.
Verification: not recorded in commit history. Adds
`tests/unit/state-withholding-formula-annualize.test.ts` (590 lines); commit message states no
pass/fail counts.

### Phase 5 — Step 4, Task 4O-6R38–4O-6R45: `DEANNUALIZE`
Status: COMPLETE — Commit `3d6302c` (2026-09-22, current HEAD as of this reconciliation)
Scope:
- `lib/core/money.ts`: new `divideHighPrecision(a, b)` — divides at the module's configured
  Decimal.js working precision with NO currency or intermediate rounding applied. Explicitly
  documented as NOT mathematically exact for a non-terminating quotient (a finite
  approximation bounded by working precision, not an infinitely precise rational value).
  Throws `MoneyError` on division by zero, not defensively caught by its caller (Task 4O-6R43
  Error Propagation Lock).
- `withholdingFormulaInterpreter.ts`: new `DEANNUALIZE` operation — the inverse of `ANNUALIZE`:
  contract-locked null `operandRef`, computing `runningValue ÷ periodsPerYear` via the same
  `resolveStatePayPeriodsPerYear()` and the same `payFrequency` parameter, but dividing via the
  new `divideHighPrecision()` rather than `divide()` — high-precision, explicitly NOT
  mathematically exact, and never touching `WITHHOLDING_ROUNDING_POLICY` or any
  scale/`RoundingMode`. This resolves the rounding-policy precision conflict `3d7a9a5` (Task
  4O-6R33 §5) left open. `ROUND` remains the one operation still architecturally excluded from
  this interpreter entirely (Task 4O-6R31) — belongs to a future, separate state rounding
  stage, never a formula-step operation.
- As of this commit, the interpreter's own doc comment states it "IMPLEMENTS ELEVEN
  OPERATIONS" — every contract operation except `ROUND`, and except the dependent-exemption
  path of `SUBTRACT_EXEMPTIONS`.
Verification: not recorded in commit history. Adds `tests/unit/money.test.ts` (91 lines) and
`tests/unit/state-withholding-formula-deannualize.test.ts` (626 lines); commit message states
no pass/fail counts.

**Summary across `7717e6a`..`3d6302c` (18 commits, all now on `claude/upbeat-dirac-qqhuye`):**
Step 3 (State Rule Resolver) went from "implemented, uncommitted" to committed, and Step 4
(State Tax Calculation) progressed from nothing to an 11-of-12-operation withholding-formula
interpreter with its full supporting reader/context layer. No commit in this range states a
suite-wide pass/fail total in its message; the last such total recorded anywhere in this file
(938 full-suite tests passed, 1 skipped, as of `7717e6a`'s own predecessor work) is now stale
and should not be treated as current — see the caveat added to §12.

---

## 8. Active Blockers

None currently active for Phase 5 Step 3. F-02 (previously the sole active blocker) was
resolved on 2026-09-19 by an explicit project design decision — see §9 for the record of that
decision and §7 for its implementation.

---

## 9. Important Decisions / Amendments

### Amendment 2 — Structural-only jurisdiction validation
**What changed:** Step 3.2's jurisdiction validation (`workJurisdiction`,
`residenceJurisdiction`) checks blank-vs-non-blank only — no format, case, length, regex, or
static state-code vocabulary check, and no database lookup.
**Why:** No zero-query 51-jurisdiction vocabulary exists anywhere in Step 2's coverage layer;
adding one would violate the zero-query guarantee for an invalid context. Resolves finding F-5.
**Status:** Implemented, part of the Step 3.2 commit (`8f7952a`).

### Amendment 3 — Explicit capability request source
**What changed:** `projectResolutionContext()` now takes `capabilitiesRequested` as a required,
caller-supplied `ReadonlySet<CapabilityCode>` argument (defensively copied), instead of always
emitting an internally-constructed empty set.
**Why:** The prior placeholder meant every real (non-test) projection would fail Step 3.2's
"non-empty capabilities" rule. No field on `StateCalculationContext` or `CalculationInput`
represents "which capabilities does this call want" — confirmed by repository-wide search
before this change was made.
**Status:** Implemented and committed (`8f7952a`).

### F-02 — Capability → rule-key mapping (resolved)
**What changed:** An explicit project design decision defined the complete mapping from each
of the 13 `StateCapability` values to the specific `StateRuleKey`s it requires, implemented in
`lib/tax/state/capabilityRuleKeys.ts`. Two prior repository/git-history inspections (see
`docs/claude-log/2026-09-19-step-3-4-blocked.md`) confirmed no such mapping existed anywhere
before this decision — it was not derived from `StateRuleKey`'s naming conventions or from
Step 2's unrelated `CAPABILITY_PROGRAM` grouping.
**Why:** Step 3.4 (and eventually candidate retrieval) needs to know which rule keys a
requested capability needs; this was the one remaining undesigned piece of the Step 3 pipeline.
**Affected:** Unblocks Step 3.5+ (candidate retrieval will consume `requiredRuleKeys()`). Does
not change Step 3.3's Coverage Gate, which remains independent.
**Status:** Implemented and committed — `7717e6a` (2026-09-20), bundled with Steps 3.3, 3.5–3.7.

### Step 3.5 sequencing — `retrieveCandidates`, positions 3-4 intentionally skipped
**What changed:** The project owner explicitly approved `retrieveCandidates` (pipeline
position 7) as Step 3.5, rather than backfilling the earlier-skipped pipeline positions 3-4
(`fixEffectiveInstant`, `identifyJurisdictions`).
**Why:** An explicit sequencing decision — the owner judged candidate retrieval more valuable
next than the two skipped positions, which remain unimplemented and unassigned.
**Affected:** Step 3.5 only. Positions 3-4 remain open for a future explicit decision; nothing
about their contract was invented or assumed.
**Status:** Implemented and committed — `7717e6a` (2026-09-20), bundled with Steps 3.3, 3.4, 3.6, 3.7.

### Step 3.5 Provenance Preservation Fix — Option 1 selected
**What changed:** A Step 3.7 (`assembleStateRuleSet`) implementation attempt found that Step
3.5's candidate shape (bare Phase 2 `ResolvableRule`) discarded `jurisdictionCode`,
`sourceIds`, `verified`, `detail`, and `verificationStatus` — fields required to honestly
construct `ResolvedStateRuleSet`/`RuleReference`. Rather than fabricate them at assembly time
(explicitly forbidden — `verified` gates whether a rule may ever be presented as
authoritative), Step 3.7 was reported BLOCKED with three remediation options. The owner
selected **Option 1**: extend Step 3.5's candidate representation to preserve the real
provenance data, read once from the database at the existing retrieval seam.
**Why:** This is the one remaining gap in the Step 3.5→3.6→3.7 pipeline; extending the
candidate type (rather than adding DB access to a later stage, or redesigning Step 3.6)
keeps retrieval as the sole database-touching seam and requires no change to the shared
Phase 2 `resolveApplicableRules`/`ResolvableRule` primitive (also used by the federal engine).
**Affected:** `candidateRetrieval.ts` (new `StateResolvableRule` type, enriched query/mapping)
and `resolveCandidates.ts` (type updated to carry the enrichment through; two documented type
casts, no algorithm change). Step 3.7 remains unimplemented.
**Status:** Implemented and committed — `7717e6a` (2026-09-20), bundled with Steps 3.3–3.7.

**Note on authority:** Both amendments and Steps 3.1–3.2 were specified by the project owner
pasting exact contract text directly into the session, not via a committed specification file.
`PHASE-5-STEP-3-SPEC-FINAL.md` is referenced repeatedly as the authoritative Step 3 document but
has never been found in this repository or filesystem — see §10.

---

## 10. Specifications & Source-of-Truth Rules

| Document | Purpose | Authority | Status |
|---|---|---|---|
| `docs/SPECIFICATION.md` | Master specification — full product/architecture requirements | **Authoritative for the whole project** | Current |
| `docs/PHASE-4-FEDERAL-TAX-ENGINE-SPEC.md` | Phase 4 federal engine spec | Authoritative for Phase 4 | Current, implemented |
| `docs/DATA-MODEL.md` | Phase 2 rule/data layer architecture (explains spec §2, §18–§24) | Explanatory, not authoritative | Current |
| `docs/CALCULATION-ENGINE.md` | Phase 3 calculation engine architecture (explains spec §4,§5,§11–17,§33,§34,§40) | Explanatory, not authoritative | Current |
| `docs/FEDERAL-ENGINE.md` | Phase 4 engine architecture (explains PHASE-4 spec) | Explanatory, not authoritative | Current |
| `docs/TAX-DATA-ENTRY.md` | Operator guide for entering federal tax rule data | Explanatory, not authoritative | Current |
| `docs/DEVELOPMENT.md` | Local dev setup (install, run, test) | Explanatory, not authoritative | Current |

**`PHASE-5-STEP-3-SPEC-FINAL.md`** (Phase 5 Step 3 — State Rule Resolver):
```text
Specification status: conversation-only
Repository copy: NOT PRESENT (confirmed absent by repeated exhaustive search)
Implementation must not invent missing contract details.
```
Where this document's content has been pasted into a session with full concrete detail (Step
3.1, Step 3.2, Amendment 2, Amendment 3, and — on a second attempt, after an initial
prose-only pass was correctly blocked — Step 3.3), implementation proceeded. A task that gives
only prose goals/prohibitions without a concrete contract (exact function signature, exact
outcome vocabulary, exact per-status behavior) should still be treated as blocked; ask for the
contract to be transcribed inline rather than inventing it.

`docs/DEPLOYMENT.md` does not exist yet; per `docs/DEVELOPMENT.md` it is intentionally deferred
to a later phase once the hosting runtime is confirmed (spec §62).

---

## 11. Git / Branch / Checkpoint History

Current branch: `claude/upbeat-dirac-qqhuye`. HEAD is `3d6302c`; working tree clean.

Table reconciled 2026-09-24 against `git log --oneline 95f3456..3d6302c`, which lists 18
commits — this table now includes every one of them, not just the range's endpoints, per that
reconciliation (see the disclosure note in §5).

| SHA | Message | Purpose | Status |
|---|---|---|---|
| `3d6302c` | feat: implement deannualize formula operation | Step 4, Task 4O-6R38–45: `DEANNUALIZE` + `lib/core/money.ts` `divideHighPrecision()` | Committed — current HEAD |
| `3d7a9a5` | feat: implement annualize formula operation | Step 4, Task 4O-6R32/33: `ANNUALIZE` | Committed |
| `c4559d1` | feat: implement percentage-of formula operation | Step 4, Task 4O-6R24–26: `APPLY_PERCENTAGE_OF` | Committed |
| `ff808ac` | feat: implement state ADD_AMOUNT formula operation | Step 4, Task 4O-6R20–23: `ADD_AMOUNT` + `resolveWorkJurisdictionElections()` | Committed |
| `04ba18c` | feat: implement state allowance subtraction | Step 4, Task 4O-6R14–17: `SUBTRACT_ALLOWANCES` | Committed |
| `f248350` | feat: add state allowance count context | Step 4, Task 4O-6R14–16: `StateInput.allowanceCounts` / context plumbing | Committed |
| `7dc01d0` | feat: implement flat rate formula operation | Step 4, Task 4O-6R9–12: `APPLY_FLAT_RATE` | Committed |
| `37d5506` | feat: implement scalar amount formula infrastructure | Step 4, Task 4O-6R4–6: `SCALAR_AMOUNT` schema + `SUBTRACT_AMOUNT` | Committed |
| `f8b2814` | feat: implement state personal exemption formula step | Step 4, Task 4O-4/5: `SUBTRACT_EXEMPTIONS` (personal path only) | Committed |
| `d19e1b3` | feat: add state withholding formula core interpreter | Step 4, Task 4O-2/3A: interpreter core — `SUBTRACT_STANDARD_DEDUCTION`, `FLOOR_AT_ZERO`, `APPLY_BRACKETS` | Committed |
| `9fe279f` | feat: add state withholding formula reader | Step 4, Task 4O-1: `readWithholdingFormula()` | Committed |
| `f175747` | feat: add state withholding table row selector | Step 4, Task 4N-R: `selectStateWithholdingTableRow()` | Committed |
| `6e53d68` | feat: add state withholding filing status map reader | Step 4, Task 4L: `readWithholdingFilingStatusMap()` | Committed |
| `939e37c` | feat: add state withholding pay periods reader | Step 4, Task 4K: `resolveStatePayPeriodsPerYear()` | Committed |
| `31b4b4d` | feat: add state withholding method reader | Step 4, Task 4J: `readWithholdingMethod()` | Committed |
| `56b2d0f` | feat: build state calculation context | Step 4, Task 4I: `buildStateCalculationContext()` | Committed |
| `ff0616f` | feat: wire state calculation options and deduction bridge | Step 4, Task 4G/4H: `state-bridge.ts` (`StateOptions`, `toStateDeductions()`) | Committed |
| `7717e6a` | feat: complete state tax foundation through task 4c | Step 3.3–3.7 (State Rule Resolver, end to end) **+** Step 4, Tasks 1–4C (rule-detail readers, wage-base primitive, Task 4B Option A wage-bucket derivation) | Committed |
| `95f3456` | docs: add persistent Claude project memory system | Project memory system checkpoint | Committed |
| `8f7952a` | feat(state): implement explicit capability request source | Step 3.2 + Amendment 3 checkpoint | Committed |
| `fd42c98` | feat: implement phase 5 step 3.1 resolution context | Step 3.1 checkpoint | Committed |
| `11b4ae0` | fix: isolate state coverage integration fixtures | Step 2 test-isolation fix | Committed |
| `979c7f3` | fix: narrow federal fixture isolation scan boundary | Federal guard timeout fix | Committed |
| `ae988ac` | feat: add phase 5 step 2 state coverage model | Step 2 checkpoint | Committed |
| `af980f5` | feat: add phase 5 step 1 state contracts, rule keys and detail schemas | Step 1 checkpoint | Committed |
| `dfa7d9c` | feat: implement phase 4 federal tax engine per approved specification | Phase 4 checkpoint | Merged to `main` |

---

## 12. Testing & Quality Gates

Verified commands (from `package.json`):

```bash
npm test                  # vitest run — unit + integration (DB tests skip without Postgres)
npm run test:db           # vitest run tests/integration — requires PostgreSQL running
npm run typecheck         # tsc --noEmit
npm run lint              # eslint .
npm run format:check      # prettier --check .
npm run build             # next build (Turbopack)
npx prisma validate       # schema validation
```

Latest verified totals (as of the Step 3.3 + 3.4 + 3.5 (provenance-corrected) + 3.6 + 3.7 work,
committed in `7717e6a`, run WITH PostgreSQL live via `npm run test:db`/full suite together):
938 tests passed, 1 skipped, 0 failed; typecheck/lint/format/build/Prisma validate all clean.
Do not append further historical test-run numbers here — replace this line when a newer result
supersedes it.

**Stale as of 2026-09-24:** this 938/1/0 total predates `7717e6a`'s own Step 4 Task 1–4C
additions and all 17 commits after it through `3d6302c` (see §7, §11) — none of which record a
suite-wide pass/fail count in their commit history. The true current total is therefore
unknown and should not be assumed to still be 938/1/0; it is left un-replaced here (rather than
guessed) pending an actual `npm test`/`npm run test:db` run against current HEAD.

Known flake (pre-existing, not caused by Step 3.5): `tests/integration/state-coverage-matrix
.test.ts` has one test with an intentionally unscoped jurisdiction count assertion that can
occasionally race against other concurrently-running DB integration test files. Re-running
resolves it; this is a documented, accepted property of that specific test, not a defect to
fix here.

PostgreSQL start (local/container): `pg_isready -q || su postgres -c "pg_ctl -D
/var/lib/postgresql/dopaycheck-dev -l /var/lib/postgresql/dopaycheck-dev/start.log start"`, then
source `.env` (`set -a; . ./.env; set +a`) before running DB-touching scripts.

---

## 13. Security / Data / Calculation Rules

- Auth, RBAC, input validation (Zod), secure secrets/cookies, security headers, rate limiting,
  and immutable audit logs are all required — see spec §42, §57, §58.
- Never commit real secrets; `.env.example` holds placeholders only, `.env` is git-ignored.
- Reports contain sensitive salary/tax data — no predictable public PDF URLs.
- All authoritative money math is Decimal/NUMERIC-safe; never floating point.
- Every tax rule is versioned, source-traced, effective-dated, and carries a verification status
  (`VERIFIED`, `NOT_APPLICABLE`, `PENDING`, `CONFLICT`, `PARTIALLY_VERIFIED`, `NOT_STATED`).
- Calculation results carry an explicit status (`COMPLETE`, `INCOMPLETE`, `INVALID_INPUT`,
  `RULE_CONFLICT`, `UNSUPPORTED_SCENARIO`, `CALCULATION_ERROR`) — never presented as
  authoritative when incomplete or guessed.
- No silent fallback, no fabricated missing rule, ever. Full detail: `docs/SPECIFICATION.md`.

---

## 14. Deployment Environment

```text
Hosting provider:     UNKNOWN — must be verified before deployment work.
Production domain:    https://dopaycheck.com/ (stated in spec; hosting not yet configured)
Runtime versions:     Node >=20.9.0 (repo-enforced), Next.js 16, PostgreSQL 16
Database technology:  PostgreSQL (via Prisma 7 + @prisma/adapter-pg)
Deployment target:    UNKNOWN — docs/DEPLOYMENT.md does not exist yet (intentionally deferred,
                       spec §62)
Infra constraints:    None documented yet.
```

---

## 15. Current Next Action

**Superseded 2026-09-24 — see the disclosure note in §5.** Everything below this line
described a state ~18 commits stale (Steps 3.3–3.7 as "COMPLETE but UNCOMMITTED"). All of
Steps 3.3–3.7 were in fact committed in `7717e6a` on 2026-09-20, and 17 further commits
(through current HEAD `3d6302c`, 2026-09-22) implemented most of Step 4 (State Tax
Calculation) on top of that — see §6 for the current phase/step summary and §7 for the
commit-by-commit detail. The `StateRuleKey -> RuleCategory` mapping decision mentioned below
remains genuinely open (not resolved by any commit in `7717e6a..3d6302c`) — it is still a
correct PENDING DECISION, not stale.

As of `3d6302c`, the two disclosed, non-blocking gaps still standing are: (1) the
`ResolvedStateRuleSet.missing` mapping gap described just below, and (2) `ROUND` and the
`SUBTRACT_EXEMPTIONS` dependent-exemption path (`PIT_DEPENDENT_EXEMPTION`), both still
unresolved in the withholding-formula interpreter (§7, `3d6302c` entry). No caller wires
`runStateWithholdingFormula()` end to end yet. This file does not know what the project owner
has asked for since `3d6302c` — the next actual next-action determination is for whichever
session next receives an explicit instruction, verified against current `git log`/`git status`
per §18, not inferred from this now-corrected paragraph.

The original (now-historical) next-action text, preserved for its still-accurate content on
the `ResolvedStateRuleSet.missing` gap and the "do not invent" guidance:

`lib/tax/state/coverageGate.ts`, `lib/tax/state/capabilityRuleKeys.ts`,
`lib/tax/state/rules/candidateRetrieval.ts`, `lib/tax/state/rules/resolveCandidates.ts`,
`lib/tax/state/rules/assembleStateRuleSet.ts`, and their tests are committed (`7717e6a`). The
Step 3.5 provenance-preservation fix (§9) made Step 3.7 possible without any database access;
Step 3.7 preserves that provenance verbatim into the final `ResolvedStateRuleSet` (see the
Step 3.7 entry in §7). One disclosed, non-blocking gap remains: `ResolvedStateRuleSet.missing`
is left empty pending an explicit `StateRuleKey -> RuleCategory` mapping decision the owner has
not yet made (see the Step 3.7 entry in §7).

**DO NOT:**
- Start Step 5+ or further Step 4 work (e.g. wiring `runStateWithholdingFormula()` into a
  caller, the `ROUND` operation, or the dependent-exemption path) without an explicit
  instruction and a concrete contract
- Implement pipeline positions 3-4 (`fixEffectiveInstant`, `identifyJurisdictions`) unless
  explicitly requested
- Invent a `StateRuleKey -> RuleCategory` mapping to populate `ResolvedStateRuleSet.missing`
  without an explicit owner decision
- Commit or push without an explicit instruction to do so

---

## 16. Activity Log Index

Detailed task/activity records: `docs/claude-log/`. Index of entries created so far:

- `docs/claude-log/2026-09-19-step-3-2-checkpoint.md` — Step 3.2 + Amendment 3 implementation,
  verification, and checkpoint commit `8f7952a`.
- `docs/claude-log/2026-09-19-step-3-3-blocked.md` — first Step 3.3 attempt: inspection and
  blocking determination (no invented contract) — superseded once the contract was supplied.
- `docs/claude-log/2026-09-19-step-3-3-coverage-gate.md` — Step 3.3 Coverage Gate implemented
  once the authoritative contract was transcribed inline; tested and verified, uncommitted.
- `docs/claude-log/2026-09-19-step-3-4-blocked.md` — first Step 3.4 attempt: F-02's actual
  capability → rule-key mapping content was not supplied, only meta-requirements; no files
  created, nothing invented. Superseded once the mapping was explicitly approved.
- `docs/claude-log/2026-09-19-step-3-4-f02-mapping.md` — Step 3.4 implemented once the approved
  F-02 mapping was supplied inline; tested and verified, uncommitted.
- `docs/claude-log/2026-09-20-step-3-5-retrieve-candidates.md` — Step 3.5 (`retrieveCandidates`)
  implemented once the owner approved it as the next pipeline seam; tested against a live
  database and verified, uncommitted. Appended with a follow-up correction section
  (2026-09-20, Provenance Preservation Fix) after a Step 3.7 attempt found the original
  candidate shape discarded required provenance — see also §7 and §9.
- `docs/claude-log/2026-09-20-step-3-6-resolve-candidates.md` — Step 3.6 (`resolveCandidates`)
  implemented once the owner locked its contract inline; tested and verified, uncommitted.
- `docs/claude-log/2026-09-20-step-3-7-assemble-state-rule-set.md` — Step 3.7
  (`assembleStateRuleSet`) implemented once the owner locked its contract inline, consuming
  the Step 3.5-corrected provenance without any database access; tested and verified,
  uncommitted. Records the disclosed `ResolvedStateRuleSet.missing` gap — see also §7.

New entries are added as meaningful work happens — see §17.

---

## 17. Rules for Updating CLAUDE.md

At the end of every meaningful task, before reporting completion:

1. Determine whether project state changed (files, tests, Git, blockers, next action).
2. If yes, update this file — specifically §5 (Current Repository State), §6 (Current Phase/
   Step), §7 (Completed Work), §8 (Active Blockers), §11 (Git History), §12 (latest test
   totals), and §15 (Current Next Action).
3. If the activity is significant (phase/step start or complete, implementation, investigation,
   blocker found, amendment, checkpoint commit, deployment, major verification), add one entry
   to `docs/claude-log/` and reference it in §16.
4. Verify — do not guess — branch, HEAD, working-tree state, current step, and blockers via:
   ```bash
   git status --short
   git rev-parse --short HEAD
   git branch --show-current
   ```
5. Do not record speculative information, and do not claim a task complete until this file
   reflects the new state.

**Never put into this file:** full terminal/test output, install logs, complete conversation
transcripts, large code blocks, temporary debugging output, resolved/irrelevant errors,
speculative future plans, or duplicated specification text. Summarize and reference instead.

---

## 18. Rules for Starting a New Claude Session

1. Read this file (`CLAUDE.md`) in full.
2. Read the specification relevant to the current phase/step (§10 tells you which).
3. Verify current state — do not trust stale memory:
   ```bash
   git status --short
   git rev-parse --short HEAD
   git branch --show-current
   ```
4. Read §15 (Current Next Action) and §8 (Active Blockers).
5. Do not reconstruct old conversation history unless the task genuinely requires it — this
   file plus `docs/claude-log/` should be sufficient.
6. Do not repeat work already recorded as complete in §7.
7. If an authoritative specification or contract is missing, say so and ask for it — never
   invent one to keep moving.

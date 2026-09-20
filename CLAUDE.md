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
HEAD:                95f3456
Working tree:        NOT clean — Steps 3.3, 3.4, 3.5 (provenance-corrected), 3.6, 3.7 all
                      implemented, uncommitted
Last verified checkpoint: 95f3456 — docs: add persistent Claude project memory system
Current phase:       Phase 5 — 50-State Engine
Current step:        Step 3.7 (assembleStateRuleSet) — COMPLETE, awaiting commit approval.
                      Step 3 (State Rule Resolver) is now fully implemented end to end.
```

---

## 6. Current Phase / Step

**Phase 5 — 50-State Engine**, Step 3 (State Rule Resolver), sub-step 3.7
(`assembleStateRuleSet`) — COMPLETE, uncommitted. This completes Step 3 end to end.

Completed within Step 3: 3.1 (Resolution Context), 3.2 (Context Validation), Amendment 2
(structural-only jurisdiction validation), Amendment 3 (explicit capability request source),
3.3 (Coverage Gate), 3.4 (F-02 capability → rule-key mapping), 3.5 (candidate retrieval,
provenance-corrected), 3.6 (candidate resolution decision — RESOLVED/NOT_FOUND/AMBIGUOUS per
key), 3.7 (final `ResolvedStateRuleSet` assembly). Pipeline positions "fixEffectiveInstant"
and "identifyJurisdictions" remain intentionally skipped (owner decision) — see §9. Step 3.8+
(if any; e.g. wiring this resolver into a caller/Stage B) is next but NOT started, and was
not requested.

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
Status: COMPLETE, uncommitted (implemented on top of `95f3456`, awaiting commit approval)
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
Status: COMPLETE, uncommitted (implemented on top of `95f3456`, awaiting commit approval)
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
Status: COMPLETE, uncommitted (implemented on top of `95f3456`, awaiting commit approval)
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

**Follow-up correction (2026-09-20 — Provenance Preservation Fix, uncommitted):** A Step 3.7
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
Status: COMPLETE, uncommitted (implemented on top of `95f3456`, awaiting commit approval)
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
Status: COMPLETE, uncommitted (implemented on top of `95f3456`, awaiting commit approval)
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
**Status:** Implemented, uncommitted (Step 3.4, on top of `95f3456`).

### Step 3.5 sequencing — `retrieveCandidates`, positions 3-4 intentionally skipped
**What changed:** The project owner explicitly approved `retrieveCandidates` (pipeline
position 7) as Step 3.5, rather than backfilling the earlier-skipped pipeline positions 3-4
(`fixEffectiveInstant`, `identifyJurisdictions`).
**Why:** An explicit sequencing decision — the owner judged candidate retrieval more valuable
next than the two skipped positions, which remain unimplemented and unassigned.
**Affected:** Step 3.5 only. Positions 3-4 remain open for a future explicit decision; nothing
about their contract was invented or assumed.
**Status:** Implemented, uncommitted (Step 3.5, on top of `95f3456`).

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
**Status:** Implemented, uncommitted (on top of `95f3456`).

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

Current branch: `claude/upbeat-dirac-qqhuye`. Key checkpoints only (not every commit):

| SHA | Message | Purpose | Status |
|---|---|---|---|
| (uncommitted) | Step 3.3 + 3.4 + 3.5 (provenance-corrected) + 3.6 + 3.7 | `coverageGate.ts`, `capabilityRuleKeys.ts`, `rules/candidateRetrieval.ts`, `rules/resolveCandidates.ts`, `rules/assembleStateRuleSet.ts` + tests | Implemented, awaiting commit approval |
| `95f3456` | docs: add persistent Claude project memory system | Project memory system checkpoint | Latest committed checkpoint |
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

Latest verified totals (as of the uncommitted Step 3.3 + 3.4 + 3.5 (provenance-corrected) +
3.6 + 3.7 work, on top of `95f3456`, run WITH PostgreSQL live via `npm run test:db`/full suite
together): 938 tests passed, 1 skipped, 0 failed; typecheck/lint/format/build/Prisma validate
all clean. Do not append further historical test-run numbers here — replace this line when a
newer result supersedes it.

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

**Steps 3.3, 3.4, 3.5 (provenance-corrected), 3.6 and 3.7 are all COMPLETE but
UNCOMMITTED — Step 3 (State Rule Resolver) is now implemented end to end.**

`lib/tax/state/coverageGate.ts`, `lib/tax/state/capabilityRuleKeys.ts`,
`lib/tax/state/rules/candidateRetrieval.ts`, `lib/tax/state/rules/resolveCandidates.ts`,
`lib/tax/state/rules/assembleStateRuleSet.ts`, and their tests exist in the working tree on
top of commit `95f3456`. The Step 3.5 provenance-preservation fix (§9) made Step 3.7 possible
without any database access; Step 3.7 preserves that provenance verbatim into the final
`ResolvedStateRuleSet` (see the Step 3.7 entry in §7). One disclosed, non-blocking gap remains:
`ResolvedStateRuleSet.missing` is left empty pending an explicit `StateRuleKey -> RuleCategory`
mapping decision the owner has not yet made (see the Step 3.7 entry in §7).

Next action: either (a) the owner reviews and asks for a commit + push checkpoint covering
Steps 3.3-3.7 together (same pattern as the Step 3.2 + Amendment 3 checkpoint), or (b) the
owner requests a next step — e.g. wiring `assembleStateRuleSet()` into an actual caller/Stage B,
or the `StateRuleKey -> RuleCategory` mapping decision noted above — with its own concrete
contract supplied inline, following the pattern established for every prior sub-step.

**DO NOT:**
- Start any further step (Step 3.8+, or wiring this resolver into a caller) without an
  explicit instruction and a concrete contract
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

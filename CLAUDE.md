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
HEAD:                8f7952a
Working tree:        clean
Last verified checkpoint: 8f7952a — feat(state): implement explicit capability request source
Current phase:       Phase 5 — 50-State Engine
Current step:        Step 3.3 (Coverage Gate) — BLOCKED, not yet implemented
```

---

## 6. Current Phase / Step

**Phase 5 — 50-State Engine**, Step 3 (State Rule Resolver), sub-step 3.3 (Coverage Gate).

Completed within Step 3: 3.1 (Resolution Context), 3.2 (Context Validation), Amendment 2
(structural-only jurisdiction validation), Amendment 3 (explicit capability request source).
Step 3.3 has not been implemented — see §8 Active Blockers.

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

---

## 8. Active Blockers

### Step-3.3-contract
**Description:** The authoritative Step 3.3 "Coverage Gate" contract (exact function signature,
input/output types, coverage outcome vocabulary, gating rules) has not been supplied — neither
committed to the repository nor pasted into a session with concrete detail (unlike Step 3.2 and
Amendment 3, which came with exact type/field definitions).
**Why it blocks:** Implementing without the contract would mean inventing the gate's shape,
which conflicts with the project's "never invent requirements" rule.
**What is required to unblock:** The exact Coverage Gate function signature, its input/output
types, the exact outcome/status terminology to use, and what specifically constitutes a gate
pass vs. fail (e.g., which `CoverageStatus` values from Step 2 permit resolution to proceed).
**Affects:** Step 3.3 only. Does not block Steps 3.1/3.2 or Amendment 3, which are complete.

### F-02
**Description:** The capability → rule-key mapping (which `StateRuleKey`s a given
`StateCapability` needs) has not been designed or approved.
**Why it blocks:** Step 3.4 (required-key construction) and Stage 6 (candidate rule retrieval)
both need this mapping to exist.
**What is required to unblock:** A human decision on the mapping's design, then implementation
and review — never inferred or approximated in the meantime.
**Affects:** Step 3.4 and everything downstream of it. Does not block Step 3.3's own scope,
except insofar as Step 3.3 must not attempt to build or approximate this mapping either.

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
3.1, Step 3.2, Amendment 2, Amendment 3), implementation proceeded. Where only prose goals/
prohibitions were given without a concrete contract (Step 3.3), implementation is BLOCKED —
see §8.

`docs/DEPLOYMENT.md` does not exist yet; per `docs/DEVELOPMENT.md` it is intentionally deferred
to a later phase once the hosting runtime is confirmed (spec §62).

---

## 11. Git / Branch / Checkpoint History

Current branch: `claude/upbeat-dirac-qqhuye`. Key checkpoints only (not every commit):

| SHA | Message | Purpose | Status |
|---|---|---|---|
| `8f7952a` | feat(state): implement explicit capability request source | Step 3.2 + Amendment 3 checkpoint | Latest verified checkpoint |
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

Latest verified totals (as of commit `8f7952a`): 720 tests passed, 81 skipped (DB integration,
run separately), 0 failed; typecheck/lint/format/build/Prisma validate all clean. Do not append
further historical test-run numbers here — replace this line when a newer result supersedes it.

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

**Step 3.3 (Coverage Gate) is BLOCKED.**

Reason: the authoritative Step 3.3 contract (exact function signature, input/output types,
coverage outcome vocabulary, gating rules) has not been supplied with concrete detail, and does
not exist in the repository.

Required before implementation can proceed:
- Exact Coverage Gate function signature
- Exact input/output types
- Exact coverage outcome/status terminology to use
- Exact gating rule(s) — what makes a request pass or fail the gate

**DO NOT:**
- Implement Step 3.3 from assumptions
- Start Step 3.4
- Modify or work around F-02

---

## 16. Activity Log Index

Detailed task/activity records: `docs/claude-log/`. Index of entries created so far:

- `docs/claude-log/2026-09-19-step-3-2-checkpoint.md` — Step 3.2 + Amendment 3 implementation,
  verification, and checkpoint commit `8f7952a`.
- `docs/claude-log/2026-09-19-step-3-3-blocked.md` — Step 3.3 inspection and blocking
  determination (no invented contract).

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

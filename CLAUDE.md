# CLAUDE.md — DoPayCheck Project Instructions

Persistent operating instructions for Claude Code sessions working on this repository.

This file is a **summary of operating rules only**. It deliberately does **not** duplicate the
Master Specification. For any detail, requirement, field list, or workflow, read the
specification.

---

## 1. Project Identity

- **Project:** DoPayCheck
- **Domain:** https://dopaycheck.com/
- **What it is:** A production-grade US Paycheck & Payroll Tax Transparency Platform.
- **Core promise:** "Know What You'll Take Home."

The product must be accurate, transparent, production-grade, scalable, secure, mobile-first,
SEO-friendly, fast, accessible, maintainable, annually updatable, auditable and source-traceable.

---

## 2. Source of Truth

**`docs/SPECIFICATION.md` is the authoritative Master Specification.**

- Read it before implementing anything.
- It supersedes assumptions, habits, convenience and anything stated informally in a prompt.
- If a requirement conflicts with an assumption, **follow the specification.**
- If two requirements appear to conflict with each other, **preserve both and flag the conflict
  for human decision.** Do not silently choose one.
- Never invent requirements to fill a gap. Flag the gap instead (see §17 below).

Section references in this file (for example "spec §6") point to numbered sections of
`docs/SPECIFICATION.md`.

---

## 3. Architecture Rule (Non-Negotiable)

**DoPayCheck must be ONE integrated full-stack application.**

**NEVER create separate top-level applications:**

```
/frontend     ← FORBIDDEN as a separate top-level app
/backend      ← FORBIDDEN as a separate top-level app
```

If Next.js is selected, use a **single Next.js App Router application**.

Conceptual structure (spec §3): `/app`, `/components`, `/lib`, `/prisma`, `/data`, `/public`,
`/tests`, `/docs`.

Keep the calculation engine as independent and testable as practical. Database access, external
services and UI concerns must not contaminate core calculation methodology.

---

## 4. Tax Accuracy Rules (Non-Negotiable)

- **Never invent tax data.**
- **Never guess** tax rates, brackets, thresholds, wage bases, allowances or effective dates.
- Tax, business and jurisdiction values must be **data-driven** — never hardcoded into UI
  components or scattered through calculation files.
- **Official government sources are the source of truth** for tax data.
- Missing information must be **marked**, never filled in (see §17 below).
- **Never silently convert `NOT_STATED` into zero.** `NOT_STATED` means the official source does
  not state the value; `NOT_APPLICABLE` means the rule does not apply. They are different, and
  neither is zero. Never invent a zero value.
- **Never silently resolve conflicting tax sources.** Mark `CONFLICT` and escalate.
- **Historical tax rules must never be destructively overwritten.**
- AI may assist with extraction/research, but **AI-generated tax data must never become
  production-authoritative without human verification and approval.**

Reference: spec §2, §6, §19, §24, §71.

---

## 5. Rule Architecture

Tax rules must support:

- Versioning
- Effective dates
- Jurisdictions
- Tax years
- Source traceability
- Verification
- Approval
- Publishing
- Rollback
- Historical preservation

A new tax year should be handled primarily by **adding/updating rule DATA**, not by rewriting
application code. Routine annual tax updates must not require frontend code changes.

Rule statuses (spec §18): `DRAFT`, `PENDING_REVIEW`, `APPROVED`, `ACTIVE`, `SUPERSEDED`,
`REJECTED`, `ROLLED_BACK`, `BLOCKED`.

Component verification statuses (spec §19): `VERIFIED`, `NOT_APPLICABLE`, `PENDING`, `CONFLICT`,
`PARTIALLY_VERIFIED`, `NOT_STATED`.

Reference: spec §2, §18–§23, §30.

---

## 6. Calculation Engine

The calculation engine must be:

- Testable
- Deterministic
- Auditable
- Source-aware
- Independent from UI where practical
- Safe for financial calculations

**Use Decimal / NUMERIC-safe arithmetic for all authoritative money calculations.**

**Do NOT use JavaScript floating-point arithmetic for authoritative financial calculations.**

The engine must support **independent taxability buckets** (spec §5) — do not assume one
taxable-wage value applies to every tax, and do not assume every deduction reduces every tax.

Reference: spec §4, §5, §13, §40.

---

## 7. Calculation Transparency

The system must be able to explain:

```
Gross
→ Pre-tax deductions
→ Taxable wages
→ Federal
→ FICA
→ State
→ Local
→ Post-tax deductions
→ Net
```

**"Why Is My Paycheck This Amount?" must use actual calculation data** from the engine.

Never write generic explanations that could contradict the real calculation. Never present a
guessed or incomplete result as authoritative — calculation statuses exist for that
(spec §16: `COMPLETE`, `INCOMPLETE`, `INVALID_INPUT`, `RULE_CONFLICT`, `UNSUPPORTED_SCENARIO`,
`CALCULATION_ERROR`).

Reference: spec §16, §17, §34.

---

## 8. Security

Always consider:

- Authentication
- Authorization / RBAC
- Input validation (Zod or equivalent)
- Secure secrets (environment-based)
- Secure cookies
- Security headers
- XSS protection
- SQL injection protection
- Rate limiting
- Secure file / PDF handling
- Protected admin routes
- Immutable audit logs

**Never commit real secrets.** Use `.env.example` with placeholder values only.

Reports may contain sensitive salary and tax data — no predictable public PDF URLs.

Reference: spec §42, §57, §58.

---

## 9. Testing

**Testing is mandatory. Do not skip it.**

Use, as appropriate: unit tests, integration tests, regression tests, golden tests, E2E tests.

- Tax calculations require **verified, source-based test cases** — table-driven against known
  correct values.
- **Never use fake or invented tax values as authoritative test fixtures.**

Reference: spec §61.

---

## 10. SEO

DoPayCheck is an SEO-focused public product. Preserve:

- Canonical URLs
- Metadata
- Sitemap
- Robots
- Structured data
- Internal linking
- Breadcrumbs
- Clean URLs
- State-specific landing pages

Only one canonical state route: `/paycheck-calculator/{state}/`. Do not create duplicate routes or
thin doorway pages. Tax year should not normally appear in calculator URLs.

Reference: spec §35, §36, §37, §66, §67.

---

## 11. Performance

Core Web Vitals are non-negotiable. Prioritize:

- LCP
- INP
- CLS
- Minimal JavaScript
- Minimal hydration
- Optimized assets (images, fonts)
- Efficient database access
- Caching
- Minimal third-party scripts

Do not sacrifice performance for unnecessary animation or scripts. Respect
`prefers-reduced-motion`.

Reference: spec §55, §60.

---

## 12. Accessibility

**Build accessibility from the beginning — do not retrofit it.** Consider it during component
creation. Address:

- Keyboard navigation
- Focus states (visible)
- Semantic HTML
- Form labels
- Accessible errors
- Screen readers
- Accessible tables
- Contrast
- Reduced motion

Reference: spec §59.

---

## 13. Admin Philosophy

The admin should feel simple and **WordPress-like**. Prefer:

- Clear persistent sidebar navigation
- Searchable tables
- Filters and pagination
- Familiar CRUD patterns
- Draft / review / publish workflow
- Clear confirmations and warnings
- Minimal unnecessary technical terminology

Major operational modules (Tax Rules, Sources, Updates, Verification, Calculations, Reports, Audit
Logs) stay **top-level**, not buried in Settings.

Reference: spec §25, §26, §27, §29.

---

## 14. Tax Rule Publishing

**Never directly activate unverified tax rules.**

Preferred flow:

```
Draft
→ Validate
→ Source Check
→ Conflict Check
→ Tests
→ Review
→ Approve
→ Publish
```

Publishing must be blocked when required fields are missing, a source is missing, effective dates
are invalid, conflicts exist, required tests fail, or approval is missing.

A duplicated/cloned rule must **never** be automatically activated.

Reference: spec §22, §23, §30.

---

## 15. Historical Data

**Never destructively overwrite published historical tax rules.**

Use:

- Versioning
- Superseding
- Archiving
- Rollback

A 2027 rule must not overwrite a 2026 rule. Historical reports must remain reproducible via
immutable calculation snapshots. **Audit logs must never be deleted.**

Reference: spec §23, §29, §31, §40, §63.

---

## 16. Phase Discipline (Non-Negotiable)

Development proceeds **strictly phase-by-phase**. The project has **12 phases** defined in
`docs/SPECIFICATION.md` §68:

| # | Phase | # | Phase |
|---|---|---|---|
| 1 | Foundation | 7 | Update Mechanism |
| 2 | Rule & Data System | 8 | Admin Dashboard |
| 3 | Calculation Engine | 9 | Calculator Frontend |
| 4 | Federal Engine | 10 | Results & UX |
| 5 | 50-State Engine | 11 | SEO + Content |
| 6 | Local Tax Engine | 12 | QA + Production |

When explicitly assigned a phase:

1. Implement **ONLY** that phase.
2. Test it.
3. Verify it.
4. Report it.
5. **STOP.**

**Do NOT automatically continue to the next phase.** Wait for explicit approval.

Reference: spec §68, §69.

---

## 17. Handling Unknown Information

If something is missing or uncertain, mark it explicitly:

- **`PENDING DECISION`** — a choice is required from a human.
- **`PENDING DATA`** — required data (e.g. official tax values) is not yet available.
- **`PENDING VERIFICATION`** — something is assumed but not yet confirmed.

For rule data specifically, use the spec's rule statuses (`PENDING`, `CONFLICT`, `NOT_STATED`,
`PARTIALLY_VERIFIED`, `NOT_APPLICABLE`).

**Do not invent an answer merely to continue implementation.** Never hide uncertainty.

Reference: spec §2, §19, §70.

---

## 18. Existing Work

Before modifying the repository:

- **Inspect existing files first.**
- **Preserve useful work.**
- Do not delete existing functionality without clear justification.
- Do not make unnecessary rewrites.
- Do not silently make major architecture decisions — surface them.

---

## 19. Git Discipline

- Keep changes focused and scoped to the assigned work.
- Do not modify unrelated files.
- Do not commit generated secrets, credentials or `.env` files.
- Do not force-push unless explicitly instructed.
- Do not rewrite history unnecessarily.
- Clearly report commits and changed files.
- **Never push unfinished or knowingly broken work** unless explicitly instructed.

---

## 20. Phase Completion Report

At the end of each development phase, report:

- What was implemented
- Files created
- Files modified
- Files deleted
- Database changes
- Architecture changes
- Tests
- Typecheck
- Build
- Security status
- Known issues
- Pending decisions
- Pending data
- Pending verification
- Recommended next phase

Then **STOP.**

---

## Workflow Rule (Every Session)

Before implementing anything:

1. Read `docs/SPECIFICATION.md`.
2. Inspect the current repository.
3. Understand the assigned phase.
4. Identify dependencies and risks.
5. Implement only the requested scope.
6. Test and verify.
7. Report.
8. **STOP.**

**Never assume the user wants the next phase automatically.**

---

## Master Principle

DoPayCheck prioritizes:

**ACCURACY · TRANSPARENCY · SOURCE TRACEABILITY · AUDITABILITY · SECURITY · MAINTAINABILITY ·
PERFORMANCE · SEO · ACCESSIBILITY · SCALABILITY**

- Never sacrifice tax accuracy for speed of implementation.
- Never invent tax data.
- Never hide uncertainty.
- Never silently overwrite historical tax rules.
- Never allow monetization logic to influence calculation logic.
- Never allow AI-generated tax data to become production-authoritative without human verification
  and approval.

Reference: spec §71.

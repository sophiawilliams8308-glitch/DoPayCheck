# DoPayCheck — Rule & Data System (Phase 2)

Architecture of the tax rule data layer.

`docs/SPECIFICATION.md` remains the authoritative Master Specification; this document explains
how Phase 2 implements §2 and §18–§24 of it. Section references below (`spec §N`) point there.

---

## 1. What Phase 2 is

The data and domain foundation that later phases calculate against. It stores **no tax
values** — the tables are built, the workflow is enforced, and every rate, bracket, threshold
and wage base is still `PENDING DATA` awaiting an official source.

Phase 2 deliberately does **not** include the calculation engine (Phase 3+), admin UI
(Phase 8) or any tax data.

---

## 2. Four invariants

Everything below exists to hold these:

1. **Tax values are data, not code.** A new tax year is new rows, not a new release.
2. **Rules are versioned and effective-dated.** `taxYear` never decides which rule applies.
3. **Published history is immutable.** Corrections supersede; they never overwrite.
4. **Every authoritative value is source-traceable** and carries a verification status.

---

## 3. Entities

| Entity                | Purpose                                                                     | Key relationships                                                                                                                |
| --------------------- | --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `Jurisdiction`        | A taxing authority: federal, state, county, city, locality, school district | Self-referencing hierarchy (`parent` / `children`); has many `TaxRule`                                                           |
| `TaxYear`             | A tax-year container for administration and reporting                       | Has many `TaxRule`                                                                                                               |
| `Source`              | An official document authorising rule data                                  | Has many `TaxRuleSource`                                                                                                         |
| `TaxRule`             | One versioned, effective-dated rule for a jurisdiction + category           | Belongs to `TaxYear` + `Jurisdiction`; has many `TaxRuleValue`, `TaxRuleSource`, `RuleConflict`; optional self-link `supersedes` |
| `TaxRuleValue`        | One authoritative component, stored exactly in `NUMERIC`                    | Belongs to `TaxRule`                                                                                                             |
| `TaxRuleSource`       | Rule ↔ source link **with a locator** (page/section/table/citation/excerpt) | Joins `TaxRule` and `Source`                                                                                                     |
| `RuleConflict`        | A recorded disagreement between sources                                     | Belongs to `TaxRule`; references up to two `Source` rows                                                                         |
| `AuditLog`            | Append-only record of administrative actions                                | Free-standing; references entities by type + id                                                                                  |
| `TaxBracket`          | One bracket of a progressive schedule                                       | → `TaxRule`; optional direct → `Source`                                                                                          |
| `WithholdingTable`    | An official payroll withholding table                                       | → `TaxRule`; → many `WithholdingTableRow`; optional → `Source`                                                                   |
| `WithholdingTableRow` | One wage row of a withholding table                                         | → `WithholdingTable`                                                                                                             |
| `ReciprocityRule`     | A reciprocity agreement between two states                                  | 1-1 → `TaxRule`; → two `Jurisdiction` (from/to)                                                                                  |
| `LocalTaxRule`        | A county/city/school-district tax                                           | 1-1 → `TaxRule`; → `Jurisdiction` (the locality)                                                                                 |

### Detail tables — why they hang off `TaxRule`

`TaxBracket`, `WithholdingTable`, `ReciprocityRule` and `LocalTaxRule` carry **only** the
structure specific to their shape. Identity, versioning, effective dates, lifecycle status,
verification, source links, conflicts and audit all come from the parent `TaxRule`.

Giving each detail table its own lifecycle columns would create several parallel lifecycles
that could disagree about which rule is in force — exactly the ambiguity the effective-date
exclusion constraint exists to prevent. One consequence worth stating: a bracket set, a
withholding table, a reciprocity agreement and a local tax are all published, superseded and
audited through the single `TaxRule` workflow.

**`WithholdingTable` is deliberately not `TaxBracket`.** Spec §6 forbids substituting annual
income-tax brackets for paycheck withholding tables, so they are separate models and the
withholding table carries a `payFrequency` dimension that a bracket schedule does not.

**`LocalTaxRule` has no ZIP column.** A ZIP is at best an input aid to locality resolution,
never the legal taxing authority (spec §9).

**Filing status is a string, not an enum.** Filing statuses differ by jurisdiction and are
jurisdiction _data_; encoding them as an application enum would put business values into
source code. `payFrequency` _is_ an enum, because spec §11 enumerates the seven frequencies as
a product-level structural decision.

### Jurisdictions

Hierarchical, so Phase 6 locality resolution can walk city → county → state → federal.

**ZIP codes are not jurisdictions** (spec §9). A ZIP may later be an _input aid_ to
resolution; it is never the legal taxing authority.

### Tax years

Any year is representable. `TAX_YEARS` in the seed creates 2025–2027 as empty containers
purely to demonstrate that nothing is pinned to one year. At most one year may be flagged
**default** (`isDefault`), enforced by a partial unique index.

---

## 4. Versioning and effective dates

This is the core of Phase 2.

- `ruleKey` identifies the **conceptual** rule and is stable across versions and years.
- `version` increments per record sharing that key; `@@unique([ruleKey, version])`.
- `effectiveFrom` / `effectiveTo` are **authoritative**. `effectiveTo = NULL` means open-ended.
- Intervals are **half-open `[from, to)`**, so consecutive periods touch without overlapping:

```
Rule A   2026-01-01  ->  2026-07-01
Rule B   2026-07-01  ->  2027-01-01
```

Both coexist. A calculation dated 2026-03-15 resolves to A; 2026-09-01 resolves to B.

### Overlap prevention — design choice

Two ACTIVE versions of the same `ruleKey` must never cover the same instant, or resolution is
ambiguous and a paycheck could silently use the wrong law.

This is enforced **in the database** with a GiST exclusion constraint, not only in application
code, so it cannot be bypassed by raw SQL or a future code path:

```sql
CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE "TaxRule"
  ADD CONSTRAINT "TaxRule_no_overlapping_active_versions"
  EXCLUDE USING gist (
    "ruleKey" WITH =,
    tsrange("effectiveFrom", "effectiveTo", '[)') WITH &&
  ) WHERE ("status" = 'ACTIVE');
```

Three details worth recording:

- **`btree_gist`** is required for the `=` operator on the scalar `ruleKey` alongside the
  range overlap operator `&&`.
- **`tsrange`, not `tstzrange`.** The columns are `TIMESTAMP(3) WITHOUT TIME ZONE`; casting
  those to `timestamptz` depends on the session `TimeZone`, making the expression `STABLE`
  rather than `IMMUTABLE` — and index expressions must be `IMMUTABLE`. Using `tstzrange` fails
  with `42P17`.
- **Scoped to `status = 'ACTIVE'`.** Drafts, superseded and rejected versions may overlap
  freely; only what is in force is constrained.

Application-level validation (`lib/rules/validation.ts`) performs the same check first so
administrators get a readable message. The database constraint is the backstop, and both use
identical half-open semantics so they cannot disagree.

---

## 5. Rule lifecycle

```
DRAFT -> PENDING_REVIEW -> APPROVED -> ACTIVE -> SUPERSEDED
                                                 -> ROLLED_BACK
   REJECTED / BLOCKED are recoverable; SUPERSEDED and ROLLED_BACK are terminal.
```

`DRAFT` cannot jump straight to `ACTIVE`. Transitions live in `lib/rules/lifecycle.ts`.

### Publish gate

`evaluateActivation()` returns **every** blocking reason at once rather than a bare boolean.
A rule reaches `ACTIVE` only when all hold:

| Requirement                                                     | Blocker if missing     |
| --------------------------------------------------------------- | ---------------------- |
| Status is `APPROVED` with a recorded approver                   | `NOT_APPROVED`         |
| Transition is legal                                             | `INVALID_TRANSITION`   |
| Rule verification is `VERIFIED`                                 | `NOT_VERIFIED`         |
| At least one official source is linked                          | `NO_SOURCE`            |
| No `OPEN` / `INVESTIGATING` conflict                            | `UNRESOLVED_CONFLICT`  |
| No component left `PENDING` / `CONFLICT` / `PARTIALLY_VERIFIED` | `UNVERIFIED_COMPONENT` |

**`NOT_APPLICABLE` and `NOT_STATED` components do not block activation.** They are _decided_
outcomes. Blocking on them would pressure an administrator into inventing a value — exactly
what spec §19 forbids.

---

## 6. Verification statuses

`VERIFIED`, `NOT_APPLICABLE`, `PENDING`, `CONFLICT`, `PARTIALLY_VERIFIED`, `NOT_STATED`.

The distinction the system exists to protect:

- **`NOT_APPLICABLE`** — the rule or component genuinely does not apply.
- **`NOT_STATED`** — the official source is silent on the value.

**Neither is zero.** A zero may be stored only when a source explicitly states zero, in which
case the value is `0` with status `VERIFIED`.

Enforcement:

- `TaxRuleValue.numericValue` is **nullable**; a missing value is `NULL`.
- `assertValueConsistency()` rejects any `NOT_APPLICABLE` / `NOT_STATED` component that
  carries a value, and any `VERIFIED` component that carries none.
- `fromPrismaDecimal()` maps `NULL` to `null`, never to `0`.

---

## 7. Source traceability

```
TaxRule ──< TaxRuleSource >── Source
              │
              └─ page, section, subsection, table, heading,
                 citation, excerpt, verificationStatus, verifiedBy, verifiedAt
```

A rule may cite several sources, and several locators within one document. This answers:
_which rule, which version, which source, which page or table, verified by whom and when._

`Source.url` is **nullable on purpose** — an unrecorded URL stays absent rather than being
invented (spec §21).

---

## 8. Conflicts

`RuleConflict` records a disagreement between two sources with a description and status
(`OPEN`, `INVESTIGATING`, `RESOLVED`, `ACCEPTED_AMBIGUITY`, `DISMISSED`). Conflicts are
**represented, never silently resolved**, and an unresolved one blocks activation.

---

## 9. Structured rule data — two layers

Rule categories have genuinely different shapes (progressive brackets vs. a flat rate vs. a
withholding table). Phase 2 stores them in two complementary places:

| Layer                     | Holds                                                              | Why                                                                                |
| ------------------------- | ------------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| `TaxRule.payload` (JSONB) | Category-specific **structure**: bracket sets, table rows, methods | Irregular shape per category; validated by a Zod schema in `lib/rules/payloads.ts` |
| `TaxRuleValue` (NUMERIC)  | Individual **authoritative values**                                | JSON numbers are IEEE-754 doubles — unacceptable for tax values (spec §4)          |

Identity, version, dates, status, verification and source links stay **normalised relational
columns**, never JSON.

Every monetary/rate field in a payload schema is a decimal **string**, so an authoritative
value can never pass through a JS `number`. `payloadSchemaVersion` lets payload shapes evolve
without data loss.

---

## 10. Decimal precision

`TaxRuleValue.numericValue` is `NUMERIC(28,12)`.

- **12 fractional digits** carry any published fractional rate without loss.
- **16 integer digits** exceed any realistic wage base or monetary threshold.
- **Nullable**, because `NOT_STATED` must be `NULL`.

`lib/db/decimal.ts` converts between PostgreSQL `NUMERIC` and the `Money` type from
`lib/core/money.ts` **through decimal strings only**. `.toNumber()` is never called on an
authoritative value.

No rounding happens in Phase 2. Per-tax rounding methodology is a Phase 3/4 decision and must
come from official documentation — it is still **PENDING DECISION**.

---

## 11. Deletion and archive policy

| Data                                            | Policy                                                      |
| ----------------------------------------------- | ----------------------------------------------------------- |
| Draft / unused rules                            | Deletable (`deleteDraftRule`)                               |
| `ACTIVE` / `SUPERSEDED` / `ROLLED_BACK` rules   | **Never deleted** — supersede, archive or roll back         |
| Sources cited by any rule                       | **Archive**, never delete (`deleteUnusedSource` refuses)    |
| Jurisdictions and tax years referenced by rules | **Deactivate**, never delete (`onDelete: Restrict`)         |
| Audit logs                                      | **Never** deleted or updated — database triggers enforce it |

---

## 12. Rule resolution

`lib/rules/resolution.ts` is **pure** — no database import — so the methodology is trivially
testable and persistence cannot contaminate it.

```ts
resolveApplicableRules(candidates, { category, jurisdictionId, effectiveDate, taxYear? })
```

Pipeline: jurisdiction → category → `ACTIVE` status → effective date → optional tax year.

It returns one of three outcomes and **never guesses**:

| Outcome     | Meaning                                                                 |
| ----------- | ----------------------------------------------------------------------- |
| `RESOLVED`  | Exactly one applicable rule                                             |
| `NOT_FOUND` | No rule covers this scenario — the caller must not substitute a default |
| `AMBIGUOUS` | Multiple ACTIVE rules apply; a data defect to surface, not arbitrate    |

It never "returns the newest row": doing so would silently apply current law to a historical
paycheck.

---

## 13. Database integrity

Beyond Prisma's schema, the migration adds:

**CHECK constraints** — `TaxRule_effective_range_valid`, `TaxRule_version_positive`,
`TaxYear_period_valid`, `Jurisdiction_effective_range_valid`, `Jurisdiction_not_self_parent`.

**Partial unique index** — `TaxYear_single_current` (at most one current year).

**Exclusion constraint** — `TaxRule_no_overlapping_active_versions` (§4 above).

**Triggers** — `AuditLog_no_update`, `AuditLog_no_delete`.

**Indexes** — tax year, jurisdiction, category, status, rule key, effective-date range, and a
composite `(jurisdictionId, category, status)` matching the resolution query. Deliberately not
over-indexed; more will be added when real query patterns exist.

### Structural validation of ordered detail data

`validateBracketSchedule()` and `validateWithholdingRows()` check that ordered structures are
sound: unique consecutive ordinals, each upper bound greater than its lower bound, contiguity
with no gap or overlap, and only the final entry open-ended. A gap or overlap would put a wage
into two rows or none, so it is caught before publication.

Comparison uses `compareDecimalStrings()`, which compares decimal **strings** digit by digit.
Converting to a JS number first would make 16-digit values indistinguishable, so no
authoritative value passes through IEEE-754 even during validation.

These check shape and ordering only. They never judge whether a rate or threshold is
plausible — there is no correct range to check against, and inventing one would be guessing.

---

## 14. Local database setup

PostgreSQL 16. See `docs/DEVELOPMENT.md` §4 for installation.

```bash
cp .env.example .env          # set DATABASE_URL
npm run db:generate           # also runs automatically via postinstall
npm run db:migrate            # create/apply migrations
npm run db:seed               # reference geography + empty tax years ONLY
npm run test:db               # integration tests (requires DATABASE_URL)
```

`npm test` runs everything; integration suites **skip** when `DATABASE_URL` is unset, so the
unit suite still works without PostgreSQL.

### What the seed contains

- The federal jurisdiction and 51 states/territories — **reference geography**, no tax content.
- Tax-year containers for 2025–2027 — **empty shells**, no rules.

### What the seed deliberately omits

Tax brackets, rates, wage bases, thresholds, state/local values, withholding tables and
sources. A fabricated source URL would be worse than none. Every tax value arrives later
through draft → review → approve → publish, traceable to an official document.

---

## 15. Unresolved decisions

| Item                                                                             | Status                                                               |
| -------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| All federal, state and local tax values                                          | **PENDING DATA** — no official values recorded                       |
| Per-tax rounding methodology                                                     | **PENDING DECISION** (Phase 3/4)                                     |
| Applicability/conditions payload shape (filing status, residency, pay frequency) | **PENDING DECISION** (Phase 3) — stored as JSON, shape not yet fixed |
| Locality resolution from ZIP / work / residence location                         | **PENDING NEXT PHASE** (Phase 6)                                     |
| Authentication for `AuditLog.actor`                                              | **PENDING NEXT PHASE** (Phase 8) — currently a free-text identifier  |
| Production database provisioning                                                 | **PENDING VERIFICATION** (production phase)                          |

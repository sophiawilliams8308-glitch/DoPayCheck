# PHASE 4 — FEDERAL TAX ENGINE SPECIFICATION

**Project:** DoPayCheck — US Paycheck & Payroll Tax Transparency Platform
**Phase:** 4 — Federal Tax Engine
**Document type:** Specification / architecture / requirements only. No implementation code.
**Initial production target:** Tax Year 2026
**Status:** APPROVED IN PART — Section C decisions approved 2026-09-13; V-01 RESOLVED 2026-09-13
**Revision:** r2 (2026-09-13) — V-01 and D-FIT-5 closed; no other change
**Date:** 2026-09-13

---

## 0. DOCUMENT CONTROL

### 0.1 Scope of this document

This is a planning artifact. It contains architecture, methodology, data requirements, rule
structures, workflows, test plans and acceptance criteria. It contains **no implementation code, no
migrations, and no repository inspection**. Repository work happens later in Claude Code; migrations
and verification happen later on the Mac.

### 0.2 Value policy used in this document

The body of this specification references **rule keys**, never literal tax values. All numbers live
in two appendices, each row carrying a source and a verification status:

- **Appendix A — PENDING DATA manifest.** Values that must be extracted from official IRS documents
  before Phase 4 can be considered complete. Nothing here is guessed.
- **Appendix B — Value register.** Values supplied by the project owner in the Phase 4 brief, plus
  values retrieved directly from IRS.gov during this specification work. Every row is marked
  `PENDING_VERIFICATION` until a human confirms it against the official PDF and records the page,
  section, table and heading.

No value anywhere in this document was produced from memory, inference, interpolation or
"commonly known" rates.

### 0.3 Methodology verification performed

The federal **methodology** described here was checked against IRS.gov on 2026-09-13:

| Document | Locator |
|---|---|
| Publication 15-T (2026), *Federal Income Tax Withholding Methods* | `https://www.irs.gov/publications/p15t` · `https://www.irs.gov/pub/irs-pdf/p15t.pdf` |
| Publication 15 (Circular E) (2026), *Employer's Tax Guide* | `https://www.irs.gov/pub/irs-pdf/p15.pdf` |
| Form W-4 (2026) and instructions | `https://www.irs.gov/forms-pubs/about-form-w-4` |

Structural facts confirmed (these drive the architecture, and none of them is a tax value):

1. The 2026 withholding tables were updated for P.L. 119-21 (OBBBA) — permanent extension of the
   individual rates, permanent increased standard deduction, permanent termination of personal
   exemptions. This is consistent with the personal exemption of $0 supplied in the brief.
2. The 2026 Form W-4 was updated for the new OBBBA deductions and **adds a new checkbox below Step
   4(c)** for claiming exemption from withholding. Previously the employee wrote "Exempt" there.
   **This is a new required input field for 2026.**
3. OBBBA deductions for qualified tips and qualified overtime compensation (tax years after 2024 and
   before 2029) are **income-tax-return deductions**. The payroll mechanism is that the employee
   accounts for the expected deduction **on their Form W-4**; the employer then applies the ordinary
   Pub. 15-T procedures. Tips and qualified overtime remain fully subject to both shares of Social
   Security and Medicare tax. **The engine must not deduct them from any wage bucket.** See §7.9.
4. Pub. 15-T Section 1 (Percentage Method Tables for Automated Payroll Systems, **Worksheet 1A**)
   works for Forms W-4 of all prior, current and future years and for any amount of wages.
5. Worksheet 1A uses the **annual** percentage-method rate schedules only, with a periods-per-year
   factor from Worksheet 1A **Table 3**. There is no per-frequency rate table in this path.
6. There are two annual rate schedule sets: **STANDARD** and **Form W-4 Step 2 Checkbox**, each with
   a table per filing status, and each row exposing columns **A** (at least), **B** (but less than),
   **C** (base amount), **D** (rate).
7. Pub. 15-T rounding is **permissive, not mandatory**. See §22.
8. Pub. 15-T cannot be used where the 37% mandatory flat rate applies or the 22% optional flat rate
   is used for supplemental wages; those rules live in Pub. 15 section 7.

### 0.4 Authority order

1. Official IRS publications and forms for the applicable tax year.
2. `docs/SPECIFICATION.md`, `CLAUDE.md`, `docs/CALCULATION-ENGINE.md`, `docs/DEVELOPMENT.md`.
3. This document.

If this document ever appears to contradict (1) or (2), (1) or (2) wins and this document is the
defect.

---

## 1. PHASE 4 OBJECTIVE AND SCOPE

### 1.1 Objective

Build the Federal Tax Engine: the layer that consumes the Phase 2 versioned rule/data system and
runs inside the Phase 3 calculation pipeline to produce accurate, transparent, reproducible federal
payroll tax results for a single pay period.

### 1.2 The four tracks — a distinction the whole design rests on

The brief requires these be clearly separated. They are separate code paths, separate rule
categories, separate result fields and separate trace stages.

| Track | Name | Purpose | Data source | Appears in paycheck? |
|---|---|---|---|---|
| **A** | Annual federal income tax **liability estimation** | Optional "annual estimate" and "effective tax rate" display | Annual standard deduction + annual 1040 marginal rate brackets | **No.** Never reduces net pay. Display only, clearly labelled as an estimate. |
| **B** | Federal income tax **payroll withholding** | The actual amount withheld from this paycheck | IRS Pub. 15-T withholding rate schedules + W-4 + pay period | **Yes.** This is the employee's FIT deduction. |
| **C** | **FICA** — Social Security, Medicare, Additional Medicare | Employee withholding + employer liability | Rates, wage base, threshold | Employee portions yes; employer portions to employer cost only |
| **D** | **Employer federal payroll taxes** — employer SS, employer Medicare, FUTA | Employer cost of employment | Rates, wage bases, credits | **Never** as an employee deduction |

**Hard rule:** Track A must never feed Track B. The annual 1040 brackets supplied in the brief are
*not* the Pub. 15-T withholding rate schedules and must never be substituted for them. They are
different tables with different column semantics, different amounts and different purposes. A test
enforces that the schedule loaded by Track B cites Pub. 15-T as its source document (§35.4).

### 1.3 In scope

- Federal income tax withholding via Pub. 15-T Worksheet 1A (percentage method, automated systems)
- Supplemental wage withholding (aggregate / optional flat / mandatory flat)
- Social Security employee and employer
- Medicare employee and employer
- Additional Medicare Tax (employee only)
- FUTA (employer only)
- Federal taxable wage buckets and deduction-taxability integration
- Annual wage-base and YTD handling
- Federal rule resolution, versioning, effective dates, status filtering
- Federal calculation trace and snapshot contribution
- Federal validation, error and unsupported-scenario behaviour
- Federal rule categories, detail structures and source traceability
- Admin requirements **for federal rule data entry** (requirements only — Phase 8 builds the UI)
- Federal test strategy including golden tests
- Documentation

### 1.4 Out of scope (later phases)

State income tax, state withholding, SDI, paid family leave, SUTA, local taxes, reciprocity,
locality resolution, calculator frontend, admin dashboard implementation, reports/PDF, SEO,
monetization, API billing, authentication, production deployment.

### 1.5 Explicitly deferred federal work (recorded so it is never silently skipped)

| Item | Reason | Behaviour in Phase 4 |
|---|---|---|
| Pub. 15-T sections 2–3 (manual wage-bracket tables) | Manual-system method; bounded wage range | Not implemented |
| Pub. 15-T sections 4–5 (manual percentage method) | Superseded by Worksheet 1A for automated systems | Not implemented |
| Pub. 15-T section 6 (annualized, average estimated, cumulative, part-year, term of continuous employment) | Alternative employer elections | `UNSUPPORTED_SCENARIO` |
| Worksheet 1B / Form W-4P (pensions and annuities) | Not paycheck | `UNSUPPORTED_SCENARIO` |
| Pub. 15-T section 7 (Indian gaming profit distributions) | Not paycheck | Not implemented |
| Nonresident alien wage addition | Needs careful handling; India carve-out unresolved | Modelled, feature-flagged OFF, returns `UNSUPPORTED_SCENARIO` (§7.8) |
| Pre-2020 W-4 computational bridge | Worksheet 1A handles pre-2020 forms natively | Constants stored, not applied (§7.10) |
| FUTA credit reduction states | Cross-cuts into state data | Modelled, feature-flagged OFF, standard credit only, disclosed in trace (§18.6) |
| FICA/FUTA statutory exceptions (household, agricultural, student, clergy, statutory employees) | Cannot be determined from calculator inputs | `UNSUPPORTED_SCENARIO` for the affected component |
| Backup withholding, section 3121(q) tip notices, lock-in letters | Employer filing concerns, not estimation | Not implemented |

### 1.6 Phase discipline

Phase 4 ends with implementation, test, verify, report, **STOP**. No Phase 5 work of any kind.

---

## 2. FEDERAL TAX ARCHITECTURE

### 2.1 Module layout (inside the single integrated application)

```
/lib/tax/federal/
  index.ts                      calculateFederalTaxes(context) — pure, sync
  types.ts                      federal-only types; no React, no Prisma client
  context.ts                    FederalCalculationContext assembly
  ruleKeys.ts                   the ONLY place federal rule keys are written
  rules/
    resolveFederalRuleSet.ts    async, I/O — the only impure file
    federalRuleSet.ts           ResolvedFederalRuleSet type + invariants
    detailSchemas.ts            zod schemas for every federal rule detail shape
  fit/
    worksheet1A.ts              line-for-line transcription of Worksheet 1A
    rateSchedule.ts             column A/B/C/D row lookup
    payPeriods.ts               Table 3 periods-per-year resolution
    supplemental.ts             aggregate / optional flat / mandatory flat
    nraAdjustment.ts            flagged OFF
    annualLiability.ts          TRACK A ONLY — display estimate, never withholding
  fica/
    socialSecurity.ts
    medicare.ts
    additionalMedicare.ts
  employer/
    futa.ts
    employerCosts.ts            assembles employer-side totals
  wages/
    federalWageBuckets.ts
  rounding/
    federalRounding.ts
  trace/
    federalTrace.ts
  errors/
    federalErrors.ts
```

### 2.2 Layering rules (non-negotiable, enforced by lint rule + test)

1. `/lib/tax/federal/**` must not import from `/app/**` or `/components/**`.
2. `/lib/tax/federal/**` must not execute a database query. The only file permitted to touch the
   rule provider is `rules/resolveFederalRuleSet.ts`.
3. Once the rule set is resolved, the engine is **pure and synchronous**. No `Date.now()`, no
   `Math.random()`, no `process.env`, no locale-dependent formatting.
4. **No federal tax value, rate, threshold, wage base or bracket amount may appear as a literal**
   anywhere under `/lib/tax/federal/**`. Enforced by a scanner test (§35.4).
5. The frontend never owns a federal rule. It renders results and traces only.

### 2.3 Two-stage shape

```
STAGE A — impure, async, I/O boundary        STAGE B — pure, deterministic
──────────────────────────────────────       ────────────────────────────────────
resolveFederalRuleSet({                      calculateFederalTaxes(
  taxYear, effectiveDate,                      context: FederalCalculationContext
  jurisdictionKey, requiredKeys              ): FederalTaxResult
}): ResolvedFederalRuleSet | MissingRules
```

This split is what makes the engine (a) unit-testable with zero database, (b) fast — one resolution
per calculation, (c) **reproducible**: re-running Stage B against the rule set persisted in a
historical snapshot must reproduce that historical result byte-for-byte, forever, regardless of what
has since been published.

### 2.4 `ResolvedFederalRuleSet`

```
ResolvedFederalRuleSet {
  taxYear: number
  effectiveDate: Date
  jurisdiction: { id, key: 'US', type: 'FEDERAL' }
  engineVersion: string
  resolvedAt: Date                  // metadata only — never used in arithmetic
  entries: ReadonlyMap<FederalRuleKey, ResolvedRuleEntry>
}

ResolvedRuleEntry {
  ruleKey, ruleId, ruleVersionId,
  category: RuleCategory,
  status: RuleStatus,                 // must be a live status (§24.5)
  verificationStatus: VerificationStatus,
  effectiveFrom: Date,
  effectiveTo: Date | null,
  sourceIds: string[],
  detail: FederalRuleDetail           // discriminated union, zod-validated
}
```

`entries` is frozen. The engine reads by key and **never** falls back to a default, a previous year,
or zero.

### 2.5 Canonical federal rule keys

`ruleKeys.ts` is the single source of truth. Every key below has a row in Appendix A or B.

```
FED.FIT.RATE_SCHEDULE.ANNUAL.STANDARD
FED.FIT.RATE_SCHEDULE.ANNUAL.STEP2_CHECKBOX
FED.FIT.W4.STEP2_UNCHECKED_ADJUSTMENT        Worksheet 1A line 1g
FED.FIT.W4.ALLOWANCE_VALUE                   Worksheet 1A line 1k
FED.FIT.PAY_PERIODS_PER_YEAR                 Worksheet 1A Table 3
FED.FIT.ROUNDING_POLICY
FED.FIT.NRA_WAGE_ADDITION.PRE2020            Pub 15-T Table 1
FED.FIT.NRA_WAGE_ADDITION.POST2019           Pub 15-T Table 2
FED.FIT.COMPUTATIONAL_BRIDGE                 stored, not applied
FED.SUPP.OPTIONAL_FLAT_RATE
FED.SUPP.MANDATORY_FLAT_RATE
FED.SUPP.MANDATORY_THRESHOLD
FED.SS.EMPLOYEE_RATE
FED.SS.EMPLOYER_RATE
FED.SS.WAGE_BASE
FED.MEDICARE.EMPLOYEE_RATE
FED.MEDICARE.EMPLOYER_RATE
FED.MEDICARE.WAGE_BASE                       explicit NOT_APPLICABLE record (§14.3)
FED.ADDL_MEDICARE.EMPLOYEE_RATE
FED.ADDL_MEDICARE.WITHHOLDING_THRESHOLD
FED.FUTA.GROSS_RATE
FED.FUTA.STANDARD_CREDIT
FED.FUTA.WAGE_BASE
FED.FUTA.CREDIT_REDUCTION.{STATE}            modelled, flagged OFF
FED.ANNUAL.STANDARD_DEDUCTION                TRACK A ONLY
FED.ANNUAL.PERSONAL_EXEMPTION                TRACK A ONLY
FED.ANNUAL.RATE_BRACKETS                     TRACK A ONLY
```

Track A keys are namespaced `FED.ANNUAL.*` and Track B keys `FED.FIT.*` precisely so that a
mis-wiring between them is visible at a glance in code review and detectable by test.

### 2.6 Internal order of operations

```
 1. assertFederalRuleSetComplete(requiredKeys)      → INCOMPLETE if any missing (§28)
 2. deriveFederalWageBuckets()                      → §19
 3. classifyWages(regular vs supplemental)          → §5.6
 4. resolvePayPeriodsPerYear()                      → §20
 5. computeFederalWithholding_regular()             → §5
 6. computeFederalWithholding_supplemental()        → §5.6
 7. computeSocialSecurityEmployee / Employer        → §13
 8. computeMedicareEmployee / Employer              → §14
 9. computeAdditionalMedicareEmployee               → §15
10. computeFutaEmployer                             → §18
11. computeAnnualLiabilityEstimate()  [flagged]     → §4
12. applyFederalRounding()                          → §22
13. assertFederalInvariants()                       → §28.5
14. buildFederalTrace()                             → §27
```

Steps 5–11 are mutually independent given the buckets. None may read another's output. This
independence is itself a test invariant.

---

## 3. FEDERAL RULE-RESOLUTION FLOW

### 3.1 Flow

```
calculation request
   ↓
resolveTaxYear(payDate | explicit taxYear)                    §23.2
   ↓
resolveEffectiveDate(payDate)                                 §23.3
   ↓
resolveJurisdiction → FEDERAL ('US')
   ↓
buildRequiredKeyList(scenario)                                §3.2
   ↓
ruleProvider.resolveMany({ taxYear, effectiveDate,
                           jurisdiction, keys })               ← Phase 2 abstraction ONLY
   ↓
filter by live RuleStatus                                     §24.5
   ↓
assert exactly one effective version per key                  §3.4
   ↓
validate each detail against its zod schema                   §6.5
   ↓
freeze → ResolvedFederalRuleSet
   ↓
calculateFederalTaxes(context)                                pure
```

### 3.2 Required-key list is scenario-dependent

The required set is computed from the scenario, not fixed, so that an unused rule's absence never
blocks a valid calculation:

| Condition | Keys added to required set |
|---|---|
| Always | SS employee/employer/wage base; Medicare employee/employer/wage-base record; Additional Medicare rate + threshold; pay periods; rounding policy |
| FIT withholding requested and not exempt | Rate schedule (STANDARD or STEP2_CHECKBOX for the filing status); line 1g adjustment |
| W-4 revision is 2019-or-earlier | Allowance value |
| Supplemental wages present | Supplemental rates + threshold |
| Employer costs requested | FUTA gross rate, standard credit, wage base |
| Annual estimate requested (Track A) | Standard deduction, personal exemption, annual rate brackets |
| NRA flag on (future) | NRA wage addition table |

### 3.3 One resolution per calculation

`resolveMany` is called **once**. Per-component lazy resolution is forbidden: it multiplies queries,
and worse, it creates a window in which two components could resolve against different rule
versions if data changes mid-calculation. **PENDING DECISION D-RES-1:** confirm the Phase 2 rule
provider exposes a batch resolve; if it only resolves one key at a time, add a batch method
additively rather than looping (looping is acceptable as a temporary shim only if wrapped in a
single transaction/read snapshot).

### 3.4 Ambiguity is an error, never a preference

For a given (taxYear, jurisdiction, ruleKey, effectiveDate), exactly one live rule version must
apply. Behaviour:

| Matches | Result |
|---|---|
| Exactly 1 | Proceed |
| 0 | `INCOMPLETE` with the missing key named (§28.2) |
| 2+ | `RULE_CONFLICT` with all candidate rule IDs and their effective ranges named |

The engine must never break a tie by `createdAt`, by "most recent", by status precedence, or by any
other heuristic. Overlapping effective ranges are a **data defect** and must be prevented by the
publish gate (§32) and surfaced loudly if they ever reach runtime.

### 3.5 No direct database access from the engine

Federal calculation functions never import Prisma, never write SQL, never read a table. This is
enforced by an import-boundary test.

---

## 4. FEDERAL INCOME-TAX CALCULATION (TRACK A — ANNUAL LIABILITY ESTIMATION)

### 4.1 Purpose and warnings

Track A exists solely to support the product's "annual estimate" and "effective tax rate" displays
(master spec §10). It is a **projection**, not a withholding calculation and not a tax return.

**It must never influence net pay, withholding, FICA or employer cost.** A test asserts that
disabling Track A leaves every other federal output bit-identical.

### 4.2 Component definition

| Aspect | Definition |
|---|---|
| **Inputs** | Projected annual federal-income-taxable wages; filing status; (optionally) annualized pre-tax deductions already reflected in the wage projection |
| **Required rule data** | `FED.ANNUAL.STANDARD_DEDUCTION` (by filing status), `FED.ANNUAL.PERSONAL_EXEMPTION`, `FED.ANNUAL.RATE_BRACKETS` (by filing status) |
| **Formula** | `taxableIncome = max(projectedAnnualWages − standardDeduction − personalExemption, 0)`; then progressive application of the annual marginal brackets |
| **Output** | `annualFederalIncomeTaxEstimate`, `effectiveFederalRateEstimate` — both flagged `isEstimate: true` |
| **Rounding** | Full Decimal precision internally; round to 2 dp for display only |
| **Effective-date behaviour** | Resolved for the calculation's tax year like any other rule |
| **Source requirements** | Annual inflation-adjustment revenue procedure for the tax year plus the relevant IRS annual publication. Source must be recorded; the source must **not** be Pub. 15-T |
| **Verification status** | `PENDING_VERIFICATION` — see Appendix B rows B-01…B-05 |
| **Error behaviour** | If any Track A rule is missing, Track A returns `NOT_AVAILABLE` and the rest of the federal result still completes as `COMPLETE`. Track A is never allowed to fail the paycheck. |
| **Test requirements** | Bracket boundary tests; zero-income; income below the standard deduction; filing-status variation; a test asserting Track A output never appears in `employeeTaxes` or `netPay`; a test asserting the loaded brackets' source is **not** Pub. 15-T |

### 4.3 Head of Household

The brief supplies annual bracket thresholds for Single and MFJ only. **HoH and MFS annual bracket
thresholds are `PENDING DATA` (Appendix A, rows A-20/A-21).** Until entered, Track A must return
`NOT_AVAILABLE` for those filing statuses rather than borrowing the Single table. Borrowing would be
invention.

### 4.4 Deliberate limitations to disclose in the UI (Phase 9)

Track A ignores credits, other income, itemized deductions, other household income, QBI, and the new
OBBBA deductions. It is a wages-only projection. The disclosure text is a Phase 9 deliverable but the
**flag and the limitation list are produced by Phase 4** so the frontend cannot overstate it.

---

## 5. FEDERAL WITHHOLDING CALCULATION (TRACK B — THE PAYCHECK NUMBER)

### 5.1 Decision D-FIT-1 — method selection (RECOMMENDED)

**Use Publication 15-T Section 1 — Percentage Method Tables for Automated Payroll Systems,
Worksheet 1A — as the sole production method for regular-wage federal income tax withholding.**

Rationale:

1. Pub. 15-T states this method works for Forms W-4 of all prior, current and future years and for
   any amount of wages. The manual wage-bracket tables are bounded by wage range and return nothing
   above the top row.
2. DoPayCheck is an automated system; Section 1 is the section written for automated payroll systems.
3. It requires only the **annual** rate schedules — two schedule sets × filing statuses — instead of
   a table per pay frequency. This cuts the annual data-entry burden by roughly an order of magnitude
   and correspondingly cuts entry-error surface. That directly serves the "annual update from the
   admin dashboard without code changes" requirement.
4. It handles 2020-or-later and 2019-or-earlier Forms W-4 natively in one worksheet.

### 5.2 Component definition

| Aspect | Definition |
|---|---|
| **Inputs** | `federalIncomeTaxWages` for the period; pay frequency; W-4 fields (§7); W-4 revision |
| **Required rule data** | `FED.FIT.RATE_SCHEDULE.ANNUAL.{STANDARD\|STEP2_CHECKBOX}` for the filing status; `FED.FIT.W4.STEP2_UNCHECKED_ADJUSTMENT`; `FED.FIT.PAY_PERIODS_PER_YEAR`; `FED.FIT.W4.ALLOWANCE_VALUE` (pre-2020 W-4 only) |
| **Formula** | Worksheet 1A, transcribed line-for-line — §5.3 |
| **Output** | `federalIncomeTaxWithheld` (employee deduction) |
| **Rounding** | §22 |
| **Effective-date behaviour** | §23 |
| **Source requirements** | Pub. 15-T for the tax year; page, section, worksheet/table and heading recorded per §25 |
| **Verification status** | Rate schedules: `PENDING DATA` (Appendix A A-01…A-06). Line 1g and allowance value: `PENDING_VERIFICATION` (Appendix B B-06, B-07) |
| **Error behaviour** | §28 |
| **Test requirements** | §33, §34 |

### 5.3 Worksheet 1A as an algorithm

Implement as a **line-for-line transcription**. Each worksheet line becomes a named intermediate that
appears in the trace. Do not simplify the algebra — the line correspondence is what makes output
auditable against the IRS worksheet and what makes future-year maintenance safe.

```
STEP 1 — Adjust the employee's payment amount
  1a  periodTaxableWages        ← federalIncomeTaxWages this period (§19)
  1b  payPeriodsPerYear         ← Table 3 (§20)
  1c  annualizedWages           ← 1a × 1b

  IF w4Revision = 2020_OR_LATER:
    1d  step4aOtherIncomeAnnual
    1e  1c + 1d
    1f  step4bDeductionsAnnual
    1g  step2UncheckedAdjustment  ← 0 if Step 2 box checked,
                                    else filing-status-dependent amount [B-06]
    1h  1f + 1g
    1i  adjustedAnnualWageAmount  ← max(1e − 1h, 0)
  ELSE (2019_OR_EARLIER):
    1j  allowancesClaimed
    1k  1j × allowanceValue       [B-07]
    1l  adjustedAnnualWageAmount  ← max(1c − 1k, 0)

STEP 2 — Tentative Withholding Amount
  scheduleType   = step2Checked ? STEP2_CHECKBOX : STANDARD
  scheduleFiling = W-4 Step 1(c) status (pre-2020: marital status;
                   Head of Household table MUST NOT be used — §8.4)
  2a  adjustedAnnualWageAmount (1i or 1l)
  2b  column A of the row where A ≤ 2a < B
  2c  column C of that row
  2d  column D of that row
  2e  2a − 2b
  2f  2e × 2d
  2g  2c + 2f                     (tentative ANNUAL withholding)
  2h  2g ÷ 1b                     (per pay period)

STEP 3 — Account for tax credits
  3a  step3CreditsAnnual          (0 for pre-2020 W-4)
  3b  3a ÷ 1b
  3c  max(2h − 3b, 0)

STEP 4 — Final amount to withhold
  4a  step4cExtraPerPeriod        (pre-2020: line 6)
  4b  federalIncomeTaxWithheld ← 3c + 4a
```

### 5.4 Invariants (enforced in code, each with a test)

| ID | Invariant |
|---|---|
| FIT-INV-1 | Lines 1i / 1l floor at zero |
| FIT-INV-2 | Line 3c floors at zero — credits can zero withholding, never make it negative |
| FIT-INV-3 | Step 4(c) only increases withholding; 4b ≥ 4a ≥ 0 |
| FIT-INV-4 | Exactly one rate-schedule row may match line 2a. Zero or multiple matches ⇒ `RULE_CONFLICT`, never a silent pick |
| FIT-INV-5 | The top row of every schedule must be open-ended (`lessThan = null`). A bounded top row is invalid data, rejected at publish time |
| FIT-INV-6 | Rows are half-open `A ≤ x < B`, contiguous, no gaps, no overlaps. Validated at publish and re-asserted at resolution |
| FIT-INV-7 | Never interpolate between rows |
| FIT-INV-8 | Never cap withholding at a "plausible" percentage of gross |

### 5.5 Exemption from withholding (new 2026 checkbox)

- `w4.claimsExemption = true` ⇒ Worksheet 1A is skipped; FIT on regular wages = 0; the trace states
  the exemption explicitly.
- FICA and FUTA are **unaffected**. Dedicated test.
- Mandatory flat-rate supplemental withholding still applies once the supplemental threshold is
  crossed (§5.6) — this is the "certain supplemental wages" carve-out in Pub. 15-T.
- **PENDING DECISION D-FIT-2:** how to treat a Step 4(c) amount entered by an employee who also
  claims exemption. Options: (a) honour it, (b) reject as `INVALID_INPUT`. Must be resolved against
  Pub. 15 section 9 before implementation. Do **not** silently drop it.

### 5.6 Supplemental wages

Supplemental wages (bonuses, commissions, tips treated as supplemental, overtime treated as
supplemental, severance, awards, back pay, retroactive increases, and similar) follow Pub. 15
section 7, not Worksheet 1A.

Three methods must be modelled explicitly as an enum, never as a default rate:

| Method | When it applies | Calculation |
|---|---|---|
| `MANDATORY_FLAT` | YTD supplemental wages exceed the statutory threshold | Threshold-crossing portion at the mandatory flat rate. Applies even to an employee claiming W-4 exemption |
| `OPTIONAL_FLAT` | Supplemental identified separately **and** the eligibility conditions are met | Optional flat rate applied to the supplemental amount |
| `AGGREGATE` | Default; always permitted | Combine supplemental with regular wages for the period and run Worksheet 1A on the combined amount, then subtract the withholding attributable to the regular wages alone |

Required modelling rules:

1. `supplementalMethod` is an explicit input/decision recorded in the trace — never inferred silently.
2. **Optional-flat eligibility is a condition, not an assumption.** The optional flat rate may be
   used only where income tax was withheld from the employee's regular wages in the current or
   preceding year and the payment is identified separately. The engine must model
   `federalIncomeTaxWithheldFromRegularWagesCurrentOrPriorYear: boolean` and must refuse the optional
   flat method when it is false. **PENDING VERIFICATION** of the complete condition list against
   Pub. 15 section 7.
3. The mandatory threshold is cumulative YTD supplemental wages, so `ytdSupplementalWages` is a
   required input whenever supplemental wages are present.
4. Crossing the threshold mid-payment splits the payment: the portion at or below the threshold uses
   the elected method, the excess uses the mandatory flat rate. This split must be explicit in the
   trace.
5. **No generic "bonus rate" may ever be invented.** Rates and threshold come from rule data
   (Appendix B B-13…B-15, `PENDING_VERIFICATION`).
6. **PENDING DECISION D-SUPP-1:** the product default when the user does not choose. Recommendation:
   default to `AGGREGATE` (always legally permitted, no eligibility conditions) and let Phase 9 offer
   the flat method explicitly with its conditions shown. Rejected alternative: defaulting to the
   optional flat rate, which is what most consumer calculators do and which is wrong whenever the
   eligibility conditions are not met.

### 5.7 What must never happen

- Substituting the annual 1040 brackets (Track A) for the Pub. 15-T rate schedules.
- Deriving a "withholding table" arithmetically from the annual brackets and standard deduction.
  The IRS schedules are not a mechanical transformation of the 1040 brackets and must be entered
  from Pub. 15-T as published.
- Approximating a missing schedule row.

---

## 6. IRS PUBLICATION 15-T INTEGRATION AND DATA MODEL

### 6.1 The core data-shape problem

Most DoPayCheck rules are scalars (a rate, a wage base). A Pub. 15-T rate schedule is a **table of
rows with four columns**, and there are (schedule types × filing statuses) of them per tax year. A
generic `value`/`valueType` scalar rule cannot hold this without losing validation and queryability.

### 6.2 Decision D-SCHEMA-1 — how to store rate schedules (RECOMMENDED)

**Store rate schedules relationally: a schedule header row plus child bracket rows.**

```
FederalWithholdingSchedule
  id
  ruleId                → Rule (carries status, versioning, effective dates, sources)
  taxYear               Int
  method                Enum  PERCENTAGE_AUTOMATED (Worksheet 1A)
  scheduleType          Enum  STANDARD | STEP2_CHECKBOX
  filingStatus          Enum
  payPeriodBasis        Enum  ANNUAL
  createdAt / updatedAt

FederalWithholdingScheduleRow
  id
  scheduleId            → FederalWithholdingSchedule (cascade)
  rowOrder              Int
  atLeast               Decimal(18,6)   column A
  lessThan              Decimal(18,6)?  column B — NULL on the final row
  baseAmount            Decimal(18,6)   column C
  ratePercent           Decimal(9,6)    column D
  @@unique([scheduleId, rowOrder])
  @@index([scheduleId, atLeast])
```

Rationale:
1. Row-level validation (contiguity, no overlap, open-ended top row) is expressible as a database
   constraint plus a deterministic validator, and can run in the publish gate.
2. Admin data entry (Phase 8) becomes a table editor with per-row validation and per-row diffing,
   which is exactly what an annual update is.
3. Diffing two tax years row by row is trivial — essential for the clone-and-verify workflow (§39).
4. A malformed JSON blob can be published and only fail at calculation time; malformed rows cannot.

**Rejected alternative:** typed JSON on the `Rule` model. Cheaper migration, but moves all structural
validation to application code, makes admin diffing and row-level audit much weaker, and makes the
"conflict/contiguity" checks harder to run in the publish gate.

**PENDING DECISION D-SCHEMA-2:** if the Phase 2 `Rule` model already stores structured detail as
validated JSON with an established zod-schema registry, follow that existing pattern instead — the
project rule "do not redesign Phase 1–3" outranks this recommendation. Confirm before migrating.

### 6.3 Other federal rule detail shapes

| Shape | Fields | Used by |
|---|---|---|
| `RATE` | `ratePercent Decimal(9,6)`, `appliesTo EMPLOYEE\|EMPLOYER` | SS, Medicare, Additional Medicare, FUTA, supplemental flat rates |
| `WAGE_BASE` | `amount Decimal(18,6)`, `basis ANNUAL`, `applicability` | SS, FUTA |
| `THRESHOLD` | `amount Decimal(18,6)`, `basis ANNUAL_YTD`, `inclusive Boolean` | Additional Medicare, supplemental mandatory |
| `AMOUNT_BY_FILING_STATUS` | map filingStatus → `Decimal(18,6)` | Worksheet 1A line 1g, standard deduction (Track A) |
| `AMOUNT_BY_PAY_PERIOD` | map payFrequency → `Decimal(18,6)` | NRA wage addition tables |
| `COUNT_BY_PAY_PERIOD` | map payFrequency → `Int` | Worksheet 1A Table 3 |
| `SCALAR_AMOUNT` | `Decimal(18,6)` | allowance value, personal exemption |
| `POLICY` | structured enum payload | rounding policy |
| `BRACKET_TABLE` | rows of `{ atLeast, lessThan, ratePercent }` | Track A annual brackets |

Note `BRACKET_TABLE` (Track A) and `FederalWithholdingScheduleRow` (Track B) are **deliberately
different shapes**. Track A brackets have no "base amount" column. Making them share a type would
invite exactly the substitution error this project forbids.

### 6.4 Precision

| Quantity | Storage |
|---|---|
| Money | `Decimal(18,6)` in the database; Decimal type in code; **never** `Float`/`Double`/JS `number` |
| Rates | `Decimal(9,6)` stored as a percent (e.g. six point two zero) with the unit recorded explicitly |
| Counts | `Int` |

**Rate unit discipline:** every rate rule record carries an explicit `unit` field (`PERCENT` or
`DECIMAL_FRACTION`). A percent/fraction mix-up is a 100× error. The engine converts once, at the
detail-schema boundary, and a test asserts the conversion.

### 6.5 Validation at resolution time

Every resolved federal detail is parsed through its zod schema at the Stage A/Stage B boundary. A
detail that fails parsing is a `RULE_CONFLICT`-class data defect, reported with the rule ID — not a
crash, not a coercion, not a default.

### 6.6 What is NOT modelled from Pub. 15-T in Phase 4

Wage-bracket tables (sections 2–3), manual percentage tables (sections 4–5), alternative methods
(section 6), Worksheet 1B / Form W-4P, and Indian gaming distribution tables. The schema does not
preclude them; the `method` enum on `FederalWithholdingSchedule` is the extension point.

---

## 7. W-4 HANDLING

### 7.1 Input model — 2020-or-later Form W-4

| Field | Type | Required | Default | Unit | Notes |
|---|---|---|---|---|---|
| `w4Revision` | `2020_OR_LATER` \| `2019_OR_EARLIER` | yes | `2020_OR_LATER` | — | Selects the 1d–1i vs 1j–1l path |
| `filingStatus` | FilingStatus | yes | `SINGLE_OR_MFS` | — | Step 1(c) |
| `step2MultipleJobsChecked` | boolean | yes | `false` | — | Selects the STEP2_CHECKBOX schedule and zeroes line 1g |
| `step3CreditsAnnual` | Decimal ≥ 0 | no | 0 | **annual** | Step 3 total |
| `step4aOtherIncomeAnnual` | Decimal ≥ 0 | no | 0 | **annual** | Step 4(a) |
| `step4bDeductionsAnnual` | Decimal ≥ 0 | no | 0 | **annual** | Step 4(b) |
| `step4cExtraPerPeriod` | Decimal ≥ 0 | no | 0 | **per pay period** | Step 4(c) |
| `claimsExemption` | boolean | yes | `false` | — | **New 2026 checkbox below Step 4(c)** |
| `isNonresidentAlien` | boolean | yes | `false` | — | Drives §7.8 |

### 7.2 Input model — 2019-or-earlier Form W-4

| Field | Type | Required | Unit |
|---|---|---|---|
| `maritalStatus` | `SINGLE` \| `MARRIED` \| `MARRIED_HIGHER_SINGLE_RATE` | yes | — |
| `allowances` | Int ≥ 0 | yes | count |
| `additionalPerPeriod` | Decimal ≥ 0 | no | per pay period |

### 7.3 Units discipline (the most common bug in this area)

Steps 3, 4(a), 4(b), line 1g and the allowance value are **annual**. Step 4(c) is **per pay period**.

**Requirement:** branded/nominal types `AnnualAmount` and `PerPeriodAmount`. Passing one where the
other is expected must be a **compile error**, not a runtime check and not a naming convention.

### 7.4 Defaults when no W-4 is furnished

Pub. 15-T: a new employee who fails to furnish a Form W-4 is treated as having checked Single or
Married filing separately in Step 1(c), with no entries in Steps 2, 3 or 4. The defaults in §7.1
match this, and the default rule itself must be **stored in rule data with a Pub. 15-T source**, not
hardcoded, so a future change to the default is a data change.

### 7.5 Validation

| Rule | Failure |
|---|---|
| All monetary W-4 fields ≥ 0 | `INVALID_INPUT` |
| `allowances` is a non-negative integer | `INVALID_INPUT` |
| HoH with a 2019-or-earlier W-4 | `INVALID_INPUT` (§8.4) |
| Values exceeding a sanity ceiling (§36.4) | `INVALID_INPUT` |
| `claimsExemption` + `step4cExtraPerPeriod > 0` | **PENDING DECISION D-FIT-2** |
| Fields for the wrong W-4 revision supplied | `INVALID_INPUT` — do not silently ignore |

### 7.6 Fields deliberately NOT modelled

- "Number of jobs" — not on the form; the engine has no use for it.
- "Number of dependents" / "number of qualifying children" — see §10.2.
- "Spouse income" — not on the form's employer-facing data.

Adding any of these would be inventing employer behaviour the IRS does not prescribe.

### 7.7 W-4 fields vs Phase 3 input

**PENDING DECISION D-W4-1:** Phase 3 already carries some W-4 inputs. Phase 4 must **extend the
existing W-4 input object additively** and must not create a parallel federal-only W-4 type. Where
Phase 3 named a field differently, keep the Phase 3 name and adapt inside the federal engine.
New fields expected to be required for 2026: `claimsExemption`, `w4Revision`, `isNonresidentAlien`.
Each is marked `PENDING PHASE 4 IMPLEMENTATION` until confirmed present.

### 7.8 Nonresident alien employees — D-FIT-3 (PENDING DECISION)

Pub. 15-T requires adding a payroll-period-specific amount to an NRA employee's wages before using
the withholding tables — Table 1 for pre-2020 Forms W-4, Table 2 for 2020-or-later. The addition:
does not affect Social Security, Medicare or FUTA; is not reported on Form W-2; does not increase the
employee's income tax liability; does not apply to supplemental wage payments taxed at the flat
rates; and does not apply to nonresident alien students and business apprentices from India.

**Recommendation:** model `isNonresidentAlien` and store both tables in rule data now (cheap, and
they are published), but gate the calculation behind feature flag `FEDERAL_NRA_ADJUSTMENT`, **OFF in
Phase 4**. With the flag off, `isNonresidentAlien = true` returns `UNSUPPORTED_SCENARIO`. The India
carve-out must be resolved before the flag is ever switched on. A half-correct NRA path is worse than
an honest refusal.

### 7.9 OBBBA qualified tips and qualified overtime — D-FIT-5 (**RESOLVED**)

> **STATUS: RESOLVED — V-01 verified against the official 2026 Form W-4 on 2026-09-13.**
>
> **Verified finding.** There is **no new dedicated W-4 field** for the OBBBA qualified tips or
> qualified overtime deductions. They are entered through the **Step 4(b) Deductions Worksheet**:
> qualified tips on **line 1a**, qualified overtime compensation on **line 1b**. The worksheet total
> flows into **Step 4(b)** on the face of the form.
>
> **Consequence:** the existing `step4bDeductionsAnnual` field (spec §7.1) represents these
> deductions in full. **No new W-4 field, no new input model field and no schema change is required
> for OBBBA tips or overtime.** Creating one would duplicate Step 4(b) and is forbidden.
>
> **Source:** 2026 Form W-4, Step 4(b) — Deductions Worksheet, lines 1a and 1b. Corroborated by IRS
> Publication 15-T (2026), *What's New*, which states that employees use the updated 2026 Form W-4 to
> account for the expected qualified tips and qualified overtime deductions through withholding.
> **Verification status:** `VERIFIED` (owner-verified against the official form, 2026-09-13).
> Record as a Source record against `IRS-W4-2026` with page and worksheet line locators at data-entry
> time.

**The engine must not deduct qualified tips or qualified overtime from any federal wage bucket.**

Per Pub. 15-T (2026), these are deductions the individual takes **on the income tax return**. The
payroll mechanism is that the employee reports the expected deduction **on their Form W-4**; the
employer then applies the ordinary Pub. 15-T procedures. Tips and qualified overtime remain subject
to both the employee and employer shares of Social Security and Medicare tax.

Consequences:

1. No new FIT calculation path for tips or overtime is required or permitted.
2. `socialSecurityWages` and `medicareWages` include tips and qualified overtime **in full**. The
   Step 4(b) amount reduces only the **annual wage amount used by Worksheet 1A** (line 1f), never a
   wage bucket. A named test asserts that a Step 4(b) amount leaves Social Security, Medicare,
   Additional Medicare and FUTA outputs bit-identical.
3. **No separate wage-bucket deduction mechanism may be invented for OBBBA deductions.** There is
   exactly one path: the employee's Step 4(b) amount, consumed at Worksheet 1A line 1f.
4. A Phase 9 UI helper that estimates a Step 4(b) amount from expected tips/overtime is **future
   work**, explicitly not Phase 4.
5. Employer reporting obligations (Forms W-2/1099, Treasury Tipped Occupation Codes, Notice 2025-62
   transition relief) are out of scope — DoPayCheck estimates, it does not file.

### 7.10 Computational bridge — D-FIT-4 (PENDING DECISION)

Pub. 15-T offers an optional computational bridge to treat 2019-and-earlier Forms W-4 as 2020-or-later
forms. Worksheet 1A already handles pre-2020 forms natively via lines 1j–1l, so the bridge is **not
needed for calculation**. Recommendation: do not apply it in Phase 4; store the bridge constants in
rule data marked `PENDING` for a possible future employer tool.

---

## 8. FILING-STATUS HANDLING

### 8.1 Canonical statuses

| Engine status | W-4 Step 1(c) | Track B schedule | Track A brackets |
|---|---|---|---|
| `SINGLE_OR_MFS` | Single or Married filing separately | yes | Single thresholds supplied; **MFS `PENDING DATA`** |
| `MARRIED_FILING_JOINTLY` | Married filing jointly (or qualifying surviving spouse) | yes | supplied |
| `HEAD_OF_HOUSEHOLD` | Head of household | yes | **`PENDING DATA`** |

**PENDING DECISION D-FS-1:** the W-4 combines Single and MFS into one Step 1(c) choice, but the
annual 1040 brackets treat them as distinct filing statuses with different thresholds above a point.
Recommendation: keep **one** status for Track B (matching the form) and require a **separate,
explicit** Track A filing status input if Track A is enabled for MFS. Do **not** let Track A silently
assume Single for an MFS taxpayer.

### 8.2 Mapping from a 2019-or-earlier W-4

| Legacy marital status | Mapped |
|---|---|
| Single | `SINGLE_OR_MFS` |
| Married, but withhold at higher single rate | `SINGLE_OR_MFS` |
| Married | `MARRIED_FILING_JOINTLY` |

### 8.3 Where filing status is and is not used

| Component | Uses filing status? |
|---|---|
| FIT withholding (Track B) | **Yes** — schedule selection and line 1g |
| Annual liability estimate (Track A) | **Yes** — standard deduction and brackets |
| Social Security | No |
| Medicare | No |
| **Additional Medicare** | **No — see §15.1. Dedicated test.** |
| FUTA | No |

### 8.4 Head of Household restriction

HoH is valid only on 2020-or-later Forms W-4. Pub. 15-T states the Head of Household table must not
be used for a 2019-or-earlier Form W-4. If `w4Revision = 2019_OR_EARLIER` and the mapped status is
HoH, that is `INVALID_INPUT`.

### 8.5 Test requirements

Every filing status × every schedule type must resolve to a distinct schedule; a test asserts no two
filing statuses accidentally resolve to the same schedule ID; a test asserts the legacy mapping
table; a test asserts the HoH restriction.

---

## 9. MULTIPLE-JOB HANDLING

### 9.1 Only one of the three W-4 options reaches the engine as a distinct signal

| W-4 Step 2 option | Engine effect |
|---|---|
| 2(a) IRS Tax Withholding Estimator | Manifests as amounts in Steps 3 / 4(a) / 4(b) / 4(c). No distinct field. |
| 2(b) Multiple Jobs Worksheet | Same — manifests as Step 4(c) and possibly 4(a)/4(b). No distinct field. |
| 2(c) Checkbox | `step2MultipleJobsChecked = true` ⇒ STEP2_CHECKBOX schedule **and** line 1g becomes zero |

### 9.2 Component definition

| Aspect | Definition |
|---|---|
| **Inputs** | `step2MultipleJobsChecked` |
| **Required rule data** | `FED.FIT.RATE_SCHEDULE.ANNUAL.STEP2_CHECKBOX` per filing status |
| **Formula** | Schedule selection + line 1g = 0 |
| **Output** | Higher tentative withholding, via the schedule |
| **Rounding** | N/A |
| **Effective-date** | Same as the schedule |
| **Source** | Pub. 15-T, Worksheet 1A and the Step 2 Checkbox rate schedules |
| **Verification** | `PENDING DATA` (Appendix A A-04…A-06) |
| **Error behaviour** | Checkbox true but no STEP2_CHECKBOX schedule published ⇒ `INCOMPLETE`. **Never** fall back to the STANDARD schedule — that would silently under-withhold |
| **Tests** | Checked vs unchecked produce different results for identical wages; checked ⇒ line 1g = 0; missing checkbox schedule ⇒ `INCOMPLETE`, not a fallback |

### 9.3 Not modelled

Spouse's income, second-job wages, and job count. None is employer-facing W-4 data.

---

## 10. DEPENDENTS / CREDITS HANDLING

### 10.1 Component definition

| Aspect | Definition |
|---|---|
| **Inputs** | `step3CreditsAnnual` — a single annual total |
| **Required rule data** | None. Step 3 is an employee-supplied amount, not a rule |
| **Formula** | Worksheet 1A lines 3a–3c: annual total ÷ pay periods, subtracted from the tentative withholding, floored at zero |
| **Output** | Reduction in per-period withholding |
| **Rounding** | §22 — note 3b is a division and will usually produce a repeating decimal |
| **Effective-date** | N/A |
| **Source** | Pub. 15-T Worksheet 1A Step 3 |
| **Verification** | Methodology `VERIFIED` from Pub. 15-T; no values required |
| **Error behaviour** | Negative input ⇒ `INVALID_INPUT` |
| **Tests** | Credits exceeding tentative withholding ⇒ zero, never negative; credit divided across each supported pay frequency; pre-2020 W-4 ⇒ Step 3 forced to zero |

### 10.2 The employer must use the employee's total, not recompute it

Pub. 15-T instructs employers to use the total the employee entered in Step 3 **even if it does not
equal the sum of the sub-amounts**, because the total may include other credits.

Therefore the engine takes one `step3CreditsAnnual` total and must **not** model a dependent count
and multiply it by a credit amount. Doing so would (a) invent employer behaviour the IRS explicitly
warns against, and (b) require a child-tax-credit amount as tax data that Pub. 15-T does not supply
for this purpose.

If Phase 9 wants to help a user *compute* a Step 3 amount from dependents, that is a **frontend
helper producing an input**, clearly labelled, and it is not Phase 4 work.

---

## 11. ADDITIONAL WITHHOLDING

### 11.1 Component definition

| Aspect | Definition |
|---|---|
| **Inputs** | `step4cExtraPerPeriod` (2020+) or legacy line 6 |
| **Required rule data** | None |
| **Formula** | Worksheet 1A line 4a, added to line 3c |
| **Output** | Increase in withholding for the period |
| **Rounding** | Added before the final rounding step (§22) |
| **Effective-date** | N/A |
| **Source** | Pub. 15-T Worksheet 1A Step 4 |
| **Verification** | Methodology `VERIFIED`; no values |
| **Error behaviour** | Negative ⇒ `INVALID_INPUT`. Absurdly large values ⇒ sanity-ceiling `INVALID_INPUT` (§36.4) |
| **Tests** | Additive behaviour; per-period semantics (a 4(c) amount must **not** be divided by pay periods); interaction with exemption (D-FIT-2); interaction with zero tentative withholding (result = the 4(c) amount) |

### 11.2 Semantic trap to test explicitly

Step 4(c) is per pay period; Steps 3, 4(a), 4(b) are annual. A test must assert that changing the pay
frequency while holding 4(c) constant changes annualized 4(c) impact proportionally — i.e. that 4(c)
was **not** annualized or divided.

---

## 12. PRE-TAX DEDUCTION TAXABILITY INTERACTION

### 12.1 The rule that governs this section

**Never assume a "pre-tax" deduction is exempt from every federal payroll tax.** Different deductions
reduce different buckets. Section 125 cafeteria-plan benefits, elective deferrals to a traditional
401(k), HSA contributions through a cafeteria plan, and others each have their own combination.

### 12.2 Taxability metadata model

Taxability is **data**, not code. Each deduction type carries a taxability profile, versioned and
sourced like any other rule:

```
DeductionTaxabilityProfile
  id
  ruleId                  → Rule (status, version, effective dates, sources)
  taxYear
  deductionTypeKey        e.g. TRADITIONAL_401K, SECTION125_HEALTH, HSA_CAFETERIA,
                               FSA_HEALTH, FSA_DEPENDENT_CARE, ROTH_401K, ...
  reducesFederalIncomeTaxWages   Boolean | NOT_STATED
  reducesSocialSecurityWages     Boolean | NOT_STATED
  reducesMedicareWages           Boolean | NOT_STATED
  reducesFutaWages               Boolean | NOT_STATED
  annualLimitRuleKey             String?   (limits are separate rules — §12.5)
  notes
```

Each boolean is a **tri-state**: `TRUE`, `FALSE`, or `NOT_STATED`. `NOT_STATED` is never coerced to
`FALSE`. A deduction whose profile contains `NOT_STATED` for a bucket the calculation needs produces
`INCOMPLETE` for the federal result, naming the deduction and the bucket.

### 12.3 Component definition

| Aspect | Definition |
|---|---|
| **Inputs** | Pre-tax deduction lines from Phase 3, each with a `deductionTypeKey` and an amount |
| **Required rule data** | One `DeductionTaxabilityProfile` per distinct `deductionTypeKey` present |
| **Formula** | For each bucket: subtract the deduction amount only where that bucket's flag is `TRUE` (§19.3) |
| **Output** | The four federal wage buckets |
| **Rounding** | None at this stage — full Decimal precision |
| **Effective-date** | Profiles are effective-dated rules like any other |
| **Source** | The IRS publication establishing the treatment (Pub. 15, Pub. 15-B, or the relevant code section), recorded per §25 |
| **Verification** | **`PENDING DATA` for every deduction type** — Appendix A rows A-30…A-37. No default profile ships |
| **Error behaviour** | Unknown `deductionTypeKey` ⇒ `UNSUPPORTED_SCENARIO`. `NOT_STATED` on a needed bucket ⇒ `INCOMPLETE`. **Never** guess |
| **Tests** | §12.6 |

### 12.4 No hardcoded taxability anywhere

Forbidden: `if (deduction.type === '401K') { federalWages -= amount }` anywhere in the codebase.
A scanner test asserts no deduction-type literal appears in `/lib/tax/federal/**`.

### 12.5 Contribution limits are separate rules

Annual contribution limits (elective deferral limits, HSA limits, catch-up amounts) are **separate
rule records** with their own sources. **PENDING DECISION D-DED-1:** whether Phase 4 enforces limits
at all. Recommendation: **do not enforce limits in Phase 4** — the calculator estimates a single pay
period and cannot know the employee's full-year elections. Instead, record the limit rules and add a
Phase 9 advisory warning. Enforcement without full-year context would produce wrong answers.

### 12.6 Test requirements

1. A fixture deduction whose FICA and FUTA treatments **differ** — proves buckets are independent.
2. A fixture where a deduction reduces FIT wages but not Social Security wages — proves no bucket
   copying.
3. `NOT_STATED` ⇒ `INCOMPLETE`, with the deduction and bucket named.
4. Unknown deduction type ⇒ `UNSUPPORTED_SCENARIO`.
5. Post-tax deductions (Roth, garnishments, post-tax insurance) reduce **no** federal wage bucket.
6. Deduction exceeding gross ⇒ buckets floor at zero, `INVALID_INPUT` or a warning per §28.

---

## 13. SOCIAL SECURITY

### 13.1 Component definition

| Aspect | Definition |
|---|---|
| **Inputs** | `socialSecurityWages` this period; `ytdSocialSecurityWages` (excluding this period — §13.4) |
| **Required rule data** | `FED.SS.EMPLOYEE_RATE`, `FED.SS.EMPLOYER_RATE`, `FED.SS.WAGE_BASE` |
| **Formula** | §13.2 |
| **Output** | `socialSecurityEmployee` (employee deduction), `socialSecurityEmployer` (employer cost) |
| **Rounding** | §22 — round at the tax level, not the wage level |
| **Effective-date** | Wage base and rates are tax-year rules; a mid-year change is expressible but historically rare |
| **Source** | Pub. 15 for rates; the annual SSA/IRS wage-base announcement for the base. Both recorded per §25 |
| **Verification** | `PENDING_VERIFICATION` — Appendix B B-08…B-10 |
| **Error behaviour** | Any of the three rules missing ⇒ `INCOMPLETE`, naming the key. Wage base resolving as `NOT_APPLICABLE` ⇒ `RULE_CONFLICT` (Social Security has a base; its absence is a data error) |
| **Tests** | §13.3 |

### 13.2 Formula

```
remainingBase          = max(wageBase − ytdSocialSecurityWages, 0)
taxableThisPeriod      = min(socialSecurityWagesThisPeriod, remainingBase)
socialSecurityEmployee = taxableThisPeriod × employeeRate
socialSecurityEmployer = taxableThisPeriod × employerRate
```

Employee and employer rates are **separate rule records** even when numerically equal, because the
law imposes them separately and a future divergence (as occurred with the 2011–2012 employee-side
reduction) must be a data change, never a code change.

### 13.3 Required tests

| Case | Expected |
|---|---|
| YTD = 0, period wages < base | Full period wages taxable |
| YTD ≥ base | Taxable = 0, tax = 0, trace states base exhausted |
| Period wages straddle the base | Only the portion up to the base is taxed; trace shows `remainingBase` |
| YTD > base (multiple employers) | `remainingBase` floors at 0; never negative; never a refund; trace warns |
| Period wages = 0 | Tax = 0, status `COMPLETE` |
| Employee and employer rates differ (synthetic fixture) | Two different outputs — proves separate rule reads |
| Wage base missing | `INCOMPLETE`, key named |

### 13.4 YTD semantics — D-SS-1 (PENDING DECISION)

`ytdSocialSecurityWages` must mean **YTD from this employer, excluding the current period**. The
convention must be stated in the type's doc comment, validated, surfaced in the Phase 9 UI, and
tested. The alternative convention ("including the current period") silently produces wrong wage-base
behaviour. Confirm which convention Phase 3 established and, if it differs, revise this spec rather
than quietly changing the convention.

### 13.5 Out of scope

Multiple-employer excess Social Security refunds (a Form 1040 matter). Household, agricultural,
student, clergy and statutory-employee exceptions ⇒ `UNSUPPORTED_SCENARIO`. The rule model leaves an
`applicability` condition field for future use; Phase 4 implements none.

---

## 14. MEDICARE

### 14.1 Component definition

| Aspect | Definition |
|---|---|
| **Inputs** | `medicareWages` this period |
| **Required rule data** | `FED.MEDICARE.EMPLOYEE_RATE`, `FED.MEDICARE.EMPLOYER_RATE`, `FED.MEDICARE.WAGE_BASE` (as an explicit `NOT_APPLICABLE` record) |
| **Formula** | `taxable = medicareWages`; `employee = taxable × employeeRate`; `employer = taxable × employerRate` |
| **Output** | `medicareEmployee`, `medicareEmployer` |
| **Rounding** | §22 |
| **Effective-date** | Tax-year rules |
| **Source** | Pub. 15 |
| **Verification** | `PENDING_VERIFICATION` — Appendix B B-11, B-12 |
| **Error behaviour** | Missing rate ⇒ `INCOMPLETE`. Missing wage-base **record** ⇒ `INCOMPLETE` (see §14.3) |
| **Tests** | §14.4 |

### 14.2 No wage base

Medicare wages are not capped.

### 14.3 The `NOT_APPLICABLE` record — the most important data-integrity pattern in Phase 4

`FED.MEDICARE.WAGE_BASE` must **exist** as a rule record with verification status `NOT_APPLICABLE`
and a source citation confirming that no Medicare wage base applies.

This is deliberate. An *absent* record is indistinguishable from *missing data*. An explicit
`NOT_APPLICABLE` record is a positive, source-backed statement that the concept does not apply.

The engine therefore:
- treats `NOT_APPLICABLE` as "no cap" and proceeds;
- treats a **missing** record as `INCOMPLETE` and refuses to calculate.

This is the central application of the project rule that `NOT_STATED` ≠ `NOT_APPLICABLE` ≠ zero, and
it gets a dedicated named test.

### 14.4 Required tests

1. Uncapped behaviour at very large wages.
2. `NOT_APPLICABLE` record present ⇒ calculation proceeds uncapped.
3. Wage-base record **absent** ⇒ `INCOMPLETE`, not uncapped.
4. A synthetic fixture with a wage base present and `VERIFIED` ⇒ the cap is applied (proves the code
   path is data-driven, not hardcoded to "uncapped").
5. Base Medicare and Additional Medicare are separate result fields and separate trace stages.

### 14.5 Relationship to Additional Medicare

Separate rules, separate calculation, separate result fields, separate trace stages. Employee total
Medicare withholding is their sum, computed in the result-assembly layer — **never** by folding the
additional rate into the base rate.

---

## 15. ADDITIONAL MEDICARE TAX

### 15.1 Three rules that must be enforced

1. **Employee-side only.** No employer match exists. There must be no
   `additionalMedicareEmployer` field anywhere. A test asserts no employer-cost total contains an
   Additional Medicare component.
2. **The employer's withholding threshold is a fixed wage amount**, applied per employer, independent
   of the employee's filing status and independent of a spouse's wages. The employee's actual
   liability *is* filing-status dependent, but that is reconciled on the individual return (Form
   8959) and is **not** a payroll calculation.
3. Therefore the engine **must not read `filingStatus`** in this component. A test asserts that
   varying filing status with all else equal produces identical Additional Medicare withholding.

### 15.2 Component definition

| Aspect | Definition |
|---|---|
| **Inputs** | `medicareWages` this period; `ytdMedicareWages` (excluding this period) |
| **Required rule data** | `FED.ADDL_MEDICARE.EMPLOYEE_RATE`, `FED.ADDL_MEDICARE.WITHHOLDING_THRESHOLD` |
| **Formula** | §15.3 |
| **Output** | `additionalMedicareEmployee` |
| **Rounding** | §22 |
| **Effective-date** | Tax-year rules |
| **Source** | Pub. 15 and the underlying code section |
| **Verification** | `PENDING_VERIFICATION` — Appendix B B-16, B-17. Strict-vs-inclusive threshold comparison is `PENDING VERIFICATION V-02` |
| **Error behaviour** | Missing rate or threshold ⇒ `INCOMPLETE` |
| **Tests** | §15.4 |

### 15.3 Formula (branch-free, required form)

```
priorYtd          = ytdMedicareWages
newYtd            = priorYtd + medicareWagesThisPeriod
amountOver        = max(newYtd   − threshold, 0)
alreadyOver       = max(priorYtd − threshold, 0)
taxableThisPeriod = amountOver − alreadyOver          // ≥ 0 by construction
additionalMedicareEmployee = taxableThisPeriod × additionalRate
```

This formulation handles the crossing period correctly without branching and is the required
implementation.

### 15.4 Required tests

| Case | Expected |
|---|---|
| YTD and period both below threshold | 0 |
| Period crosses the threshold | Only the excess portion taxed |
| YTD already above threshold | Whole period taxed |
| YTD exactly equals the threshold | Whole period taxed — **pending V-02** on strict vs inclusive |
| Filing status varied, all else equal | Identical result |
| Period wages = 0 | 0 |
| Employer cost totals | Contain no Additional Medicare component |

### 15.5 No annualization

Additional Medicare is a pure YTD-threshold calculation. It does not annualize, does not use pay
periods, and does not touch the withholding rate schedules. It must not import anything from `fit/`.

---

## 16. ANNUAL WAGE-BASE HANDLING

### 16.1 Shared semantics

Three federal quantities are YTD-bounded and share one implementation:

| Quantity | Bound type | Bucket | Side |
|---|---|---|---|
| Social Security | Wage base (cap) | `socialSecurityWages` | Employee + employer |
| FUTA | Wage base (cap) | `futaWages` | Employer only |
| Additional Medicare | Threshold (floor) | `medicareWages` | Employee only |

A **cap** limits taxable wages from above. A **threshold** starts taxation from below. They are
mathematically different and must be separate helpers — `applyWageBaseCap()` and
`applyThresholdFloor()` — never one function with a boolean.

### 16.2 Required YTD inputs

`ytdSocialSecurityWages`, `ytdMedicareWages`, `ytdFutaWages`, `ytdSupplementalWages` — all
per-bucket, all "from this employer, excluding the current period" (§13.4), all defaulting to zero
with that default **disclosed in the trace** ("assumes first pay period of the year / no prior YTD
supplied"). A silent zero default would misstate mid-year and high-earner paychecks.

### 16.3 Cross-year behaviour

Wage bases and thresholds reset on the tax-year boundary. The engine uses the tax year resolved in
§23 and never spans years within a single calculation. A pay period straddling 31 December is
governed by the **pay date**, not the work period (§23.2) — `PENDING VERIFICATION V-03` against
Pub. 15's constructive-receipt guidance.

### 16.4 Tests

Boundary tests at base − 0.01, exactly base, base + 0.01 for each bounded quantity; a test that
caps and thresholds are not interchanged; a test that YTD defaults are disclosed in the trace.

---

## 17. EMPLOYER-SIDE FEDERAL PAYROLL TAXES

### 17.1 Hard separation

Employer costs are a **separate branch of the result contract** from employee deductions:

```
FederalTaxResult {
  employee: {
    federalIncomeTaxWithheld
    socialSecurityEmployee
    medicareEmployee
    additionalMedicareEmployee
    totalEmployeeFederalTaxes
  }
  employer: {
    socialSecurityEmployer
    medicareEmployer
    futaEmployer
    totalEmployerFederalTaxes
    disclosures: string[]        // e.g. FUTA credit-reduction not evaluated
  }
  estimates: {                   // Track A, optional, flagged
    annualFederalIncomeTaxEstimate?
    effectiveFederalRateEstimate?
    isEstimate: true
  }
  status, trace, ruleRefs, sourceRefs
}
```

### 17.2 Net pay invariant

`netPay` is computed from `employee.*` only. A property test must assert that varying every employer
rate and the FUTA wage base leaves `netPay` **bit-identical**. This single test is the strongest
protection against the most damaging class of error in this domain.

### 17.3 Employer components in Phase 4

Employer Social Security (§13), employer Medicare (§14), FUTA (§18). Employer SUTA is Phase 5.

### 17.4 Total employer cost of employment

`grossPay + totalEmployerFederalTaxes` is a **partial** figure in Phase 4 — it excludes state
employer taxes, SUTA, benefits and workers' compensation. The result must carry a disclosure saying
so. Presenting a partial employer cost as complete would violate the transparency principle.

---

## 18. FUTA ARCHITECTURE

### 18.1 Hard constraint

FUTA is **employer-only**. It must never appear in `employeeTaxes`, never reduce `netPay`, never
appear in the employee-facing paycheck breakdown as a deduction, and appear only under
`employer.futaEmployer`. Three tests enforce this, including the §17.2 property test.

### 18.2 Component definition

| Aspect | Definition |
|---|---|
| **Inputs** | `futaWages` this period; `ytdFutaWages`; `employerSubjectToFuta`; optional `employmentStateCode` |
| **Required rule data** | `FED.FUTA.GROSS_RATE`, `FED.FUTA.STANDARD_CREDIT`, `FED.FUTA.WAGE_BASE` |
| **Formula** | §18.3 |
| **Output** | `futaEmployer` |
| **Rounding** | §22 |
| **Effective-date** | Tax-year rules; credit reductions are annual determinations |
| **Source** | Pub. 15; Form 940 and its instructions; Schedule A (Form 940) for credit reductions |
| **Verification** | `PENDING_VERIFICATION` — Appendix B B-18…B-20 |
| **Error behaviour** | Missing rule ⇒ `INCOMPLETE`. Employer-type signals not supported ⇒ `UNSUPPORTED_SCENARIO` for the FUTA component only, with partial completion (§28.4) |
| **Tests** | §18.7 |

### 18.3 Formula

```
remainingBase     = max(futaWageBase − ytdFutaWages, 0)
taxableThisPeriod = min(futaWagesThisPeriod, remainingBase)
effectiveRate     = grossRate − applicableCredit
futaEmployer      = taxableThisPeriod × effectiveRate
```

`grossRate`, `standardCredit` and `wageBase` are three separate rule records. The effective rate is
**derived at calculation time**, never stored as a pre-computed rule, so that the trace can show the
subtraction and a credit change requires no rate re-entry.

### 18.4 Decision D-FUTA-1 — rule category (RECOMMENDED)

**Add a dedicated `FUTA` member to `RuleCategory`.**

Rationale:
1. FUTA's structure (gross rate minus credit, its own wage base) has no analogue in FIT (schedules)
   or FICA (symmetric rate + base).
2. It is the only federal tax whose effective rate depends on the **state** of employment (§18.6).
   That cross-cutting dimension needs its own category to model cleanly.
3. Admin UX: "FUTA" is the term payroll administrators search for. Burying it in a generic
   `PAYROLL_TAX` category degrades the annual update workflow.
4. The master spec already treats FUTA as a first-class concern and anticipates category additions.

**Rejected alternative:** a generic `EMPLOYER_PAYROLL_TAX` category — would force credit-reduction
data into untyped conditions and would collide with SUTA in Phase 5.

**Migration impact:** adding a Postgres enum member is additive and non-breaking; no existing rows
change. If `RuleCategory` is a lookup table rather than an enum, this becomes seed data instead.

### 18.5 FUTA wages are their own bucket

FUTA has its own exclusions, which differ from both the income-tax and FICA buckets. `futaWages`
must be derived from its own taxability flags (§12, §19). Copying `socialSecurityWages` into
`futaWages` is forbidden and is caught by a test using a deduction fixture whose FUTA treatment
differs from its FICA treatment.

### 18.6 Decision D-FUTA-2 — credit reduction states (PENDING DECISION + PENDING VERIFICATION)

The FUTA credit is reduced for employers in states with outstanding federal unemployment account
loans; affected states are determined annually and reported on Schedule A (Form 940). This makes the
FUTA effective rate **state-dependent**, even though FUTA is federal — an architectural boundary
problem, because Phase 4 is federal-only.

**Recommendation for Phase 4:**
1. Implement the **standard credit only**.
2. Model `FED.FUTA.CREDIT_REDUCTION.{STATE}` in the key namespace and detail schema now, so no
   migration is needed later.
3. Accept an optional `employmentStateCode` in the federal context **for FUTA only**, recorded in
   the trace.
4. Gate credit-reduction application behind feature flag `FEDERAL_FUTA_CREDIT_REDUCTION`, **OFF**.
5. When the flag is off, the trace and the employer-cost output must **state explicitly** that the
   standard credit was applied and credit reduction was not evaluated. Silently presenting a possibly
   understated employer cost as complete would violate the transparency principle.

`PENDING VERIFICATION V-04`: the authoritative credit-reduction list and mechanism for the applicable
year. `PENDING DECISION`: whether this lands in Phase 4 with the flag on, or in Phase 5 where a state
is always present. **Recommendation: Phase 5.**

### 18.7 Employer applicability and exclusions

FUTA applies only to employers meeting statutory tests, with separate tests for household and
agricultural employers. A paycheck calculator cannot know whether those tests are met.

**Recommendation:** treat employer FUTA as an estimate **conditioned on the employer being subject to
FUTA**; expose `employerSubjectToFuta` (default `true`); state the condition in the trace and in the
employer-cost output. Do not attempt to evaluate the statutory tests — that would be invention.
Household/agricultural/nonprofit/governmental signals ⇒ `UNSUPPORTED_SCENARIO` for the FUTA
component, with the rest of the federal result still completing.

Required tests: employer-only placement (×3); wage-base exhaustion; straddle; effective rate derived
not stored; credit-reduction flag off ⇒ disclosure present; FUTA bucket differs from FICA bucket;
`employerSubjectToFuta = false` ⇒ FUTA omitted with a disclosure, not silently zeroed.

---

## 19. TAXABLE WAGE BUCKETS

### 19.1 Federal buckets

| Bucket | Consumer |
|---|---|
| `federalIncomeTaxWages` | FIT withholding (Track B) |
| `socialSecurityWages` | Social Security employee + employer |
| `medicareWages` | Medicare employee + employer, Additional Medicare |
| `futaWages` | FUTA employer |

State/local buckets (`stateIncomeTaxWages`, `localIncomeTaxWages`, `sutaWages`) exist in the Phase 3
architecture and are untouched by Phase 4.

### 19.2 Derivation

```
for each bucket B:
  B = grossPayComponentsTaxableFor(B)
  for each pre-tax deduction D:
    if profile(D).reduces(B) == TRUE:      B -= D.amount
    if profile(D).reduces(B) == NOT_STATED: mark INCOMPLETE(D, B)
    if profile(D).reduces(B) == FALSE:     no change
  B = max(B, 0)
```

Post-tax deductions never reduce any bucket.

### 19.3 Independence is mandatory

Each bucket is computed independently from its own flags. Forbidden patterns:

- `medicareWages = socialSecurityWages` (they differ above the SS wage base in *taxability inputs*
  and can differ by deduction treatment)
- `futaWages = socialSecurityWages`
- `federalIncomeTaxWages = grossPay − allPreTaxDeductions`

A test using a fixture deduction with four different bucket flags asserts four different bucket
values.

### 19.4 Component definition

| Aspect | Definition |
|---|---|
| **Inputs** | Gross pay components (regular, overtime, bonus, commission, tips, other); pre-tax deduction lines |
| **Required rule data** | `DeductionTaxabilityProfile` per deduction type; pay-component taxability metadata |
| **Formula** | §19.2 |
| **Output** | Four Decimal buckets + a per-bucket derivation trace |
| **Rounding** | **None.** Buckets stay at full Decimal precision; rounding happens only at the tax level (§22) |
| **Effective-date** | Profiles are effective-dated |
| **Source** | Pub. 15 / Pub. 15-B per deduction type |
| **Verification** | `PENDING DATA` for every profile |
| **Error behaviour** | §12.3 |
| **Tests** | §12.6, §19.3 |

### 19.5 Tips and overtime

Both are ordinary wages for all four buckets. The OBBBA deductions do **not** reduce any bucket
(§7.9). This gets an explicit named test, because it is the single most likely 2026 implementation
error.

---

## 20. PAY-FREQUENCY CONVERSION

### 20.1 Source of truth

Worksheet 1A **Table 3** supplies the periods-per-year factor used at lines 1b, 2h and 3b. It is
stored as rule data (`FED.FIT.PAY_PERIODS_PER_YEAR`, detail shape `COUNT_BY_PAY_PERIOD`), sourced to
Pub. 15-T, and **never hardcoded**.

Table 3 enumerates: Semiannually, Quarterly, Monthly, Semimonthly, Biweekly, Weekly, Daily.

### 20.2 Coverage against DoPayCheck's frequency list

| DoPayCheck frequency | In Table 3? | Status |
|---|---|---|
| Weekly | Yes | Supported |
| Biweekly | Yes | Supported |
| Semimonthly | Yes | Supported |
| Monthly | Yes | Supported |
| Quarterly | Yes | Supported |
| **Daily** | **Yes** | **Supported — see §20.3** |
| **Annual** | **No — NOT_STATED in Table 3** | **§20.4** |
| Semiannual | Yes (not currently a DoPayCheck frequency) | Available if ever added |

### 20.3 DAILY — resolved for federal purposes

Phase 3 recorded a pending decision about the DAILY pay frequency. **For federal withholding the
question is answered by the source:** Table 3 enumerates Daily with an explicit periods-per-year
factor, and Pub. 15-T's nonresident-alien tables likewise enumerate "Daily or Miscellaneous (each day
of the payroll period)".

So DAILY is supported for federal withholding, using the Table 3 factor as data
(`PENDING_VERIFICATION`, Appendix B B-21). The broader Phase 3 question — whether the *product*
should expose a daily frequency, and how daily interacts with state rules — remains open and belongs
to Phase 5/Phase 9. Do not extend this resolution beyond federal withholding.

### 20.4 ANNUAL — PENDING DECISION D-FREQ-1

Table 3 does not list an Annually row. The arithmetically obvious factor is one, but Pub. 15-T does
not state it in Table 3, so entering it as verified data would be an inference, not a citation.

Options:
- **(a) Recommended.** Return `UNSUPPORTED_SCENARIO` for ANNUAL federal withholding until a citation
  is found (candidates: the nonresident-alien tables, which do enumerate an Annually row; Pub. 15-T
  section 6 annualized-wages method; Pub. 15).
- (b) Enter a factor of one with verification status `NOT_STATED` and a note, and surface the
  calculation as `INCOMPLETE`/estimated.
- (c) Enter it as `VERIFIED` — **rejected**, it would be a fabricated citation.

`PENDING VERIFICATION V-05`: locate an official statement of the annual payroll-period factor.

### 20.5 Component definition

| Aspect | Definition |
|---|---|
| **Inputs** | `payFrequency` |
| **Required rule data** | `FED.FIT.PAY_PERIODS_PER_YEAR` |
| **Formula** | Map lookup |
| **Output** | Integer periods-per-year |
| **Rounding** | N/A — integer |
| **Effective-date** | Tax-year rule |
| **Source** | Pub. 15-T Worksheet 1A Table 3 |
| **Verification** | `PENDING_VERIFICATION` B-21 |
| **Error behaviour** | Frequency not present in the table ⇒ `UNSUPPORTED_SCENARIO` naming the frequency. **Never** compute a substitute factor |
| **Tests** | Every supported frequency resolves; ANNUAL behaves per D-FREQ-1; a test asserting no periods-per-year integer literal appears in engine code |

### 20.6 Semimonthly is not biweekly

A dedicated test asserts semimonthly and biweekly produce different withholding for identical
per-period wages. These are routinely conflated and the difference is material.

---

## 21. ANNUALIZATION / DE-ANNUALIZATION METHODOLOGY

### 21.1 The pattern

Worksheet 1A is an annualize → look up → de-annualize pipeline:

```
annualize:      1c = periodWages × periodsPerYear
adjust:         1i/1l  (annual W-4 adjustments applied in annual space)
look up:        2g     (annual tentative withholding from the ANNUAL schedule)
de-annualize:   2h = 2g ÷ periodsPerYear
adjust again:   3b = step3Credits ÷ periodsPerYear   (annual → per period)
                4a                                    (already per period)
```

### 21.2 Precision rules for the two divisions

Lines 2h and 3b are divisions that commonly produce non-terminating decimals.

**Requirement:**
- Intermediate Decimal precision of at least **12 significant decimal places** for divisions, with an
  explicit rounding mode (recommend `ROUND_HALF_UP`), configured once in the Decimal library setup
  and asserted by a test.
- **No rounding between lines 2h and 4b.** Rounding only at the final tax value (§22).
- Division precision must be **explicit and documented**, never left to library defaults, because a
  library default change would silently alter historical reproducibility.

### 21.3 Determinism requirement

Given identical inputs and an identical rule set, the annualization path must produce a bit-identical
result on every platform and in perpetuity. A golden-file test stores full-precision intermediates
(1c, 1i, 2g, 2h, 3c, 4b) for a set of scenarios and fails on any drift.

### 21.4 What must not be done

- Do not compute an "annual tax" via Track A and divide it by pay periods. That is not the IRS
  methodology and produces different numbers.
- Do not round the annualized wage to whole dollars before the schedule lookup unless the rounding
  policy rule (§22) explicitly says to.
- Do not use a "days in period / 365" proration. Table 3 is the authority.

---

## 22. ROUNDING RULES

### 22.1 What Pub. 15-T actually says (paraphrased)

Pub. 15-T's rounding guidance for figuring income tax withholding is **permissive**: the employer
*may* reduce the last digit of the wages to zero or figure wages to the nearest dollar, and *may*
round the tax for the pay period to the nearest dollar. If rounding is used it must be used
consistently. Where whole-dollar rounding of withheld tax is applied, amounts under fifty cents drop
and amounts of fifty cents or more go up to the next dollar.

Two consequences:

1. **There is no single mandated rounding behaviour**, so a specification that claims one would be
   overstating the source.
2. Whatever DoPayCheck chooses, it must be **consistent, documented, versioned and disclosed** —
   because two employers using different permitted policies will legitimately withhold different
   amounts, and DoPayCheck must be able to explain why its estimate differs from a real pay stub.

### 22.2 Decision D-ROUND-1 — DoPayCheck federal rounding policy (RECOMMENDED)

| Stage | Policy |
|---|---|
| Wage buckets | **No rounding.** Full Decimal precision |
| Worksheet 1A annualization (1c) | No rounding |
| Schedule lookup (2a–2g) | No rounding |
| De-annualization (2h), credits (3b) | No rounding; ≥12 dp intermediate precision (§21.2) |
| **Final federal income tax withheld (4b)** | Round **HALF_UP to 2 decimal places** |
| Social Security, Medicare, Additional Medicare, FUTA | Round **HALF_UP to 2 decimal places** at the tax level, after multiplication, never at the wage level |
| Track A annual estimate | 2 dp, display only |

Rationale: rounding to cents rather than whole dollars keeps the estimate closest to the arithmetic
truth, avoids compounding rounding across components, and matches how the results are displayed. The
IRS whole-dollar option is permitted but is an employer convention DoPayCheck cannot know.

### 22.3 The policy is rule data, not code

`FED.FIT.ROUNDING_POLICY` is a `POLICY` rule record with fields:

```
wageRoundingMode      NONE | NEAREST_DOLLAR | LAST_DIGIT_TO_ZERO
taxRoundingMode       CENTS_HALF_UP | WHOLE_DOLLAR_HALF_UP
intermediatePrecision Int
```

So a future change — or an employer-configurable option in a later phase — is a data change. The
default policy record ships with a Pub. 15-T source citation recording that the publication permits
these options and that DoPayCheck has selected one.

### 22.4 Disclosure requirement

Because the choice is a policy rather than a mandate, the calculation trace and the "Why is my
paycheck this amount?" explanation must state which rounding policy was applied and that an employer
using a different permitted policy may withhold a slightly different amount. This is a Phase 4
output requirement even though the UI is Phase 9.

### 22.5 Never

- Never use JS floating point for any authoritative money value.
- Never round to whole dollars silently.
- Never round intermediates to 2 dp — rounding twice compounds error.
- Never use banker's rounding without an explicit decision (it is not what Pub. 15-T describes).

### 22.6 Tests

Half-cent boundary tests for each tax component; a test that intermediates are unrounded; a test
that the policy record drives behaviour (switch the fixture policy to whole-dollar and assert the
output changes); a scanner test asserting no `toFixed`, `Math.round`, `parseFloat` or `Number()`
appears in `/lib/tax/federal/**`.

---

## 23. EFFECTIVE-DATE AND TAX-YEAR RESOLUTION

### 23.1 Principles

1. Every calculation resolves exactly one tax year and one effective date, up front, once.
2. All federal rules are resolved at that single effective date. **Mixing rule versions within one
   calculation is a defect**, not a tolerance.
3. Publishing a new rule must never mutate a historical result (§29).

### 23.2 Tax year resolution — D-DATE-1 (PENDING DECISION)

| Option | Behaviour |
|---|---|
| (a) **Recommended** | Tax year is derived from the **pay date**, since payroll withholding follows the date wages are paid, not the period worked |
| (b) | Tax year supplied explicitly by the caller |
| (c) | Default to the system's active tax year |

Recommendation: accept an optional explicit `taxYear`; otherwise derive from `payDate`; otherwise
fall back to the active tax year **with that fallback disclosed in the trace**. A period straddling
31 December is governed by the pay date — `PENDING VERIFICATION V-03`.

### 23.3 Effective date

`effectiveDate = payDate` (or the resolved tax-year default if no pay date is supplied). A rule
applies when `effectiveFrom ≤ effectiveDate` and (`effectiveTo` is null or `effectiveDate ≤
effectiveTo`).

### 23.4 Mid-year changes

Federal rates rarely change mid-year but it has happened. The model supports it: a superseding rule
version with `effectiveFrom` mid-year, and the prior version's `effectiveTo` set to the day before.
No historical data is overwritten. A test covers a mid-year fixture and asserts that calculations
before and after the change date resolve to different versions.

### 23.5 Anti-fallback rules

If no rule is effective for the resolved date, the engine returns `INCOMPLETE`. It must **never**:

- use the prior tax year's rule
- use the nearest rule by date
- use a draft rule
- use zero
- use an average or an interpolation

Each of these gets an explicit negative test.

### 23.6 Tests

Effective-from boundary (day before / day of / day after); effective-to boundary; open-ended
`effectiveTo`; overlapping ranges ⇒ `RULE_CONFLICT`; gap ⇒ `INCOMPLETE`; year-boundary pay date;
mid-year supersession.

---

## 24. RULE VERSIONING

### 24.1 Requirements inherited from Phase 2

Federal rules use the Phase 2 versioning system unchanged. Phase 4 adds no parallel versioning.

### 24.2 What the engine must retain

For every federal value it uses, the result and snapshot retain: `ruleId`, `ruleVersionId`,
`ruleKey`, `taxYear`, `effectiveFrom`, `effectiveTo`, `status`, `verificationStatus`, `sourceIds`.

A rule whose value was used but whose IDs were not retained is a defect — a test asserts that the
count of distinct rule references in the result equals the count of rule entries actually read.

### 24.3 Historical rules are never overwritten

Updating a federal value creates a **new version**; the old version is `SUPERSEDED` with its
`effectiveTo` closed. Destructive edits to published federal rules are blocked by the Phase 1
delete/archive safeguards.

### 24.4 Cloning for a new tax year

`Clone 2026 → 2027 Draft` must work for every federal rule type, including multi-row withholding
schedules (header + all rows). Clones land as `DRAFT` with verification reset to `PENDING` and the
source deliberately cleared or flagged stale, so a clone can never be published without fresh
verification. See §39.

### 24.5 Live statuses — D-STATUS-1

The engine consumes **only** rules in a live production status. It must never consume `DRAFT`,
`PENDING_REVIEW`, `REJECTED`, `BLOCKED` or `ROLLED_BACK`.

`APPROVED` vs `ACTIVE`: **PENDING DECISION** — confirm the Phase 2 semantics. Recommendation: only
`ACTIVE` is consumable, with `APPROVED` meaning "approved but not yet published/activated". The
engine's live-status set must be defined in **one** constant, used by the resolver, and asserted by a
test that enumerates every `RuleStatus` member and checks consumability — so that adding a status
later cannot silently become consumable.

### 24.6 Tests

For each non-live status, a fixture rule in that status must be invisible to the engine and produce
`INCOMPLETE` rather than being used; a `SUPERSEDED` rule is used for a historical date and not for a
current one; the enumeration test in §24.5.

---

## 25. SOURCE TRACEABILITY

### 25.1 Every production federal rule must have a source

Required fields (per the master spec §32):

| Field | Federal example |
|---|---|
| `officialAgency` | Internal Revenue Service |
| `sourceDocument` | Publication 15-T (2026) |
| `url` | The IRS.gov locator |
| `page` | PDF page number |
| `section` | e.g. Section 1 |
| `table` | e.g. Worksheet 1A, Table 3; or the named rate schedule |
| `heading` | The printed heading above the value |
| `publishedDate` | Document revision date |
| `effectiveDate` | Tax-year effective date |
| `verificationDate` | When a human confirmed it |
| `verifiedBy` | Who confirmed it |
| `excerpt` | Short quotation or precise locator of the value |
| `notes` | Ambiguities, conflicts |

### 25.2 Federal source records expected for TY2026

| Source ID (suggested) | Document |
|---|---|
| `IRS-P15T-2026` | Publication 15-T (2026) |
| `IRS-P15-2026` | Publication 15 (Circular E) (2026) |
| `IRS-P15B-2026` | Publication 15-B (2026) — fringe benefit taxability |
| `IRS-W4-2026` | Form W-4 (2026) and instructions |
| `IRS-F940-2026` | Form 940 and instructions; Schedule A (Form 940) |
| `IRS-RP-ANNUAL-2026` | The annual inflation-adjustment revenue procedure (Track A only) |
| `SSA-WAGEBASE-2026` | The annual Social Security wage-base announcement |

### 25.3 Granularity

A withholding rate schedule's **header** carries the source (document, section, table, page). Where
a schedule spans pages, individual rows may carry a page override. One source per rule is the
minimum; multiple sources are permitted and are required when a value is corroborated across
documents.

### 25.4 Result-level traceability

Every federal amount in the result carries the source IDs that backed it, so the Phase 9 "Official
sources" panel and the Phase 10 report can list exactly what was relied on. A test asserts every
non-zero federal amount has at least one source reference.

### 25.5 No source, no publish

Enforced at the publish gate (§32), not at calculation time.

---

## 26. VERIFICATION WORKFLOW

### 26.1 Statuses and their federal meaning

| Status | Federal meaning |
|---|---|
| `VERIFIED` | A human confirmed the value against the official document and recorded the locator |
| `PARTIALLY_VERIFIED` | Some rows/fields confirmed; the rest outstanding. **Not publishable** |
| `PENDING` | Awaiting verification |
| `NOT_STATED` | The official document does not state this value. **Never converted to zero** |
| `NOT_APPLICABLE` | The document states the concept does not apply (e.g. Medicare wage base) |
| `CONFLICT` | Two official sources disagree. **Blocks publication** until resolved with a documented rationale |

### 26.2 Federal extraction workflow (per master spec §77)

```
1. Download the official IRS PDF from IRS.gov
2. Record the document, revision date and URL as a Source record
3. Extract structured values (AI assistance permitted as an EXTRACTION ASSISTANT ONLY)
4. Enter into the DoPayCheck admin as DRAFT
5. Human verifies every value against the PDF, recording page/section/table/heading
6. Validate (structure, contiguity, units)
7. Conflict check against existing versions and other sources
8. Run the federal test suite against the draft data
9. Review
10. Approve
11. Publish → version activation
```

AI-extracted federal data is **never** trusted automatically. Verification status remains `PENDING`
until a human sets it, and the human's identity and date are recorded.

### 26.3 Two-person rule — D-VERIFY-1 (PENDING DECISION)

**Recommendation:** for federal withholding rate schedules specifically, require that the approver
differ from the person who entered the data, and require a **double-entry or diff-based
confirmation** of the schedule rows (re-enter, or diff against an independent extraction). Rate
schedules are the highest-consequence, highest-row-count data in the system and a single transposed
digit silently produces wrong paychecks for a whole wage band.

### 26.4 Row-level verification for schedules

A schedule is `VERIFIED` only when **every row** is verified. Partial row verification ⇒
`PARTIALLY_VERIFIED` ⇒ not publishable. The admin must show per-row verification state.

### 26.5 Re-verification triggers

A rule must be re-verified when: the IRS reissues the publication (revision date changes); a
mid-year change is announced; a conflict is reported; or the annual roll-forward clones it.

---

## 27. CALCULATION TRACE AND AUDITABILITY

### 27.1 Required trace stages

| # | Stage | Key values |
|---|---|---|
| 1 | Federal wage bucket derivation | Gross components, each deduction's per-bucket effect, four final buckets |
| 2 | Tax year and effective date resolution | Resolved year, date, how derived |
| 3 | Rule set resolution | Every rule key with rule ID, version ID, effective dates, source IDs |
| 4 | Pay frequency | Frequency, periods per year, Table 3 reference |
| 5 | W-4 inputs | Revision, filing status, Step 2 checkbox, Steps 3/4a/4b/4c, exemption |
| 6 | Worksheet 1A | Named intermediates 1a, 1b, 1c, 1d–1i or 1j–1l, 2a–2h, 3a–3c, 4a, 4b |
| 7 | Schedule row selected | Schedule type, filing status, row order, columns A/B/C/D |
| 8 | Supplemental wages | Method chosen, eligibility evaluation, threshold split |
| 9 | Social Security | Wages, YTD, remaining base, taxable, employee, employer |
| 10 | Medicare | Wages, taxable (uncapped + the `NOT_APPLICABLE` basis), employee, employer |
| 11 | Additional Medicare | Prior YTD, new YTD, threshold, taxable portion, tax |
| 12 | FUTA | Wages, YTD, remaining base, gross rate, credit, effective rate, tax, disclosures |
| 13 | Rounding | Policy applied, pre- and post-rounding values |
| 14 | Track A estimate (if enabled) | Clearly flagged as an estimate |
| 15 | Disclosures and assumptions | YTD defaults assumed, FUTA credit reduction not evaluated, employer-cost partiality, rounding-policy note |

### 27.2 Trace entry shape

```
FederalTraceEntry {
  stage: FederalTraceStage
  label: string                 // human-readable, non-technical
  values: { name, value: Decimal|string|boolean, unit }[]
  ruleRefs: { ruleKey, ruleId, ruleVersionId, taxYear, effectiveFrom, effectiveTo }[]
  sourceRefs: string[]
  notes?: string[]
}
```

### 27.3 "Why is my paycheck this amount?"

The explanation must be **generated from the actual trace**, never from a template that could
contradict the numbers. Phase 4 produces the structured trace and the disclosure list; Phase 9
renders them. A test asserts every user-visible explanation field is derived from a trace entry.

### 27.4 Two audiences

- **User-facing:** plain language, the flow from gross to net, no rule IDs, no internal identifiers.
- **Admin/developer-facing:** full rule IDs, version IDs, source IDs, worksheet intermediates.

The same trace object serves both via a projection. The user projection must not leak internal
identifiers; the admin projection must not leak secrets (§36).

### 27.5 Tests

Every stage present for a full scenario; stages omitted only when genuinely not applicable and then
with a reason; every trace value traceable to either an input or a rule reference; no trace entry
containing an unexplained magic number.

---

## 28. ERROR AND UNSUPPORTED-SCENARIO HANDLING

### 28.1 Statuses

Use the existing Phase 3 statuses — no parallel system:

| Status | Federal use |
|---|---|
| `COMPLETE` | All required federal components calculated |
| `INCOMPLETE` | A required rule is missing, or a taxability flag is `NOT_STATED` |
| `INVALID_INPUT` | Input failed validation |
| `RULE_CONFLICT` | Overlapping versions, multiple/zero schedule row matches, contradictory data |
| `UNSUPPORTED_SCENARIO` | A recognised scenario Phase 4 deliberately does not implement |
| `CALCULATION_ERROR` | An unexpected internal failure |

### 28.2 Missing-rule behaviour (absolute)

If a required federal rule is absent, the engine must **not**: use zero, use last year's value, use a
guessed value, use an average, approximate, or silently continue.

It must: return `INCOMPLETE`; name the missing `ruleKey`, category, tax year and effective date;
include the partial trace; and make the gap machine-readable so admin tooling and tests can surface
it.

```
MissingRuleIssue { ruleKey, category, taxYear, effectiveDate, reason:
  'NO_RULE' | 'NO_EFFECTIVE_VERSION' | 'NOT_LIVE_STATUS' | 'DETAIL_INVALID' }
```

### 28.3 Unsupported scenarios in Phase 4

Nonresident alien (flag off); pension/annuity payments; alternative withholding methods; manual
wage-bracket method requests; household/agricultural/clergy/student/statutory employment;
ANNUAL frequency (pending D-FREQ-1); pre-2020 W-4 if D-W4-2 defers it.

Each returns `UNSUPPORTED_SCENARIO` with a machine-readable reason code and a plain-language
explanation. **Never a best-effort approximation.**

### 28.4 Partial completion — D-ERR-1 (PENDING DECISION)

Some failures are component-local (e.g. FUTA unsupported for an agricultural employer) while the
employee's paycheck is fully calculable.

**Recommendation:** support component-level status. The overall status is `COMPLETE` only when every
requested component is complete; otherwise the overall status reflects the worst component status,
and each component carries its own status and reason. The employee-facing paycheck may still display
if all employee components are `COMPLETE`, with the employer section marked incomplete.

**Rejected alternative:** all-or-nothing failure — it would refuse a perfectly good paycheck because
of an employer-side gap.

### 28.5 Federal invariants asserted before returning

| ID | Invariant |
|---|---|
| INV-1 | Every federal tax amount ≥ 0 |
| INV-2 | Every taxable amount ≤ its corresponding wage bucket |
| INV-3 | Social Security taxable ≤ remaining wage base |
| INV-4 | FUTA appears only in `employer` |
| INV-5 | Additional Medicare appears only in `employee` |
| INV-6 | No employer amount is included in `netPay` |
| INV-7 | Every non-zero amount has ≥ 1 rule reference and ≥ 1 source reference |
| INV-8 | `status = COMPLETE` implies zero `MissingRuleIssue`s |

An invariant breach is `CALCULATION_ERROR`, logged with full internal detail, surfaced to the user
as a generic failure (§36.2).

### 28.6 Never-throw contract

The federal engine returns a result object; it does not throw for domain conditions. Only genuinely
exceptional programming errors propagate, and those are caught at the pipeline boundary and converted
to `CALCULATION_ERROR`.

---

## 29. FEDERAL CALCULATION SNAPSHOT REQUIREMENTS

### 29.1 Additions to the Phase 3 snapshot

Phase 4 adds to the immutable snapshot:

```
federal: {
  taxYear
  effectiveDate
  jurisdictionId
  engineVersion
  methodology: {
    fitMethod: 'PUB15T_PERCENTAGE_AUTOMATED_WORKSHEET_1A'
    supplementalMethod
    roundingPolicy            // the resolved policy record, embedded
  }
  resolvedRuleSet: [          // EMBEDDED, not merely referenced
    { ruleKey, ruleId, ruleVersionId, category, effectiveFrom, effectiveTo,
      verificationStatus, sourceIds, detailHash }
  ]
  worksheetIntermediates      // full-precision 1a…4b
  buckets                     // four federal buckets, full precision
  result                      // employee + employer + estimates
  disclosures[]
  featureFlags                // the flag values in force at calculation time
}
```

### 29.2 Reproducibility requirement

**The snapshot must contain enough information to recompute the identical result without reading the
rule tables.** Storing only rule IDs is insufficient — a rollback, a correction, or an archival
policy could make those IDs resolve differently or not at all.

**Recommendation D-SNAP-1:** embed the **resolved rule detail values** (or an immutable
version-detail record plus a `detailHash` that a test verifies) in the snapshot. Historical reports
(Phase 10) are generated from the snapshot and must remain reproducible years later.

### 29.3 Reproducibility test

A regression test recomputes a stored historical snapshot through Stage B and asserts byte-identical
output, then publishes a *new* rule version for the same key and repeats, asserting the historical
result is unchanged. This is the definitive test that future rule publication cannot mutate history.

### 29.4 Engine version

`engineVersion` must be bumped whenever federal calculation behaviour changes (including a rounding
policy default change). Pure refactors do not bump it. The version is part of the snapshot and part
of the golden-test identity.

### 29.5 Privacy

The snapshot contains salary and W-4 data. Retention, access control and deletion are governed by
Phase 1 privacy architecture (§36.5). Phase 4 adds no new personal data field beyond the W-4 fields
already required.

---

## 30. ADMIN DASHBOARD REQUIREMENTS FOR FEDERAL RULES

Requirements only — Phase 8 builds the UI. Listed here so Phase 8 has a precise federal brief.

### 30.1 Screens required

| Screen | Purpose |
|---|---|
| **Tax Rules → Federal** | List of all federal rules for a tax year, grouped by category, with status, verification status, effective dates and source presence |
| **Federal Withholding Schedules** | Dedicated editor: select tax year → schedule type → filing status → a row grid (A/B/C/D) with per-row validation, per-row verification checkbox, and add/insert/delete row |
| **Schedule Compare** | Side-by-side row diff of two tax years (or two versions) — the core annual-update verification tool |
| **Federal Rates & Bases** | Simple form editor for SS, Medicare, Additional Medicare, FUTA scalar rules |
| **Deduction Taxability** | Matrix editor: deduction type × four federal buckets, tri-state per cell |
| **Federal Sources** | Source records with document, URL, page, section, table, heading, published date |
| **Federal Verification Queue** | Everything `PENDING` / `PARTIALLY_VERIFIED` / `CONFLICT` for the selected tax year |
| **Publish Gate** | Pre-publish checklist showing exactly which gate conditions pass and fail |
| **Federal Test Runner** | Run the federal golden tests against draft data before publishing |
| **Federal Rule Audit** | Immutable history of every change to a federal rule |

### 30.2 Dashboard cards (federal slice)

Active tax year; federal rules pending verification; federal drafts; federal conflicts; federal rules
missing sources; schedule row-count sanity per filing status; days until the next tax year needs
data; last federal publish.

### 30.3 Usability requirements

- Routine annual federal updates must require **no source-code change**.
- The schedule editor must support paste-from-table entry with strict per-row validation, since the
  data originates from a PDF table.
- Validation errors must be per-row and specific ("row 4 `atLeast` overlaps row 3 `lessThan`"), not a
  generic form error.
- Every field must show its verification status and its source inline.
- Non-technical language throughout: "Federal withholding tables (Publication 15-T)", not
  "FED.FIT.RATE_SCHEDULE.ANNUAL.STANDARD".

---

## 31. FEDERAL RULE CRUD REQUIREMENTS

### 31.1 Permitted operations by status

| Operation | DRAFT | PENDING_REVIEW | APPROVED | ACTIVE | SUPERSEDED |
|---|---|---|---|---|---|
| Create | ✓ | — | — | — | — |
| Edit | ✓ | ✓ (returns to DRAFT) | ✗ | ✗ | ✗ |
| Duplicate / clone | ✓ | ✓ | ✓ | ✓ | ✓ |
| Archive | ✓ | ✓ | ✓ | ✓ (via supersede) | ✓ |
| **Delete** | ✓ with confirmation | ✓ with confirmation | ✗ | **✗ never** | **✗ never** |
| Restore | ✓ | ✓ | ✓ | ✓ | ✓ |
| Rollback | — | — | — | ✓ | — |

### 31.2 Destructive-action rules

- Published federal rules are **never** destructively deleted. Use supersede / archive / rollback.
- Sources in use are archived, never deleted.
- Audit logs are never deleted.
- Confirmation copy: "This action cannot be undone."
- Reset is a separate action from Delete and also requires confirmation.

### 31.3 Schedule-specific CRUD

Rows cascade with their schedule header. Deleting a row from a published schedule is forbidden —
create a new version. Bulk row import must land in `DRAFT` with all rows `PENDING` verification.

### 31.4 Audit

Every federal rule operation writes an immutable audit entry: actor, timestamp, entity, action, old
value, new value, reason, metadata. Schedule row changes are audited at row granularity.

---

## 32. PUBLISH / APPROVAL GATES

### 32.1 Federal publish gate — all must pass

| # | Gate | Blocks publication if |
|---|---|---|
| 1 | Required fields | Any required field empty |
| 2 | Source present | No source record linked |
| 3 | Source complete | Document, URL, page, section/table, published date missing |
| 4 | Verification | Status is not `VERIFIED`, `NOT_APPLICABLE` or an approved `NOT_STATED` with rationale |
| 5 | Row completeness (schedules) | Any row unverified ⇒ `PARTIALLY_VERIFIED` |
| 6 | Structural validity (schedules) | Rows not contiguous; overlapping; top row not open-ended; rates or amounts negative; rows not monotonic |
| 7 | Units | Rate `unit` unset or implausible for its kind |
| 8 | Effective dates | `effectiveFrom` after `effectiveTo`; overlap with an existing live version of the same key |
| 9 | Conflict check | Any `CONFLICT` verification status unresolved |
| 10 | Coverage | Publishing a tax year with any required federal key missing |
| 11 | Tests | The federal golden and unit suites fail against the draft data |
| 12 | Approval | No approval recorded; or (D-VERIFY-1) approver is the same person as the entrant for schedules |
| 13 | Checkpoint | No recovery checkpoint created before a major federal publication |

### 32.2 Coverage check (gate 10) is federal-specific and important

Before a tax year can go live, the gate must confirm the presence of the complete required key set
from §3.2 — both schedule sets × all supported filing statuses, all FICA rules, FUTA rules, pay
periods, rounding policy, and every deduction taxability profile in use. Publishing a partially
populated tax year would produce `INCOMPLETE` paychecks in production.

### 32.3 Rollback

Rollback is non-destructive, auditable and reversible: reactivate the prior version, close the new
one as `ROLLED_BACK`, write an audit entry with a reason, and invalidate the rule cache (§37.4).
Historical snapshots are unaffected.

---

## 33. TEST STRATEGY

### 33.1 Layers

| Layer | Scope | Database |
|---|---|---|
| Unit | Pure Stage B functions with hand-built rule sets | No |
| Contract | zod detail schemas, invariants, type-level unit discipline | No |
| Integration | Phase 2 rule provider → resolution → Stage B | Yes |
| Golden | Official IRS worked examples | No |
| Regression | Phase 1–3 suites + snapshot reproducibility | Mixed |
| Property | Invariants over generated inputs | No |

### 33.2 Unit tests — required coverage

**Federal income tax withholding**
- Each Worksheet 1A line computed correctly in isolation
- 2020+ path (1d–1i) and pre-2020 path (1j–1l)
- Step 2 checkbox ⇒ schedule switch and line 1g = 0
- Step 3 credits: normal, exceeding tentative withholding, zero
- Step 4(a)/(b) annual handling; Step 4(c) per-period handling
- Exemption checkbox ⇒ zero FIT, FICA unaffected
- Row selection at exact boundaries: `atLeast`, `atLeast − 0.01`, `lessThan − 0.01`, `lessThan`
- Open-ended top row
- Zero wages; very large wages; wages exactly at a row boundary
- Multiple row matches ⇒ `RULE_CONFLICT`; zero matches ⇒ `RULE_CONFLICT`
- Every supported pay frequency

**Supplemental wages**
- Aggregate, optional flat, mandatory flat
- Optional-flat eligibility false ⇒ method refused
- Threshold crossing mid-payment ⇒ split
- Exempt employee + mandatory threshold crossed ⇒ withholding still applies

**Social Security** — the seven cases in §13.3
**Medicare** — the five cases in §14.4
**Additional Medicare** — the seven cases in §15.4, including filing-status invariance
**FUTA** — the eight cases in §18.7, including the employer-only triple check
**Buckets** — the six cases in §12.6 plus §19.3 independence
**Rounding** — §22.6
**Rule resolution** — §23.6 effective dates, §24.6 statuses
**Missing rules** — one test per required key: remove it, assert `INCOMPLETE` naming that key
**Decimal** — no float anywhere; precision configured; division precision asserted

### 33.3 Property tests

| Property |
|---|
| Varying any employer rate or the FUTA wage base leaves `netPay` bit-identical |
| Varying filing status leaves Additional Medicare bit-identical |
| Every tax amount is ≥ 0 for all generated non-negative inputs |
| Taxable never exceeds its bucket |
| Recomputing the same input twice returns bit-identical output |
| Withholding is monotonically non-decreasing in wages, holding W-4 constant |

### 33.4 Integration tests

Rule provider → resolution → calculation for a seeded fixture tax year; effective-date selection
against the database; status filtering against the database; source IDs retained end to end; snapshot
written and re-read; snapshot recomputation reproducibility (§29.3); cache invalidation on publish
and rollback.

### 33.5 Test data policy

- **Production federal data and test fixtures are stored separately and are clearly distinguishable.**
- Fixtures used for *mechanics* use obviously synthetic values (e.g. a ten percent flat schedule)
  and are labelled `SYNTHETIC — NOT TAX DATA` in the fixture file header and in the record itself.
- Fixtures used for *correctness against the IRS* are golden tests (§34) and must carry the source
  document, page, table, tax year, effective date and verification status.
- **Never** put a real-looking federal rate into a test merely to make a test pass.
- A test asserts no fixture marked `SYNTHETIC` can be loaded by a production code path.

### 33.6 Coverage expectations

100% branch coverage of `/lib/tax/federal/**` is the target; anything uncovered must be justified in
writing. Coverage is necessary but not sufficient — the golden tests are what establish correctness.

---

## 34. GOLDEN TEST CASES

### 34.1 Principle

**Expected federal results are never manufactured.** A golden test's expected value must come from an
official IRS worked example, or from a value the specification itself dictates arithmetically from
verified rule data with the derivation shown.

### 34.2 Sources of official worked examples

| Source | Content |
|---|---|
| Pub. 15-T, Worksheet 1A examples | Percentage method, automated systems — the primary golden source |
| Pub. 15-T, nonresident alien example | Includes a stated withholding result (uses the manual wage-bracket method, so it is a **future** golden once §7.8 is implemented) |
| Pub. 15-T sections 2–5 examples | Manual methods — out of scope, but useful cross-checks |
| Pub. 15, section 7 | Supplemental wage examples |
| IRS Tax Withholding Estimator | **Not** an authoritative golden source — it is a tool, not a published example. May be used as a sanity cross-check only, never as an expected value |

**PENDING DATA A-40:** extract every worked example from the 2026 Pub. 15-T and Pub. 15 with its page
and the exact inputs and stated result. This extraction is a required Phase 4 deliverable **before**
the engine is declared correct.

### 34.3 Golden test record shape

```
GoldenTestCase {
  id
  sourceDocument        // e.g. Publication 15-T (2026)
  sourcePage
  sourceSection         // section / worksheet / example number
  taxYear
  inputs { wages, payFrequency, w4Revision, filingStatus, step2Checked,
           step3, step4a, step4b, step4c, ytd... }
  expected { federalIncomeTaxWithheld, ... }
  expectedBasis: 'OFFICIAL_IRS_EXAMPLE' | 'DERIVED_FROM_VERIFIED_RULE_DATA'
  derivation?            // required when basis is DERIVED
  verificationStatus
}
```

`expectedBasis` is mandatory. A golden test without one of the two permitted bases cannot be merged.

### 34.4 Golden scenario matrix (to be populated from official examples)

| Scenario | Status |
|---|---|
| Weekly, single, no adjustments | `PENDING DATA` |
| Biweekly, MFJ, Step 2 checkbox | `PENDING DATA` |
| Semimonthly, HoH, Step 3 credits | `PENDING DATA` |
| Monthly, Step 4(a)/(b)/(c) all populated | `PENDING DATA` |
| Pre-2020 W-4 with allowances | `PENDING DATA` |
| Wages at the top open-ended row | `PENDING DATA` |
| Social Security wage-base crossing | Derivable from verified rule data — derivation required |
| Additional Medicare threshold crossing | Derivable — derivation required |
| FUTA wage-base exhaustion | Derivable — derivation required |
| Supplemental optional flat | `PENDING DATA` |
| Supplemental mandatory flat crossing | `PENDING DATA` |

### 34.5 Golden tests are tax-year scoped

Each golden test is pinned to its tax year and its engine version. Adding TY2027 adds new golden
tests; it never edits TY2026 ones. A test asserts that every supported tax year has at least one
`OFFICIAL_IRS_EXAMPLE` golden test — so a tax year cannot go live on derived expectations alone.

---

## 35. REGRESSION-TEST REQUIREMENTS

### 35.1 Preserve Phase 1–3

All existing Phase 1–3 tests must continue to pass unmodified. If a Phase 4 change requires editing
an existing test, that edit must be justified in the phase report as an intentional contract change —
never as a convenience.

### 35.2 Snapshot reproducibility regression

The §29.3 test is the most important regression in the project: publish a new rule version, then
recompute historical snapshots and assert byte-identical output.

### 35.3 Cross-phase regressions

Pipeline stage order unchanged; Phase 3 result contract additions are additive only; Decimal handling
unchanged; trace structure extended, not replaced; snapshot structure extended, not replaced.

### 35.4 Guard tests (scanners)

| Guard | Asserts |
|---|---|
| No-literals | No numeric tax literal in `/lib/tax/federal/**` (allowlist: 0, 1, and loop indices) |
| No-float | No `toFixed`, `parseFloat`, `Number(`, `Math.round` in `/lib/tax/federal/**` |
| Import boundary | No `/app` or `/components` import; no Prisma client outside the resolver |
| Source provenance | The loaded Track B rate schedule's source document is Pub. 15-T |
| Track separation | `FED.ANNUAL.*` keys are never read by any file under `fit/` other than `annualLiability.ts` |
| No deduction-type literals | No deduction type string literal in federal calculation code |
| Fixture isolation | `SYNTHETIC` fixtures are unreachable from production code paths |

### 35.5 CI gates

Typecheck, lint, format, unit, integration, golden, property, guards, Prisma validate, build,
`npm audit`. All must pass before a Phase 4 completion report may claim success. **Test results must
be reported truthfully; no claim of passing tests without an actual passing run.**

---

## 36. SECURITY AND PRIVACY CONSIDERATIONS

### 36.1 Input validation

All federal inputs validated with zod at the boundary: type, non-negativity, finiteness, maximum
magnitude, integer-ness where required, enum membership. Rejected input ⇒ `INVALID_INPUT` with a
field-level message that echoes **no** user value back into logs.

### 36.2 Error redaction

Federal errors are structured objects. They must never expose `DATABASE_URL`, connection strings,
secrets, environment variables, stack traces, internal file paths, or raw SQL to a user. Internal
detail goes to the logger through the existing Phase 1 redaction layer; users receive a stable
reason code plus plain language.

### 36.3 Numeric safety

| Threat | Mitigation |
|---|---|
| Float precision loss | Decimal end to end; no-float guard test |
| Overflow / absurd magnitudes | Sanity ceiling on every monetary input (§36.4) |
| Negative wages / YTD | Rejected at validation |
| `NaN` / `Infinity` | Rejected at validation; Decimal parse guarded |
| Decimal precision exhaustion from a huge input | Ceiling + explicit precision configuration |
| Malformed numeric strings | Strict parse, no coercion |

### 36.4 Sanity ceilings — D-SEC-1 (PENDING DECISION)

A configurable maximum per-period wage and per-field maximum, above which the engine returns
`INVALID_INPUT` rather than attempting arbitrary-precision arithmetic on an absurd number. The
ceiling is a **denial-of-service and data-quality control, not a tax rule**, and must be stored in
configuration, not in the rule tables, so it is never mistaken for tax data. Recommendation: set it
high enough never to affect a legitimate paycheck.

### 36.5 Privacy

Wages, W-4 data and YTD figures are sensitive. Phase 4 must: log **no** wage or W-4 values at any
level above debug; keep them out of error messages and out of URLs; hold them in the snapshot under
the existing Phase 1 retention and access controls; add no new personal-data field beyond the W-4
fields §7 requires; and carry no identity data into the federal engine at all — the engine sees
amounts and elections, never a name, SSN or email.

### 36.6 Rule mutation safety

The federal engine is strictly read-only with respect to rule data. Authentication and RBAC are later
phases; Phase 4 must not introduce any code path that writes a rule.

### 36.7 Untrusted source data

AI-extracted values are untrusted until human verification (§26.2). The publish gate is the trust
boundary, and it is enforced server-side.

---

## 37. PERFORMANCE AND CACHING CONSIDERATIONS

### 37.1 Targets

| Metric | Target |
|---|---|
| Stage B (pure calculation) | Sub-millisecond, no I/O |
| Stage A rule resolution, cold | One batched query |
| Stage A, warm | Cache hit, no query |
| Database queries per calculation | **Exactly one** batched resolution when cold; zero when warm |

### 37.2 Resolve once

One `resolveMany` per calculation (§3.3). Per-component resolution is forbidden.

### 37.3 Caching — D-PERF-1 (RECOMMENDED)

Cache the `ResolvedFederalRuleSet` keyed by `(taxYear, effectiveDate-bucket, jurisdiction, requiredKeySetHash, ruleDataVersion)`.

- `ruleDataVersion` is a monotonic token bumped on **every** federal publish, rollback or rule
  mutation. Including it in the key makes stale-cache correctness failures structurally impossible —
  a stale entry simply becomes unreachable rather than needing eviction.
- The effective-date component must be bucketed by day, not by timestamp, or the cache never hits.
- Cache the **resolved and validated** rule set, not raw rows, so zod parsing is not repeated.
- TTL is a backstop, not the correctness mechanism.

### 37.4 Invalidation

Publish, rollback, archive, restore and any rule edit bump `ruleDataVersion`. An integration test
asserts a published change is reflected in the very next calculation.

### 37.5 Correctness outranks speed

No cache may ever serve a rule set for the wrong effective date or a non-live status. If in doubt,
miss the cache. No premature infrastructure: an in-process cache is sufficient for Phase 4;
distributed caching is a later concern.

### 37.6 Determinism

Caching must not alter results. A test runs the same calculation with the cache warm and cold and
asserts bit-identical output.

---

## 38. API / SERVICE BOUNDARIES

### 38.1 Internal boundaries

```
UI (Phase 9)
   │  reads results and traces only — never a tax rule
Calculation pipeline (Phase 3)
   │  calls
Federal engine (Phase 4) ── pure, sync
   │  consumes
ResolvedFederalRuleSet
   │  produced by
Federal rule resolver (Phase 4, thin) ── the only impure federal file
   │  calls
Rule provider (Phase 2)
   │  reads
Database (Phase 1/2)
```

### 38.2 Public surface of the federal module

```
calculateFederalTaxes(context: FederalCalculationContext): FederalTaxResult   // pure
resolveFederalRuleSet(params): Promise<ResolvedFederalRuleSet | MissingRules> // impure
FEDERAL_RULE_KEYS                                                             // constants
federalDetailSchemas                                                          // zod
```

Nothing else is exported. Internal worksheet functions stay internal so they can be refactored
without breaking consumers.

### 38.3 Future public API readiness (no implementation in Phase 4)

The federal result contract is designed to be directly serializable as a future API response:
employee taxes, employer costs, rule versions, source references, status and trace are already
separated. **No API route, no API key, no rate limiting, no billing and no authentication in
Phase 4.**

### 38.4 Stability contract

`FederalTaxResult` is additive-only once Phase 4 ships. Removing or renaming a field is a breaking
change requiring an engine-version bump and a documented migration.

---

## 39. FUTURE-YEAR UPDATE WORKFLOW

### 39.1 The target experience

Adding TY2027 must require **only** new versioned rule data and source records entered through the
admin — **no code change**.

```
Admin → Tax Years → Create 2027 (DRAFT)
  → Clone 2026 federal rules → 2027 DRAFT
     (verification reset to PENDING, sources flagged stale)
  → Download the 2027 IRS publications, create Source records
  → For each rule: enter the 2027 value, record page/section/table/heading,
    mark VERIFIED (or NOT_STATED / NOT_APPLICABLE / CONFLICT)
  → Use Schedule Compare to diff 2026 vs 2027 rows
  → Run the publish gate → fix every failure
  → Enter the 2027 golden tests from the new publications
  → Run the federal test suite against the draft data
  → Review → Approve (different person for schedules) → Checkpoint → Publish
  → Set 2027 as the active tax year on its effective date
```

### 39.2 What would break the no-code-change promise, and the mitigations

| Risk | Mitigation |
|---|---|
| IRS changes the worksheet structure | The `method` enum on `FederalWithholdingSchedule` allows a new method alongside the old; old years keep working |
| A new W-4 step or field appears | Requires a code change. Detect early: annual review of the new Form W-4 in the checklist (§ verification checklist) |
| A new federal tax is introduced | Requires a new rule category and calculation — a code change by definition |
| Filing statuses change | Enum change — code change |
| A mid-year change is announced | Data only: new version with a mid-year `effectiveFrom` |
| Rate/base/threshold changes | Data only |
| Bracket count changes | Data only — rows are dynamic |

**The honest statement is:** routine annual value updates are data-only; structural changes to IRS
methodology require code. The annual checklist must therefore include a structural-diff review of the
new Pub. 15-T and Form W-4, not only a values review.

### 39.3 Annual calendar

| When | Action |
|---|---|
| Oct–Nov | Social Security wage base announced; annual inflation adjustments published (Track A) |
| Dec | Pub. 15-T, Pub. 15 and Form W-4 for the coming year published — begin entry |
| Dec | Structural-diff review of the new Pub. 15-T and W-4 |
| Late Dec | Publish gate, golden tests, approval, checkpoint, publish |
| 1 Jan | New tax year active; verify a sample calculation against an official example |
| Nov (prior year) | DOL/IRS FUTA credit-reduction determination — relevant when §18.6 is implemented |

---

## 40. PHASE 4 ACCEPTANCE CRITERIA

Phase 4 is complete only when **every** line is true.

**Methodology and data**
1. Federal withholding uses Pub. 15-T Worksheet 1A (percentage method, automated systems)
2. Annual 1040 brackets are never used for withholding, and a guard test proves it
3. Every 2026 federal value in production is source-backed with document, page, section/table and heading
4. No invented federal tax data exists anywhere in the repository
5. Every federal rule has a verification status and a verifier recorded
6. `NOT_STATED`, `NOT_APPLICABLE` and `CONFLICT` are used correctly and never coerced to zero
7. The Medicare wage-base `NOT_APPLICABLE` record exists and drives behaviour

**Engine**
8. Rule data is versioned; historical rules were never overwritten
9. Effective dates are enforced; no cross-version mixing within a calculation
10. Rule status is enforced; non-live statuses are never consumed
11. Social Security wage base handled including exhaustion and straddle
12. Medicare handled; uncapped behaviour is data-driven, not hardcoded
13. Additional Medicare is employee-only and filing-status-independent
14. FUTA is employer-only and never reduces net pay
15. Four federal taxable wage buckets derived independently from data-driven taxability
16. W-4 integration validated, including the 2026 exemption checkbox
17. Supplemental wage handling validated across all three methods with eligibility modelled
18. OBBBA tips/overtime are not deducted from any wage bucket, with a named test
19. All money is Decimal; no float anywhere in the federal engine
20. Rounding behaviour is documented, policy-driven, source-referenced and disclosed
21. Missing rules fail safely with the missing key named
22. Unsupported scenarios return `UNSUPPORTED_SCENARIO`, never an approximation
23. Calculation trace is complete across all 15 stages
24. Rule IDs, version IDs and source IDs are retained in the result and the snapshot
25. Historical calculations remain reproducible after new rules are published

**Quality gates**
26. All Phase 1–3 tests still pass, unmodified
27. All new federal unit, integration, golden, property and guard tests pass
28. At least one `OFFICIAL_IRS_EXAMPLE` golden test passes per supported scenario family
29. Typecheck passes · 30. Lint passes · 31. Format passes · 32. Build passes
33. Prisma validate passes · 34. Database integration tests pass on the Mac
35. `npm audit` passes
36. No secrets exposed; no wage or W-4 data in logs
37. No Phase 5+ work introduced
38. Documentation updated (`docs/FEDERAL-ENGINE.md`, `docs/CALCULATION-ENGINE.md`, `docs/TAX-DATA-ENTRY.md`)
39. Phase 4 report delivered in the master-spec §93 format with truthful test results
40. STOP — no Phase 5 work begun

---

## 41. RISKS AND UNRESOLVED DECISIONS

### 41.1 Top risks

| # | Risk | Impact | Mitigation |
|---|---|---|---|
| R1 | A transposed digit in a rate-schedule row | Silently wrong paychecks for a whole wage band; no exception thrown | Two-person verification (D-VERIFY-1); row-level verification; Schedule Compare diff; golden tests; contiguity validation |
| R2 | Annual 1040 brackets used for withholding | Systematically wrong withholding | Separate namespaces, separate types, guard test on source provenance |
| R3 | ~~2026 Form W-4 has a new field for OBBBA deductions~~ | **CLOSED** | **V-01 RESOLVED 2026-09-13: no new field. Step 4(b) Deductions Worksheet lines 1a/1b. Existing `step4bDeductionsAnnual` suffices; no schema change** |
| R4 | FUTA appearing as an employee deduction | Understated net pay; severe credibility damage | Three tests including the `netPay` property test |
| R5 | Additional Medicare treated as filing-status dependent or employer-matched | Wrong withholding and wrong employer cost | Dedicated invariance tests |
| R6 | Rounding policy differs from a user's real employer | Support complaints, perceived inaccuracy | Explicit policy disclosure in the trace and explanation (§22.4) |
| R7 | YTD convention ambiguity (D-SS-1) | Wrong wage-base behaviour for mid-year paychecks | Decide, document, validate, test, display |
| R8 | Historical results change when new rules are published | Breaks reproducibility and any issued report | Embed resolved detail in the snapshot (D-SNAP-1) + the §29.3 test |
| R9 | Pre-tax deduction taxability assumed uniform | Wrong buckets, wrong FICA | Tri-state data-driven profiles; `NOT_STATED` ⇒ `INCOMPLETE` |
| R10 | Partial tax-year data published | Production `INCOMPLETE` paychecks | Coverage gate (§32.2) |
| R11 | Cache serving a stale or wrong-status rule set | Silently wrong results | `ruleDataVersion` in the cache key |
| R12 | Supplemental optional-flat used without eligibility | Wrong withholding on bonuses | Eligibility modelled as a required boolean; aggregate as default |

### 41.2 PENDING DECISIONS (consolidated)

| ID | Decision | Recommendation |
|---|---|---|
| D-FIT-1 | Withholding method | Pub. 15-T Worksheet 1A only |
| D-FIT-2 | Exempt employee with a Step 4(c) amount | Resolve against Pub. 15 §9; do not silently drop |
| D-FIT-3 | Nonresident alien adjustment | Model now, feature-flag OFF, `UNSUPPORTED_SCENARIO` |
| D-FIT-4 | Computational bridge | Do not apply; store constants |
| ~~D-FIT-5~~ | **RESOLVED** — OBBBA tips/overtime mechanism | Closed by V-01: W-4 Step 4(b) Deductions Worksheet lines 1a/1b; no bucket reduction; no new field; tips and qualified overtime remain fully subject to Social Security and Medicare |
| D-SCHEMA-1 | Rate-schedule storage | Relational header + rows |
| D-SCHEMA-2 | Defer to an existing Phase 2 JSON detail pattern if one exists | Follow Phase 2 |
| D-SUPP-1 | Default supplemental method | Aggregate |
| D-FS-1 | Single vs MFS split for Track A | Separate explicit Track A status; never assume Single for MFS |
| D-DED-1 | Enforce contribution limits | No — record limits, advise in Phase 9 |
| D-SS-1 | YTD convention | Excluding the current period; confirm against Phase 3 |
| D-FUTA-1 | FUTA rule category | Dedicated `FUTA` category |
| D-FUTA-2 | FUTA credit reduction | Defer to Phase 5; disclose in Phase 4 |
| D-FREQ-1 | ANNUAL pay frequency | `UNSUPPORTED_SCENARIO` until a citation is found |
| D-ROUND-1 | Rounding policy | Cents, HALF_UP, at the tax level only; policy stored as rule data |
| D-DATE-1 | Tax-year derivation | Pay date, with explicit override; disclose fallbacks |
| D-STATUS-1 | `APPROVED` vs `ACTIVE` consumability | Only `ACTIVE`; confirm Phase 2 semantics |
| D-ERR-1 | Partial completion | Component-level status |
| D-SNAP-1 | Snapshot content | Embed resolved rule detail, not only IDs |
| D-VERIFY-1 | Two-person rule for schedules | Yes, for withholding rate schedules |
| D-PERF-1 | Caching | Rule-set cache keyed with `ruleDataVersion` |
| D-SEC-1 | Sanity ceilings | Configurable, in config not rule data |
| D-RES-1 | Batch resolution | Confirm or add a batch method additively |
| D-W4-1 | Extend the Phase 3 W-4 input | Additive extension; no parallel type |
| D-W4-2 | Implement the pre-2020 W-4 path in Phase 4? | Recommend yes — Worksheet 1A supports it natively and it is cheap |

### 41.3 PENDING VERIFICATION (consolidated)

| ID | Item |
|---|---|
| ~~V-01~~ | **RESOLVED 2026-09-13.** 2026 Form W-4 Step 4(b) Deductions Worksheet, line 1a (qualified tips) and line 1b (qualified overtime); total to Step 4(b). No new W-4 field. No schema change. Corroborated by Pub. 15-T (2026) *What's New*. Verification status `VERIFIED` — **no longer blocks the schema decision** |
| V-02 | Additional Medicare threshold comparison: strict or inclusive at exactly the threshold |
| V-03 | Which date governs the tax year for a period straddling 31 December (constructive receipt) |
| V-04 | FUTA credit-reduction states and mechanism for the applicable year |
| V-05 | An official periods-per-year factor for an ANNUAL payroll period |
| V-06 | The complete optional-flat-rate eligibility condition list (Pub. 15 §7) |
| V-07 | Every value in Appendix B, against the official PDF, with page/section/table/heading recorded |
| V-08 | Whether Pub. 15-T (2026) has been revised since 2025-12-11 — check `IRS.gov/Pub15T` Future Developments before entry |

---

# PHASE 4 ARCHITECTURE SUMMARY

DoPayCheck's Federal Tax Engine is a **pure, deterministic, data-driven calculation layer** that sits
inside the existing Phase 3 pipeline and consumes the Phase 2 versioned rule system through a single
batched resolution.

- **Two stages.** An impure resolver produces an immutable `ResolvedFederalRuleSet`; a pure engine
  turns it into a `FederalTaxResult`. This makes the engine testable without a database, fast, and —
  critically — **reproducible from a snapshot forever**.
- **Four separated tracks.** Annual liability estimation (display only), payroll withholding
  (Pub. 15-T Worksheet 1A), FICA, and employer federal taxes. They use different rule namespaces,
  different types and different result branches, so the classic bracket-substitution error is
  structurally prevented rather than merely discouraged.
- **No values in code.** Every rate, base, threshold, bracket, adjustment and even the pay-period
  factor and rounding policy is versioned, effective-dated, source-backed rule data. Guard tests
  enforce it.
- **Fails loudly, never quietly.** A missing rule returns `INCOMPLETE` naming the key. An unsupported
  scenario returns `UNSUPPORTED_SCENARIO`. There is no fallback to zero, to last year, or to an
  approximation anywhere in the design.
- **Employee and employer are separate branches**, so FUTA and employer FICA can never touch net pay.
- **Everything is traced.** Fifteen trace stages, worksheet-line-level intermediates, rule versions,
  source IDs and an explicit disclosure list feed the "Why is my paycheck this amount?" explanation.

## Required database entities and fields

| Entity | Status | Key fields |
|---|---|---|
| `RuleCategory` enum | **Extend** | Add `FUTA`; add federal withholding categories as needed |
| `FederalWithholdingSchedule` | **New** | `ruleId`, `taxYear`, `method`, `scheduleType`, `filingStatus`, `payPeriodBasis` |
| `FederalWithholdingScheduleRow` | **New** | `scheduleId`, `rowOrder`, `atLeast`, `lessThan?`, `baseAmount`, `ratePercent` |
| `DeductionTaxabilityProfile` | **New** | `ruleId`, `taxYear`, `deductionTypeKey`, four tri-state bucket flags, `annualLimitRuleKey?` |
| `Rule` | **Possibly extend** | A `ruleKey` field if Phase 2 does not already have one; confirm before migrating |
| Rule detail (scalar shapes) | **Extend or reuse** | `RATE`, `WAGE_BASE`, `THRESHOLD`, `AMOUNT_BY_FILING_STATUS`, `COUNT_BY_PAY_PERIOD`, `POLICY`, `BRACKET_TABLE` |
| `Source` | **Reuse** | Confirm page/section/table/heading/excerpt fields exist |
| `CalculationSnapshot` | **Extend** | Add the `federal` block from §29.1 |
| `FeatureFlag` | **Reuse** | `FEDERAL_NRA_ADJUSTMENT`, `FEDERAL_FUTA_CREDIT_REDUCTION`, `FEDERAL_ANNUAL_ESTIMATE` |
| `GoldenTestCase` | **New (optional)** | If golden cases are stored in the database rather than fixtures — **PENDING DECISION** |

All money `Decimal(18,6)`; all rates `Decimal(9,6)` with an explicit unit. **No migration is written
in this phase.** V-01 is resolved (no OBBBA field required); the remaining schema gate is D-SCHEMA-2.

## Required services and modules

`/lib/tax/federal/` — `index`, `types`, `context`, `ruleKeys`; `rules/` (resolver, rule-set type,
detail schemas); `fit/` (worksheet1A, rateSchedule, payPeriods, supplemental, nraAdjustment,
annualLiability); `fica/` (socialSecurity, medicare, additionalMedicare); `employer/` (futa,
employerCosts); `wages/federalWageBuckets`; `rounding/federalRounding`; `trace/federalTrace`;
`errors/federalErrors`. Plus validation-schema extensions for the W-4 input and publish-gate
validators for federal rule structures.

## Required admin screens

Tax Rules → Federal; Federal Withholding Schedules (row editor); Schedule Compare (year/version
diff); Federal Rates & Bases; Deduction Taxability matrix; Federal Sources; Federal Verification
Queue; Publish Gate checklist; Federal Test Runner; Federal Rule Audit. *(Requirements only —
built in Phase 8.)*

## Required APIs

**None are implemented in Phase 4.** Internal module boundaries only (§38.2). The result contract is
shaped for a future public API; no route, key, limit, log, version or billing is built now.

## Required tests

Unit (§33.2) · Property (§33.3) · Integration (§33.4) · Golden (§34) · Regression (§35) ·
Guards/scanners (§35.4) · CI gates (§35.5).

## Official-source verification checklist

- [ ] Check `IRS.gov/Pub15T` Future Developments for revisions since 2025-12-11 (V-08)
- [ ] Download Pub. 15-T (2026) PDF; record revision date and URL as a Source
- [ ] Download Pub. 15 (2026) PDF; record as a Source
- [ ] Download Pub. 15-B (2026) for deduction/fringe taxability
- [x] Download Form W-4 (2026) and instructions; **V-01 RESOLVED — Step 4(b) Deductions Worksheet lines 1a/1b; no new field**. Still required: record the Source record locators, and verify D-FIT-2 (exemption + Step 4(c)) against the same instructions
- [ ] Download Form 940 and Schedule A (Form 940)
- [ ] Record the SSA wage-base announcement
- [ ] Record the annual inflation-adjustment revenue procedure (Track A only)
- [ ] Extract the STANDARD annual rate schedules: all filing statuses, all rows, columns A/B/C/D
- [ ] Extract the Step 2 Checkbox annual rate schedules: all filing statuses, all rows
- [ ] Extract Worksheet 1A line 1g amounts and the line 1k allowance value
- [ ] Extract Worksheet 1A Table 3 periods-per-year
- [ ] Extract NRA Tables 1 and 2 (stored, flag off)
- [ ] Extract supplemental flat rates and the mandatory threshold (Pub. 15 §7) and the eligibility conditions (V-06)
- [ ] Extract SS rates and wage base; Medicare rates; record the Medicare wage base as `NOT_APPLICABLE` with a citation
- [ ] Extract the Additional Medicare rate and withholding threshold; resolve V-02
- [ ] Extract the FUTA gross rate, standard credit and wage base
- [ ] Extract every Pub. 15-T and Pub. 15 worked example for golden tests (A-40)
- [ ] For every value: record page, section, table, heading, excerpt, verification date, verifier
- [ ] Second-person verification of every rate-schedule row (D-VERIFY-1)
- [ ] Run the publish gate and fix every failure

## PENDING DATA / PENDING DECISIONS — headline list

**PENDING DATA (blocking):** both annual rate schedule sets × all filing statuses (A-01…A-06);
HoH and MFS annual brackets for Track A (A-20, A-21); deduction taxability profiles (A-30…A-37);
official worked examples for golden tests (A-40).

**PENDING VERIFICATION (blocking the schema):** ~~V-01~~ **RESOLVED 2026-09-13** — the 2026 Form W-4 handles OBBBA tips and overtime through the Step 4(b) Deductions Worksheet (lines 1a/1b); no new field and no schema change. The remaining schema gate is **D-SCHEMA-2** (REPO-CONFIRM).

**PENDING DECISIONS (25):** listed in §41.2, each with a recommendation.

## Phase 4 acceptance checklist

The 40 numbered criteria in §40.

---

# APPENDIX A — PENDING DATA MANIFEST

Every row below is **`PENDING DATA`**. No value is supplied, guessed or inferred.

| ID | Rule key | What is needed | Source locator to use |
|---|---|---|---|
| A-01 | `FED.FIT.RATE_SCHEDULE.ANNUAL.STANDARD` (MFJ) | All rows: columns A, B, C, D | Pub. 15-T (2026) §1, Annual Percentage Method table, STANDARD, Married Filing Jointly |
| A-02 | …STANDARD (Single/MFS) | All rows | Same table, Single or Married Filing Separately |
| A-03 | …STANDARD (HoH) | All rows | Same table, Head of Household |
| A-04 | `…STEP2_CHECKBOX` (MFJ) | All rows | Pub. 15-T (2026) §1, Form W-4 Step 2 Checkbox schedules, MFJ |
| A-05 | …STEP2_CHECKBOX (Single/MFS) | All rows | Same |
| A-06 | …STEP2_CHECKBOX (HoH) | All rows | Same |
| A-20 | `FED.ANNUAL.RATE_BRACKETS` (HoH) | Annual 1040 bracket thresholds | Annual inflation-adjustment revenue procedure (**not** Pub. 15-T) |
| A-21 | `FED.ANNUAL.RATE_BRACKETS` (MFS) | Annual 1040 bracket thresholds | Same |
| A-30 | Taxability profile — traditional 401(k) elective deferral | Four bucket flags | Pub. 15 / Pub. 15-B |
| A-31 | Taxability profile — §125 health premiums | Four bucket flags | Pub. 15 / Pub. 15-B |
| A-32 | Taxability profile — HSA via cafeteria plan | Four bucket flags | Pub. 15 / Pub. 15-B |
| A-33 | Taxability profile — HSA outside cafeteria plan | Four bucket flags | Pub. 15 / Pub. 15-B |
| A-34 | Taxability profile — health FSA | Four bucket flags | Pub. 15 / Pub. 15-B |
| A-35 | Taxability profile — dependent care FSA | Four bucket flags | Pub. 15 / Pub. 15-B |
| A-36 | Taxability profile — Roth 401(k) | Four bucket flags (expected all FALSE, but must be sourced) | Pub. 15 |
| A-37 | Taxability profile — each additional supported deduction | Four bucket flags | Pub. 15 / Pub. 15-B |
| A-40 | Golden test cases | Every worked example with inputs, stated result, page | Pub. 15-T (2026); Pub. 15 (2026) §7 |
| A-50 | `FED.FIT.COMPUTATIONAL_BRIDGE` | Bridge constants (stored, not applied) | Pub. 15-T (2026), computational bridge section |

---

# APPENDIX B — VALUE REGISTER

**Every row is `PENDING_VERIFICATION`.** Nothing here may be published until a human confirms it
against the official PDF and records page, section, table, heading, verification date and verifier.

### B.1 Values supplied by the project owner in the Phase 4 brief

| ID | Rule key | Provenance | Verification |
|---|---|---|---|
| B-01 | `FED.ANNUAL.STANDARD_DEDUCTION` (Single/MFS, HoH, MFJ) | Owner-supplied | `PENDING_VERIFICATION` — confirm against the annual revenue procedure |
| B-02 | `FED.ANNUAL.PERSONAL_EXEMPTION` (zero) | Owner-supplied; consistent with OBBBA's permanent termination of personal exemptions as stated in Pub. 15-T (2026) | `PENDING_VERIFICATION` |
| B-03 | `FED.ANNUAL.RATE_BRACKETS` — marginal rates | Owner-supplied | `PENDING_VERIFICATION` |
| B-04 | `FED.ANNUAL.RATE_BRACKETS` (Single) — thresholds | Owner-supplied | `PENDING_VERIFICATION` |
| B-05 | `FED.ANNUAL.RATE_BRACKETS` (MFJ) — thresholds | Owner-supplied | `PENDING_VERIFICATION` |
| B-08 | `FED.SS.EMPLOYEE_RATE` | Owner-supplied | `PENDING_VERIFICATION` — Pub. 15 |
| B-09 | `FED.SS.EMPLOYER_RATE` | Owner-supplied | `PENDING_VERIFICATION` — Pub. 15 |
| B-10 | `FED.SS.WAGE_BASE` | Owner-supplied | `PENDING_VERIFICATION` — SSA/IRS announcement |
| B-11 | `FED.MEDICARE.EMPLOYEE_RATE` | Owner-supplied | `PENDING_VERIFICATION` — Pub. 15 |
| B-12 | `FED.MEDICARE.EMPLOYER_RATE` | Owner-supplied | `PENDING_VERIFICATION` — Pub. 15 |
| B-12b | `FED.MEDICARE.WAGE_BASE` | Owner-supplied: no wage cap | Record as **`NOT_APPLICABLE`** with a Pub. 15 citation (§14.3) |
| B-16 | `FED.ADDL_MEDICARE.EMPLOYEE_RATE` | Owner-supplied; employee-only | `PENDING_VERIFICATION` |
| B-17 | `FED.ADDL_MEDICARE.WITHHOLDING_THRESHOLD` | Owner-supplied | `PENDING_VERIFICATION`; also resolve V-02 |
| B-18 | `FED.FUTA.GROSS_RATE` | Owner-supplied | `PENDING_VERIFICATION` — Pub. 15 / Form 940 |
| B-19 | `FED.FUTA.WAGE_BASE` | Owner-supplied | `PENDING_VERIFICATION` |
| B-20 | `FED.FUTA.STANDARD_CREDIT` | Owner-supplied maximum qualifying credit; the effective rate is **derived**, never stored (§18.3) | `PENDING_VERIFICATION` |

### B.2 Values retrieved from IRS.gov during this specification work

Retrieved from the Pub. 15-T (2026) HTML at `https://www.irs.gov/publications/p15t` on 2026-09-13.
These were **read from the official source**, not recalled or inferred — but they are still
`PENDING_VERIFICATION` because no human has confirmed them against the PDF and recorded the locator.

| ID | Rule key | Content | Verification |
|---|---|---|---|
| B-06 | `FED.FIT.W4.STEP2_UNCHECKED_ADJUSTMENT` | Worksheet 1A line 1g: filing-status-dependent amounts, entered only when the Step 2 box is **not** checked | `PENDING_VERIFICATION` — Pub. 15-T (2026), Worksheet 1A, Step 1, line 1g |
| B-07 | `FED.FIT.W4.ALLOWANCE_VALUE` | Worksheet 1A line 1k: per-allowance multiplier for pre-2020 Forms W-4 | `PENDING_VERIFICATION` — Worksheet 1A, line 1k |
| B-21 | `FED.FIT.PAY_PERIODS_PER_YEAR` | Worksheet 1A Table 3: Semiannually, Quarterly, Monthly, Semimonthly, Biweekly, Weekly, Daily. **Annually is not listed → `NOT_STATED`** (§20.4) | `PENDING_VERIFICATION` — Worksheet 1A, Table 3 |
| B-22 | `FED.FIT.NRA_WAGE_ADDITION.PRE2020` | Pub. 15-T Table 1: amounts by payroll period, pre-2020 W-4 | `PENDING_VERIFICATION` (stored, flag OFF) |
| B-23 | `FED.FIT.NRA_WAGE_ADDITION.POST2019` | Pub. 15-T Table 2: amounts by payroll period, 2020-or-later W-4 | `PENDING_VERIFICATION` (stored, flag OFF) |
| B-13 | `FED.SUPP.OPTIONAL_FLAT_RATE` | Pub. 15-T states the methods in that publication cannot be used where the optional flat rate is used; the rate itself is stated in Pub. 15 §7 | `PENDING_VERIFICATION` — Pub. 15 §7 |
| B-14 | `FED.SUPP.MANDATORY_FLAT_RATE` | As above, for the mandatory flat rate | `PENDING_VERIFICATION` — Pub. 15 §7 |
| B-15 | `FED.SUPP.MANDATORY_THRESHOLD` | Cumulative YTD supplemental wage threshold above which the mandatory rate applies | `PENDING_VERIFICATION` — Pub. 15 §7 |
| B-25 | W-4 Step 4(b) OBBBA representation | 2026 Form W-4, Step 4(b) Deductions Worksheet, line 1a (qualified tips), line 1b (qualified overtime); total to Step 4(b) | **`VERIFIED`** — owner-verified against the official 2026 Form W-4, 2026-09-13. Record page/line locators on the `IRS-W4-2026` Source record at entry time |
| B-24 | `FED.FIT.ROUNDING_POLICY` | Pub. 15-T's rounding guidance is permissive (§22.1); DoPayCheck selects a policy and cites the publication as permitting the options | `PENDING_VERIFICATION` |

---

**END OF PHASE 4 SPECIFICATION — STOP.**
No implementation code was written. No migration was created. No tax value was invented.
Phase 5 has not been started and must not be started without explicit instruction.

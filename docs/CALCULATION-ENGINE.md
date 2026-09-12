# DoPayCheck — Calculation Engine (Phase 3)

Architecture of the paycheck calculation engine.

`docs/SPECIFICATION.md` remains the authoritative Master Specification; this document explains
how Phase 3 implements §4, §5, §11–§17, §33, §34 and §40 of it. Section references below
(`spec §N`) point there.

This document describes **implemented behaviour only.** Where a capability is deferred it is
named as deferred, not described as working.

---

## 1. What Phase 3 is

The deterministic arithmetic and orchestration layer that turns a validated input into a
structured, traceable, source-attributed result.

Phase 3 contains **no tax values and no tax methodology.** There are no rates, brackets,
thresholds, wage bases or withholding tables anywhere in `lib/calculator/`, because none have
been sourced and verified yet. The engine resolves _which rule governs each component_ and
reports honestly when it cannot produce a figure.

A component backed by a usable, verified rule is currently returned as
`UNSUPPORTED_SCENARIO` / `METHOD_NOT_IMPLEMENTED` — the methodology that consumes rule values
arrives in Phases 4–6.

**Not in Phase 3:** federal withholding methodology (Phase 4), state engines (Phase 5),
locality resolution and local tax (Phase 6), any UI (Phases 9–10).

---

## 2. Five invariants

Everything below exists to hold these:

1. **No tax value is ever invented.** Missing data yields `amount: null` plus a reason —
   never `0` (spec §19).
2. **No floating-point arithmetic.** Every monetary value is a decimal string at the boundary
   and a `Decimal` inside (spec §4).
3. **The engine is pure and deterministic.** Same input + same rules + same policy + same
   engine version ⇒ byte-identical result.
4. **Every stage is traceable.** The trace is produced from the actual arithmetic, not from
   prose written alongside it (spec §17).
5. **Taxable-wage buckets are independent.** One taxable-wage figure is never assumed to apply
   to every tax (spec §5).

---

## 3. Module map

| Path                                        | Responsibility                                                         |
| ------------------------------------------- | ---------------------------------------------------------------------- |
| `lib/calculator/index.ts`                   | `calculatePaycheck` — the pipeline orchestrator and public entry point |
| `lib/calculator/types/input.ts`             | `CalculationInput` and its sub-shapes; all money is `DecimalString`    |
| `lib/calculator/types/result.ts`            | `CalculationResult`, `TaxComponent`, `TaxableWages`                    |
| `lib/calculator/types/rules.ts`             | The rule contract the engine consumes (`ResolvedRuleSet`)              |
| `lib/calculator/types/status.ts`            | `CalculationStatus`, `IncompleteReason`, status folding                |
| `lib/calculator/validation/input-schema.ts` | Zod shape + internal-consistency validation (stage 1)                  |
| `lib/calculator/rounding/policy.ts`         | Injected `RoundingPolicy`; `GENERIC_CURRENCY_POLICY`                   |
| `lib/calculator/pipeline/pay-frequency.ts`  | Calendar periods-per-year conversion                                   |
| `lib/calculator/pipeline/gross-pay.ts`      | Gross pay and annualization (stage 5)                                  |
| `lib/calculator/pipeline/deductions.ts`     | Pre-tax and post-tax deduction arithmetic (stages 6 and 12)            |
| `lib/calculator/pipeline/taxable-wages.ts`  | Seven independent wage buckets (stage 7)                               |
| `lib/calculator/pipeline/jurisdiction.ts`   | Jurisdiction chain from supplied codes (stage 3)                       |
| `lib/calculator/pipeline/tax-stages.ts`     | Component specs and rule evaluation (stages 8–11, 13)                  |
| `lib/calculator/trace/trace.ts`             | `TraceBuilder`, `TraceEntry`, step/category taxonomy                   |
| `lib/calculator/snapshot/snapshot.ts`       | Immutable snapshot payload construction (spec §40)                     |
| `lib/calculator/rule-provider.ts`           | The **only** Phase 3 module that touches the database                  |

---

## 4. Purity and the database boundary

`calculatePaycheck` is **synchronous and performs no I/O.** It never imports Prisma, a
repository, a clock or an environment variable. Rules arrive already resolved, as plain data.

```
loadRuleSet()  →  ResolvedRuleSet  →  calculatePaycheck()  →  CalculationResult
  (async, DB)        (plain data)        (pure, sync)
```

`lib/calculator/rule-provider.ts` is the bridge. It queries Phase 2's tables, re-applies the
pure Phase 2 resolver (`lib/rules/resolution.ts`) so resolution logic lives in exactly one
place, and maps the outcome onto the engine's contract.

Three consequences, all deliberate (spec §3):

1. The engine is deterministic, which is what makes a snapshot reproducible.
2. Every stage is testable with no database.
3. Persistence cannot contaminate calculation methodology.

---

## 5. The 17-stage pipeline

Executed in order by `calculatePaycheck`. Every stage appends to the trace.

| #     | Stage                        | Behaviour                                                                    |
| ----- | ---------------------------- | ---------------------------------------------------------------------------- |
| 1     | `validateInput`              | Zod shape + consistency. Failure ⇒ `INVALID_INPUT`, pipeline stops           |
| 2     | `normalizeInput`             | Structural only: absent deduction arrays become empty. No money conversion   |
| 3     | `resolveJurisdiction`        | Federal always applies; state/local only from supplied codes                 |
| 4     | `resolveApplicableRules`     | Records the rule set received (resolution itself happened upstream)          |
| 5     | `calculateGrossPay`          | Salary ÷ periods, or hours × rate (+ overtime)                               |
| 6     | `calculatePreTaxDeductions`  | Fixed amounts and percent-of-gross, in ordinal order                         |
| 7     | `determineTaxableWages`      | Seven buckets, each derived independently                                    |
| 8     | Federal                      | `FEDERAL_WITHHOLDING` component evaluated against its rule                   |
| 9     | FICA                         | Social Security, Medicare, Additional Medicare (employee side)               |
| 10    | State                        | `STATE_WITHHOLDING` component                                                |
| 11    | Local                        | `LOCAL_TAX` component                                                        |
| 12    | `calculatePostTaxDeductions` | Same arithmetic as stage 6, applied after tax                                |
| 13    | `calculateEmployerTaxes`     | SS, Medicare, FUTA, SUTA (employer side) — never reduce net pay              |
| 14    | `validateCalculation`        | Totals, net pay, effective rate, annualized gross, overall status fold       |
| 15/16 | Attach rule versions/sources | Deduplicated `ruleReferences` and `sourceIds` collected from every component |
| 17    | `createCalculationSnapshot`  | `buildSnapshot()` — pure, invoked by the **caller** after the engine returns |

Stage 17 sits outside `calculatePaycheck` on purpose: the engine stays pure and synchronous,
and the caller decides whether a given calculation is persisted (see §17).

The overall status is the **worst** component status, by the severity ordering in
`types/status.ts`: `COMPLETE` < `INCOMPLETE` < `UNSUPPORTED_SCENARIO` < `RULE_CONFLICT` <
`INVALID_INPUT` < `CALCULATION_ERROR`. An unresolved jurisdiction contributes `INCOMPLETE`.

---

## 6. Money

All authoritative arithmetic runs through `lib/core/money.ts` (Phase 1), which wraps
`decimal.js`.

- `money()` **refuses a JavaScript `number` at runtime.** A number may already have lost
  precision before the engine sees it.
- Every monetary field on `CalculationInput` and `CalculationResult` is a decimal **string**.
- Division always requires an explicit scale and rounding mode — there is no implicit
  rounding anywhere.
- Snapshots store amounts as strings, so JSON serialization cannot reintroduce IEEE-754 error.

---

## 7. Rounding

The `RoundingPolicy` is **injected**, never chosen by the engine:

```ts
calculatePaycheck(input, { rounding: GENERIC_CURRENCY_POLICY, rules });
```

`GENERIC_CURRENCY_POLICY` is 2 decimal places half-up for presented amounts, carrying 12
digits through intermediate steps.

> **PENDING DECISION.** `GENERIC_CURRENCY_POLICY` is **not a tax rule.** Correct rounding
> differs by tax, jurisdiction and official method (IRS wage-bracket vs percentage method,
> state-specific rules). No such methodology has been sourced, so the engine does not choose
> one. Tax-specific rounding must arrive as rule data in Phases 4–6.

---

## 8. Gross pay

`SALARY`: `annualSalary ÷ periodsPerYear`, rounded to the policy's currency precision after an
intermediate-precision division.

`HOURLY`: `regularHours × hourlyRate`, plus overtime when `overtimeHours` is supplied.

Overtime requires **exactly one** of:

- `overtimeRate` — an explicit per-hour rate ⇒ `overtimeHours × overtimeRate`
- `overtimeMultiplier` — a multiplier on the regular rate ⇒ `overtimeHours × hourlyRate × multiplier`

Supplying neither, or both, is `INVALID_INPUT`. **Neither is ever defaulted** — an overtime
premium (1.5×, double time, daily vs weekly thresholds) is jurisdiction law and is rule-driven
in Phase 5, not an engine constant.

Bonus, commission, tips and other compensation are added as supplied. This stage makes no
taxability decision about them.

### Periods per year

`WEEKLY` 52 · `BIWEEKLY` 26 · `SEMIMONTHLY` 24 · `MONTHLY` 12 · `QUARTERLY` 4 · `ANNUAL` 1.
These are unambiguous calendar facts, not tax values.

> **PENDING DECISION — `DAILY`.** The number of _paid_ days in a year is a payroll-policy
> choice (260, 261, 365 …) with no single correct answer. A `DAILY` calculation must supply
> `periodsPerYear` explicitly; without it the calculation returns `UNSUPPORTED_SCENARIO`
> rather than guessing.

---

## 9. Deductions

One implementation serves both pre-tax and post-tax deductions; they differ only in when they
are applied and whether they carry taxability metadata.

- `FIXED_AMOUNT` ⇒ the stated amount. `PERCENT_OF_GROSS` ⇒ `gross × percent`, where percent is
  a fraction (`"0.05"` = 5%).
- Applied in ascending `ordinal`, ties falling back to array order — so the breakdown is
  deterministic.
- `enabled: false` deductions are **skipped entirely**, not included as zero.

Every deduction must state its `taxability` explicitly. It is never inferred.

---

## 10. Independent taxable wage buckets

Seven buckets are derived independently in stage 7:

`federalIncomeTax` · `socialSecurity` · `medicare` · `stateIncomeTax` · `localIncomeTax` ·
`futa` · `suta`

Each is `gross − (deductions flagged for THAT bucket)`, floored at zero.

This exists to prevent a specific class of silent error. A 401(k) contribution typically
reduces federal income tax wages but **not** Social Security or Medicare wages; collapsing the
buckets into one "taxable wages" figure would produce the wrong FICA amount with no visible
symptom. A bucket flag that is absent means "does not reduce" — it is never inferred as true.

The zero floor is arithmetic, not a tax rule: deductions exceeding gross cannot create
negative taxable wages.

---

## 11. Jurisdiction

Phase 3 resolves the jurisdiction **codes the caller supplied** and nothing more. Federal
(`US`) always applies. An absent `stateCode` is reported as unresolved, never defaulted to "no
state tax". The work location determines the chain in this phase.

A ZIP code is accepted only as an input aid and is **never** treated as the taxing authority
(spec §9). A ZIP supplied with no locality codes is reported as unresolved.

> **Deferred to Phase 6:** deriving a legal taxing jurisdiction from an address or ZIP, and
> walking the county/city/school-district hierarchy.
>
> **Deferred to Phases 5–6:** residence-based taxation and reciprocity agreements.

---

## 12. How a tax component is evaluated

`evaluateComponent` in `pipeline/tax-stages.ts` applies these gates in order:

| Condition                                       | Result                                                |
| ----------------------------------------------- | ----------------------------------------------------- |
| No rule supplied for the category               | `INCOMPLETE` / `NO_APPLICABLE_RULE`                   |
| Two or more ACTIVE rules apply                  | `RULE_CONFLICT` / `AMBIGUOUS_RULE` — never arbitrated |
| Rule carries no verified source                 | `INCOMPLETE` / `RULE_UNVERIFIED`                      |
| Rule has no usable, verified value              | `INCOMPLETE` / `RULE_VALUES_PENDING`                  |
| Rule is usable, methodology not yet implemented | `UNSUPPORTED_SCENARIO` / `METHOD_NOT_IMPLEMENTED`     |

In **every** case the component's `amount` is `null`, never `"0"`, and the component carries
its reason plus the rule references that were consulted. The last row is the current state of
every component in Phase 3, because no verified rate data exists yet.

### Components tracked

| Group    | Components                                                                        |
| -------- | --------------------------------------------------------------------------------- |
| Federal  | `FEDERAL_INCOME_TAX_WITHHOLDING`                                                  |
| FICA     | `SOCIAL_SECURITY_EMPLOYEE`, `MEDICARE_EMPLOYEE`, `ADDITIONAL_MEDICARE_EMPLOYEE`   |
| State    | `STATE_INCOME_TAX_WITHHOLDING`                                                    |
| Local    | `LOCAL_INCOME_TAX_WITHHOLDING`                                                    |
| Employer | `SOCIAL_SECURITY_EMPLOYER`, `MEDICARE_EMPLOYER`, `FUTA_EMPLOYER`, `SUTA_EMPLOYER` |

Federal withholding is mapped to the `FEDERAL_WITHHOLDING` rule category, not to annual
brackets: paycheck withholding uses the official withholding methodology, and spec §6 forbids
substituting one for the other.

> **PENDING DECISION.** FUTA has no dedicated `RuleCategory` in the Phase 2 enum and is
> currently carried under `SOCIAL_SECURITY` as a federal employer obligation. Whether Phase 4
> adds a FUTA category is an open decision.

---

## 13. Employer liabilities

Employer components are evaluated separately and are **never** subtracted from employee net
pay (spec §48). They appear only under `employerTaxes` in the result, and they do not
contribute to `totalEmployeeTaxes`, `netPay` or `effectiveTaxRate`.

---

## 14. Totals, and why they can be null

`totalEmployeeTaxes` is `null` whenever **any** employee-side component is undetermined. A
partial sum would read as a complete one and understate what the employee owes.

Consequently:

- `netPay` is `null` when `totalEmployeeTaxes` is `null`.
- `effectiveTaxRate` is `null` when net pay is undetermined _or_ gross pay is zero.
- `annualized` is `null` when periods-per-year is undecided (`DAILY` without `periodsPerYear`).

`totalDeductions` is always stated, because deductions are caller-supplied and never depend on
tax data.

---

## 15. Statuses

`CalculationStatus` (spec §16):

| Status                 | Meaning                                                        |
| ---------------------- | -------------------------------------------------------------- |
| `COMPLETE`             | Every stage completed with applicable, verified rules          |
| `INCOMPLETE`           | Structurally valid, but a required rule was unavailable        |
| `INVALID_INPUT`        | The caller's input failed validation                           |
| `RULE_CONFLICT`        | Two or more ACTIVE rules applied. Never arbitrated             |
| `UNSUPPORTED_SCENARIO` | Understood, but not supported by the current rule architecture |
| `CALCULATION_ERROR`    | An unexpected engine failure — a defect, not a data state      |

`INVALID_INPUT` is deliberately distinct from `INCOMPLETE`: the caller can fix the former;
only sourcing official data fixes the latter.

The engine does not throw for any expected scenario. An unexpected throw is caught and
returned as `CALCULATION_ERROR` with the message only — **no stack trace leaves the engine.**

---

## 16. The trace

Every stage appends a `TraceEntry`:

| Field         | Content                                                                                                  |
| ------------- | -------------------------------------------------------------------------------------------------------- |
| `step`        | One of 15 `TraceStep` values                                                                             |
| `sequence`    | Zero-based pipeline position, assigned on insertion                                                      |
| `category`    | `INPUT` · `JURISDICTION` · `RULES` · `EARNINGS` · `DEDUCTIONS` · `WAGES` · `TAX` · `EMPLOYER` · `RESULT` |
| `description` | Short machine-readable label — **not** user-facing copy                                                  |
| `inputs`      | What the stage received, as exact strings                                                                |
| `outputs`     | What it produced, as exact strings                                                                       |
| `rules`       | Rule references that authorised the step                                                                 |
| `sourceIds`   | Official source IDs behind those rules, deduplicated                                                     |
| `status`      | The step's own outcome                                                                                   |
| `note`        | Why a step produced no value, when applicable                                                            |

`sequence`, `category` and `sourceIds` are assigned by `TraceBuilder`, so ordering and grouping
cannot drift from the pipeline.

This is the **data foundation only.** No user-facing text is generated in Phase 3. When
Phase 10 renders "Why Is My Paycheck This Amount?", it must render from this data, so the
explanation cannot contradict the arithmetic (spec §17).

---

## 17. Snapshots and historical reproducibility

A report issued today must stay explainable years later, after the rules it used have been
superseded. Re-running the engine against _current_ rules would produce a different answer and
silently rewrite history.

`buildSnapshot` therefore captures everything needed to reproduce the original:

`engineVersion` · `taxYear` · `effectiveDate` · jurisdiction codes · `status` ·
`originalInput` · `normalizedInput` · the full `result` including its trace ·
`ruleReferences` (id **and version**) · `sourceIds`

Rule references are **denormalized on purpose.** Pointing at live rule rows would leave the
snapshot at the mercy of later archival; copying the identity keeps it self-contained
(spec §40).

`ENGINE_VERSION` is recorded in every result and snapshot, and must be bumped whenever
calculation **methodology** changes — a snapshot is only reproducible against the engine that
produced it. It is currently `3.0.0-phase3`.

Persistence is the `CalculationSnapshot` table (`prisma/schema.prisma`). `buildSnapshot`
itself is pure; writing the payload is a separate concern.

---

## 18. Usage

```ts
import { calculatePaycheck, GENERIC_CURRENCY_POLICY } from '@/lib/calculator';
import { loadRuleSet } from '@/lib/calculator/rule-provider';
import { buildSnapshot, toPersistablePayload } from '@/lib/calculator/snapshot/snapshot';

const rules = await loadRuleSet({
  taxYear: input.taxYear,
  effectiveDate: input.effectiveDate,
  jurisdictionCodes: { SOCIAL_SECURITY: 'US', STATE_WITHHOLDING: 'US-CA' },
  categories: ['SOCIAL_SECURITY', 'STATE_WITHHOLDING'],
});

const result = calculatePaycheck(input, { rounding: GENERIC_CURRENCY_POLICY, rules });

// A component with no usable rule carries amount: null and a reason — never 0.
if (result.status !== 'COMPLETE') {
  // Surface result.federal/fica/state/local reasons; do not treat null as zero.
}

const snapshot = toPersistablePayload(buildSnapshot(input, result));
```

`rounding` and `rules` are both **required**. The engine supplies no default for either.

---

## 19. Testing

| File                                             | Focus                                                        |
| ------------------------------------------------ | ------------------------------------------------------------ |
| `tests/unit/calculator-gross-pay.test.ts`        | Pay frequency, salary/hourly, overtime, decimal exactness    |
| `tests/unit/calculator-deductions.test.ts`       | Deduction bases, ordering, disabled items, bucket derivation |
| `tests/unit/calculator-engine.test.ts`           | Pipeline orchestration, statuses, totals, trace              |
| `tests/unit/calculator-invariants.test.ts`       | Validation, rule-resolution safety, determinism, invariants  |
| `tests/integration/calculation-snapshot.test.ts` | Snapshot persistence and historical reproducibility          |

Tax-value fixtures are **deliberately absent.** Test rules carry identifiers and structure
only, and scenarios use non-real tax years (2095, 2099) so no fixture can be mistaken for
authoritative data. Golden tests against verified official values arrive with Phases 4–6, once
there are official values to test against (spec §61).

Integration tests skip cleanly when no database is configured.

---

## 20. Unresolved decisions

| Item                                                        | Status                                                            |
| ----------------------------------------------------------- | ----------------------------------------------------------------- |
| All federal, state and local tax values and methodology     | **PENDING DATA** — no official values recorded                    |
| Per-tax rounding methodology                                | **PENDING DECISION** (Phases 4–6)                                 |
| `DAILY` periods per year                                    | **PENDING DECISION** — caller must supply `periodsPerYear`        |
| Dedicated FUTA rule category                                | **PENDING DECISION** (Phase 4)                                    |
| YTD application (wage bases, Additional Medicare threshold) | **PENDING NEXT PHASE** (Phase 4) — `ytd` is accepted, not applied |
| W-4 withholding methodology                                 | **PENDING NEXT PHASE** (Phase 4) — `w4` shape only                |
| Supplemental-wage taxation (bonus, commission, tips)        | **PENDING NEXT PHASE** (Phases 4–5)                               |
| Locality resolution from ZIP / address                      | **PENDING NEXT PHASE** (Phase 6)                                  |
| Residence-based taxation and reciprocity                    | **PENDING NEXT PHASE** (Phases 5–6)                               |
| Verification against a non-container PostgreSQL instance    | **PENDING VERIFICATION**                                          |

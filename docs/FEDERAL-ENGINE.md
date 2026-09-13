# DoPayCheck — Federal Tax Engine (Phase 4)

Architecture of the federal payroll tax engine.

`docs/PHASE-4-FEDERAL-TAX-ENGINE-SPEC.md` is the authoritative Phase 4 specification; this
document explains how the code implements it. Section references below (`§N`) point there.
`docs/SPECIFICATION.md` remains the Master Specification for the project as a whole.

This document describes **implemented behaviour only.** Where a capability is modelled but not
applied, it says so.

---

## 1. What Phase 4 is — and is not

Phase 4 implements the federal **methodology**: how a federal payroll tax is computed once its
rule data exists. It does **not** supply the data.

There are no federal rates, brackets, thresholds, wage bases or withholding tables anywhere in
`lib/tax/federal/`. Every value arrives from a resolved, verified, sourced tax rule, and a
guard test (`tests/unit/federal-guards.test.ts`) fails the build if a numeric literal that
could be one appears.

The consequence, today: with no federal rules published, every federal component returns
`amount: null` with a stated reason. That is the correct output, not a gap — see §8 below.

---

## 2. Two stages, one boundary

```
Stage A  resolveFederalRuleSet()   impure   database → frozen ResolvedFederalRuleSet
Stage B  calculateFederalTaxes()   pure     frozen rule set + context → result
```

Stage A is the only module in the engine that may touch the outside world. Stage B reads no
database, no clock, no environment and no randomness — everything it needs arrives in the
frozen context (§2.3).

This split is what makes a historical paycheck reproducible: replay a snapshot's frozen rules
with the same input and the answer cannot have drifted because someone published a new rule
since. Guard tests enforce the boundary rather than trusting convention.

`resolvedAt` and `engineVersion` are recorded on the frozen set as metadata. Neither ever
enters arithmetic (§2.4).

---

## 3. Four tracks, structurally separate

| Track | What                                        | Namespace     | Can it change net pay? |
| ----- | ------------------------------------------- | ------------- | ---------------------- |
| A     | Annual 1040 liability estimate              | `FED.ANNUAL.` | **No** — display only  |
| B     | Paycheck withholding (Pub. 15-T)            | `FED.FIT.`    | Yes                    |
| C     | Employee FICA (SS, Medicare, Addl Medicare) | `FED.SS.` etc | Yes                    |
| D     | Employer taxes (SS, Medicare, FUTA)         | `FED.FUTA.`   | No — employer side     |

The separation is not stylistic. **Withholding a paycheck from the annual 1040 brackets is the
single most damaging mistake this engine could make**: the tables look alike, a plausible
number comes out, and it is wrong all year for everyone. Three mechanisms prevent it:

1. **Namespaced keys** (§2.5) — a mis-wiring is a visibly different string.
2. **Different detail shapes** (§6.3) — `BRACKET_TABLE` (Track A) has no base-amount column;
   `WITHHOLDING_SCHEDULE` (Track B) has columns A/B/C/D. They cannot be interchanged and still
   validate.
3. **Source provenance** (§35.4) — a rule filed under `FED.FIT.RATE_SCHEDULE.*` whose cited
   document is not Publication 15-T is refused at resolution, with reason
   `SOURCE_PROVENANCE_MISMATCH`. See `lib/tax/federal/rules/provenance.ts`.

**Track A never fails the paycheck** (§4.2). It is excluded from the status fold by
construction, so an unavailable annual estimate cannot make a withholding result INCOMPLETE.

---

## 4. Module map

| Path                                           | Responsibility                                           |
| ---------------------------------------------- | -------------------------------------------------------- |
| `lib/tax/federal/index.ts`                     | Stage B orchestrator; `calculateFederalTaxes`            |
| `lib/tax/federal/rule-keys.ts`                 | The 27 canonical rule keys (§2.5) and `requiredRuleKeys` |
| `lib/tax/federal/rules/resolver.ts`            | **Stage A.** The only impure module                      |
| `lib/tax/federal/rules/resolved-rule-set.ts`   | The frozen rule set Stage B consumes                     |
| `lib/tax/federal/rules/detail-schemas.ts`      | Zod shapes per rule key (§6.3)                           |
| `lib/tax/federal/rules/read-detail.ts`         | The only way a tax value enters the engine               |
| `lib/tax/federal/rules/provenance.ts`          | Track B source check (§35.4)                             |
| `lib/tax/federal/wages/federalWageBuckets.ts`  | The four independent wage buckets (§12)                  |
| `lib/tax/federal/fit/worksheet1A.ts`           | Pub. 15-T Worksheet 1A, line for line (§5.3)             |
| `lib/tax/federal/fit/rate-schedule.ts`         | Schedule row selection and its invariants (§5.4)         |
| `lib/tax/federal/fit/pay-periods.ts`           | Periods per year from Worksheet 1A Table 3               |
| `lib/tax/federal/fit/supplemental.ts`          | Supplemental wages (Pub. 15 section 7)                   |
| `lib/tax/federal/fit/nraAdjustment.ts`         | Nonresident-alien addition — modelled, flag off (§7.8)   |
| `lib/tax/federal/fit/annualLiability.ts`       | **Track A.** Display-only annual estimate                |
| `lib/tax/federal/fica/social-security.ts`      | OASDI with wage-base cap                                 |
| `lib/tax/federal/fica/medicare.ts`             | Medicare, including the NOT_APPLICABLE wage base (§14.3) |
| `lib/tax/federal/fica/additional-medicare.ts`  | Additional Medicare — employee only, no filing status    |
| `lib/tax/federal/employer/futa.ts`             | FUTA gross rate less credit, own wage base               |
| `lib/tax/federal/rounding/federal-rounding.ts` | Rounding policy resolution and its disclosure            |
| `lib/tax/federal/snapshot/federal-snapshot.ts` | Snapshot block and replay (§29)                          |
| `lib/tax/federal/invariants.ts`                | The §28.5 invariants, asserted before returning          |
| `lib/tax/federal/trace/federal-trace.ts`       | The 17-stage calculation trace                           |
| `lib/tax/federal/context.ts`                   | Phase 3 input → worksheet vocabulary; W-4 validation     |
| `lib/calculator/federal-bridge.ts`             | Bridge from the Phase 3 pipeline. One engine, extended   |

---

## 5. Worksheet 1A, line for line

`fit/worksheet1A.ts` transcribes the published worksheet rather than paraphrasing it: lines
1a–1i (2020-or-later W-4), 1j–1l (2019-or-earlier), 2a–2h, 3a–3c, 4a–4b. Every line is emitted
into `worksheetLines`, so the result can be checked against the paper form by a human who has
never read the code.

Its invariants (§5.4), asserted rather than assumed:

| ID    | Invariant                                              |
| ----- | ------------------------------------------------------ |
| FIT-1 | Line 1i / 1l floors at zero                            |
| FIT-2 | Line 3c floors at zero                                 |
| FIT-3 | Line 4c only ever increases withholding                |
| FIT-4 | Exactly one schedule row matches, else `RULE_CONFLICT` |
| FIT-5 | The top row is open-ended (`lessThan: null`)           |
| FIT-6 | Rows are contiguous and half-open                      |
| FIT-7 | No interpolation between rows                          |
| FIT-8 | No plausibility cap is applied to the result           |

---

## 6. Wage buckets are independent, and never zeroed

The four buckets — federal income tax, Social Security, Medicare, FUTA — are derived
**separately** from per-deduction-type taxability profiles (§12). A traditional deferral
reduces income tax wages but not FICA wages; a section 125 premium reduces all three. The
engine contains no deduction-type literal; the treatment is data, and a guard test enforces
that.

Taxability is **tri-state**: `TRUE`, `FALSE`, `NOT_STATED`. `NOT_STATED` is never coerced to
`FALSE` (§12.2).

When a deduction's treatment for one bucket is unknown or NOT_STATED, that bucket is `null` and
every tax that reads it reports INCOMPLETE. It is **not** set to zero: a zeroed bucket would
under-withhold silently, with a confident-looking number and no symptom. The other buckets are
unaffected — an unknown Medicare treatment must not block income tax withholding.

---

## 7. Rate units, and where conversion happens

Every rate in rule data carries `unit: PERCENT | DECIMAL_FRACTION` (§6.4). Conversion happens
in exactly one place — `readRate()` in `rules/read-detail.ts` — so a rate can never be divided
by 100 twice or not at all. Getting this wrong by a factor of 100 is the classic payroll bug;
centralising it makes the mistake structurally unavailable.

---

## 8. Missing data is an answer

Nothing in the engine returns a default, a fallback or a zero stand-in. `read-detail.ts`
deliberately has no overload that takes a default value, because a default is exactly the
fabricated number the specification forbids.

Distinguished states (§19, §28):

| State            | Meaning                                                              |
| ---------------- | -------------------------------------------------------------------- |
| `NOT_APPLICABLE` | The source positively states the concept does not apply. **Usable.** |
| `NOT_STATED`     | The source does not state a value. Not zero. Not usable.             |
| `PENDING`        | Not yet verified. Not usable.                                        |
| `CONFLICT`       | Sources disagree. Escalated, never arbitrated.                       |

`NOT_APPLICABLE` being usable matters in practice: `FED.MEDICARE.WAGE_BASE` must **exist** as a
record marked `NOT_APPLICABLE` (Medicare has no wage base). An absent record is a gap and makes
the result INCOMPLETE; a present `NOT_APPLICABLE` record is a verified statement and lets the
calculation proceed (§14.3).

---

## 9. Failure taxonomy

The engine does not throw for domain conditions (§28.6). A missing rule, an unverified value,
an unsupported scenario and a rule conflict are ordinary states of a tax system whose data is
published gradually; each is returned as a typed reason on the component it affects.

| Reason                       | Calculation status     |
| ---------------------------- | ---------------------- |
| `RULE_MISSING`               | `INCOMPLETE`           |
| `RULE_UNVERIFIED`            | `INCOMPLETE`           |
| `COMPONENT_NOT_STATED`       | `INCOMPLETE`           |
| `TAXABILITY_NOT_STATED`      | `INCOMPLETE`           |
| `PENDING_VERIFICATION`       | `INCOMPLETE`           |
| `RULE_CONFLICT`              | `RULE_CONFLICT`        |
| `RULE_DETAIL_INVALID`        | `RULE_CONFLICT`        |
| `SOURCE_PROVENANCE_MISMATCH` | `RULE_CONFLICT`        |
| `SCENARIO_UNSUPPORTED`       | `UNSUPPORTED_SCENARIO` |
| `FEATURE_DISABLED`           | `UNSUPPORTED_SCENARIO` |
| `INPUT_INVALID`              | `INVALID_INPUT`        |
| `INVARIANT_BREACH`           | `CALCULATION_ERROR`    |

`INVARIANT_BREACH` is the odd one out: it means the engine contradicted itself, which is a
defect, not a data state.

---

## 10. Snapshots and replay

The snapshot block embeds the **resolved rule detail**, not rule IDs, plus a SHA-256
`detailHash` over each detail's canonical JSON (§29.2, D-SNAP-1).

Storing only IDs would leave history at the mercy of a rollback, a correction or an archival
policy — precisely the things versioning exists to permit. Provenance is stored verbatim too
(`jurisdictionId`, `verified`) rather than re-derived, so a replayed result cites exactly what
the original cited.

`ruleSetFromSnapshot()` reads the snapshot and never the live tables. The test of the design:
publish a new rule tomorrow, replay a snapshot from today, and the answer must not move — which
`tests/unit/federal-snapshot.test.ts` asserts byte-for-byte.

---

## 11. Trace and its two audiences

All fifteen §27.1 stages are emitted for a full scenario: wage buckets, tax-year resolution,
rule resolution, pay frequency, W-4 normalisation, Worksheet 1A, schedule row, supplemental,
Social Security, Medicare, Additional Medicare, FUTA, employer taxes, rounding, annual estimate
and disclosures.

`toUserTrace()` is the user-facing projection (§27.4). It drops `rules` and `sourceIds`
**structurally** rather than redacting field by field — a projection that filtered contents
would leak the first identifier someone added later — and withholds `RULE_RESOLUTION`
entirely, since that stage exists for administrators. Tests assert no rule ID or source ID
appears in the projection.

The W-4 stage records the form's structural answers only. No free-text employee detail is
traced, and the engine writes no logs at all (§36).

---

## 12. Tests

| File                                                | Covers                                        |
| --------------------------------------------------- | --------------------------------------------- |
| `tests/unit/federal-worksheet-1a.test.ts`           | Worksheet lines and the FIT invariants        |
| `tests/unit/federal-fica-futa.test.ts`              | Tracks C and D, wage bases, thresholds        |
| `tests/unit/federal-engine.test.ts`                 | Orchestration, statuses, disclosures, trace   |
| `tests/unit/federal-properties.test.ts`             | Properties across a wage spread               |
| `tests/unit/federal-snapshot.test.ts`               | Snapshot contents, hashes and replay identity |
| `tests/unit/federal-guards.test.ts`                 | The seven §35.4 scanners                      |
| `tests/unit/federal-pipeline-integration.test.ts`   | Phase 3 pipeline + Phase 4 engine together    |
| `tests/integration/federal-rule-resolution.test.ts` | Stage A against a real database               |
| `tests/golden/federal/`                             | Official worked examples — registry empty     |

**Every fixture value is synthetic** and marked as such: ten-percent rates, a wage base of
1000, tax years 2097 and 2099. They are chosen to be obviously fake so a real figure can never
be mistaken for one, and so a test that accidentally asserted a real-world amount would stand
out. A guard test fails if production code can reach a fixture.

The **golden registry is empty**, deliberately. Official IRS worked examples are PENDING DATA;
the runner is complete and skips with a stated reason rather than passing against invented
expectations. One test asserts the registry is empty — it is designed to fail the day official
data lands, as the signal to populate it.

---

## 13. Feature flags and open items

| Item                                    | State                                                          |
| --------------------------------------- | -------------------------------------------------------------- |
| All federal tax values                  | **PENDING DATA** — no official rule is published               |
| Official golden cases                   | **PENDING DATA** — registry intentionally empty                |
| Nonresident-alien wage addition         | Modelled, flag off (§7.8) — the India carve-out is unresolved  |
| Additional Medicare threshold semantics | **PENDING VERIFICATION** (V-02) — strict vs inclusive          |
| Step 4(c) alongside an exemption claim  | **PENDING DECISION** (D-FIT-2) — amount preserved, not applied |

An open item is surfaced as a disclosure or a typed reason on the affected component. None is
resolved by assumption.

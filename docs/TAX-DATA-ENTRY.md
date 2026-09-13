# DoPayCheck — Federal Tax Data Entry

How to record federal tax rule data so the Phase 4 engine can use it.

This is an **operator** document. It describes what a rule record must contain, not how the
arithmetic works — for that see `docs/FEDERAL-ENGINE.md`. The authoritative requirements are in
`docs/PHASE-4-FEDERAL-TAX-ENGINE-SPEC.md`; section references (`§N`) point there.

---

## 0. The rules that override everything else

1. **Never invent a value.** If the official document does not state it, the value is
   `NOT_STATED`. Not zero. Not "probably the same as last year."
2. **Never resolve a conflict yourself.** Two sources disagreeing is `CONFLICT`, escalated to a
   human decision. The engine will refuse the rule, which is the correct outcome.
3. **The official government document is the source.** Not a news article, not a payroll
   vendor's summary, not a previous year's record, not an AI-generated extraction.
4. **AI may assist with extraction; AI output is never authoritative.** A value reaches `ACTIVE`
   only after human verification and approval.
5. **A published historical rule is never overwritten.** Supersede it; never edit it in place.

---

## 1. What the engine needs before it can calculate anything

Nothing federal computes until these exist as `ACTIVE`, verified rules for the tax year, in the
`US` jurisdiction. Ten are always required:

| Key                                       | Shape                 | Notes                                        |
| ----------------------------------------- | --------------------- | -------------------------------------------- |
| `FED.SS.EMPLOYEE_RATE`                    | `RATE`                | `appliesTo: EMPLOYEE`                        |
| `FED.SS.EMPLOYER_RATE`                    | `RATE`                | `appliesTo: EMPLOYER`                        |
| `FED.SS.WAGE_BASE`                        | `WAGE_BASE`           | `applicability: APPLIES`                     |
| `FED.MEDICARE.EMPLOYEE_RATE`              | `RATE`                |                                              |
| `FED.MEDICARE.EMPLOYER_RATE`              | `RATE`                |                                              |
| `FED.MEDICARE.WAGE_BASE`                  | `WAGE_BASE`           | **`applicability: NOT_APPLICABLE`** — see §4 |
| `FED.ADDL_MEDICARE.EMPLOYEE_RATE`         | `RATE`                | Employee only; there is no employer share    |
| `FED.ADDL_MEDICARE.WITHHOLDING_THRESHOLD` | `THRESHOLD`           | Withholding threshold, not the filing one    |
| `FED.FIT.PAY_PERIODS_PER_YEAR`            | `COUNT_BY_PAY_PERIOD` | Worksheet 1A Table 3                         |
| `FED.FIT.ROUNDING_POLICY`                 | `POLICY`              | Our disclosed choice, not an IRS mandate     |

Then, per scenario:

| Scenario                       | Additionally required                                                                         |
| ------------------------------ | --------------------------------------------------------------------------------------------- |
| Income tax withholding         | `FED.FIT.RATE_SCHEDULE.ANNUAL.STANDARD`, `FED.FIT.W4.STEP2_UNCHECKED_ADJUSTMENT`              |
| Step 2 checkbox ticked         | `FED.FIT.RATE_SCHEDULE.ANNUAL.STEP2_CHECKBOX`                                                 |
| 2019-or-earlier W-4            | `FED.FIT.W4.ALLOWANCE_VALUE`                                                                  |
| Supplemental wages             | `FED.SUPP.OPTIONAL_FLAT_RATE`, `FED.SUPP.MANDATORY_FLAT_RATE`, `FED.SUPP.MANDATORY_THRESHOLD` |
| Employer taxes                 | `FED.FUTA.GROSS_RATE`, `FED.FUTA.STANDARD_CREDIT`, `FED.FUTA.WAGE_BASE`                       |
| Annual estimate (display only) | `FED.ANNUAL.STANDARD_DEDUCTION`, `FED.ANNUAL.RATE_BRACKETS`, `FED.ANNUAL.PERSONAL_EXEMPTION`  |

A key the scenario does not need is never required — an unused rule's absence must not block a
valid calculation.

---

## 2. Rate unit: the 100× trap

Every `RATE` and every schedule row carries an explicit `unit`:

- `PERCENT` — 6.2 means six point two percent
- `DECIMAL_FRACTION` — 0.062 means the same thing

**Record the unit the source uses, and record the number exactly as printed.** Do not convert
by hand. The engine converts once, in `readRate()`, and a test asserts it. Hand-converting is
how a rate ends up applied at 100× or 1/100×.

---

## 3. The two rate tables that must never be swapped

`FED.FIT.RATE_SCHEDULE.*` (withholding) and `FED.ANNUAL.RATE_BRACKETS` (annual liability) are
different documents for different purposes:

|          | `FED.FIT.RATE_SCHEDULE.*`               | `FED.ANNUAL.RATE_BRACKETS`       |
| -------- | --------------------------------------- | -------------------------------- |
| Source   | **Publication 15-T**                    | The annual inflation adjustments |
| Shape    | `WITHHOLDING_SCHEDULE`, columns A/B/C/D | `BRACKET_TABLE`, no base amount  |
| Used for | The paycheck                            | A display-only estimate          |

The withholding schedule has a **base amount** column (column C) that the annual brackets do
not. If you are entering a table with no base-amount column into a `FED.FIT.` key, stop: it is
the wrong table.

The engine enforces this. A rule under `FED.FIT.RATE_SCHEDULE.*` whose attached source document
is not Publication 15-T is **refused** at resolution with `SOURCE_PROVENANCE_MISMATCH`. The
check matches the document by code or title (`IRS-PUB-15-T-2026`, `Publication 15-T`,
`Pub 15T` all pass), so record the source document properly and it will resolve.

### Entering a withholding schedule

One row per published row, per filing status, with `rowOrder` ascending:

- `atLeast` — column A
- `lessThan` — column B, and **`null` on the final row** (it is open-ended)
- `baseAmount` — column C
- `rate` + `unit` — column D

Rows must be contiguous and half-open: each row's `lessThan` is the next row's `atLeast`. A gap
or an overlap makes exactly-one-row selection impossible and the engine reports
`RULE_CONFLICT` rather than picking one.

---

## 4. `NOT_APPLICABLE` is a value; absence is not

`FED.MEDICARE.WAGE_BASE` must **exist**, as a `WAGE_BASE` record with
`applicability: NOT_APPLICABLE`. Medicare has no wage base, and that is a positive, sourced
statement — the engine treats it as usable and proceeds.

Leaving the record out instead means "we have not looked", and the engine reports the result
INCOMPLETE. Both are honest; only one lets the calculation run. Record the `NOT_APPLICABLE`.

The same distinction applies throughout:

| Verification status  | Meaning                                     | Engine may compute from it |
| -------------------- | ------------------------------------------- | -------------------------- |
| `VERIFIED`           | Human-checked against the official document | Yes                        |
| `NOT_APPLICABLE`     | The source states it does not apply         | Yes                        |
| `PENDING`            | Not yet checked                             | No                         |
| `NOT_STATED`         | The source does not state a value           | No                         |
| `CONFLICT`           | Sources disagree                            | No                         |
| `PARTIALLY_VERIFIED` | Some components checked, others not         | No                         |

---

## 5. Sources are part of the rule, not a footnote

A rule with no `VERIFIED` source link is **downgraded to `PENDING` at resolution**, whatever
its own verification status says. An attached but unverified source does not make a rule
authoritative.

Record, on the `TaxRuleSource` link:

- the `Source` document (code, organization, title, official URL, publication date)
- `page` / `section` / `table` / `heading` — where in the document the value appears
- `excerpt` — the supporting text **verbatim**, never paraphrased into a value
- `verificationStatus`, plus who verified it and when

The locator is what makes a value re-checkable next year by someone who was not there this
year.

---

## 6. Publishing

```
DRAFT → validate → source check → conflict check → tests → PENDING_REVIEW → APPROVED → ACTIVE
```

Publishing is blocked when a required field is missing, a source is missing, the effective
dates are invalid, a conflict exists, a required test fails, or approval is absent. A cloned
rule is never automatically activated.

**Effective dates**, not overwrites. A 2027 rule does not replace a 2026 rule: it is a new
record with its own effective period, and the 2026 rule is superseded. Historical results must
stay reproducible, and calculation snapshots embed the rule detail they used precisely so that
a later correction cannot silently rewrite a paycheck someone already received.

Exactly one `ACTIVE` rule may cover a given key at a given instant. Two is a data defect; the
engine reports `RULE_CONFLICT` and refuses to arbitrate.

---

## 7. Never enter as tax data

- A value from a test fixture. Fixtures are synthetic and marked `SYNTHETIC`; ten-percent rates
  and a wage base of 1000 are not tax data and must never be seeded.
- A value carried forward from a prior year "because it usually doesn't change".
- A placeholder zero, so that a screen stops showing an error.
- A URL that has not been checked to resolve to the actual document.
- An AI-extracted value that no human has verified against the document itself.

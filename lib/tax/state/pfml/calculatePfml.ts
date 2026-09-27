import { type Money, multiply } from '@/lib/core/money';
import type { RuleReference } from '@/lib/calculator/types/rules';

import { StateReason, stateUnavailable } from '../errors/stateErrors';
import { readDetail, readFail, readOk, readRate, type Read } from '../rules/read-detail';
import type { StateRateDetail } from '../rules/detailSchemas';
import { applyStateWageBase } from '../rules/wageBase';
import { stateRule, type ResolvedStateRuleSet } from '../rules/stateRuleSet';
import { StateRuleKey } from '../ruleKeys';

/**
 * PFML (Paid Family and Medical Leave) calculation — DM-03 Slice 11.
 *
 * ===========================================================================
 * PFML's OWN CONTRACT, INDEPENDENTLY VERIFIED — NOT A COPY OF SDI'S.
 *
 * `PFML_EMPLOYEE_RATE`/`PFML_EMPLOYER_RATE`/`PFML_WAGE_BASE` (`ruleKeys.ts`)
 * validate under exactly the schemas SDI's own rule keys validate under
 * (`STATE_DETAIL_SCHEMAS`, `detailSchemas.ts`: `stateRateDetailSchema` /
 * `stateRateDetailSchema` / `stateWageBaseDetailSchema` — confirmed by
 * reading the registry directly, not inferred from the two programmes
 * "looking similar"). `applyStateWageBase()` (`wageBase.ts`) is ALREADY
 * generic over `PFML_WAGE_BASE` (its own `StateWageBaseRuleKey` union names
 * it explicitly, alongside `SDI_WAGE_BASE`/`SUTA_WAGE_BASE`) — built for
 * exactly this reuse, Task 3. No production reader/calculator touched any
 * `PFML_*` rule key before this slice (confirmed by repository search —
 * only the F-02 capability mapping and doc-comment mentions existed).
 *
 * Because the underlying schema evidence for PFML is genuinely identical in
 * shape to SDI's, this module reaches the same conclusions SDI's module
 * does on wage base / applicability / rounding — but it is its own,
 * independent module, not a shared abstraction: DM-03 Slice 11's own
 * instruction is explicit that looking similar does not justify inventing
 * a shared generic framework, so PFML's rule keys, labels and doc comments
 * are all its own, verified separately below.
 * ===========================================================================
 *
 * ===========================================================================
 * WAGE BASE: YTD-AWARE (DM-03 wage-base YTD wiring).
 *
 * Identical reasoning to `calculateSdi.ts`, re-verified for PFML:
 * `applyStateWageBase()` now consumes the caller-supplied
 * `StateCalculationContext.ytd.pfmlWages` — wages from this employer,
 * EXCLUDING the current pay period, per `StateYtd`'s own established
 * convention — to compute `remaining = max(base - ytdWages, 0)` before
 * clamping the current period's wages against it:
 *
 *   PFML_WAGE_BASE resolves NOT_APPLICABLE -> no cap exists; proceed uncapped.
 *   PFML_WAGE_BASE resolves APPLIES        -> capped correctly against the
 *                                              remaining annual base, using
 *                                              the supplied YTD figure.
 *   PFML_WAGE_BASE rule missing/unverified/invalid -> that failure, verbatim.
 *
 * `PFML_MAX_CONTRIBUTION` (`stateThresholdDetailSchema`) is a different,
 * still-deferred concern (a contribution-total cap, not a wage-base cap) —
 * it has NO existing reader/primitive anywhere in the repository and
 * remains entirely unread here; this wiring does not extend to it.
 * ===========================================================================
 *
 * ===========================================================================
 * APPLICABILITY: READ FROM THE RATE ITSELF.
 *
 * `stateRateDetailSchema`'s `applicability`/`appliesTo` fields, consulted
 * the same way `withholdingFormulaInterpreter.ts`'s `applyFlatRate()` and
 * `calculateSdi.ts` already do for other `RATE`-shaped keys. No
 * `PFML_PROGRAM`/`CAPABILITY_DECLARATION` reader exists anywhere in the
 * repository to establish how they should gate a calculation, so neither is
 * read here.
 * ===========================================================================
 *
 * ROUNDING: NONE. No `STATE.PFML.ROUNDING_POLICY` (or equivalent) key
 * exists anywhere in `StateRuleKey` — confirmed directly, not assumed from
 * SDI. `multiply()` never rounds; full Decimal precision is returned.
 *
 * PURE. No database access, no filesystem, no global state, no rule lookup
 * beyond the frozen `ResolvedStateRuleSet` it is handed, no taxability
 * resolution (the caller supplies already-resolved `pfmlWages`).
 */

export interface PfmlContribution {
  readonly amount: Money;
  readonly rules: readonly RuleReference[];
}

function ruleReference(
  ruleSet: ResolvedStateRuleSet,
  key: StateRuleKey,
): RuleReference | undefined {
  const entry = stateRule(ruleSet, key);
  return entry.available ? entry.rule.reference : undefined;
}

/** Resolves this pay period's PFML-taxable wages against the wage base, or
 * explains why that cannot be done yet. Shared by both contribution sides —
 * the wage base is one fact, not a per-side one. */
function resolvePfmlTaxableWages(
  ruleSet: ResolvedStateRuleSet,
  pfmlWages: Money,
  ytdWages: Money,
): Read<{ readonly applicableWages: Money; readonly reference: RuleReference | undefined }> {
  const wageBase = applyStateWageBase(ruleSet, StateRuleKey.PFML_WAGE_BASE, pfmlWages, ytdWages);
  if (!wageBase.ok) {
    return readFail(wageBase.problem);
  }

  return readOk({
    applicableWages: wageBase.value.applicableWages,
    reference: ruleReference(ruleSet, StateRuleKey.PFML_WAGE_BASE),
  });
}

function calculatePfmlSide(
  ruleSet: ResolvedStateRuleSet,
  pfmlWages: Money,
  ytdWages: Money,
  rateRuleKey: typeof StateRuleKey.PFML_EMPLOYEE_RATE | typeof StateRuleKey.PFML_EMPLOYER_RATE,
  expectedSide: 'EMPLOYEE' | 'EMPLOYER',
): Read<PfmlContribution> {
  const taxable = resolvePfmlTaxableWages(ruleSet, pfmlWages, ytdWages);
  if (!taxable.ok) {
    return readFail(taxable.problem);
  }

  const found = readDetail(ruleSet, rateRuleKey);
  if (!found.ok) {
    return readFail(found.problem);
  }
  const rateDetail = found.value.detail as StateRateDetail;

  if (rateDetail.applicability === 'NOT_APPLICABLE') {
    return readFail(
      stateUnavailable(
        StateReason.SCENARIO_UNSUPPORTED,
        `${rateRuleKey} is NOT_APPLICABLE in this jurisdiction; no rate is assumed`,
        rateRuleKey,
      ),
    );
  }

  if (rateDetail.appliesTo !== expectedSide) {
    return readFail(
      stateUnavailable(
        StateReason.SCENARIO_UNSUPPORTED,
        `${rateRuleKey} applies to ${rateDetail.appliesTo}, not ${expectedSide}; this is a data ` +
          'inconsistency, not assumed away',
        rateRuleKey,
      ),
    );
  }

  const rate = readRate(rateDetail.rate, rateDetail.unit, rateRuleKey, 'rate');
  if (!rate.ok) {
    return readFail(rate.problem);
  }

  const rateReference = ruleReference(ruleSet, rateRuleKey);
  const references = [taxable.value.reference, rateReference].filter(
    (reference): reference is RuleReference => reference !== undefined,
  );

  return readOk({
    amount: multiply(taxable.value.applicableWages, rate.value),
    rules: references,
  });
}

/** PFML employee contribution for this pay period, from already-resolved
 * PFML wages and this employer's YTD PFML wages (`StateYtd.pfmlWages`,
 * excluding the current period). */
export function calculatePfmlEmployee(
  ruleSet: ResolvedStateRuleSet,
  pfmlWages: Money,
  ytdWages: Money,
): Read<PfmlContribution> {
  return calculatePfmlSide(
    ruleSet,
    pfmlWages,
    ytdWages,
    StateRuleKey.PFML_EMPLOYEE_RATE,
    'EMPLOYEE',
  );
}

/** PFML employer contribution for this pay period, from already-resolved
 * PFML wages and this employer's YTD PFML wages (`StateYtd.pfmlWages`,
 * excluding the current period). */
export function calculatePfmlEmployer(
  ruleSet: ResolvedStateRuleSet,
  pfmlWages: Money,
  ytdWages: Money,
): Read<PfmlContribution> {
  return calculatePfmlSide(
    ruleSet,
    pfmlWages,
    ytdWages,
    StateRuleKey.PFML_EMPLOYER_RATE,
    'EMPLOYER',
  );
}

import {
  type Money,
  add,
  max,
  money,
  subtract,
  sum,
  toStorageString,
  zero,
} from '@/lib/core/money';

import {
  StateReason,
  statusForStateReason,
  stateUnavailable,
  type StateUnavailable,
} from '../errors/stateErrors';
import type { StateBucket } from '../ruleKeys';
import type { StateTaxabilityProfileDetail } from '../rules/detailSchemas';
import type { StateAmount, StateDeductionLine } from '../types';

/**
 * State wage-bucket derivation — Task 4C, implementing the locked Task 4B
 * contract (Option A: Context-Driven State Taxability).
 *
 * ===========================================================================
 * THIS IS THE PURE CALCULATION HALF OF OPTION A ONLY.
 *
 * `deriveStateWageBuckets` consumes `deductions`/`taxabilityProfiles` exactly
 * as `StateCalculationContext` now carries them. It does NOT resolve where
 * those profiles came from — under Option A they bypass the state rule-
 * resolution pipeline entirely (candidate retrieval, candidate resolution,
 * rule-set assembly are all untouched and unrelated to this module). Runtime
 * sourcing of `taxabilityProfiles` remains an explicitly open question (Task
 * 4B report §11) and is not addressed here.
 * ===========================================================================
 *
 * PURE, SYNCHRONOUS, DATABASE-INDEPENDENT. No Prisma, no `getPrisma`, no
 * `ResolvedStateRuleSet`, no candidate retrieval/resolution/assembly import
 * of any kind — this module operates entirely on already-prepared, in-memory
 * inputs.
 *
 * ===========================================================================
 * REGULAR VS SUPPLEMENTAL — LOCKED BY THE COMMITTED RESULT TYPE, NOT GUESSED.
 *
 * `StateEmployeeResult` (Step 1, `types.ts`) has separate `incomeTaxWithheld`
 * and `supplementalWithheld` fields, but a single, unsplit `sdiEmployee` /
 * `pfmlEmployee` / `sutaEmployee` field each. That is why `stateIncomeTaxWages`
 * is derived from REGULAR WAGES ONLY here — supplemental withholding is a
 * wholly separate mechanism (`WITHHOLDING_SUPPLEMENTAL`) that never passes
 * through this bucket — while `sdiWages`/`pfmlWages`/`sutaWages` each combine
 * regular + supplemental, since the committed result type has no supplemental
 * sub-field for any of the three.
 *
 * ===========================================================================
 * NOT_STATED IS NEVER COERCED, AND A MISSING PROFILE IS NEVER GUESSED.
 *
 * A deduction whose `taxabilityProfiles` entry is missing, or whose flag for
 * a given bucket is `NOT_STATED`, makes exactly THAT bucket unavailable
 * (`SCENARIO_UNSUPPORTED` / `TAXABILITY_NOT_STATED` respectively — both
 * already exist in `stateErrors.ts`; no new error vocabulary is introduced).
 * Other buckets, if unaffected, remain fully available — independence is the
 * whole point of separate buckets in the first place.
 *
 * DISCLOSED CONSEQUENCE OF OPTION A: every `StateAmount` this module returns
 * has `rules: []`. `taxabilityProfiles` never pass through rule resolution,
 * so there is no `RuleReference` to attach — this is not an omission.
 * ===========================================================================
 */

type TaxabilityFlagField =
  'reducesStateIncomeTaxWages' | 'reducesSdiWages' | 'reducesPfmlWages' | 'reducesSutaWages';

const BUCKET_FLAG_FIELD: Readonly<Record<StateBucket, TaxabilityFlagField>> = {
  stateIncomeTaxWages: 'reducesStateIncomeTaxWages',
  sdiWages: 'reducesSdiWages',
  pfmlWages: 'reducesPfmlWages',
  sutaWages: 'reducesSutaWages',
};

const BUCKET_DISPLAY: Readonly<
  Record<StateBucket, { readonly code: string; readonly label: string }>
> = {
  stateIncomeTaxWages: { code: 'STATE_INCOME_TAX_WAGES', label: 'State income tax wages' },
  sdiWages: { code: 'SDI_WAGES', label: 'SDI wages' },
  pfmlWages: { code: 'PFML_WAGES', label: 'PFML wages' },
  sutaWages: { code: 'SUTA_WAGES', label: 'SUTA wages' },
};

/** Regular only for state income tax; regular + supplemental for everything else. */
function grossWagesFor(
  bucket: StateBucket,
  wages: { readonly regular: Money; readonly supplemental: Money },
): Money {
  if (bucket === 'stateIncomeTaxWages') {
    return wages.regular;
  }
  return add(wages.regular, wages.supplemental);
}

function deriveBucket(
  bucket: StateBucket,
  wages: { readonly regular: Money; readonly supplemental: Money },
  deductions: readonly StateDeductionLine[],
  profiles: Readonly<Record<string, StateTaxabilityProfileDetail>>,
): StateAmount {
  const { code, label } = BUCKET_DISPLAY[bucket];
  const flagField = BUCKET_FLAG_FIELD[bucket];

  let problem: StateUnavailable | null = null;
  const applicableAmounts: Money[] = [];

  for (const deduction of deductions) {
    const profile = profiles[deduction.deductionTypeKey];

    if (profile === undefined) {
      problem ??= stateUnavailable(
        StateReason.SCENARIO_UNSUPPORTED,
        `No taxability profile for deduction type ${deduction.deductionTypeKey}; its state ` +
          'treatment is unknown and is not guessed',
        undefined,
        deduction.deductionTypeKey,
      );
      continue;
    }

    const flag = profile[flagField];

    if (flag === 'NOT_STATED') {
      problem ??= stateUnavailable(
        StateReason.TAXABILITY_NOT_STATED,
        `The taxability profile for ${deduction.deductionTypeKey} does not state whether it ` +
          `reduces ${bucket}; NOT_STATED is never treated as "does not reduce"`,
        undefined,
        `${deduction.deductionTypeKey}.${bucket}`,
      );
      continue;
    }

    if (flag === 'TRUE') {
      applicableAmounts.push(money(deduction.amount));
    }
  }

  if (problem !== null) {
    return {
      code,
      label,
      // NEVER "0". An absent bucket and a zero bucket are different facts.
      amount: null,
      status: statusForStateReason(problem.reason),
      problem,
      rules: [],
    };
  }

  const totalApplicable = applicableAmounts.length === 0 ? zero() : sum(applicableAmounts);
  // Arithmetic floor, not a tax rule: deductions above gross cannot make a bucket negative.
  const taxable = max(subtract(grossWagesFor(bucket, wages), totalApplicable), zero());

  return { code, label, amount: toStorageString(taxable), status: 'COMPLETE', rules: [] };
}

/**
 * Derives the four independent state wage buckets from current pay-period
 * wages, this period's deduction lines, and their taxability profiles.
 *
 * Current-period amounts only (Task 4B §8) — no YTD, no annualization, no
 * wage-base capping (`applyStateWageBase`, Task 3) and no rate application
 * happen here.
 */
export function deriveStateWageBuckets(
  wages: { readonly regular: Money; readonly supplemental: Money },
  deductions: readonly StateDeductionLine[],
  profiles: Readonly<Record<string, StateTaxabilityProfileDetail>>,
): Record<StateBucket, StateAmount> {
  const derive = (bucket: StateBucket): StateAmount =>
    deriveBucket(bucket, wages, deductions, profiles);

  return {
    stateIncomeTaxWages: derive('stateIncomeTaxWages'),
    sdiWages: derive('sdiWages'),
    pfmlWages: derive('pfmlWages'),
    sutaWages: derive('sutaWages'),
  };
}

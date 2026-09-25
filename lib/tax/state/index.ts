import { money } from '@/lib/core/money';
import { combineStatuses } from '@/lib/calculator/types/status';
import type { RuleReference } from '@/lib/calculator/types/rules';

import type { StateCalculationContext } from './context';
import { StateReason, statusForStateReason, stateUnavailable } from './errors/stateErrors';
import { PROGRAM_BUCKET, type StateBucket, type StateProgram } from './ruleKeys';
import type { TaxabilityResolutionContext } from './rules/resolveTaxability';
import type {
  StateAmount,
  StateComponentResult,
  StateEmployeeResult,
  StateEmployerResult,
  StateTaxResult,
  StateWageBuckets,
} from './types';
import { deriveResolvedStateWageBuckets } from './wages/deriveResolvedStateWageBuckets';

/**
 * State calculation engine — top-level entry point. DM-03 Slice 8.
 *
 * ===========================================================================
 * A SHELL, NOT A TAX CALCULATOR.
 *
 * `calculateStateTaxes()` proves the `StateCalculationContext -> StateTaxResult`
 * shape end to end using the ONE thing the repository can currently compute
 * authoritatively — resolver-driven state wage buckets
 * (`deriveResolvedStateWageBuckets()`, Slice 7) — and reports every actual
 * tax AMOUNT (withholding, SDI, PFML, SUTA, employer contributions) as
 * explicitly not-yet-implemented, using the existing
 * `StateReason.METHOD_NOT_IMPLEMENTED` reason. No rate is ever applied to a
 * wage figure here: no such primitive exists anywhere in this repository
 * (Slice 8 discovery), and inventing one is explicitly out of scope.
 *
 * This module does not resolve rules, does not resolve taxability, and does
 * not derive wage buckets itself — those stay exactly where they already
 * live (`resolveTaxability()`, `deriveResolvedStateWageBuckets()`). It only
 * composes their already-correct outputs into the committed `StateTaxResult`
 * shape, and is not called from `calculatePaycheck()` or wired into
 * `options.state` anywhere — that remains a later, separate integration
 * slice.
 * ===========================================================================
 */

export const STATE_ENGINE_VERSION = '5.0.0-phase5';

/** Reuses the exact `ruleId@version` dedup key `deriveResolvedStateWageBuckets.ts`
 * and `lib/calculator/index.ts`'s `collectReferences()` already established. */
function mergeReferences(groups: readonly (readonly RuleReference[])[]): RuleReference[] {
  const seen = new Map<string, RuleReference>();
  for (const group of groups) {
    for (const reference of group) {
      seen.set(`${reference.ruleId}@${String(reference.version)}`, reference);
    }
  }
  return [...seen.values()];
}

const PROGRAM_LABEL: Readonly<Record<StateProgram, string>> = {
  INCOME_TAX_WITHHOLDING: 'state income tax withholding',
  SDI: 'SDI',
  PFML: 'PFML',
  SUTA: 'SUTA',
};

/**
 * Builds one program's tax-amount `StateAmount`, from the wage bucket that
 * program is mapped to (`PROGRAM_BUCKET`, unchanged).
 *
 * If the bucket itself is unavailable, its `status`/`problem` are propagated
 * VERBATIM — never replaced by a fabricated `METHOD_NOT_IMPLEMENTED`
 * problem, per the explicit task requirement. Only when the bucket is
 * genuinely available does this report the calculation itself as not yet
 * implemented.
 */
function programAmount(
  code: string,
  label: string,
  program: StateProgram,
  buckets: Readonly<Record<StateBucket, StateAmount>>,
): StateAmount {
  const bucket = buckets[PROGRAM_BUCKET[program]];

  if (bucket.amount === null) {
    return {
      code,
      label,
      amount: null,
      status: bucket.status,
      ...(bucket.problem === undefined ? {} : { problem: bucket.problem }),
      rules: [],
    };
  }

  const problem = stateUnavailable(
    StateReason.METHOD_NOT_IMPLEMENTED,
    `${label} is not yet implemented for ${PROGRAM_LABEL[program]}`,
  );
  return {
    code,
    label,
    amount: null,
    status: statusForStateReason(problem.reason),
    problem,
    rules: [],
  };
}

/** A total across several `StateAmount`s that are all unavailable in this
 * shell — folds status via the existing `combineStatuses()`, and carries the
 * first defined component problem forward (mirroring the "first problem
 * wins" convention `deriveResolvedStateWageBuckets()` already established),
 * never a second, distinct problem invented for the total itself. */
function totalAmount(code: string, label: string, amounts: readonly StateAmount[]): StateAmount {
  const status = combineStatuses(amounts.map((amount) => amount.status));
  const firstProblem = amounts.find((amount) => amount.problem !== undefined)?.problem;
  return {
    code,
    label,
    amount: null,
    status,
    ...(firstProblem === undefined ? {} : { problem: firstProblem }),
    rules: [],
  };
}

function toWageBuckets(buckets: Readonly<Record<StateBucket, StateAmount>>): StateWageBuckets {
  return {
    stateIncomeTaxWages: buckets.stateIncomeTaxWages.amount,
    sdiWages: buckets.sdiWages.amount,
    pfmlWages: buckets.pfmlWages.amount,
    sutaWages: buckets.sutaWages.amount,
  };
}

function bucketReferences(buckets: Readonly<Record<StateBucket, StateAmount>>): RuleReference[] {
  return mergeReferences([
    buckets.stateIncomeTaxWages.rules,
    buckets.sdiWages.rules,
    buckets.pfmlWages.rules,
    buckets.sutaWages.rules,
  ]);
}

function bucketProblems(
  buckets: Readonly<Record<StateBucket, StateAmount>>,
): readonly (StateAmount['problem'] & object)[] {
  return Object.values(buckets)
    .map((bucket) => bucket.problem)
    .filter((problem): problem is NonNullable<typeof problem> => problem !== undefined);
}

/**
 * Calculates state taxes for one pay period from an already-assembled
 * `StateCalculationContext` and a separately-supplied
 * `TaxabilityResolutionContext` (delivery mechanism / limit discriminator /
 * sub-monthly classification — none of which `StateCalculationContext`
 * itself carries, exactly the same disclosed gap `deriveResolvedStateWageBuckets()`
 * already has at its own boundary, Slice 7).
 *
 * Pure, synchronous. Calls `deriveResolvedStateWageBuckets()` exactly once.
 */
export function calculateStateTaxes(
  context: StateCalculationContext,
  taxabilityContext: TaxabilityResolutionContext,
): StateTaxResult {
  const buckets = deriveResolvedStateWageBuckets({
    ruleSet: context.workRuleSet,
    wages: {
      regular: money(context.wages.regular),
      supplemental: money(context.wages.supplemental),
    },
    deductions: context.deductions,
    context: taxabilityContext,
  });

  const workJurisdictionCode = context.workRuleSet.jurisdictionCode;

  const incomeTaxWithheld = programAmount(
    'STATE_INCOME_TAX_WITHHELD',
    'State income tax withheld',
    'INCOME_TAX_WITHHOLDING',
    buckets,
  );
  const supplementalWithheld = programAmount(
    'STATE_SUPPLEMENTAL_WITHHELD',
    'State supplemental withholding',
    'INCOME_TAX_WITHHOLDING',
    buckets,
  );
  const sdiEmployee = programAmount('SDI_EMPLOYEE', 'SDI employee contribution', 'SDI', buckets);
  const pfmlEmployee = programAmount(
    'PFML_EMPLOYEE',
    'PFML employee contribution',
    'PFML',
    buckets,
  );
  const sutaEmployee = programAmount(
    'SUTA_EMPLOYEE',
    'SUTA employee contribution',
    'SUTA',
    buckets,
  );

  const employeeComponents: StateComponentResult[] = [
    {
      program: 'INCOME_TAX_WITHHOLDING',
      jurisdictionCode: workJurisdictionCode,
      role: 'WORK',
      amount: incomeTaxWithheld,
      bucket: 'stateIncomeTaxWages',
    },
    {
      program: 'SDI',
      jurisdictionCode: workJurisdictionCode,
      role: 'WORK',
      amount: sdiEmployee,
      bucket: 'sdiWages',
    },
    {
      program: 'PFML',
      jurisdictionCode: workJurisdictionCode,
      role: 'WORK',
      amount: pfmlEmployee,
      bucket: 'pfmlWages',
    },
    {
      program: 'SUTA',
      jurisdictionCode: workJurisdictionCode,
      role: 'WORK',
      amount: sutaEmployee,
      bucket: 'sutaWages',
    },
  ];

  const employee: StateEmployeeResult = {
    incomeTaxWithheld,
    supplementalWithheld,
    sdiEmployee,
    pfmlEmployee,
    sutaEmployee,
    totalEmployeeStateTaxes: totalAmount(
      'TOTAL_EMPLOYEE_STATE_TAXES',
      'Total employee state taxes',
      [incomeTaxWithheld, supplementalWithheld, sdiEmployee, pfmlEmployee, sutaEmployee],
    ),
    components: employeeComponents,
  };

  let employer: StateEmployerResult | null = null;
  if (context.includeEmployerTaxes) {
    const sdiEmployer = programAmount('SDI_EMPLOYER', 'SDI employer contribution', 'SDI', buckets);
    const pfmlEmployer = programAmount(
      'PFML_EMPLOYER',
      'PFML employer contribution',
      'PFML',
      buckets,
    );
    const sutaEmployer = programAmount(
      'SUTA_EMPLOYER',
      'SUTA employer contribution',
      'SUTA',
      buckets,
    );

    const employerComponents: StateComponentResult[] = [
      {
        program: 'SDI',
        jurisdictionCode: workJurisdictionCode,
        role: 'WORK',
        amount: sdiEmployer,
        bucket: 'sdiWages',
      },
      {
        program: 'PFML',
        jurisdictionCode: workJurisdictionCode,
        role: 'WORK',
        amount: pfmlEmployer,
        bucket: 'pfmlWages',
      },
      {
        program: 'SUTA',
        jurisdictionCode: workJurisdictionCode,
        role: 'WORK',
        amount: sutaEmployer,
        bucket: 'sutaWages',
      },
    ];

    employer = {
      sdiEmployer,
      pfmlEmployer,
      sutaEmployer,
      totalEmployerStateTaxes: totalAmount(
        'TOTAL_EMPLOYER_STATE_TAXES',
        'Total employer state taxes',
        [sdiEmployer, pfmlEmployer, sutaEmployer],
      ),
      components: employerComponents,
      disclosures: [],
    };
  }

  const allAmounts: StateAmount[] = [
    incomeTaxWithheld,
    supplementalWithheld,
    sdiEmployee,
    pfmlEmployee,
    sutaEmployee,
    ...(employer === null
      ? []
      : [employer.sdiEmployer, employer.pfmlEmployer, employer.sutaEmployer]),
  ];
  const status = combineStatuses(allAmounts.map((amount) => amount.status));

  const issues = [...new Set(bucketProblems(buckets))];

  return {
    status,
    engineVersion: STATE_ENGINE_VERSION,
    taxYear: context.taxYear,
    effectiveDate: context.effectiveDate,
    workJurisdictionCode,
    residenceJurisdictionCode: context.residenceJurisdictionCode,
    residencyStatus: context.residencyStatus,
    methodology: {
      withholdingMethod: null,
      supplementalTreatment: null,
      roundingPolicyId: null,
    },
    buckets: toWageBuckets(buckets),
    employee,
    employer,
    disclosures: [],
    ruleReferences: bucketReferences(buckets),
    sourceIds: [...new Set(bucketReferences(buckets).flatMap((reference) => reference.sourceIds))],
    issues,
    missingRules: context.workRuleSet.missing,
  };
}

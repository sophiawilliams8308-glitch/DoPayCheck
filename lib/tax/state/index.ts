import { money, toStorageString } from '@/lib/core/money';
import { combineStatuses } from '@/lib/calculator/types/status';
import type { RuleReference } from '@/lib/calculator/types/rules';

import type { StateCalculationContext } from './context';
import { StateReason, statusForStateReason, stateUnavailable } from './errors/stateErrors';
import { PROGRAM_BUCKET, type StateBucket, type StateProgram } from './ruleKeys';
import type { TaxabilityResolutionContext } from './rules/resolveTaxability';
import type { ResolvedStateRuleSet } from './rules/stateRuleSet';
import { calculatePfmlEmployee, calculatePfmlEmployer } from './pfml/calculatePfml';
import { calculateSdiEmployee, calculateSdiEmployer } from './sdi/calculateSdi';
import { calculateSutaEmployee, calculateSutaEmployer } from './suta/calculateSuta';
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
 * State calculation engine — top-level entry point. DM-03 Slice 8; SDI wired
 * in at Slice 10; PFML wired in at Slice 11; SUTA employee side wired in at
 * Slice 12; SUTA employer side wired in at Slice 15.
 *
 * ===========================================================================
 * MOSTLY STILL A SHELL — SDI, PFML, AND SUTA (BOTH SIDES) ARE THE REAL
 * CALCULATIONS.
 *
 * `calculateStateTaxes()` proves the `StateCalculationContext -> StateTaxResult`
 * shape end to end using resolver-driven state wage buckets
 * (`deriveResolvedStateWageBuckets()`, Slice 7). State income tax
 * withholding still reports every actual tax AMOUNT as explicitly
 * not-yet-implemented, via `StateReason.METHOD_NOT_IMPLEMENTED` (Slice 8).
 * SDI (`sdi/calculateSdi.ts`, Slice 10), PFML (`pfml/calculatePfml.ts`,
 * Slice 11) and SUTA (`suta/calculateSuta.ts`, Slices 12 + 15) are real,
 * resolver-driven calculations on both sides — `sdiAmount()`/`pfmlAmount()`/
 * (`sutaEmployeeAmount()` + `sutaEmployerAmount()`) below wire them in for
 * exactly their own employee/employer components. SUTA's employer side
 * reads its rate from `context.employer.sutaRate` (the locked Slice 14
 * contract), never from `SUTA_EMPLOYER_RATE`/`SUTA_NEW_EMPLOYER_RATE`.
 *
 * This module does not resolve rules, does not resolve taxability, and does
 * not derive wage buckets itself — those stay exactly where they already
 * live (`resolveTaxability()`, `deriveResolvedStateWageBuckets()`). It only
 * composes their already-correct outputs (and, for SDI/PFML/SUTA, their own
 * calculation modules' output) into the committed `StateTaxResult` shape,
 * and is not called from `calculatePaycheck()` or wired into `options.state`
 * anywhere — that remains a later, separate integration slice.
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

/**
 * SDI-specific counterpart to `programAmount()` — the SDI wage bucket that
 * program is mapped to (`PROGRAM_BUCKET.SDI`, unchanged) feeds a real
 * calculation (`calculateSdi.ts`, Slice 10) instead of a fabricated
 * `METHOD_NOT_IMPLEMENTED`.
 *
 * If the bucket itself is unavailable, its `status`/`problem` propagate
 * VERBATIM — identical to `programAmount()`'s own bucket-failure branch,
 * never overwritten. Only when the bucket is genuinely available does this
 * attempt the real SDI calculation; if THAT fails (missing/unverified rate,
 * a wage base this engine cannot yet enforce, and so on), the calculation's
 * own `StateUnavailable` is used as-is — never replaced or reinterpreted.
 */
function sdiAmount(
  code: string,
  label: string,
  ruleSet: ResolvedStateRuleSet,
  buckets: Readonly<Record<StateBucket, StateAmount>>,
  side: 'EMPLOYEE' | 'EMPLOYER',
): StateAmount {
  const bucket = buckets[PROGRAM_BUCKET.SDI];

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

  const result =
    side === 'EMPLOYEE'
      ? calculateSdiEmployee(ruleSet, money(bucket.amount))
      : calculateSdiEmployer(ruleSet, money(bucket.amount));

  if (!result.ok) {
    return {
      code,
      label,
      amount: null,
      status: statusForStateReason(result.problem.reason),
      problem: result.problem,
      rules: [],
    };
  }

  return {
    code,
    label,
    amount: toStorageString(result.value.amount),
    status: 'COMPLETE',
    rules: mergeReferences([bucket.rules, result.value.rules]),
  };
}

/**
 * PFML-specific counterpart to `programAmount()` — the PFML wage bucket that
 * program is mapped to (`PROGRAM_BUCKET.PFML`, unchanged) feeds a real
 * calculation (`calculatePfml.ts`, Slice 11) instead of a fabricated
 * `METHOD_NOT_IMPLEMENTED`. Structurally mirrors `sdiAmount()` above — not
 * shared with it (DM-03 Slice 11's own instruction: do not invent a generic
 * abstraction merely because the two programmes look similar) — but its own
 * bucket-failure-propagation and calculation-failure handling are identical
 * in shape because both wrap the same established `Read<T>` -> `StateAmount`
 * boundary every other reader in this engine already uses.
 *
 * If the bucket itself is unavailable, its `status`/`problem` propagate
 * VERBATIM. Only when the bucket is genuinely available does this attempt
 * the real PFML calculation; if THAT fails, the calculation's own
 * `StateUnavailable` is used as-is — never replaced or reinterpreted.
 */
function pfmlAmount(
  code: string,
  label: string,
  ruleSet: ResolvedStateRuleSet,
  buckets: Readonly<Record<StateBucket, StateAmount>>,
  side: 'EMPLOYEE' | 'EMPLOYER',
): StateAmount {
  const bucket = buckets[PROGRAM_BUCKET.PFML];

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

  const result =
    side === 'EMPLOYEE'
      ? calculatePfmlEmployee(ruleSet, money(bucket.amount))
      : calculatePfmlEmployer(ruleSet, money(bucket.amount));

  if (!result.ok) {
    return {
      code,
      label,
      amount: null,
      status: statusForStateReason(result.problem.reason),
      problem: result.problem,
      rules: [],
    };
  }

  return {
    code,
    label,
    amount: toStorageString(result.value.amount),
    status: 'COMPLETE',
    rules: mergeReferences([bucket.rules, result.value.rules]),
  };
}

/**
 * SUTA-EMPLOYEE-specific counterpart to `programAmount()` — the SUTA wage
 * bucket (`PROGRAM_BUCKET.SUTA`, unchanged) feeds a real calculation
 * (`calculateSuta.ts`, Slice 12) instead of a fabricated
 * `METHOD_NOT_IMPLEMENTED`, for the employee side only. There is no
 * `sutaAmount(..., side)` — the employer side (`sutaEmployerAmount()`,
 * below) needs an extra input (`employerSutaRate`) this function has no use
 * for, so the two stay separate rather than sharing one signature.
 *
 * If the bucket itself is unavailable, its `status`/`problem` propagate
 * VERBATIM. Only when the bucket is genuinely available does this attempt
 * the real SUTA employee calculation; if THAT fails, the calculation's own
 * `StateUnavailable` is used as-is — never replaced or reinterpreted.
 */
function sutaEmployeeAmount(
  code: string,
  label: string,
  ruleSet: ResolvedStateRuleSet,
  buckets: Readonly<Record<StateBucket, StateAmount>>,
): StateAmount {
  const bucket = buckets[PROGRAM_BUCKET.SUTA];

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

  const result = calculateSutaEmployee(ruleSet, money(bucket.amount));

  if (!result.ok) {
    return {
      code,
      label,
      amount: null,
      status: statusForStateReason(result.problem.reason),
      problem: result.problem,
      rules: [],
    };
  }

  return {
    code,
    label,
    amount: toStorageString(result.value.amount),
    status: 'COMPLETE',
    rules: mergeReferences([bucket.rules, result.value.rules]),
  };
}

/**
 * SUTA-EMPLOYER-specific counterpart to `programAmount()` — the SUTA wage
 * bucket feeds a real calculation (`calculateSuta.ts`, Slice 15) instead of
 * a fabricated `METHOD_NOT_IMPLEMENTED`. Takes `employerSutaRate`
 * (`context.employer.sutaRate`) as an explicit parameter — the sole
 * established employer-rate input (Slice 14's locked contract) —
 * rather than reading `context` itself, keeping this function's inputs
 * exactly as narrow as `sdiAmount()`/`pfmlAmount()`/`sutaEmployeeAmount()`
 * already are.
 *
 * If the bucket itself is unavailable, its `status`/`problem` propagate
 * VERBATIM. Only when the bucket is genuinely available does this attempt
 * the real SUTA employer calculation; if THAT fails (most commonly
 * `employerSutaRate` absent, per the locked contract), the calculation's
 * own `StateUnavailable` is used as-is — never replaced or reinterpreted.
 */
function sutaEmployerAmount(
  code: string,
  label: string,
  ruleSet: ResolvedStateRuleSet,
  buckets: Readonly<Record<StateBucket, StateAmount>>,
  employerSutaRate: string | undefined,
): StateAmount {
  const bucket = buckets[PROGRAM_BUCKET.SUTA];

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

  const result = calculateSutaEmployer(ruleSet, money(bucket.amount), employerSutaRate);

  if (!result.ok) {
    return {
      code,
      label,
      amount: null,
      status: statusForStateReason(result.problem.reason),
      problem: result.problem,
      rules: [],
    };
  }

  return {
    code,
    label,
    amount: toStorageString(result.value.amount),
    status: 'COMPLETE',
    rules: mergeReferences([bucket.rules, result.value.rules]),
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
  const sdiEmployee = sdiAmount(
    'SDI_EMPLOYEE',
    'SDI employee contribution',
    context.workRuleSet,
    buckets,
    'EMPLOYEE',
  );
  const pfmlEmployee = pfmlAmount(
    'PFML_EMPLOYEE',
    'PFML employee contribution',
    context.workRuleSet,
    buckets,
    'EMPLOYEE',
  );
  const sutaEmployee = sutaEmployeeAmount(
    'SUTA_EMPLOYEE',
    'SUTA employee contribution',
    context.workRuleSet,
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
    const sdiEmployer = sdiAmount(
      'SDI_EMPLOYER',
      'SDI employer contribution',
      context.workRuleSet,
      buckets,
      'EMPLOYER',
    );
    const pfmlEmployer = pfmlAmount(
      'PFML_EMPLOYER',
      'PFML employer contribution',
      context.workRuleSet,
      buckets,
      'EMPLOYER',
    );
    const sutaEmployer = sutaEmployerAmount(
      'SUTA_EMPLOYER',
      'SUTA employer contribution',
      context.workRuleSet,
      buckets,
      context.employer.sutaRate,
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

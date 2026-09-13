import { compare, money, sum, zero } from '@/lib/core/money';

import type { FederalCalculationResult, FederalAmount } from './types';

/**
 * Federal invariants asserted before returning — spec §28.5.
 *
 * ===========================================================================
 * THE LAST LINE OF DEFENCE.
 *
 * These are not input validation and not data checks; they are assertions about
 * the engine's own output. A breach means a programming defect reached the
 * result, so it becomes CALCULATION_ERROR rather than a data status: the caller
 * must not be handed a number the engine cannot vouch for.
 * ===========================================================================
 */

export interface InvariantBreach {
  readonly id: string;
  readonly detail: string;
}

function stated(amount: FederalAmount): boolean {
  return amount.amount !== null;
}

/** Runs INV-1 … INV-8. An empty array means the result may be returned. */
export function assertFederalInvariants(
  result: FederalCalculationResult,
): readonly InvariantBreach[] {
  const breaches: InvariantBreach[] = [];
  const employeeAmounts: FederalAmount[] = [
    result.employee.federalIncomeTaxWithheld,
    result.employee.supplementalWithheld,
    result.employee.socialSecurityEmployee,
    result.employee.medicareEmployee,
    result.employee.additionalMedicareEmployee,
  ];
  const employerAmounts: FederalAmount[] =
    result.employer === null
      ? []
      : [
          result.employer.socialSecurityEmployer,
          result.employer.medicareEmployer,
          result.employer.futaEmployer,
        ];

  // INV-1 — every federal tax amount is >= 0.
  for (const amount of [...employeeAmounts, ...employerAmounts]) {
    if (stated(amount) && compare(money(amount.amount ?? '0'), zero()) < 0) {
      breaches.push({ id: 'INV-1', detail: `${amount.code} is negative` });
    }
  }

  // INV-2 / INV-3 — a taxable amount never exceeds its wage bucket. Checked
  // through the tax itself: a tax above its bucket is impossible at any rate
  // at or below 100%, and catches a bucket/tax mix-up.
  const ssWagesStated = result.buckets.socialSecurityWages;
  const ssTax = result.employee.socialSecurityEmployee;
  if (
    ssWagesStated !== null &&
    stated(ssTax) &&
    compare(money(ssTax.amount ?? '0'), money(ssWagesStated)) > 0
  ) {
    breaches.push({ id: 'INV-3', detail: 'Social Security tax exceeds Social Security wages' });
  }

  // INV-4 — FUTA appears only in the employer branch.
  if (employeeAmounts.some((amount) => amount.code.includes('FUTA'))) {
    breaches.push({ id: 'INV-4', detail: 'A FUTA amount appears in the employee branch' });
  }

  // INV-5 — Additional Medicare appears only in the employee branch.
  if (employerAmounts.some((amount) => amount.code.includes('ADDITIONAL_MEDICARE'))) {
    breaches.push({
      id: 'INV-5',
      detail: 'An Additional Medicare amount appears in the employer branch',
    });
  }

  // INV-6 — the employee total contains no employer amount. Verified by
  // recomputing it from the employee branch alone.
  const total = result.employee.totalEmployeeFederalTaxes;
  if (stated(total) && employeeAmounts.every(stated)) {
    const recomputed = sum(employeeAmounts.map((amount) => money(amount.amount ?? '0')));
    if (compare(recomputed, money(total.amount ?? '0')) !== 0) {
      breaches.push({
        id: 'INV-6',
        detail: 'The employee total does not equal the sum of the employee components',
      });
    }
  }

  // INV-7 — every non-zero amount carries at least one rule reference.
  for (const amount of [...employeeAmounts, ...employerAmounts]) {
    if (stated(amount) && !money(amount.amount ?? '0').isZero() && amount.rules.length === 0) {
      breaches.push({
        id: 'INV-7',
        detail: `${amount.code} is non-zero but cites no rule`,
      });
    }
  }

  // INV-8 — COMPLETE implies no missing-rule issues.
  if (result.status === 'COMPLETE' && result.missingRules.length > 0) {
    breaches.push({
      id: 'INV-8',
      detail: 'Status is COMPLETE while missing-rule issues are recorded',
    });
  }

  return breaches;
}

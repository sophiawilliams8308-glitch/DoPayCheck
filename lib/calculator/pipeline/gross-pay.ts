import { type Money, add, money, multiply, sum, zero } from '@/lib/core/money';

import { type RoundingPolicy, roundCurrency } from '../rounding/policy';
import type { PayInput } from '../types/input';
import { periodsPerYear } from './pay-frequency';

/**
 * Gross pay (pipeline stage 5; spec §12).
 *
 * GENERIC ARITHMETIC ONLY. No jurisdiction overtime law appears here: the overtime threshold,
 * daily-vs-weekly method and double-time rules are rule-driven data and belong to Phase 5.
 * This stage multiplies the hours and multiplier it is given and nothing more (spec §12).
 */

export interface GrossPayComponents {
  readonly regular: Money;
  readonly overtime: Money;
  readonly bonus: Money;
  readonly commission: Money;
  readonly tips: Money;
  readonly other: Money;
  readonly total: Money;
}

export type GrossPayOutcome =
  | { readonly ok: true; readonly gross: GrossPayComponents }
  | { readonly ok: false; readonly reason: string };

function optional(value: string | undefined): Money {
  return value === undefined ? zero() : money(value);
}

/**
 * Computes gross pay for one pay period.
 *
 * Salary basis: annual salary divided by periods per year.
 * Hourly basis: regular hours x rate, plus overtime hours x rate x multiplier.
 *
 * Supplemental items (bonus, commission, tips, other) are added as supplied — this stage does
 * not decide their tax treatment, which is a taxability question handled downstream.
 */
export function calculateGrossPay(pay: PayInput, policy: RoundingPolicy): GrossPayOutcome {
  let regular: Money;
  let overtime = zero();

  if (pay.basis === 'SALARY') {
    const periods = periodsPerYear(pay.payFrequency, pay.periodsPerYear);
    if (!periods.known) {
      return { ok: false, reason: periods.reason };
    }
    const annual = optional(pay.annualSalary);
    // Division requires an explicit scale and mode — there is no implicit rounding.
    regular = roundCurrency(
      annual
        .dividedBy(money(String(periods.periods)))
        .toDecimalPlaces(policy.intermediateScale, policy.intermediateMode),
      policy,
    );
  } else {
    const rate = optional(pay.hourlyRate);
    regular = roundCurrency(multiply(optional(pay.regularHours), rate), policy);

    if (pay.overtimeHours !== undefined) {
      const hours = money(pay.overtimeHours);
      // Validation guarantees exactly one of rate/multiplier is present; neither is assumed,
      // because the overtime premium is jurisdiction law (Phase 5), not an engine default.
      const overtimePay =
        pay.overtimeRate !== undefined
          ? multiply(hours, money(pay.overtimeRate))
          : multiply(multiply(hours, rate), optional(pay.overtimeMultiplier));
      overtime = roundCurrency(overtimePay, policy);
    }
  }

  const bonus = roundCurrency(optional(pay.bonus), policy);
  const commission = roundCurrency(optional(pay.commission), policy);
  const tips = roundCurrency(optional(pay.tips), policy);
  const other = roundCurrency(optional(pay.otherCompensation), policy);

  const total = roundCurrency(sum([regular, overtime, bonus, commission, tips, other]), policy);

  return { ok: true, gross: { regular, overtime, bonus, commission, tips, other, total } };
}

/** Annualizes a per-period amount. Returns null when periods per year is undecided. */
export function annualize(perPeriod: Money, pay: PayInput, policy: RoundingPolicy): Money | null {
  const periods = periodsPerYear(pay.payFrequency, pay.periodsPerYear);
  if (!periods.known) {
    return null;
  }
  return roundCurrency(multiply(perPeriod, money(String(periods.periods))), policy);
}

/** Adds two gross components. Exported for stages that compose partial gross figures. */
export function addGross(a: Money, b: Money): Money {
  return add(a, b);
}

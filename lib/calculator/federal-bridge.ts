import { money, toStorageString, zero } from '@/lib/core/money';

import { calculateFederalTaxes, FEDERAL_ROUNDING_V1 } from '@/lib/tax/federal';
import { toFederalW4 } from '@/lib/tax/federal/context';
import { DEFAULT_FEDERAL_FLAGS, type FederalFeatureFlags } from '@/lib/tax/federal/flags';
import type { FederalRoundingPolicy } from '@/lib/tax/federal/rounding/federal-rounding';
import type { ResolvedFederalRuleSet } from '@/lib/tax/federal/rules/resolved-rule-set';
import type {
  FederalAmount,
  FederalCalculationResult,
  FederalWageBuckets,
  FederalYtd,
} from '@/lib/tax/federal/types';

import type { DeductionResult } from './pipeline/deductions';
import type { TaxableWageResult } from './pipeline/taxable-wages';
import type { CalculationInput } from './types/input';
import type { TaxComponent } from './types/result';

/**
 * Bridge between the Phase 3 pipeline and the Phase 4 federal engine.
 *
 * ===========================================================================
 * ONE ENGINE, EXTENDED — NOT A SECOND ENGINE.
 *
 * `calculatePaycheck` remains the single entry point and keeps its pipeline. This module
 * translates between the two contracts: Phase 3's wage buckets and deductions go in, the
 * federal engine's amounts come back as ordinary `TaxComponent`s, and everything downstream
 * (totals, net pay, trace, snapshot) works unchanged.
 *
 * When no federal rule set is supplied the bridge is not called at all, so Phase 3 behaviour
 * is bit-for-bit what it was.
 * ===========================================================================
 */

export interface FederalOptions {
  readonly ruleSet: ResolvedFederalRuleSet;
  readonly flags?: FederalFeatureFlags;
  readonly rounding?: FederalRoundingPolicy;
  /** YTD EXCLUDING the current pay period (D-SS-1). */
  readonly ytd?: FederalYtd;
  readonly includeAnnualEstimate?: boolean;
  readonly includeEmployerTaxes?: boolean;
}

/** Phase 3's seven buckets, narrowed to the four the federal engine consumes. */
export function toFederalBuckets(wages: TaxableWageResult): FederalWageBuckets {
  return {
    federalIncomeTaxWages: toStorageString(wages.federalIncomeTax.taxableWages),
    socialSecurityWages: toStorageString(wages.socialSecurity.taxableWages),
    medicareWages: toStorageString(wages.medicare.taxableWages),
    futaWages: toStorageString(wages.futa.taxableWages),
  };
}

/** YTD defaults to zero — meaning "nothing earned yet this year", a stated starting point. */
export function toFederalYtd(input: CalculationInput, override?: FederalYtd): FederalYtd {
  if (override !== undefined) {
    return override;
  }
  const z = toStorageString(zero());
  return {
    socialSecurityWages: input.ytd?.socialSecurityWages ?? z,
    medicareWages: input.ytd?.medicareWages ?? z,
    // Phase 3's YtdInput has no FUTA field; absent means none used yet this year.
    futaWages: z,
    federalWithholding: input.ytd?.federalWithholding ?? z,
  };
}

function toComponent(amount: FederalAmount): TaxComponent {
  return {
    code: amount.code,
    label: amount.label,
    amount: amount.amount,
    status: amount.status,
    ...(amount.problem === undefined
      ? {}
      : { detail: `${amount.problem.reason}: ${amount.problem.detail}` }),
    rules: amount.rules,
  };
}

export interface FederalBridgeOutcome {
  readonly federal: FederalCalculationResult;
  readonly federalComponents: readonly TaxComponent[];
  readonly ficaComponents: readonly TaxComponent[];
  readonly employerComponents: readonly TaxComponent[];
}

/** Runs the federal engine for one period and maps its output onto Phase 3 components. */
export function runFederalEngine(
  input: CalculationInput,
  wages: TaxableWageResult,
  periodsPerYear: number,
  grossRegular: string,
  grossSupplemental: string,
  options: FederalOptions,
  _preTaxDeductions: readonly DeductionResult[],
): FederalBridgeOutcome {
  const result = calculateFederalTaxes({
    taxYear: input.taxYear,
    effectiveDate: input.effectiveDate.toISOString(),
    payFrequency: input.pay.payFrequency,
    periodsPerYear,
    w4: toFederalW4(input.w4),
    wages: {
      regular: grossRegular,
      supplemental: grossSupplemental,
      tips: input.pay.tips ?? toStorageString(zero()),
      qualifiedOvertime: toStorageString(zero()),
    },
    buckets: toFederalBuckets(wages),
    ytd: toFederalYtd(input, options.ytd),
    ruleSet: options.ruleSet,
    rounding: options.rounding ?? FEDERAL_ROUNDING_V1,
    flags: options.flags ?? DEFAULT_FEDERAL_FLAGS,
    includeAnnualEstimate: options.includeAnnualEstimate ?? false,
    includeEmployerTaxes: options.includeEmployerTaxes ?? true,
  });

  return {
    federal: result,
    federalComponents: [toComponent(result.withholding.total)],
    ficaComponents: [
      toComponent(result.fica.socialSecurityEmployee),
      toComponent(result.fica.medicareEmployee),
      toComponent(result.fica.additionalMedicareEmployee),
    ],
    employerComponents:
      result.employer === null
        ? []
        : [
            toComponent(result.employer.socialSecurityEmployer),
            toComponent(result.employer.medicareEmployer),
            toComponent(result.employer.futa),
          ],
  };
}

/** Exposed so callers can size a period's regular wages consistently with the engine. */
export function regularWagesFrom(grossTotal: string, supplemental: string): string {
  return toStorageString(money(grossTotal).minus(money(supplemental)));
}

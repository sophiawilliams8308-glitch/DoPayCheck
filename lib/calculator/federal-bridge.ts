import { money, toStorageString, zero } from '@/lib/core/money';

import { calculateFederalTaxes, SupplementalMethod } from '@/lib/tax/federal';
import { toFederalW4 } from '@/lib/tax/federal/context';
import { DEFAULT_FEDERAL_FLAGS, type FederalFeatureFlags } from '@/lib/tax/federal/flags';
import type { ResolvedFederalRuleSet } from '@/lib/tax/federal/rules/resolved-rule-set';
import type {
  DeductionTaxabilityProfile,
  FederalDeductionLine,
} from '@/lib/tax/federal/wages/federalWageBuckets';
import type { FederalAmount, FederalCalculationResult, FederalYtd } from '@/lib/tax/federal/types';

import type { DeductionResult } from './pipeline/deductions';
import type { CalculationInput } from './types/input';
import type { TaxComponent } from './types/result';

/**
 * Bridge between the Phase 3 pipeline and the Phase 4 federal engine.
 *
 * ===========================================================================
 * ONE ENGINE, EXTENDED — NOT A SECOND ENGINE.
 *
 * `calculatePaycheck` stays the single entry point and keeps its pipeline. This
 * module translates between the two contracts. When no federal rule set is
 * supplied the bridge is never called, so Phase 3 behaviour is bit-for-bit what
 * it was.
 * ===========================================================================
 */

export interface FederalOptions {
  readonly ruleSet: ResolvedFederalRuleSet;
  readonly flags?: FederalFeatureFlags;
  /** YTD EXCLUDING the current pay period (spec §13.4). */
  readonly ytd?: Partial<Omit<FederalYtd, 'assumedZero'>>;
  /** Taxability profile per deduction type key (spec §12.2). */
  readonly taxabilityProfiles?: Readonly<Record<string, DeductionTaxabilityProfile>>;
  readonly supplementalMethod?: SupplementalMethod;
  readonly federalIncomeTaxWithheldFromRegularWagesCurrentOrPriorYear?: boolean;
  readonly employerSubjectToFuta?: boolean;
  readonly includeAnnualEstimate?: boolean;
  readonly includeEmployerTaxes?: boolean;
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

/** Maps Phase 3 deduction lines onto the federal engine's contract. */
export function toFederalDeductions(
  items: readonly DeductionResult[],
): readonly FederalDeductionLine[] {
  return items.map((item) => ({
    id: item.id,
    // Phase 3 identifies a deduction by its id; the federal engine resolves a
    // taxability profile by type key, and the id is the type key by convention
    // until Phase 3 carries an explicit one.
    deductionTypeKey: item.input.deductionTypeKey ?? item.id,
    amount: item.amount,
  }));
}

export interface FederalBridgeOutcome {
  readonly federal: FederalCalculationResult;
  readonly federalComponents: readonly TaxComponent[];
  readonly ficaComponents: readonly TaxComponent[];
  readonly employerComponents: readonly TaxComponent[];
}

/** Runs the federal engine for one period and maps its output to Phase 3. */
export function runFederalEngine(
  input: CalculationInput,
  grossRegular: string,
  grossSupplemental: string,
  preTaxDeductions: readonly DeductionResult[],
  options: FederalOptions,
): FederalBridgeOutcome {
  const ytd = options.ytd ?? {};
  const anyYtd = Object.values(ytd).some((value) => value !== undefined);

  const result = calculateFederalTaxes({
    taxYear: input.taxYear,
    effectiveDate: input.effectiveDate.toISOString(),
    payFrequency: input.pay.payFrequency,
    w4: toFederalW4(input.w4),
    wages: {
      regular: grossRegular,
      supplemental: grossSupplemental,
      tips: input.pay.tips ?? toStorageString(zero()),
      qualifiedOvertime: toStorageString(zero()),
    },
    deductions: toFederalDeductions(preTaxDeductions),
    taxabilityProfiles: options.taxabilityProfiles ?? {},
    ytd: {
      socialSecurityWages: ytd.socialSecurityWages ?? input.ytd?.socialSecurityWages ?? '0',
      medicareWages: ytd.medicareWages ?? input.ytd?.medicareWages ?? '0',
      futaWages: ytd.futaWages ?? '0',
      supplementalWages: ytd.supplementalWages ?? '0',
      assumedZero: !anyYtd && input.ytd === undefined,
    },
    ruleSet: options.ruleSet,
    flags: options.flags ?? DEFAULT_FEDERAL_FLAGS,
    supplementalMethod: options.supplementalMethod ?? SupplementalMethod.AGGREGATE,
    federalIncomeTaxWithheldFromRegularWagesCurrentOrPriorYear:
      options.federalIncomeTaxWithheldFromRegularWagesCurrentOrPriorYear ?? false,
    employerSubjectToFuta: options.employerSubjectToFuta ?? true,
    includeAnnualEstimate: options.includeAnnualEstimate ?? false,
    includeEmployerTaxes: options.includeEmployerTaxes ?? true,
  });

  return {
    federal: result,
    federalComponents: [
      toComponent(result.employee.federalIncomeTaxWithheld),
      toComponent(result.employee.supplementalWithheld),
    ],
    ficaComponents: [
      toComponent(result.employee.socialSecurityEmployee),
      toComponent(result.employee.medicareEmployee),
      toComponent(result.employee.additionalMedicareEmployee),
    ],
    employerComponents:
      result.employer === null
        ? []
        : [
            toComponent(result.employer.socialSecurityEmployer),
            toComponent(result.employer.medicareEmployer),
            toComponent(result.employer.futaEmployer),
          ],
  };
}

/** Regular wages = gross total minus the supplemental portion. */
export function regularWagesFrom(grossTotal: string, supplemental: string): string {
  return toStorageString(money(grossTotal).minus(money(supplemental)));
}

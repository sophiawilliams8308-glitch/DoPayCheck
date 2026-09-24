import type { PayBasis } from '@/lib/calculator/types/input';
import type { PayFrequency } from '@/lib/db/generated/client';

/**
 * Calculator registry (SEO-05 contract §8, §9).
 *
 * ===========================================================================
 * THE SINGLE SOURCE OF TRUTH FOR CALCULATOR IDENTITY.
 *
 * This is NOT a second calculation engine — every entry only describes which existing
 * `calculatePaycheck()` input shapes a page offers and how it presents them. The actual
 * arithmetic always runs through `lib/calculator/index.ts` (SEO-05 contract §10).
 *
 * `calculatorKey` is the stable, URL-independent identity (contract §9): never a display
 * title, never derived from the URL at runtime. `canonicalPath` is DERIVED from the key
 * (`/${calculatorKey}-calculator/`) here, once, rather than duplicated at every call site —
 * every name in the SEO-05 inspection's approved inventory (spec §36; the SEO-05 inspection
 * report §7/§8) already follows this exact `{key}-calculator` URL shape, so the derivation is
 * not an invented convention, it is the one the repository's own evidence already uses.
 *
 * Exactly the 6 owner-approved candidates (SEO-05 contract §54 decision record): `net-pay` is
 * deliberately NOT a registry entry — Pair A was resolved CONSOLIDATE, so `/net-pay-calculator/`
 * is a redirect only (`./redirects.ts`), never its own calculator identity or `SeoPage`.
 * ===========================================================================
 */

export const CALCULATOR_KEYS = [
  'paycheck',
  'salary-paycheck',
  'hourly-paycheck',
  'overtime',
  'bonus-tax',
  'take-home-pay',
] as const;

export type CalculatorKey = (typeof CALCULATOR_KEYS)[number];

export function isCalculatorKey(value: string): value is CalculatorKey {
  return (CALCULATOR_KEYS as readonly string[]).includes(value);
}

/** Every pay frequency the calculator UI offers. DAILY is deliberately excluded here — its
 * periods-per-year is a payroll-policy choice with no calendar answer (`pay-frequency.ts`'s own
 * PENDING DECISION), and a calculator page must not ask a visitor to resolve that. The engine
 * itself still supports DAILY; this registry only narrows what the UI collects (contract §13:
 * "collect only inputs supported by the selected calculator"). */
export const CALCULATOR_UI_FREQUENCIES: readonly PayFrequency[] = [
  'WEEKLY',
  'BIWEEKLY',
  'SEMIMONTHLY',
  'MONTHLY',
  'QUARTERLY',
  'ANNUAL',
];

export interface CalculatorDefinition {
  readonly calculatorKey: CalculatorKey;
  readonly canonicalPath: string;
  readonly displayName: string;
  readonly shortDescription: string;
  /** Pay bases this calculator's UI accepts. A single-entry array locks the form to that
   * basis (e.g. `salary-paycheck` never shows an hourly-rate field). */
  readonly supportedPayBases: readonly PayBasis[];
  readonly supportedFrequencies: readonly PayFrequency[];
  readonly pageType: 'CALCULATOR';
  /** Whether this calculator offers overtime-hours input, beyond regular pay. */
  readonly supportsOvertime: boolean;
  /** Whether this calculator offers a bonus-amount input, beyond regular pay. */
  readonly supportsBonus: boolean;
  /**
   * Static configuration fact — NOT a live probe of today's rule data. `true` means this
   * calculator's input shape is one `calculatePaycheck()` can accept and attempt; it does NOT
   * mean the federal engine currently holds every rule the request will need (that is decided
   * per-request, by `coverage`/`resolveFederalRuleSet`, and reported through the ordinary
   * `CalculationStatus` — never assumed here). Feeds gate 9 (`./validation.ts`).
   */
  readonly calculationAvailable: boolean;
  /** A calculator whose methodology is disclosed as narrower than its name might suggest
   * (contract §15) — surfaced on the page itself, never silently omitted. */
  readonly scopeDisclosure?: string;
}

function definition(
  calculatorKey: CalculatorKey,
  fields: Omit<CalculatorDefinition, 'calculatorKey' | 'canonicalPath' | 'pageType'>,
): CalculatorDefinition {
  return {
    calculatorKey,
    canonicalPath: `/${calculatorKey}-calculator/`,
    pageType: 'CALCULATOR',
    ...fields,
  };
}

export const CALCULATOR_REGISTRY: Readonly<Record<CalculatorKey, CalculatorDefinition>> = {
  paycheck: definition('paycheck', {
    displayName: 'Paycheck Calculator',
    shortDescription:
      'Estimate federal paycheck withholding and take-home pay for salary or hourly work.',
    supportedPayBases: ['SALARY', 'HOURLY'],
    supportedFrequencies: CALCULATOR_UI_FREQUENCIES,
    supportsOvertime: true,
    supportsBonus: true,
    calculationAvailable: true,
  }),
  'salary-paycheck': definition('salary-paycheck', {
    displayName: 'Salary Paycheck Calculator',
    shortDescription: 'Estimate federal paycheck withholding for a fixed annual salary.',
    supportedPayBases: ['SALARY'],
    supportedFrequencies: CALCULATOR_UI_FREQUENCIES,
    supportsOvertime: false,
    supportsBonus: true,
    calculationAvailable: true,
  }),
  'hourly-paycheck': definition('hourly-paycheck', {
    displayName: 'Hourly Paycheck Calculator',
    shortDescription: 'Estimate federal paycheck withholding for an hourly wage.',
    supportedPayBases: ['HOURLY'],
    supportedFrequencies: CALCULATOR_UI_FREQUENCIES,
    supportsOvertime: true,
    supportsBonus: false,
    calculationAvailable: true,
  }),
  overtime: definition('overtime', {
    displayName: 'Overtime Calculator',
    shortDescription: 'Estimate paycheck withholding including overtime pay.',
    supportedPayBases: ['HOURLY'],
    supportedFrequencies: CALCULATOR_UI_FREQUENCIES,
    supportsOvertime: true,
    supportsBonus: false,
    calculationAvailable: true,
    scopeDisclosure:
      'This calculator performs overtime pay arithmetic only (hours × rate × multiplier), ' +
      'using the multiplier you enter. It does not apply any state or federal overtime-law ' +
      'threshold, and does not determine legal overtime eligibility.',
  }),
  'bonus-tax': definition('bonus-tax', {
    displayName: 'Bonus Tax Calculator',
    shortDescription: 'Estimate federal withholding on a bonus paid alongside a regular paycheck.',
    supportedPayBases: ['SALARY', 'HOURLY'],
    supportedFrequencies: CALCULATOR_UI_FREQUENCIES,
    supportsOvertime: false,
    supportsBonus: true,
    calculationAvailable: true,
  }),
  'take-home-pay': definition('take-home-pay', {
    displayName: 'Take-Home Pay Calculator',
    shortDescription: 'Estimate what you will actually take home after federal paycheck taxes.',
    supportedPayBases: ['SALARY', 'HOURLY'],
    supportedFrequencies: CALCULATOR_UI_FREQUENCIES,
    supportsOvertime: true,
    supportsBonus: true,
    calculationAvailable: true,
  }),
};

export function getCalculatorDefinition(key: string): CalculatorDefinition | null {
  return isCalculatorKey(key) ? CALCULATOR_REGISTRY[key] : null;
}

/** For callers that already hold a real `CalculatorKey` (e.g. iterating `CALCULATOR_KEYS`) —
 * a total lookup, so it never needs a null check or a non-null assertion at the call site. */
export function requireCalculatorDefinition(key: CalculatorKey): CalculatorDefinition {
  return CALCULATOR_REGISTRY[key];
}

/** Reverses `canonicalPath` (as a route slug, e.g. `"paycheck-calculator"`, no slashes) back
 * to its `CalculatorKey`. The one place this mapping is derived — route resolution and
 * `generateStaticParams()` both call this rather than re-deriving it. */
export function calculatorKeyFromSlug(slug: string): CalculatorKey | null {
  const path = `/${slug}/`;
  for (const key of CALCULATOR_KEYS) {
    if (CALCULATOR_REGISTRY[key].canonicalPath === path) {
      return key;
    }
  }
  return null;
}

export function slugForCalculator(key: CalculatorKey): string {
  return CALCULATOR_REGISTRY[key].canonicalPath.replace(/^\/|\/$/g, '');
}

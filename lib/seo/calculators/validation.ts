import { CALCULATOR_KEYS, CALCULATOR_REGISTRY, getCalculatorDefinition } from './registry';

/**
 * Calculator registry validation + real (non-hardcoded) gates 8/9 (SEO-05 contract §2, §23).
 *
 * ===========================================================================
 * REPLACES THE SEO-04 DISCLOSED HARDCODE.
 *
 * `lib/seo/sitemap-eligibility.ts` previously set `calculatorConfigured`/`calculationAvailable`
 * to `true` unconditionally, disclosed as a scope limit because no calculator registry existed
 * (SEO-04 §D.9 note; SEO-05 inspection report §10). `isCalculatorConfigured()` and
 * `isCalculationAvailable()` below are the real implementations gates 8/9 now call — sourced
 * from `./registry.ts`, never hardcoded. Gates 8/9 still apply universally to every page type
 * (`lib/seo/gates.ts` is untouched — no second gate system); for a non-CALCULATOR page these
 * two functions are simply not the relevant check, so the caller passes `true` for them exactly
 * as before, which stays correct for STATE/SALARY/GUIDE/HUB/HOME/UTILITY pages.
 * ===========================================================================
 */

/** Gate 8: does this `calculatorKey` resolve to a real, known registry entry. `null` (no
 * calculatorKey — never applicable to a non-CALCULATOR page) is not configured. */
export function isCalculatorConfigured(calculatorKey: string | null): boolean {
  return calculatorKey !== null && getCalculatorDefinition(calculatorKey) !== null;
}

/** Gate 9: does the registry consider this calculator's configuration capable of producing a
 * calculation. A STATIC configuration fact (see `CalculatorDefinition.calculationAvailable`'s
 * own doc) — never a live probe of today's tax-rule data, which is a per-request concern the
 * calculation itself reports through `CalculationStatus`, not through indexability. */
export function isCalculationAvailable(calculatorKey: string | null): boolean {
  if (calculatorKey === null) {
    return false;
  }
  const definition = getCalculatorDefinition(calculatorKey);
  return definition !== null && definition.calculationAvailable;
}

export interface RegistryValidationIssue {
  readonly calculatorKey: string;
  readonly message: string;
}

/** Self-check over the registry's own invariants (contract §39 "Registry" test requirements):
 * unique keys, unique canonical paths, valid configuration. Exists so a test can assert these
 * hold without hand-inspecting `CALCULATOR_REGISTRY` — and so a future registry edit that
 * breaks one of them fails loudly rather than silently. */
export function validateCalculatorRegistry(): readonly RegistryValidationIssue[] {
  const issues: RegistryValidationIssue[] = [];
  const seenPaths = new Map<string, string>();

  for (const key of CALCULATOR_KEYS) {
    const entry = CALCULATOR_REGISTRY[key];

    if (entry.calculatorKey !== key) {
      issues.push({
        calculatorKey: key,
        message: `Registry key "${key}" does not match its own calculatorKey field "${entry.calculatorKey}"`,
      });
    }
    if (entry.supportedPayBases.length === 0) {
      issues.push({ calculatorKey: key, message: 'supportedPayBases must not be empty' });
    }
    if (entry.supportedFrequencies.length === 0) {
      issues.push({ calculatorKey: key, message: 'supportedFrequencies must not be empty' });
    }
    if (!entry.canonicalPath.startsWith('/') || !entry.canonicalPath.endsWith('/')) {
      issues.push({
        calculatorKey: key,
        message: `canonicalPath "${entry.canonicalPath}" must start and end with "/"`,
      });
    }

    const existing = seenPaths.get(entry.canonicalPath);
    if (existing !== undefined) {
      issues.push({
        calculatorKey: key,
        message: `canonicalPath "${entry.canonicalPath}" duplicates the path already used by "${existing}"`,
      });
    } else {
      seenPaths.set(entry.canonicalPath, key);
    }
  }

  return issues;
}

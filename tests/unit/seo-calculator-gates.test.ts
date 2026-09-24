import { describe, expect, it } from 'vitest';

import { CALCULATOR_KEYS } from '@/lib/seo/calculators/registry';
import { isCalculationAvailable, isCalculatorConfigured } from '@/lib/seo/calculators/validation';

/**
 * Gates 8/9 — the real, registry-derived implementations (SEO-05 contract §23, §24) that
 * replace the SEO-04 hardcoded `true` in `lib/seo/sitemap-eligibility.ts`.
 */

describe('isCalculatorConfigured (gate 8)', () => {
  it('is true for every approved calculator key', () => {
    for (const key of CALCULATOR_KEYS) {
      expect(isCalculatorConfigured(key)).toBe(true);
    }
  });

  it('is false for an unknown key, an empty string, and null (never applicable)', () => {
    expect(isCalculatorConfigured('not-a-real-calculator')).toBe(false);
    expect(isCalculatorConfigured('net-pay-calculator')).toBe(false);
    expect(isCalculatorConfigured('')).toBe(false);
    expect(isCalculatorConfigured(null)).toBe(false);
  });
});

describe('isCalculationAvailable (gate 9)', () => {
  it('is true for every approved calculator key (all currently configured available: true)', () => {
    for (const key of CALCULATOR_KEYS) {
      expect(isCalculationAvailable(key)).toBe(true);
    }
  });

  it('is false for an unknown key or null — never optimistic for an unconfigured calculator', () => {
    expect(isCalculationAvailable('not-a-real-calculator')).toBe(false);
    expect(isCalculationAvailable(null)).toBe(false);
  });
});

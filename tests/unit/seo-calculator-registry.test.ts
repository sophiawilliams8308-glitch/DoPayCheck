import { describe, expect, it } from 'vitest';

import {
  CALCULATOR_KEYS,
  CALCULATOR_REGISTRY,
  CALCULATOR_UI_FREQUENCIES,
  calculatorKeyFromSlug,
  getCalculatorDefinition,
  isCalculatorKey,
  requireCalculatorDefinition,
  slugForCalculator,
} from '@/lib/seo/calculators/registry';
import { validateCalculatorRegistry } from '@/lib/seo/calculators/validation';

/**
 * Calculator registry (SEO-05 contract §8, §9, §39 "Registry").
 */

describe('CALCULATOR_REGISTRY — the approved 6-calculator inventory', () => {
  it('contains exactly the 6 owner-approved calculator keys (contract §54 decision record)', () => {
    expect([...CALCULATOR_KEYS].sort()).toEqual(
      [
        'bonus-tax',
        'hourly-paycheck',
        'overtime',
        'paycheck',
        'salary-paycheck',
        'take-home-pay',
      ].sort(),
    );
  });

  it('never includes net-pay, pay-raise, or salary-increase — the OQ-3 non-canonical/deferred names', () => {
    const keys = CALCULATOR_KEYS as readonly string[];
    expect(keys).not.toContain('net-pay');
    expect(keys).not.toContain('net-pay-calculator');
    expect(keys).not.toContain('pay-raise');
    expect(keys).not.toContain('salary-increase');
  });

  it('has no duplicate keys or canonical paths', () => {
    expect(validateCalculatorRegistry()).toEqual([]);
  });

  it("every canonicalPath follows the '/{key}-calculator/' shape", () => {
    for (const key of CALCULATOR_KEYS) {
      expect(CALCULATOR_REGISTRY[key].canonicalPath).toBe(`/${key}-calculator/`);
    }
  });

  it('every entry declares at least one supported pay basis and pay frequency', () => {
    for (const key of CALCULATOR_KEYS) {
      const entry = CALCULATOR_REGISTRY[key];
      expect(entry.supportedPayBases.length).toBeGreaterThan(0);
      expect(entry.supportedFrequencies.length).toBeGreaterThan(0);
    }
  });

  it('excludes DAILY from the UI frequency set (PENDING DECISION, never assumed)', () => {
    expect(CALCULATOR_UI_FREQUENCIES).not.toContain('DAILY');
  });

  it('take-home-pay is the canonical Pair A identity — single-basis calculators lock to one basis', () => {
    expect(CALCULATOR_REGISTRY['salary-paycheck'].supportedPayBases).toEqual(['SALARY']);
    expect(CALCULATOR_REGISTRY['hourly-paycheck'].supportedPayBases).toEqual(['HOURLY']);
  });

  it('overtime discloses its arithmetic-only scope (contract §15)', () => {
    expect(CALCULATOR_REGISTRY.overtime.scopeDisclosure).toBeDefined();
    expect(CALCULATOR_REGISTRY.overtime.scopeDisclosure).toMatch(/arithmetic/i);
  });
});

describe('isCalculatorKey / getCalculatorDefinition / requireCalculatorDefinition', () => {
  it('accepts every real key and rejects an unknown one', () => {
    for (const key of CALCULATOR_KEYS) {
      expect(isCalculatorKey(key)).toBe(true);
      expect(getCalculatorDefinition(key)).not.toBeNull();
      expect(requireCalculatorDefinition(key).calculatorKey).toBe(key);
    }
    expect(isCalculatorKey('net-pay-calculator')).toBe(false);
    expect(getCalculatorDefinition('net-pay-calculator')).toBeNull();
    expect(getCalculatorDefinition('')).toBeNull();
  });
});

describe('slug <-> calculatorKey round trip', () => {
  it('round-trips every real calculator through slugForCalculator/calculatorKeyFromSlug', () => {
    for (const key of CALCULATOR_KEYS) {
      const slug = slugForCalculator(key);
      expect(calculatorKeyFromSlug(slug)).toBe(key);
    }
  });

  it('returns null for an unknown slug — never a fabricated calculatorKey', () => {
    expect(calculatorKeyFromSlug('does-not-exist')).toBeNull();
    expect(calculatorKeyFromSlug('net-pay-calculator')).toBeNull();
  });
});

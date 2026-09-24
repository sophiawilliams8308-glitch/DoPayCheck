import { describe, expect, it } from 'vitest';

import { CALCULATOR_REGISTRY } from '@/lib/seo/calculators/registry';
import { CALCULATOR_REDIRECTS } from '@/lib/seo/calculators/redirects';

/**
 * OQ-3 Pair A redirect (SEO-05 contract §22, owner decision record §54: CONSOLIDATE,
 * `/take-home-pay-calculator/` canonical).
 */

describe('CALCULATOR_REDIRECTS', () => {
  it('redirects /net-pay-calculator/ permanently to the canonical take-home-pay path', () => {
    const redirect = CALCULATOR_REDIRECTS.find((entry) => entry.source === '/net-pay-calculator/');
    expect(redirect).toBeDefined();
    expect(redirect?.destination).toBe(CALCULATOR_REGISTRY['take-home-pay'].canonicalPath);
    expect(redirect?.destination).toBe('/take-home-pay-calculator/');
    expect(redirect?.permanent).toBe(true);
  });

  it('never redirects to itself and never targets a non-canonical path', () => {
    for (const redirect of CALCULATOR_REDIRECTS) {
      expect(redirect.source).not.toBe(redirect.destination);
    }
  });

  it('the destination is always a real, registered calculator canonical path', () => {
    const canonicalPaths = new Set(
      Object.values(CALCULATOR_REGISTRY).map((entry) => entry.canonicalPath),
    );
    for (const redirect of CALCULATOR_REDIRECTS) {
      expect(canonicalPaths.has(redirect.destination)).toBe(true);
    }
  });
});

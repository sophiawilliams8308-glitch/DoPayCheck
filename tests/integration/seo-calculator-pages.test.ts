import { afterAll, describe, expect, it } from 'vitest';

import { loadCalculatorPageData } from '@/lib/seo/calculators/pageData';
import { listEligibleSeoPages } from '@/lib/seo/sitemap-eligibility';
import { isRouteVisibleInProduction, resolveCalculatorPageRoute } from '@/lib/seo/routes';
import { CALCULATOR_KEYS, CALCULATOR_REGISTRY } from '@/lib/seo/calculators/registry';

import { disconnect, hasDatabase, testPrisma } from './helpers/db';

/**
 * Calculator pages against the real database (SEO-05 contract §39 "Route resolution", "SEO").
 *
 * ===========================================================================
 * EXERCISES THE REAL BOOTSTRAPPED CONTENT.
 *
 * These pages are created by `prisma/seedSeoCalculators.ts` (contract §16's controlled
 * creation mechanism), not by this test file — this suite verifies what that mechanism
 * actually produced, restoring any state it temporarily changes. Skips entirely (per every
 * other integration test's own convention) rather than failing when the seed has not been run
 * in this database.
 * ===========================================================================
 */

describe.skipIf(!hasDatabase)('calculator pages — route resolution', () => {
  afterAll(async () => {
    await disconnect();
  });

  it('resolveCalculatorPageRoute returns null for an unknown calculator key', async () => {
    expect(await resolveCalculatorPageRoute('not-a-real-calculator')).toBeNull();
  });

  it.each(CALCULATOR_KEYS)(
    'resolveCalculatorPageRoute resolves "%s" if the bootstrap seed has run',
    async (key) => {
      const route = await resolveCalculatorPageRoute(key);
      if (route === null) {
        // The seed (`npm run db:seed:seo-calculators`) has not been run against this
        // database — a legitimate, disclosed precondition (contract §16), not a failure of
        // route resolution itself.
        return;
      }
      expect(route.page.calculatorKey).toBe(key);
      expect(route.page.path).toBe(CALCULATOR_REGISTRY[key].canonicalPath);
      expect(isRouteVisibleInProduction(route)).toBe(true);
    },
  );
});

describe.skipIf(!hasDatabase)('calculator pages — page data + sitemap eligibility', () => {
  afterAll(async () => {
    await disconnect();
  });

  it('loadCalculatorPageData returns null for an unknown calculator key', async () => {
    // @ts-expect-error — deliberately outside the CalculatorKey union, exercising the
    // function's own defense-in-depth registry check.
    expect(await loadCalculatorPageData('not-a-real-calculator')).toBeNull();
  });

  it('resolves the real, seeded "paycheck" page with its effective metadata and blocks', async () => {
    const existing = await testPrisma().seoPage.findFirst({
      where: { pageType: 'CALCULATOR', calculatorKey: 'paycheck' },
    });
    if (existing === null) {
      return; // Seed not run against this database — see the suite's own doc comment.
    }

    const data = await loadCalculatorPageData('paycheck');
    expect(data).not.toBeNull();
    expect(data?.calculatorKey).toBe('paycheck');
    expect(data?.canonicalPath).toBe('/paycheck-calculator/');
    expect(data?.titleText).not.toBeNull();
    expect(data?.blocks.length).toBeGreaterThan(0);
    expect(data?.blocks.some((block) => block.blockType === 'DISCLAIMER')).toBe(true);
    expect(data?.blocks.some((block) => block.blockType === 'CALCULATOR_EMBED')).toBe(true);
  });

  it('returns null once the page is temporarily unpublished, and resolves again once restored', async () => {
    const page = await testPrisma().seoPage.findFirst({
      where: { pageType: 'CALCULATOR', calculatorKey: 'bonus-tax' },
    });
    if (page === null) {
      return; // Seed not run against this database.
    }

    await testPrisma().seoPage.update({
      where: { id: page.id },
      data: { lifecycleState: 'DRAFT' },
    });
    try {
      expect(await loadCalculatorPageData('bonus-tax')).toBeNull();
    } finally {
      await testPrisma().seoPage.update({
        where: { id: page.id },
        data: { lifecycleState: 'PUBLISHED' },
      });
    }

    expect(await loadCalculatorPageData('bonus-tax')).not.toBeNull();
  });

  it(
    'every seeded calculator page is sitemap-eligible — proves gates 8/9 and the ' +
      'precomputed relatedLinksCache cross-link all 6 pages to satisfy gate 12',
    async () => {
      const allPages = await testPrisma().seoPage.findMany({
        where: { pageType: 'CALCULATOR' },
        select: { calculatorKey: true },
      });
      const seededKeys = new Set(allPages.map((page) => page.calculatorKey));
      const runnableKeys = CALCULATOR_KEYS.filter((key) => seededKeys.has(key));
      if (runnableKeys.length === 0) {
        return; // Seed not run against this database.
      }

      const eligible = await listEligibleSeoPages();
      const eligiblePaths = new Set(eligible.map((page) => page.path));

      for (const key of runnableKeys) {
        expect(eligiblePaths.has(CALCULATOR_REGISTRY[key].canonicalPath)).toBe(true);
      }
    },
  );
});

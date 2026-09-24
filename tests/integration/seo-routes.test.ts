import { afterAll, describe, expect, it } from 'vitest';

import {
  isRouteVisibleInProduction,
  resolveGuidePageRoute,
  resolveSalaryPageRoute,
  resolveStatePageRoute,
} from '@/lib/seo/routes';

import {
  createTestJurisdiction,
  disconnect,
  hasDatabase,
  testPrisma,
  uniqueSuffix,
} from './helpers/db';

const suffix = uniqueSuffix();

// Every `createTestJurisdiction()` call below deliberately omits `type: 'STATE'` (default
// type is FEDERAL): route resolution never reads `Jurisdiction.type`, and
// `state-coverage-matrix.test.ts` asserts an exact, UNSCOPED `listByType('STATE')` count —
// the same reason `state-candidate-retrieval.test.ts` and `tax-readiness.test.ts` avoid it.
describe.skipIf(!hasDatabase)('SEO programmatic route resolution (contract §R)', () => {
  afterAll(async () => {
    await disconnect();
  });

  it('resolveStatePageRoute returns null for an unknown slug — a 404, never a thin 200', async () => {
    expect(await resolveStatePageRoute(`unknown-${suffix}`)).toBeNull();
  });

  it('resolveStatePageRoute returns null when the jurisdiction exists but has no SeoPage yet', async () => {
    // `createTestJurisdiction` slugs as `test-${suffix}`.
    await createTestJurisdiction(suffix);
    expect(await resolveStatePageRoute(`test-${suffix}`)).toBeNull();
  });

  it('resolveStatePageRoute resolves via the EXISTING Jurisdiction.slug once a SeoPage exists', async () => {
    const jurisdiction = await createTestJurisdiction(`${suffix}-2`);
    await testPrisma().seoPage.create({
      data: {
        pageType: 'STATE',
        path: `/paycheck-calculator/test-${suffix}-2/`,
        jurisdictionId: jurisdiction.id,
        lifecycleState: 'DRAFT',
      },
    });

    const resolution = await resolveStatePageRoute(`test-${suffix}-2`);
    expect(resolution).not.toBeNull();
    expect(resolution?.jurisdictionId).toBe(jurisdiction.id);
    expect(isRouteVisibleInProduction(resolution!)).toBe(false); // DRAFT ⇒ not production-visible
  });

  it('resolveSalaryPageRoute returns null for a non-integer or negative amount', async () => {
    expect(await resolveSalaryPageRoute(1.5)).toBeNull();
    expect(await resolveSalaryPageRoute(-1)).toBeNull();
  });

  it('resolveSalaryPageRoute returns null when no SeoPage exists for that amount', async () => {
    expect(await resolveSalaryPageRoute(919191919)).toBeNull();
  });

  it('resolveGuidePageRoute resolves a PUBLISHED page as production-visible', async () => {
    const slug = `${suffix}-guide`;
    await testPrisma().seoPage.create({
      data: {
        pageType: 'GUIDE',
        path: `/guides/${slug}/`,
        guideSlug: slug,
        lifecycleState: 'PUBLISHED',
      },
    });
    const resolution = await resolveGuidePageRoute(slug);
    expect(resolution).not.toBeNull();
    expect(isRouteVisibleInProduction(resolution!)).toBe(true);
  });

  it('resolveGuidePageRoute returns null for an unknown slug', async () => {
    expect(await resolveGuidePageRoute(`unknown-${suffix}`)).toBeNull();
  });
});

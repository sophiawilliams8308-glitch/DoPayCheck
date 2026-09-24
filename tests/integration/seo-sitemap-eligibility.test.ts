import { afterAll, describe, expect, it } from 'vitest';

import { listEligibleSeoPages } from '@/lib/seo/sitemap-eligibility';
import { grantReadinessApproval } from '@/lib/tax/readiness/repository';

import {
  createTestJurisdiction,
  createTestTaxYear,
  disconnect,
  hasDatabase,
  testPrisma,
  uniqueSuffix,
} from './helpers/db';

/**
 * `listEligibleSeoPages()` against the real database (SEO-03 contract §N, §46).
 */

const suffix = uniqueSuffix();

function disclaimerBlock(
  pageId: string,
  position: number,
): {
  pageId: string;
  blockType: 'DISCLAIMER';
  position: number;
  payload: object;
  isRequired: boolean;
  isRemovable: boolean;
} {
  return {
    pageId,
    blockType: 'DISCLAIMER',
    position,
    payload: {
      body: {
        nodes: [{ type: 'paragraph', children: [{ type: 'text', text: 'Estimate only.' }] }],
      },
    },
    isRequired: true,
    isRemovable: false,
  };
}

describe.skipIf(!hasDatabase)('listEligibleSeoPages', () => {
  afterAll(async () => {
    await disconnect();
  });

  it('excludes a non-PUBLISHED page', async () => {
    const before = await listEligibleSeoPages();

    const page = await testPrisma().seoPage.create({
      data: {
        pageType: 'GUIDE',
        path: `/guides/${suffix}-draft/`,
        guideSlug: `${suffix}-draft`,
        lifecycleState: 'DRAFT',
        manualIndexable: true,
        titleOverride: 'Draft Guide',
        descriptionOverride: 'A draft guide.',
        h1Override: 'Draft Guide',
      },
    });
    await testPrisma().seoBlock.create({ data: disclaimerBlock(page.id, 1) });

    const after = await listEligibleSeoPages();
    expect(after.length).toBe(before.length);
    expect(after.some((p) => p.id === page.id)).toBe(false);
  });

  it('excludes a PUBLISHED page with manualIndexable=false', async () => {
    const before = await listEligibleSeoPages();

    const page = await testPrisma().seoPage.create({
      data: {
        pageType: 'GUIDE',
        path: `/guides/${suffix}-noindex/`,
        guideSlug: `${suffix}-noindex`,
        lifecycleState: 'PUBLISHED',
        manualIndexable: false,
        titleOverride: 'Noindex Guide',
        descriptionOverride: 'A noindex guide.',
        h1Override: 'Noindex Guide',
      },
    });
    await testPrisma().seoBlock.create({ data: disclaimerBlock(page.id, 1) });

    const after = await listEligibleSeoPages();
    expect(after.length).toBe(before.length);
    expect(after.some((p) => p.id === page.id)).toBe(false);
  });

  it('includes a fully valid, PUBLISHED, manualIndexable guide page passing every gate', async () => {
    // Every gate matters here — this is the one test proving the full wiring (DB query, block
    // evaluation, inbound-link counting from the batch, related-link validity) end to end, not
    // just that gate logic is correct in isolation (tests/unit/seo-gates.test.ts already
    // covers that exhaustively).
    const guidePath = `/guides/${suffix}-valid/`;
    const hubPath = `/guides/${suffix}-hub/`;
    const secondPath = `/guides/${suffix}-second/`;

    const guide = await testPrisma().seoPage.create({
      data: {
        pageType: 'GUIDE',
        path: guidePath,
        guideSlug: `${suffix}-valid`,
        lifecycleState: 'PUBLISHED',
        manualIndexable: true,
        titleOverride: 'Valid Guide',
        descriptionOverride: 'A valid, published guide page with everything it needs.',
        h1Override: 'Valid Guide',
        relatedLinksCache: { targets: [{ path: hubPath }] },
      },
    });
    await testPrisma().seoBlock.createMany({
      data: [
        disclaimerBlock(guide.id, 1),
        {
          pageId: guide.id,
          blockType: 'RICH_TEXT',
          position: 2,
          payload: {
            body: {
              nodes: [{ type: 'paragraph', children: [{ type: 'text', text: 'Guide body.' }] }],
            },
          },
          isRequired: false,
          isRemovable: true,
        },
        {
          pageId: guide.id,
          blockType: 'CTA',
          position: 3,
          payload: { label: 'Calculate', href: '/paycheck-calculator/' },
          isRequired: false,
          isRemovable: true,
        },
      ],
    });

    // Inbound link #1, from a HUB page — satisfies "at least one from a hub or calculator".
    await testPrisma().seoPage.create({
      data: {
        pageType: 'HUB',
        path: hubPath,
        lifecycleState: 'PUBLISHED',
        manualIndexable: true,
        titleOverride: 'Guides Hub',
        descriptionOverride: 'All guides.',
        h1Override: 'Guides Hub',
        relatedLinksCache: { targets: [{ path: guidePath }] },
      },
    });
    // Inbound link #2, from an ordinary page — satisfies the ≥2 total requirement.
    await testPrisma().seoPage.create({
      data: {
        pageType: 'GUIDE',
        path: secondPath,
        guideSlug: `${suffix}-second`,
        lifecycleState: 'PUBLISHED',
        manualIndexable: true,
        titleOverride: 'Second Guide',
        descriptionOverride: 'Another guide linking to the first.',
        h1Override: 'Second Guide',
        relatedLinksCache: { targets: [{ path: guidePath }] },
      },
    });
    await testPrisma().seoBlock.create({
      data: disclaimerBlock(
        (await testPrisma().seoPage.findUniqueOrThrow({ where: { path: secondPath } })).id,
        1,
      ),
    });

    const after = await listEligibleSeoPages();
    const found = after.find((p) => p.id === guide.id);
    expect(found).toMatchObject({ path: guidePath });
  });

  it('excludes a STATE page whose tax readiness is not publishable', async () => {
    const jurisdiction = await createTestJurisdiction(`${suffix}-state`);
    // Unique per run: a repeat run in the same database (TaxYear rows created via an approval
    // become FK-Restrict-undeletable, same as in tax-readiness.test.ts) must not collide with
    // `TaxYear.year`'s global uniqueness, and must stay a 4-digit year (see that file's note
    // on 5-digit years round-tripping as an unparseable date for this driver).
    const taxYear = await createTestTaxYear(2100 + (Date.now() % 7000));

    const before = await listEligibleSeoPages();
    const statePath = `/paycheck-calculator/${suffix}-state/`;
    const linkerPath = `/paycheck-calculator/${suffix}-linker/`;

    const page = await testPrisma().seoPage.create({
      data: {
        pageType: 'STATE',
        path: statePath,
        jurisdictionId: jurisdiction.id,
        lifecycleState: 'PUBLISHED',
        manualIndexable: true,
        titleOverride: 'State Guide',
        descriptionOverride: 'A state calculator page.',
        h1Override: 'State Guide',
        contentYear: taxYear.year,
        requiredCapabilities: ['WITHHOLDING'],
        relatedLinksCache: { targets: [{ path: linkerPath }] },
      },
    });
    await testPrisma().seoBlock.createMany({
      data: [
        disclaimerBlock(page.id, 1),
        {
          pageId: page.id,
          blockType: 'RICH_TEXT',
          position: 2,
          payload: {
            body: {
              nodes: [{ type: 'paragraph', children: [{ type: 'text', text: 'State details.' }] }],
            },
          },
          isRequired: false,
          isRemovable: true,
        },
        {
          pageId: page.id,
          blockType: 'CTA',
          position: 3,
          payload: { label: 'Calculate', href: '/paycheck-calculator/' },
          isRequired: false,
          isRemovable: true,
        },
      ],
    });
    // Two inbound links, at least one from a CALCULATOR-type page (gate 12).
    await testPrisma().seoPage.create({
      data: {
        pageType: 'CALCULATOR',
        path: linkerPath,
        calculatorKey: `${suffix}-linker`,
        lifecycleState: 'PUBLISHED',
        manualIndexable: true,
        titleOverride: 'Main Calculator',
        descriptionOverride: 'Links to the state page.',
        h1Override: 'Main Calculator',
        relatedLinksCache: { targets: [{ path: statePath }] },
      },
    });
    const secondLinkerPath = `/paycheck-calculator/${suffix}-second-linker/`;
    await testPrisma().seoPage.create({
      data: {
        pageType: 'STATE',
        path: secondLinkerPath,
        jurisdictionId: (await createTestJurisdiction(`${suffix}-linker2`)).id,
        lifecycleState: 'PUBLISHED',
        manualIndexable: true,
        titleOverride: 'Another State',
        descriptionOverride: 'Also links to the target state page.',
        h1Override: 'Another State',
        relatedLinksCache: { targets: [{ path: statePath }] },
      },
    });

    const noApproval = await listEligibleSeoPages();
    expect(noApproval.some((p) => p.id === page.id)).toBe(false);
    expect(noApproval.length).toBe(before.length);

    await grantReadinessApproval({
      jurisdictionId: jurisdiction.id,
      taxYearId: taxYear.id,
      capabilities: ['WITHHOLDING'],
      approvedByUserId: 'tester',
      reason: 'Sitemap eligibility fixture',
    });

    const withApproval = await listEligibleSeoPages();
    expect(withApproval.some((p) => p.id === page.id)).toBe(true);
  });

  it('excludes a page missing its required DISCLAIMER block (gate 18 fails)', async () => {
    const before = await listEligibleSeoPages();

    // No SeoBlock created at all — title/description/h1 still resolve (no SeoSettings row
    // exists in this test database, so `resolveSeoMetadata()` falls through to the global
    // `SITE` constant fallback, per contract §C), but the non-removable DISCLAIMER block
    // (gate 18) is genuinely absent.
    const page = await testPrisma().seoPage.create({
      data: {
        pageType: 'GUIDE',
        path: `/guides/${suffix}-no-disclaimer/`,
        guideSlug: `${suffix}-no-disclaimer`,
        lifecycleState: 'PUBLISHED',
        manualIndexable: true,
      },
    });

    const after = await listEligibleSeoPages();
    expect(after.length).toBe(before.length);
    expect(after.some((p) => p.id === page.id)).toBe(false);
  });
});

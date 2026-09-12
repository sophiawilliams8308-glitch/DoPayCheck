import type { MetadataRoute } from 'next';

/**
 * XML sitemap (spec §37).
 *
 * A sitemap must contain only canonical, indexable, valid, HTTP 200 URLs. In Phase 1 no page
 * meets that bar — the home page is deliberately non-indexable and no real content exists —
 * so the sitemap is intentionally empty rather than populated with placeholder URLs.
 *
 * Phase 11 populates it from real routes, including the 50 canonical state pages
 * (`/paycheck-calculator/{state}/`, spec §35/§66).
 */
export default function sitemap(): MetadataRoute.Sitemap {
  return [];
}

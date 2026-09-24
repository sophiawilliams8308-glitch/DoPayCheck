import type { MetadataRoute } from 'next';

import { canonicalUrl } from '@/lib/seo/metadata';
import { listEligibleSeoPages } from '@/lib/seo/sitemap-eligibility';

/**
 * XML sitemap (spec §37; SEO-03 contract §N, §31, §46).
 *
 * ===========================================================================
 * EXTENDED, NOT REPLACED — `app/sitemap.ts` remains the sole sitemap owner. It calls
 * `listEligibleSeoPages()` (`lib/seo/sitemap-eligibility.ts`) and does nothing else; that
 * module is the ONE place eligibility is decided, using the same gate/readiness logic the
 * resolver and `resolveIndexability()` use elsewhere — never a second, competing view of
 * which pages exist (contract §31).
 *
 * A sitemap must contain only canonical, indexable, valid, HTTP 200 URLs. Today that set is
 * empty — the home page is deliberately non-indexable (§37) and no `SeoPage` row exists yet
 * (no admin creates one; SEO-04 builds none) — so this still returns `[]` in practice, but
 * now because the real query finds nothing PUBLISHED, not because the route is hardcoded
 * empty. `lastmod` reflects a genuine content change (`SeoPage.updatedAt`), never a cosmetic
 * tax-year token bump (contract §N).
 * ===========================================================================
 */
/** Revalidation window — a tuning detail, not an architectural decision (contract §46: "exact
 * revalidate windows are an implementation tuning detail"). Without this the route would
 * statically cache its build-time result forever, which would defeat a data-driven sitemap. */
export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const pages = await listEligibleSeoPages();
  return pages.map((page) => ({
    url: canonicalUrl(page.path),
    lastModified: page.updatedAt,
  }));
}

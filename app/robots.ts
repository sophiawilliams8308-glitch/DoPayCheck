import type { MetadataRoute } from 'next';

import { getPublicEnv } from '@/lib/config/env';
import { canonicalUrl, siteUrl } from '@/lib/seo/metadata';

/**
 * robots.txt (spec §37; SEO-03 contract §M, §30).
 *
 * ===========================================================================
 * EXTENDED, NOT REPLACED — `app/robots.ts` remains the sole robots owner (contract §19, §AF).
 *
 * Production: allow crawling, reference the sitemap. Non-production: disallow everything —
 * driven by environment, never by content (contract §M: "robots.txt is never a substitute for
 * page-level noindex" — individual page suppression is `buildMetadata()`'s `indexable` flag,
 * resolved per page by `resolveIndexability()`, not this file).
 *
 * `/api/` and `/admin/` remain disallowed permanently in every environment — `/admin` does not
 * exist yet (SEO-04 builds no admin UI), but the rule is future-proofed rather than added
 * later alongside it.
 * ===========================================================================
 */
export default function robots(): MetadataRoute.Robots {
  const isProduction = getPublicEnv().NODE_ENV === 'production';

  return {
    rules: isProduction
      ? [{ userAgent: '*', disallow: ['/api/', '/admin/'] }]
      : [{ userAgent: '*', disallow: '/' }],
    sitemap: `${siteUrl()}/sitemap.xml`,
    host: canonicalUrl('/'),
  };
}

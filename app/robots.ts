import type { MetadataRoute } from 'next';

import { canonicalUrl, siteUrl } from '@/lib/seo/metadata';

/**
 * robots.txt (spec §37).
 *
 * Phase 1 posture: the site has no real public content yet, so crawling is disallowed
 * outright. Allowing indexing of a placeholder would create thin-content signals against the
 * domain before launch. Phase 11 opens this up alongside real content.
 *
 * `/api/` and `/admin/` remain disallowed permanently.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        disallow: '/',
      },
    ],
    sitemap: `${siteUrl()}/sitemap.xml`,
    host: canonicalUrl('/'),
  };
}

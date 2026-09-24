import type { Metadata } from 'next';

import { getPublicEnv } from '@/lib/config/env';

/**
 * SEO metadata foundation (spec §37).
 *
 * PHASE 1 SCOPE: the mechanism only — canonical URLs, titles, descriptions, Open Graph and
 * Twitter metadata, plus a base URL for robots/sitemap generation.
 *
 * NOT in Phase 1 (spec §35, §36, §66, §67): state landing pages, calculator landing pages,
 * structured data, breadcrumbs, the internal-linking system and content. Phase 11 owns those.
 * No placeholder or fabricated content is created here.
 */

export const SITE = {
  name: 'DoPayCheck',
  /** Product promise from spec §1/§32. */
  tagline: "Know What You'll Take Home",
  description:
    'DoPayCheck helps you understand your US paycheck: estimated take-home pay, federal ' +
    'withholding, Social Security, Medicare, state and local taxes, and how deductions ' +
    'affect what you actually receive.',
  locale: 'en_US',
} as const;

/** Canonical origin, no trailing slash. */
export function siteUrl(): string {
  return getPublicEnv().NEXT_PUBLIC_SITE_URL;
}

/**
 * Builds an absolute canonical URL from a site-relative path.
 * Applies the project's trailing-slash policy (see `next.config.ts`, spec §37).
 */
export function canonicalUrl(path = '/'): string {
  const normalized = path.startsWith('/') ? path : `/${path}`;
  const withTrailingSlash =
    normalized === '/' || normalized.endsWith('/') ? normalized : `${normalized}/`;
  return `${siteUrl()}${withTrailingSlash}`;
}

export interface PageMetadataInput {
  readonly title: string;
  readonly description: string;
  /** Site-relative path, e.g. `/paycheck-calculator/`. */
  readonly path: string;
  /** Set false for pages that must not be indexed (spec §37). */
  readonly indexable?: boolean;
  /**
   * Site-relative Open Graph / Twitter image path, e.g. `/og/california.png`.
   *
   * SEO-04 (SEO-03 contract §L): strictly additive — omitting it leaves every existing caller
   * (`app/page.tsx`, `app/layout.tsx`) byte-for-byte unchanged. Added here rather than in a
   * second metadata emitter because `buildMetadata()` remains the sole one (contract §19).
   */
  readonly ogImagePath?: string;
}

/** Builds per-page metadata with a canonical URL and social tags. */
export function buildMetadata(input: PageMetadataInput): Metadata {
  const url = canonicalUrl(input.path);
  const indexable = input.indexable ?? true;
  const ogImageUrl =
    input.ogImagePath === undefined ? undefined : `${siteUrl()}${input.ogImagePath}`;

  return {
    title: input.title,
    description: input.description,
    alternates: { canonical: url },
    openGraph: {
      type: 'website',
      siteName: SITE.name,
      title: input.title,
      description: input.description,
      url,
      locale: SITE.locale,
      ...(ogImageUrl === undefined ? {} : { images: [{ url: ogImageUrl }] }),
    },
    twitter: {
      card: 'summary_large_image',
      title: input.title,
      description: input.description,
      ...(ogImageUrl === undefined ? {} : { images: [ogImageUrl] }),
    },
    robots: indexable
      ? { index: true, follow: true }
      : { index: false, follow: false, nocache: true },
  };
}

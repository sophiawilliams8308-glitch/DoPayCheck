import { faqItemsFromPayload } from './blocks';
import { resolveBreadcrumbTrail, type BreadcrumbInput } from './breadcrumbs';
import { canonicalUrl } from './metadata';
import type { SeoBlockType } from './types';

/**
 * Structured data (SEO-03 contract §O).
 *
 * ===========================================================================
 * ONE STRUCTURED-DATA RESOLVER. ONE JSON-LD EMITTER. Implements exactly the five allowed
 * types and nothing else:
 *
 *   Organization  — home, when settings are populated
 *   WebSite       — home
 *   BreadcrumbList — every page except home, from `resolveBreadcrumbTrail()` — the SAME trail
 *                    that powers the visible breadcrumbs, never a second definition
 *   FAQPage       — ONLY when a populated, VISIBLE FAQ block exists on the page
 *   Article       — `/guides/` pages only
 *
 * NEVER EMITTED (contract §O, §42): SoftwareApplication, WebApplication, Product, Offer,
 * AggregateRating, HowTo, FinancialProduct, Dataset. There is no `Calculator` schema type —
 * inventing one would describe something the page is not. A scanner test
 * (`tests/unit/seo-guards.test.ts`) asserts none of these strings ever appear in this file.
 * ===========================================================================
 */

export interface OrganizationSettings {
  readonly organizationName: string | null;
  readonly organizationLogoPath: string | null;
  readonly organizationSameAs: readonly string[];
}

export interface StructuredDataInput extends BreadcrumbInput {
  readonly siteName: string;
  readonly siteDescription: string;
  readonly organization?: OrganizationSettings;
  /** Visible blocks on this page, in the same shape the resolver and gates already use. */
  readonly blocks: readonly { readonly blockType: SeoBlockType; readonly payload: unknown }[];
}

function organizationSchema(settings: OrganizationSettings): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: settings.organizationName,
    ...(settings.organizationLogoPath === null
      ? {}
      : { logo: canonicalUrl(settings.organizationLogoPath) }),
    ...(settings.organizationSameAs.length === 0 ? {} : { sameAs: settings.organizationSameAs }),
  };
}

function websiteSchema(siteName: string): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: siteName,
    url: canonicalUrl('/'),
  };
}

function breadcrumbListSchema(input: BreadcrumbInput): Record<string, unknown> | null {
  const trail = resolveBreadcrumbTrail(input);
  if (trail.length === 0) {
    return null;
  }
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: trail.map((entry, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: entry.label,
      item: canonicalUrl(entry.path),
    })),
  };
}

/** `null` unless a populated FAQ block exists — never emitted for a hidden or absent FAQ. */
function faqPageSchema(
  blocks: readonly { readonly blockType: SeoBlockType; readonly payload: unknown }[],
): Record<string, unknown> | null {
  const questions = blocks.flatMap(
    (block) => faqItemsFromPayload(block.blockType, block.payload) ?? [],
  );
  if (questions.length === 0) {
    return null;
  }
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: questions.map((item) => ({
      '@type': 'Question',
      name: item.question,
      acceptedAnswer: { '@type': 'Answer', text: item.answer },
    })),
  };
}

function articleSchema(input: StructuredDataInput): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: input.label ?? input.siteName,
    description: input.siteDescription,
    url: canonicalUrl(input.path),
  };
}

/** Builds every structured-data object applicable to one page. Returns an array ready to
 * serialize, one `<script type="application/ld+json">` per entry (or one array, either is a
 * valid JSON-LD document — the choice is a rendering detail, not an architectural one). */
export function buildStructuredData(
  input: StructuredDataInput,
): readonly Record<string, unknown>[] {
  const schemas: Record<string, unknown>[] = [];

  if (input.pageType === 'HOME') {
    if (input.organization !== undefined) {
      schemas.push(organizationSchema(input.organization));
    }
    schemas.push(websiteSchema(input.siteName));
  }

  const breadcrumbs = breadcrumbListSchema(input);
  if (breadcrumbs !== null) {
    schemas.push(breadcrumbs);
  }

  const faq = faqPageSchema(input.blocks);
  if (faq !== null) {
    schemas.push(faq);
  }

  if (input.pageType === 'GUIDE') {
    schemas.push(articleSchema(input));
  }

  return schemas;
}

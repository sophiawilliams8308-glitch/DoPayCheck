import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { CalculatorForm } from '@/components/calculator/CalculatorForm';
import { Faq, Hero, RelatedLinks, RichText } from '@/components/seo/SeoBlocks';
import { buildSeoPageMetadata } from '@/lib/seo/buildSeoPageMetadata';
import {
  CALCULATOR_KEYS,
  calculatorKeyFromSlug,
  requireCalculatorDefinition,
} from '@/lib/seo/calculators/registry';
import { loadCalculatorPageData } from '@/lib/seo/calculators/pageData';
import { resolveBreadcrumbTrail } from '@/lib/seo/breadcrumbs';
import { buildStructuredData } from '@/lib/seo/structured-data';
import { relatedCalculatorsForCalculator, type LinkCandidate } from '@/lib/seo/internal-links';
import { SITE } from '@/lib/seo/metadata';
import { isRouteVisibleInProduction, resolveCalculatorPageRoute } from '@/lib/seo/routes';

/**
 * Calculator page route (SEO-05 contract §30, §46 Slices 3-11).
 *
 * ===========================================================================
 * ONE DYNAMIC ROUTE FOR THE WHOLE CALCULATOR FAMILY.
 *
 * Every approved calculator URL follows the same, repository-evidenced shape
 * (`/{calculatorKey}-calculator/` — SEO-05 inspection report §7/§8), so one `[calculatorSlug]`
 * segment resolves all six rather than six near-duplicate route files. `generateStaticParams()`
 * enumerates exactly the registry's known slugs (contract §19: "no unbounded route system") and
 * `dynamicParams = false` means any other slug 404s WITHOUT a database query.
 *
 * Route resolution reuses `resolveCalculatorPageRoute()` (built, unused, in SEO-04) — the
 * existence/visibility check `lib/seo/routes.ts` already established (contract §30: "extend
 * that system"). Metadata/indexability resolution reuses `loadCalculatorPageData()``, which in
 * turn calls the exact same resolver/gates/indexability primitives the sitemap batch uses
 * (contract §5).
 * ===========================================================================
 */

export const revalidate = 3600;
export const dynamicParams = false;

export function generateStaticParams(): readonly { calculatorSlug: string }[] {
  return CALCULATOR_KEYS.map((key) => ({
    calculatorSlug: requireCalculatorDefinition(key).canonicalPath.replace(/^\/|\/$/g, ''),
  }));
}

interface PageParams {
  readonly params: Promise<{ readonly calculatorSlug: string }>;
}

async function resolve(calculatorSlug: string) {
  const calculatorKey = calculatorKeyFromSlug(calculatorSlug);
  if (calculatorKey === null) {
    return null;
  }
  const route = await resolveCalculatorPageRoute(calculatorKey);
  if (route === null || !isRouteVisibleInProduction(route)) {
    return null;
  }
  const data = await loadCalculatorPageData(calculatorKey);
  if (data === null) {
    return null;
  }
  return { calculatorKey, data };
}

export async function generateMetadata({ params }: PageParams): Promise<Metadata> {
  const { calculatorSlug } = await params;
  const resolved = await resolve(calculatorSlug);
  if (resolved === null) {
    return {};
  }
  const { calculatorKey, data } = resolved;
  const definition = requireCalculatorDefinition(calculatorKey);

  return buildSeoPageMetadata({
    indexable: data.indexable,
    resolverInput: {
      page: {
        pageType: 'CALCULATOR',
        path: data.canonicalPath,
        titleOverride: data.titleText,
        descriptionOverride: data.descriptionText,
        h1Override: data.h1Text,
        ogImagePathOverride: null,
        canonicalOverride: null,
        canonicalOverrideReason: null,
      },
      context: { title: null, description: null, h1: null, ogImagePath: null },
      template: { titleTemplate: null, descriptionTemplate: null, h1Template: null },
      pageType: { titleTemplate: null, descriptionTemplate: null, h1Template: null },
      settings: {
        siteName: SITE.name,
        tagline: SITE.tagline,
        defaultDescription: SITE.description,
        defaultOgImagePath: null,
      },
      tokenValues: { calculator: definition.displayName },
    },
  });
}

export default async function CalculatorPage({ params }: PageParams): Promise<React.ReactElement> {
  const { calculatorSlug } = await params;
  const resolved = await resolve(calculatorSlug);
  if (resolved === null) {
    notFound();
  }
  const { calculatorKey, data } = resolved;
  const definition = requireCalculatorDefinition(calculatorKey);

  const breadcrumbs = resolveBreadcrumbTrail({
    pageType: 'CALCULATOR',
    path: data.canonicalPath,
    label: definition.displayName,
  });

  const otherCalculators: LinkCandidate[] = CALCULATOR_KEYS.filter(
    (key) => key !== calculatorKey,
  ).map((key) => {
    const other = requireCalculatorDefinition(key);
    return { path: other.canonicalPath, label: other.displayName };
  });
  const relatedLinks = relatedCalculatorsForCalculator(otherCalculators);

  const structuredData = buildStructuredData({
    pageType: 'CALCULATOR',
    path: data.canonicalPath,
    label: definition.displayName,
    siteName: SITE.name,
    siteDescription: SITE.description,
    blocks: data.blocks,
  });

  return (
    <main id="main-content">
      <nav aria-label="Breadcrumb">
        <ol>
          {breadcrumbs.map((crumb) => (
            <li key={crumb.path}>
              <a href={crumb.path}>{crumb.label}</a>
            </li>
          ))}
        </ol>
      </nav>

      {data.blocks.map((block, index) => {
        switch (block.blockType) {
          case 'HERO':
            return <Hero key={index} payload={block.payload} />;
          case 'INTRO':
          case 'TAX_EXPLANATION':
          case 'DISCLAIMER':
            return <RichText key={index} payload={block.payload} />;
          case 'CALCULATOR_EMBED':
            return <CalculatorForm key={index} calculatorKey={calculatorKey} />;
          case 'FAQ':
            return <Faq key={index} payload={block.payload} />;
          case 'RELATED_CALCULATORS':
            return <RelatedLinks key={index} title="Related calculators" links={relatedLinks} />;
          default:
            return null;
        }
      })}

      {structuredData.map((schema, index) => (
        // JSON-LD, not HTML — the one sanctioned use of dangerouslySetInnerHTML for
        // structured data (SEO-03 contract §O).
        <script
          key={index}
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }}
        />
      ))}
    </main>
  );
}

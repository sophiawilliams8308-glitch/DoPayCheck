import { getPrisma } from '@/lib/db/client';

import type { QualityGateBlockInput } from '../gates';
import type { SeoBlockType } from '../types';
import { resolveIndexability } from '../indexability';
import { SITE } from '../metadata';
import {
  resolveCanonicalPath,
  resolveSeoMetadata,
  type SeoResolveMetadataInput,
} from '../resolver';
import {
  countInboundLinks,
  hasInboundFromHubOrCalculator,
  targetsOf,
} from '../sitemap-eligibility';
import { isCalculationAvailable, isCalculatorConfigured } from './validation';
import { getCalculatorDefinition, type CalculatorKey } from './registry';

/**
 * One-page load for a calculator route (SEO-05 contract §4, §30).
 *
 * ===========================================================================
 * NO SECOND RESOLVER. Calls the exact same `resolveSeoMetadata`/`resolveCanonicalPath`/
 * `evaluateQualityGates`/`resolveIndexability` primitives `lib/seo/sitemap-eligibility.ts`
 * calls for the sitemap batch — this is the SAME resolution logic applied to one page instead
 * of the published set, not a parallel implementation (contract §5, §30).
 * ===========================================================================
 */

export interface CalculatorPageData {
  readonly pageId: string;
  readonly calculatorKey: CalculatorKey;
  readonly canonicalPath: string;
  readonly titleText: string | null;
  readonly descriptionText: string | null;
  readonly h1Text: string | null;
  readonly indexable: boolean;
  readonly blocks: readonly { readonly blockType: SeoBlockType; readonly payload: unknown }[];
}

const STALE_THRESHOLD_YEARS = 2;

/** `null` when no `PUBLISHED` `SeoPage` exists for this calculator — the caller's job is to
 * 404, per `lib/seo/routes.ts`'s own established "no record ⇒ 404" rule. */
export async function loadCalculatorPageData(
  calculatorKey: CalculatorKey,
): Promise<CalculatorPageData | null> {
  const definition = getCalculatorDefinition(calculatorKey);
  if (definition === null) {
    return null;
  }

  const prisma = getPrisma();

  const page = await prisma.seoPage.findFirst({
    where: { pageType: 'CALCULATOR', calculatorKey, lifecycleState: 'PUBLISHED' },
    include: { blocks: true },
  });
  if (page === null) {
    return null;
  }

  const [settingsRow, pageTypeConfig, template, defaultTaxYear, allPublished] = await Promise.all([
    prisma.seoSettings.findUnique({ where: { id: 'singleton' } }),
    prisma.seoPageTypeConfig.findUnique({ where: { pageType: 'CALCULATOR' } }),
    page.templateId === null
      ? Promise.resolve(null)
      : prisma.seoTemplate.findUnique({ where: { id: page.templateId } }),
    prisma.taxYear.findFirst({ where: { isDefault: true }, select: { year: true } }),
    prisma.seoPage.findMany({
      where: { lifecycleState: 'PUBLISHED' },
      select: { path: true, pageType: true, relatedLinksCache: true },
    }),
  ]);

  const settings = {
    siteName: settingsRow?.siteName ?? SITE.name,
    tagline: settingsRow?.tagline ?? SITE.tagline,
    defaultDescription: settingsRow?.defaultDescription ?? SITE.description,
    defaultOgImagePath: settingsRow?.defaultOgImagePath ?? null,
  };

  const resolverInput: SeoResolveMetadataInput = {
    page: {
      pageType: page.pageType,
      path: page.path,
      titleOverride: page.titleOverride,
      descriptionOverride: page.descriptionOverride,
      h1Override: page.h1Override,
      ogImagePathOverride: page.ogImagePathOverride,
      canonicalOverride: page.canonicalOverride,
      canonicalOverrideReason: page.canonicalOverrideReason,
    },
    context: { title: null, description: null, h1: null, ogImagePath: null },
    template: {
      titleTemplate: template?.titleTemplate ?? null,
      descriptionTemplate: template?.descriptionTemplate ?? null,
      h1Template: template?.h1Template ?? null,
    },
    pageType: {
      titleTemplate: pageTypeConfig?.titleTemplate ?? null,
      descriptionTemplate: pageTypeConfig?.descriptionTemplate ?? null,
      h1Template: pageTypeConfig?.h1Template ?? null,
    },
    settings,
    tokenValues: { calculator: definition.displayName },
  };

  const resolvedMetadata = resolveSeoMetadata(resolverInput);
  const canonical = resolveCanonicalPath(resolverInput.page);

  const contentStale =
    page.contentYear !== null &&
    defaultTaxYear !== null &&
    defaultTaxYear.year - page.contentYear > STALE_THRESHOLD_YEARS;

  const blockInputs: QualityGateBlockInput[] = page.blocks.map((block) => ({
    blockType: block.blockType,
    payload: block.payload,
    isRequired: block.isRequired,
    isRemovable: block.isRemovable,
  }));

  const gateInput = {
    lifecycleState: page.lifecycleState,
    titleText: resolvedMetadata.titleText,
    descriptionText: resolvedMetadata.descriptionText,
    h1Text: resolvedMetadata.h1Text,
    canonicalPath: canonical.path,
    duplicateIdentity: false,
    blocks: blockInputs,
    requiredBlockTypes: [],
    hasLocalTaxRelevance: false,
    isProgrammaticPage: true,
    requiresTaxReadiness: false,
    readinessPublishable: null,
    calculatorConfigured: isCalculatorConfigured(page.calculatorKey),
    calculationAvailable: isCalculationAvailable(page.calculatorKey),
    taxYearDataAvailable: page.contentYear === null,
    inboundLinkCount: countInboundLinks(allPublished, page.path),
    hasInboundLinkFromHubOrCalculator: hasInboundFromHubOrCalculator(allPublished, page.path),
    relatedLinks: targetsOf(page.relatedLinksCache)
      .filter((target): target is { readonly path: string } => typeof target.path === 'string')
      .map((target) => ({
        targetPath: target.path,
        valid: allPublished.some((candidate) => candidate.path === target.path),
      })),
    contentStale,
  };

  const indexability = await resolveIndexability({
    ...gateInput,
    manualIndexable: page.manualIndexable,
    routeValid: true,
    jurisdictionId: null,
    taxYearId: null,
    requiredCapabilities: [],
  });

  return {
    pageId: page.id,
    calculatorKey,
    canonicalPath: canonical.path,
    titleText: resolvedMetadata.titleText,
    descriptionText: resolvedMetadata.descriptionText,
    h1Text: resolvedMetadata.h1Text,
    indexable: indexability.indexable,
    blocks: page.blocks.map((block) => ({ blockType: block.blockType, payload: block.payload })),
  };
}

import type { SeoPageTypeKey, SeoTemplate } from '@/lib/db/generated/index';
import { getPrisma } from '@/lib/db/client';
import { coverage } from '@/lib/tax/readiness';

import { SITE } from './metadata';
import { isCalculatorConfigured, isCalculationAvailable } from './calculators/validation';
import { evaluateQualityGates, type QualityGateBlockInput } from './gates';
import { resolveCanonicalPath, resolveSeoMetadata } from './resolver';

/**
 * Sitemap / robots eligibility (SEO-03 contract §N, §46).
 *
 * ===========================================================================
 * ONE INDEXED QUERY OVER SeoPage, THEN A BATCHED READINESS EVALUATION. NO PER-URL QUERY.
 *
 * `listEligibleSeoPages()` is the ONE place that decides which pages are sitemap-eligible —
 * `app/sitemap.ts` calls it and does nothing else (contract §31: "no second sitemap
 * implementation"). It fetches every `PUBLISHED` page (with its blocks) in one query filtered
 * on `lifecycleState`, plus `SeoSettings`/`SeoPageTypeConfig`/`SeoTemplate` and `TaxYear` —
 * each a small, bounded, non-per-page query — so every page's EFFECTIVE title/description/H1
 * (contract §H.5: gates validate the resolved value, never the stored one) and content
 * staleness can be computed without a second query per page. Inbound-link counts come from the
 * same batch's `relatedLinksCache`, in memory. Tax readiness is evaluated through
 * `coverage.isPublishable()` ONCE per distinct `(jurisdictionId, taxYearId, capabilities)` key,
 * never once per page.
 * ===========================================================================
 *
 * GATES 8/9 (SEO-05 update): `calculatorConfigured`/`calculationAvailable` are now real,
 * registry-derived checks for `CALCULATOR` pages (`lib/seo/calculators/validation.ts`), not the
 * SEO-04 unconditional `true` placeholder. For every OTHER page type these two gates stay
 * `true` — they describe a calculator-specific prerequisite that does not apply to a STATE,
 * SALARY, GUIDE, HUB, HOME or UTILITY page, so a fixed `true` remains correct for them.
 *
 * DISCLOSED SCOPE LIMIT (unchanged from SEO-04): the "state/programmatic context" inheritance
 * level (contract §H.1) is not synthesized here — no per-state default content generator
 * exists yet, so it resolves as absent (inherits from the template/page-type/global levels),
 * exactly like every other unbuilt input.
 */

export interface EligiblePage {
  readonly id: string;
  readonly path: string;
  readonly updatedAt: Date;
}

const STALE_THRESHOLD_YEARS = 2;

interface RelatedLinksCacheShape {
  readonly targets?: readonly { readonly path?: unknown }[];
}

/** Exported for reuse by `lib/seo/calculators/pageData.ts` — a single-page render needs the
 * same inbound-link accounting this batch already computes, never a second implementation of
 * it (contract §11, §14). */
export function targetsOf(relatedLinksCache: unknown): readonly { readonly path?: unknown }[] {
  const cache = relatedLinksCache as RelatedLinksCacheShape | null;
  return cache !== null && Array.isArray(cache.targets) ? cache.targets : [];
}

export function countInboundLinks(
  pages: readonly { readonly path: string; readonly relatedLinksCache: unknown }[],
  targetPath: string,
): number {
  return pages.filter(
    (page) =>
      page.path !== targetPath &&
      targetsOf(page.relatedLinksCache).some((target) => target.path === targetPath),
  ).length;
}

export function hasInboundFromHubOrCalculator(
  pages: readonly {
    readonly path: string;
    readonly pageType: string;
    readonly relatedLinksCache: unknown;
  }[],
  targetPath: string,
): boolean {
  return pages.some(
    (page) =>
      page.path !== targetPath &&
      (page.pageType === 'HUB' || page.pageType === 'CALCULATOR') &&
      targetsOf(page.relatedLinksCache).some((target) => target.path === targetPath),
  );
}

/** Every page currently eligible for the sitemap: `PUBLISHED`, `manualIndexable`, every
 * quality gate passing (evaluated against EFFECTIVE, inherited values), and (where required)
 * tax-readiness-publishable. Fail-closed — a page this function cannot fully evaluate is
 * excluded, never included optimistically. */
export async function listEligibleSeoPages(): Promise<readonly EligiblePage[]> {
  const prisma = getPrisma();

  const pages = await prisma.seoPage.findMany({
    where: { lifecycleState: 'PUBLISHED' },
    include: { blocks: true },
  });
  if (pages.length === 0) {
    return [];
  }

  // Scoped to exactly the content years these pages declare — never the whole `TaxYear`
  // table, which in a shared database can hold many years unrelated to any published page.
  const contentYears = [
    ...new Set(
      pages.map((page) => page.contentYear).filter((year): year is number => year !== null),
    ),
  ];

  const [settingsRow, pageTypeConfigs, templates, taxYears, defaultTaxYear] = await Promise.all([
    prisma.seoSettings.findUnique({ where: { id: 'singleton' } }),
    prisma.seoPageTypeConfig.findMany(),
    prisma.seoTemplate.findMany(),
    contentYears.length === 0
      ? Promise.resolve([])
      : prisma.taxYear.findMany({
          where: { year: { in: contentYears } },
          select: { id: true, year: true },
        }),
    // "Current tax year" (contract §U) is the one row flagged `isDefault` — the same concept
    // `lib/tax-years/repository.ts`'s `getDefault()` already uses. When none is flagged (true
    // of this repository's own seed data today), staleness cannot be asserted, so it is never
    // assumed (§21 — never invent a fact this project cannot back with evidence).
    prisma.taxYear.findFirst({ where: { isDefault: true }, select: { year: true } }),
  ]);

  const settings = {
    siteName: settingsRow?.siteName ?? SITE.name,
    tagline: settingsRow?.tagline ?? SITE.tagline,
    defaultDescription: settingsRow?.defaultDescription ?? SITE.description,
    defaultOgImagePath: settingsRow?.defaultOgImagePath ?? null,
  };
  const pageTypeConfigByType = new Map(
    pageTypeConfigs.map((config) => [config.pageType, config] as const),
  );
  const templateById = new Map(templates.map((template) => [template.id, template] as const));

  const currentTaxYearYear = defaultTaxYear?.year ?? null;
  const taxYearIdByYear = new Map(taxYears.map((year) => [year.year, year.id] as const));

  // Batched readiness: one `isPublishable()` call per distinct key, never per page.
  const readinessCache = new Map<string, boolean>();
  async function readinessFor(
    jurisdictionId: string,
    taxYearId: number,
    capabilities: readonly string[],
  ): Promise<boolean> {
    const key = `${jurisdictionId}|${String(taxYearId)}|${[...capabilities].sort().join(',')}`;
    const cached = readinessCache.get(key);
    if (cached !== undefined) {
      return cached;
    }
    const result = await coverage.isPublishable(jurisdictionId, taxYearId, capabilities);
    readinessCache.set(key, result.publishable);
    return result.publishable;
  }

  function templateFor(id: string | null): SeoTemplate | undefined {
    return id === null ? undefined : templateById.get(id);
  }
  function pageTypeConfigTemplates(pageType: SeoPageTypeKey): {
    titleTemplate: string | null;
    descriptionTemplate: string | null;
    h1Template: string | null;
  } {
    const config = pageTypeConfigByType.get(pageType);
    return {
      titleTemplate: config?.titleTemplate ?? null,
      descriptionTemplate: config?.descriptionTemplate ?? null,
      h1Template: config?.h1Template ?? null,
    };
  }

  const eligible: EligiblePage[] = [];

  for (const page of pages) {
    if (!page.manualIndexable) {
      continue;
    }

    const contentStale =
      page.contentYear !== null &&
      currentTaxYearYear !== null &&
      currentTaxYearYear - page.contentYear > STALE_THRESHOLD_YEARS;

    let readinessPublishable: boolean | null = null;
    const requiresTaxReadiness =
      page.jurisdictionId !== null && page.requiredCapabilities.length > 0;
    if (requiresTaxReadiness && page.jurisdictionId !== null) {
      const taxYearId =
        page.contentYear !== null ? (taxYearIdByYear.get(page.contentYear) ?? null) : null;
      if (taxYearId === null) {
        continue; // Fail-closed: no matching tax year for the declared content year.
      }
      readinessPublishable = await readinessFor(
        page.jurisdictionId,
        taxYearId,
        page.requiredCapabilities,
      );
      if (!readinessPublishable) {
        continue;
      }
    }

    const template = templateFor(page.templateId);
    const resolvedMetadata = resolveSeoMetadata({
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
      pageType: pageTypeConfigTemplates(page.pageType),
      settings,
      tokenValues: {},
    });
    const canonical = resolveCanonicalPath({
      pageType: page.pageType,
      path: page.path,
      titleOverride: page.titleOverride,
      descriptionOverride: page.descriptionOverride,
      h1Override: page.h1Override,
      ogImagePathOverride: page.ogImagePathOverride,
      canonicalOverride: page.canonicalOverride,
      canonicalOverrideReason: page.canonicalOverrideReason,
    });

    const blockInputs: QualityGateBlockInput[] = page.blocks.map((block) => ({
      blockType: block.blockType,
      payload: block.payload,
      isRequired: block.isRequired,
      isRemovable: block.isRemovable,
    }));

    const outcomes = evaluateQualityGates({
      lifecycleState: page.lifecycleState,
      titleText: resolvedMetadata.titleText,
      descriptionText: resolvedMetadata.descriptionText,
      h1Text: resolvedMetadata.h1Text,
      canonicalPath: canonical.path,
      duplicateIdentity: false, // The database's own unique index on `path` already guarantees this.
      blocks: blockInputs,
      requiredBlockTypes: [],
      hasLocalTaxRelevance: false,
      isProgrammaticPage: page.pageType !== 'HOME' && page.pageType !== 'UTILITY',
      requiresTaxReadiness,
      readinessPublishable,
      calculatorConfigured:
        page.pageType !== 'CALCULATOR' || isCalculatorConfigured(page.calculatorKey),
      calculationAvailable:
        page.pageType !== 'CALCULATOR' || isCalculationAvailable(page.calculatorKey),
      taxYearDataAvailable: page.contentYear === null || taxYearIdByYear.has(page.contentYear),
      inboundLinkCount: countInboundLinks(pages, page.path),
      hasInboundLinkFromHubOrCalculator: hasInboundFromHubOrCalculator(pages, page.path),
      relatedLinks: targetsOf(page.relatedLinksCache)
        .filter((target): target is { readonly path: string } => typeof target.path === 'string')
        .map((target) => ({
          targetPath: target.path,
          valid: pages.some((candidate) => candidate.path === target.path),
        })),
      contentStale,
    });

    if (outcomes.every((outcome) => outcome.passed)) {
      eligible.push({ id: page.id, path: canonical.path, updatedAt: page.updatedAt });
    }
  }

  return eligible;
}

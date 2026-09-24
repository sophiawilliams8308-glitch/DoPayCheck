import { resolveInheritance } from './inheritance';
import { substituteTokens } from './tokens';
import type { EffectiveField, SeoPageTypeKey, TokenValues } from './types';

/**
 * SEO resolver — the metadata-synchronous half (SEO-03 contract §G).
 *
 * ===========================================================================
 * ONE RESOLVER. PURE. NO DATABASE ACCESS.
 *
 * `resolveSeoMetadata()` is a pure function: identical inputs always produce an identical
 * result, so it is testable without a database (contract §G.2). Every level's raw value is
 * fetched by the CALLER (a page-assembly service under `lib/seo/`, not built by SEO-04's
 * scope) and handed in already — this module never queries `SeoSettings`, `SeoPageTypeConfig`,
 * `SeoTemplate`, `SeoPage` or `Jurisdiction` itself.
 *
 * Feeds `lib/seo/metadata.ts`'s existing `buildMetadata()` — it does not replace it, and
 * `buildMetadata()`'s own signature is untouched (contract §19).
 *
 * INDEXABILITY IS NOT COMPUTED HERE. Deriving `indexable` requires the tax-readiness call and
 * the quality gates, both asynchronous (`lib/seo/gates.ts`, `lib/tax/readiness/`) — this
 * module only resolves the metadata TEXT. A higher orchestration step combines this
 * synchronous result with the async indexability decision before calling `buildMetadata()`.
 * ===========================================================================
 */

export interface SeoResolverPageInput {
  readonly pageType: SeoPageTypeKey;
  /** Canonical path, e.g. `/paycheck-calculator/california/` — self-referencing by default. */
  readonly path: string;

  readonly titleOverride: string | null;
  readonly descriptionOverride: string | null;
  readonly h1Override: string | null;
  readonly ogImagePathOverride: string | null;

  /** Exception path only (contract §K) — requires `canonicalOverrideReason` whenever set. The
   * migration itself enforces this pairing at the database level. */
  readonly canonicalOverride: string | null;
  readonly canonicalOverrideReason: string | null;
}

/** The "State/programmatic context" inheritance level (contract §H.1) — e.g. a state's own
 * computed defaults. Supplied by the caller; this module never derives it. */
export interface SeoResolverContextInput {
  readonly title: string | null;
  readonly description: string | null;
  readonly h1: string | null;
  readonly ogImagePath: string | null;
}

export interface SeoResolverTemplateInput {
  readonly titleTemplate: string | null;
  readonly descriptionTemplate: string | null;
  readonly h1Template: string | null;
}

export interface SeoResolverPageTypeInput {
  readonly titleTemplate: string | null;
  readonly descriptionTemplate: string | null;
  readonly h1Template: string | null;
}

/** Global fallback layer. `SeoSettings value ?? SITE default` is resolved by the caller
 * BEFORE this module runs (contract §C: "the system degrades to today's behaviour" when
 * `SeoSettings` is absent) — by the time this reaches the resolver, it is always a concrete,
 * non-null value (either the database row or the existing `SITE` constant). */
export interface SeoResolverSettingsInput {
  readonly siteName: string;
  readonly tagline: string;
  readonly defaultDescription: string;
  readonly defaultOgImagePath: string | null;
}

export interface SeoResolveMetadataInput {
  readonly page: SeoResolverPageInput;
  readonly context: SeoResolverContextInput;
  readonly template: SeoResolverTemplateInput;
  readonly pageType: SeoResolverPageTypeInput;
  readonly settings: SeoResolverSettingsInput;
  /** Resolved token values (e.g. `{state}` → `"California"`) for THIS page — computed by the
   * caller from `Jurisdiction`/tax-year/calculator identity, never by this module. */
  readonly tokenValues: TokenValues;
}

export interface ResolvedSeoMetadata {
  readonly title: EffectiveField<string>;
  readonly description: EffectiveField<string>;
  readonly h1: EffectiveField<string>;
  readonly ogImagePath: EffectiveField<string>;
  /** Final text, tokens substituted. `null` only when every level was absent. */
  readonly titleText: string | null;
  readonly descriptionText: string | null;
  readonly h1Text: string | null;
}

function resolveAndSubstitute(
  effective: EffectiveField<string>,
  tokenValues: TokenValues,
): string | null {
  return effective.value === null ? null : substituteTokens(effective.value, tokenValues);
}

/**
 * Resolves title, description, H1 and OG image through the five-level inheritance chain
 * (contract §H), then substitutes tokens (contract §G.3) in the text fields. Pure and
 * synchronous.
 */
export function resolveSeoMetadata(input: SeoResolveMetadataInput): ResolvedSeoMetadata {
  const title = resolveInheritance({
    page: input.page.titleOverride,
    context: input.context.title,
    template: input.template.titleTemplate,
    pageType: input.pageType.titleTemplate,
    global: `${input.settings.siteName} — ${input.settings.tagline}`,
  });

  const description = resolveInheritance({
    page: input.page.descriptionOverride,
    context: input.context.description,
    template: input.template.descriptionTemplate,
    pageType: input.pageType.descriptionTemplate,
    global: input.settings.defaultDescription,
  });

  const h1 = resolveInheritance({
    page: input.page.h1Override,
    context: input.context.h1,
    template: input.template.h1Template,
    pageType: input.pageType.h1Template,
    global: input.settings.siteName,
  });

  const ogImagePath = resolveInheritance({
    page: input.page.ogImagePathOverride,
    context: input.context.ogImagePath,
    // SeoTemplate and SeoPageTypeConfig declare no ogImage field (contract §D.4, §D.5) — this
    // level never contributes for this field.
    template: null,
    pageType: null,
    global: input.settings.defaultOgImagePath,
  });

  return {
    title,
    description,
    h1,
    ogImagePath,
    titleText: resolveAndSubstitute(title, input.tokenValues),
    descriptionText: resolveAndSubstitute(description, input.tokenValues),
    h1Text: resolveAndSubstitute(h1, input.tokenValues),
  };
}

export interface ResolvedCanonical {
  readonly path: string;
  readonly overridden: boolean;
  readonly overrideReason: string | null;
}

/**
 * Resolves the canonical path (contract §K). Self-referencing (`page.path`) unless an
 * override is set — and an override is only ever meaningful paired with its required reason,
 * which the database itself enforces (`SeoPage_canonical_override_requires_reason`).
 *
 * Returns a PATH, not an absolute URL — `canonicalUrl()` (`lib/seo/metadata.ts`) remains the
 * sole absolute-URL builder (contract §19); this module never duplicates it.
 */
export function resolveCanonicalPath(page: SeoResolverPageInput): ResolvedCanonical {
  if (page.canonicalOverride !== null && page.canonicalOverride !== '') {
    return {
      path: page.canonicalOverride,
      overridden: true,
      overrideReason: page.canonicalOverrideReason,
    };
  }
  return { path: page.path, overridden: false, overrideReason: null };
}

import type { Metadata } from 'next';

import { buildMetadata } from './metadata';
import { resolveCanonicalPath, resolveSeoMetadata, type SeoResolveMetadataInput } from './resolver';

/**
 * Feeds the SEO resolver's output into the existing `buildMetadata()` (SEO-03 contract §19,
 * §G.2). This is the one place the two connect — `buildMetadata()`'s signature and behavior
 * are otherwise untouched, and this module never constructs a `Metadata` object itself.
 *
 * `indexable` is supplied by the caller, already resolved via `resolveIndexability()`
 * (`lib/seo/indexability.ts`) — this function never computes it, keeping metadata resolution
 * synchronous and cheap as contract §G.2 requires.
 */
export interface BuildSeoPageMetadataInput {
  readonly resolverInput: SeoResolveMetadataInput;
  readonly indexable: boolean;
}

export function buildSeoPageMetadata(input: BuildSeoPageMetadataInput): Metadata {
  const resolved = resolveSeoMetadata(input.resolverInput);
  const canonical = resolveCanonicalPath(input.resolverInput.page);

  return buildMetadata({
    title: resolved.titleText ?? input.resolverInput.settings.siteName,
    description: resolved.descriptionText ?? input.resolverInput.settings.defaultDescription,
    path: canonical.path,
    indexable: input.indexable,
    ...(resolved.ogImagePath.value === null ? {} : { ogImagePath: resolved.ogImagePath.value }),
  });
}

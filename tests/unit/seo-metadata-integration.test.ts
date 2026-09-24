import { beforeEach, describe, expect, it, vi } from 'vitest';

import { resetEnvCacheForTesting } from '@/lib/config/env';
import { buildMetadata, canonicalUrl } from '@/lib/seo/metadata';
import { buildSeoPageMetadata } from '@/lib/seo/buildSeoPageMetadata';
import type { SeoResolveMetadataInput } from '@/lib/seo/resolver';

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://dopaycheck.com');
  resetEnvCacheForTesting();
});

describe('buildMetadata() — additive ogImagePath extension (contract §L)', () => {
  it('is unchanged for a caller that omits ogImagePath — existing app/page.tsx behavior', () => {
    const metadata = buildMetadata({
      title: 'DoPayCheck',
      description: 'Know your take-home pay.',
      path: '/',
    });
    expect(metadata.openGraph).not.toHaveProperty('images');
    expect(metadata.twitter).not.toHaveProperty('images');
  });

  it('adds an absolute OG/Twitter image URL when ogImagePath is supplied', () => {
    const metadata = buildMetadata({
      title: 'California Paycheck Calculator',
      description: 'Estimate your California take-home pay.',
      path: '/paycheck-calculator/california/',
      ogImagePath: '/og/california.png',
    });
    expect(metadata.openGraph).toMatchObject({
      images: [{ url: 'https://dopaycheck.com/og/california.png' }],
    });
    expect(metadata.twitter).toMatchObject({
      images: ['https://dopaycheck.com/og/california.png'],
    });
  });
});

function baseResolverInput(
  overrides: Partial<SeoResolveMetadataInput> = {},
): SeoResolveMetadataInput {
  return {
    page: {
      pageType: 'STATE',
      path: '/paycheck-calculator/california/',
      titleOverride: null,
      descriptionOverride: null,
      h1Override: null,
      ogImagePathOverride: null,
      canonicalOverride: null,
      canonicalOverrideReason: null,
    },
    context: { title: null, description: null, h1: null, ogImagePath: null },
    template: { titleTemplate: null, descriptionTemplate: null, h1Template: null },
    pageType: {
      titleTemplate: '{state} Paycheck Calculator',
      descriptionTemplate: null,
      h1Template: null,
    },
    settings: {
      siteName: 'DoPayCheck',
      tagline: "Know What You'll Take Home",
      defaultDescription: 'DoPayCheck helps you understand your paycheck.',
      defaultOgImagePath: '/og-default.png',
    },
    tokenValues: { state: 'California' },
    ...overrides,
  };
}

describe('buildSeoPageMetadata — resolver feeds buildMetadata() unchanged (contract §19)', () => {
  it('produces a canonical URL matching the resolved canonical path', () => {
    const metadata = buildSeoPageMetadata({ resolverInput: baseResolverInput(), indexable: true });
    expect(metadata.alternates?.canonical).toBe(canonicalUrl('/paycheck-calculator/california/'));
  });

  it('sets robots to noindex when indexable is false, regardless of content quality', () => {
    const metadata = buildSeoPageMetadata({ resolverInput: baseResolverInput(), indexable: false });
    expect(metadata.robots).toMatchObject({ index: false, follow: false });
  });

  it('sets robots to index/follow when indexable is true', () => {
    const metadata = buildSeoPageMetadata({ resolverInput: baseResolverInput(), indexable: true });
    expect(metadata.robots).toMatchObject({ index: true, follow: true });
  });

  it('uses the resolved, token-substituted title', () => {
    const metadata = buildSeoPageMetadata({ resolverInput: baseResolverInput(), indexable: true });
    expect(metadata.title).toBe('California Paycheck Calculator');
  });

  it('respects a canonical override in the resolved path', () => {
    const metadata = buildSeoPageMetadata({
      resolverInput: baseResolverInput({
        page: {
          ...baseResolverInput().page,
          canonicalOverride: '/paycheck-calculator/',
          canonicalOverrideReason: 'Consolidated pending content.',
        },
      }),
      indexable: true,
    });
    expect(metadata.alternates?.canonical).toBe(canonicalUrl('/paycheck-calculator/'));
  });
});

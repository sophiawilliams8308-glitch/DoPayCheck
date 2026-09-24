import { describe, expect, it } from 'vitest';

import {
  resolveCanonicalPath,
  resolveSeoMetadata,
  type SeoResolveMetadataInput,
} from '@/lib/seo/resolver';

function baseInput(overrides: Partial<SeoResolveMetadataInput> = {}): SeoResolveMetadataInput {
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
    pageType: { titleTemplate: null, descriptionTemplate: null, h1Template: null },
    settings: {
      siteName: 'DoPayCheck',
      tagline: "Know What You'll Take Home",
      defaultDescription: 'DoPayCheck helps you understand your paycheck.',
      defaultOgImagePath: '/og-default.png',
    },
    tokenValues: {},
    ...overrides,
  };
}

describe('resolveSeoMetadata — same inputs, same output (pure)', () => {
  it('produces an identical result for identical inputs', () => {
    const input = baseInput();
    expect(resolveSeoMetadata(input)).toEqual(resolveSeoMetadata(input));
  });

  it('falls back all the way to the Global level when nothing else is set', () => {
    const result = resolveSeoMetadata(baseInput());
    expect(result.title.source).toBe('GLOBAL');
    expect(result.titleText).toBe("DoPayCheck — Know What You'll Take Home");
    expect(result.description.source).toBe('GLOBAL');
    expect(result.h1.source).toBe('GLOBAL');
  });

  it('a page-level override wins over every other level', () => {
    const result = resolveSeoMetadata(
      baseInput({
        page: {
          pageType: 'STATE',
          path: '/paycheck-calculator/california/',
          titleOverride: '{state} Paycheck Calculator',
          descriptionOverride: null,
          h1Override: null,
          ogImagePathOverride: null,
          canonicalOverride: null,
          canonicalOverrideReason: null,
        },
        pageType: {
          titleTemplate: '{state} Take-Home Pay Calculator',
          descriptionTemplate: null,
          h1Template: null,
        },
        tokenValues: { state: 'California' },
      }),
    );
    expect(result.title.source).toBe('PAGE');
    expect(result.titleText).toBe('California Paycheck Calculator');
  });

  it('a context-level value is used when the page has none, ahead of the template', () => {
    const result = resolveSeoMetadata(
      baseInput({
        context: { title: 'Context Title', description: null, h1: null, ogImagePath: null },
        template: {
          titleTemplate: 'Template Title',
          descriptionTemplate: null,
          h1Template: null,
        },
      }),
    );
    expect(result.title.source).toBe('CONTEXT');
    expect(result.titleText).toBe('Context Title');
  });

  it('an explicit empty description suppresses it instead of inheriting the global default', () => {
    const result = resolveSeoMetadata(
      baseInput({
        page: {
          pageType: 'STATE',
          path: '/paycheck-calculator/california/',
          titleOverride: null,
          descriptionOverride: '',
          h1Override: null,
          ogImagePathOverride: null,
          canonicalOverride: null,
          canonicalOverrideReason: null,
        },
      }),
    );
    expect(result.description.source).toBe('PAGE');
    expect(result.descriptionText).toBe('');
  });

  it('OG image has no template/pageType level — page falls straight through to global', () => {
    const result = resolveSeoMetadata(baseInput());
    expect(result.ogImagePath).toEqual({ value: '/og-default.png', source: 'GLOBAL' });
  });

  it('substitutes tokens after inheritance resolves the winning template', () => {
    const result = resolveSeoMetadata(
      baseInput({
        pageType: {
          titleTemplate: '{state} Paycheck Calculator — {tax_year}',
          descriptionTemplate: null,
          h1Template: null,
        },
        tokenValues: { state: 'Texas', tax_year: '2026' },
      }),
    );
    expect(result.titleText).toBe('Texas Paycheck Calculator — 2026');
  });
});

describe('resolveCanonicalPath (contract §K)', () => {
  it('is self-referencing by default', () => {
    const result = resolveCanonicalPath(baseInput().page);
    expect(result).toEqual({
      path: '/paycheck-calculator/california/',
      overridden: false,
      overrideReason: null,
    });
  });

  it('uses the override path and carries its reason when one is set', () => {
    const result = resolveCanonicalPath({
      ...baseInput().page,
      canonicalOverride: '/paycheck-calculator/',
      canonicalOverrideReason: 'Consolidated into the hub page pending state content.',
    });
    expect(result).toEqual({
      path: '/paycheck-calculator/',
      overridden: true,
      overrideReason: 'Consolidated into the hub page pending state content.',
    });
  });

  it('an explicit empty-string override is treated as no override (never a blank canonical)', () => {
    const result = resolveCanonicalPath({
      ...baseInput().page,
      canonicalOverride: '',
      canonicalOverrideReason: null,
    });
    expect(result.overridden).toBe(false);
    expect(result.path).toBe('/paycheck-calculator/california/');
  });
});

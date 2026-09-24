import { beforeEach, describe, expect, it, vi } from 'vitest';

import { resetEnvCacheForTesting } from '@/lib/config/env';
import { buildStructuredData } from '@/lib/seo/structured-data';

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://dopaycheck.com');
  resetEnvCacheForTesting();
});

const FORBIDDEN_TYPES = [
  'SoftwareApplication',
  'WebApplication',
  'Product',
  'Offer',
  'AggregateRating',
  'HowTo',
  'FinancialProduct',
  'Dataset',
];

describe('buildStructuredData (SEO-03 contract §O)', () => {
  it('emits Organization and WebSite on the home page when organization settings exist', () => {
    const schemas = buildStructuredData({
      pageType: 'HOME',
      path: '/',
      siteName: 'DoPayCheck',
      siteDescription: 'Know your take-home pay.',
      organization: {
        organizationName: 'DoPayCheck',
        organizationLogoPath: '/logo.png',
        organizationSameAs: [],
      },
      blocks: [],
    });
    expect(schemas.some((s) => s['@type'] === 'Organization')).toBe(true);
    expect(schemas.some((s) => s['@type'] === 'WebSite')).toBe(true);
    expect(schemas.some((s) => s['@type'] === 'BreadcrumbList')).toBe(false);
  });

  it('omits Organization on the home page when no organization settings are supplied', () => {
    const schemas = buildStructuredData({
      pageType: 'HOME',
      path: '/',
      siteName: 'DoPayCheck',
      siteDescription: 'Know your take-home pay.',
      blocks: [],
    });
    expect(schemas.some((s) => s['@type'] === 'Organization')).toBe(false);
    expect(schemas.some((s) => s['@type'] === 'WebSite')).toBe(true);
  });

  it('emits BreadcrumbList for every non-home page, matching the visible trail', () => {
    const schemas = buildStructuredData({
      pageType: 'STATE',
      path: '/paycheck-calculator/california/',
      label: 'California',
      siteName: 'DoPayCheck',
      siteDescription: 'Know your take-home pay.',
      blocks: [],
    });
    const breadcrumbs = schemas.find((s) => s['@type'] === 'BreadcrumbList') as
      { itemListElement: { name: string; item: string }[] } | undefined;
    expect(breadcrumbs?.itemListElement.map((item) => item.name)).toEqual([
      'Home',
      'Paycheck Calculator',
      'California',
    ]);
    expect(breadcrumbs?.itemListElement[2]?.item).toBe(
      'https://dopaycheck.com/paycheck-calculator/california/',
    );
  });

  it('emits FAQPage only when a populated FAQ block exists', () => {
    const withFaq = buildStructuredData({
      pageType: 'GUIDE',
      path: '/guides/example/',
      label: 'Example Guide',
      siteName: 'DoPayCheck',
      siteDescription: 'Know your take-home pay.',
      blocks: [{ blockType: 'FAQ', payload: { items: [{ question: 'Q1', answer: 'A1' }] } }],
    });
    expect(withFaq.some((s) => s['@type'] === 'FAQPage')).toBe(true);

    const withoutFaq = buildStructuredData({
      pageType: 'GUIDE',
      path: '/guides/example/',
      label: 'Example Guide',
      siteName: 'DoPayCheck',
      siteDescription: 'Know your take-home pay.',
      blocks: [{ blockType: 'RICH_TEXT', payload: {} }],
    });
    expect(withoutFaq.some((s) => s['@type'] === 'FAQPage')).toBe(false);
  });

  it('emits Article only for GUIDE pages', () => {
    const guide = buildStructuredData({
      pageType: 'GUIDE',
      path: '/guides/example/',
      label: 'Example Guide',
      siteName: 'DoPayCheck',
      siteDescription: 'Know your take-home pay.',
      blocks: [],
    });
    expect(guide.some((s) => s['@type'] === 'Article')).toBe(true);

    const state = buildStructuredData({
      pageType: 'STATE',
      path: '/paycheck-calculator/texas/',
      label: 'Texas',
      siteName: 'DoPayCheck',
      siteDescription: 'Know your take-home pay.',
      blocks: [],
    });
    expect(state.some((s) => s['@type'] === 'Article')).toBe(false);
  });

  it('never emits a prohibited schema type, across every page type', () => {
    const pageTypes = ['HOME', 'CALCULATOR', 'STATE', 'SALARY', 'GUIDE', 'HUB', 'UTILITY'] as const;
    for (const pageType of pageTypes) {
      const schemas = buildStructuredData({
        pageType,
        path: '/x/',
        label: 'X',
        amountLabel: '$1',
        siteName: 'DoPayCheck',
        siteDescription: 'Know your take-home pay.',
        organization: {
          organizationName: 'DoPayCheck',
          organizationLogoPath: null,
          organizationSameAs: [],
        },
        blocks: [{ blockType: 'FAQ', payload: { items: [{ question: 'Q', answer: 'A' }] } }],
      });
      const types = schemas.map((s) => s['@type']);
      for (const forbidden of FORBIDDEN_TYPES) {
        expect(types).not.toContain(forbidden);
      }
    }
  });

  it('never invents a Calculator schema type', () => {
    const schemas = buildStructuredData({
      pageType: 'CALCULATOR',
      path: '/hourly-paycheck-calculator/',
      label: 'Hourly Paycheck Calculator',
      siteName: 'DoPayCheck',
      siteDescription: 'Know your take-home pay.',
      blocks: [],
    });
    expect(schemas.map((s) => s['@type'])).not.toContain('Calculator');
  });
});

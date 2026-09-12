import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { resetEnvCacheForTesting } from '@/lib/config/env';
import { buildMetadata, canonicalUrl } from '@/lib/seo/metadata';

/** SEO foundation tests (spec §37). */

const originalSiteUrl = process.env['NEXT_PUBLIC_SITE_URL'];

beforeEach(() => {
  process.env['NEXT_PUBLIC_SITE_URL'] = 'https://dopaycheck.com';
  resetEnvCacheForTesting();
});

afterEach(() => {
  if (originalSiteUrl === undefined) {
    delete process.env['NEXT_PUBLIC_SITE_URL'];
  } else {
    process.env['NEXT_PUBLIC_SITE_URL'] = originalSiteUrl;
  }
  resetEnvCacheForTesting();
});

describe('canonicalUrl', () => {
  it('builds an absolute URL for the root', () => {
    expect(canonicalUrl('/')).toBe('https://dopaycheck.com/');
  });

  it('applies the trailing-slash policy consistently', () => {
    expect(canonicalUrl('/paycheck-calculator')).toBe(
      'https://dopaycheck.com/paycheck-calculator/',
    );
    expect(canonicalUrl('/paycheck-calculator/')).toBe(
      'https://dopaycheck.com/paycheck-calculator/',
    );
  });

  it('tolerates a path given without a leading slash', () => {
    expect(canonicalUrl('guides')).toBe('https://dopaycheck.com/guides/');
  });
});

describe('buildMetadata', () => {
  it('sets a canonical URL and social metadata', () => {
    const metadata = buildMetadata({
      title: 'Title',
      description: 'Description',
      path: '/guides/',
    });
    expect(metadata.alternates?.canonical).toBe('https://dopaycheck.com/guides/');
    expect(metadata.openGraph?.title).toBe('Title');
    expect(metadata.twitter?.title).toBe('Title');
  });

  it('marks pages indexable by default and non-indexable on request', () => {
    expect(buildMetadata({ title: 't', description: 'd', path: '/' }).robots).toMatchObject({
      index: true,
    });
    expect(
      buildMetadata({ title: 't', description: 'd', path: '/', indexable: false }).robots,
    ).toMatchObject({ index: false });
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { resetEnvCacheForTesting } from '@/lib/config/env';
import robots from '@/app/robots';

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://dopaycheck.com');
  resetEnvCacheForTesting();
});

describe('app/robots.ts (SEO-03 contract §M)', () => {
  it('disallows everything outside production', () => {
    vi.stubEnv('NODE_ENV', 'development');
    resetEnvCacheForTesting();
    expect(robots().rules).toEqual([{ userAgent: '*', disallow: '/' }]);
  });

  it('allows crawling with /api/ and /admin/ disallowed in production', () => {
    vi.stubEnv('NODE_ENV', 'production');
    resetEnvCacheForTesting();
    const result = robots();
    expect(result.rules).toEqual([{ userAgent: '*', disallow: ['/api/', '/admin/'] }]);
    expect(result.sitemap).toBe('https://dopaycheck.com/sitemap.xml');
  });
});

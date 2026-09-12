import { describe, expect, it } from 'vitest';

import { parsePublicEnv, parseServerEnv } from '@/lib/config/env';

/** Configuration validation tests (spec §57). */

const validBase = {
  NODE_ENV: 'development',
  NEXT_PUBLIC_SITE_URL: 'http://localhost:3000',
  LOG_LEVEL: 'info',
};

describe('parseServerEnv', () => {
  it('accepts a valid development configuration without a database', () => {
    const result = parseServerEnv(validBase);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.env.DATABASE_URL).toBeUndefined();
      expect(result.env.NODE_ENV).toBe('development');
    }
  });

  it('applies defaults when optional values are absent', () => {
    const result = parseServerEnv({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.env.NODE_ENV).toBe('development');
      expect(result.env.LOG_LEVEL).toBe('info');
      expect(result.env.NEXT_PUBLIC_SITE_URL).toBe('http://localhost:3000');
    }
  });

  it('treats an empty string as unset rather than as an empty value', () => {
    const result = parseServerEnv({ ...validBase, DATABASE_URL: '' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.env.DATABASE_URL).toBeUndefined();
    }
  });

  it('requires DATABASE_URL in production', () => {
    const result = parseServerEnv({ ...validBase, NODE_ENV: 'production' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors.join(' ')).toContain('DATABASE_URL');
    }
  });

  it('accepts a production configuration that supplies a database URL', () => {
    const result = parseServerEnv({
      ...validBase,
      NODE_ENV: 'production',
      NEXT_PUBLIC_SITE_URL: 'https://dopaycheck.com',
      DATABASE_URL: 'postgresql://user:pass@db.internal:5432/dopaycheck',
    });
    expect(result.success).toBe(true);
  });

  it('rejects a non-PostgreSQL database URL', () => {
    const result = parseServerEnv({ ...validBase, DATABASE_URL: 'mysql://user:pass@localhost/db' });
    expect(result.success).toBe(false);
  });

  it('rejects a site URL with a trailing slash, which would break canonical URLs', () => {
    const result = parseServerEnv({
      ...validBase,
      NEXT_PUBLIC_SITE_URL: 'https://dopaycheck.com/',
    });
    expect(result.success).toBe(false);
  });

  it('rejects an unknown log level', () => {
    const result = parseServerEnv({ ...validBase, LOG_LEVEL: 'verbose' });
    expect(result.success).toBe(false);
  });

  it('reports errors without echoing the offending secret value', () => {
    const secret = 'postgresql-SUPER-SECRET-VALUE';
    const result = parseServerEnv({ ...validBase, DATABASE_URL: secret });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors.join(' ')).not.toContain('SUPER-SECRET-VALUE');
    }
  });
});

describe('parsePublicEnv', () => {
  it('does not require DATABASE_URL even in production', () => {
    // This is what makes `next build` possible without live database credentials.
    const result = parsePublicEnv({
      NODE_ENV: 'production',
      NEXT_PUBLIC_SITE_URL: 'https://dopaycheck.com',
    });
    expect(result.success).toBe(true);
  });

  it('never exposes DATABASE_URL through the public config', () => {
    const result = parsePublicEnv({
      NODE_ENV: 'development',
      DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(Object.keys(result.env)).not.toContain('DATABASE_URL');
      expect(JSON.stringify(result.env)).not.toContain('pass');
    }
  });

  it('still validates the site URL', () => {
    expect(parsePublicEnv({ NEXT_PUBLIC_SITE_URL: 'not-a-url' }).success).toBe(false);
  });
});

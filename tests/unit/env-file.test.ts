import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { applyParsedEnv, loadEnvFile } from '@/lib/config/env-file';

/**
 * `.env` loading behaviour (Prisma 7 no longer auto-loads it).
 *
 * The connection strings below are throwaway fixtures written to a temporary directory —
 * no real credential, host or database appears in this file.
 */

let dir = '';

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'dopaycheck-envfile-'));
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

function writeEnv(name: string, contents: string): string {
  const path = join(dir, name);
  writeFileSync(path, contents, 'utf8');
  return path;
}

describe('applyParsedEnv', () => {
  it('writes values that are not already set', () => {
    const target: Record<string, string | undefined> = {};
    const applied = applyParsedEnv({ A: '1', B: '2' }, target);
    expect(target).toEqual({ A: '1', B: '2' });
    expect(applied.sort()).toEqual(['A', 'B']);
  });

  it('NEVER overrides a variable already present in the environment', () => {
    // The precedence rule that matters: CI and production set variables directly, and a
    // stale local .env must not silently clobber them.
    const target: Record<string, string | undefined> = { DATABASE_URL: 'from-real-env' };
    const applied = applyParsedEnv({ DATABASE_URL: 'from-dotenv' }, target);
    expect(target['DATABASE_URL']).toBe('from-real-env');
    expect(applied).toEqual([]);
  });

  it('treats an empty existing value as unset', () => {
    const target: Record<string, string | undefined> = { DATABASE_URL: '' };
    applyParsedEnv({ DATABASE_URL: 'from-dotenv' }, target);
    expect(target['DATABASE_URL']).toBe('from-dotenv');
  });

  it('applies only the unset subset when some keys already exist', () => {
    const target: Record<string, string | undefined> = { KEPT: 'original' };
    const applied = applyParsedEnv({ KEPT: 'ignored', ADDED: 'new' }, target);
    expect(target).toEqual({ KEPT: 'original', ADDED: 'new' });
    expect(applied).toEqual(['ADDED']);
  });

  it('handles an empty parse result', () => {
    const target: Record<string, string | undefined> = {};
    expect(applyParsedEnv({}, target)).toEqual([]);
  });
});

describe('loadEnvFile', () => {
  it('loads variables from a file into the supplied target', () => {
    const path = writeEnv('.env.basic', 'DATABASE_URL=postgresql://example-host/example-db\n');
    const target: Record<string, string | undefined> = {};
    const result = loadEnvFile(path, target);

    expect(result.status).toBe('loaded');
    expect(target['DATABASE_URL']).toBe('postgresql://example-host/example-db');
    if (result.status === 'loaded') {
      expect(result.applied).toEqual(['DATABASE_URL']);
    }
  });

  it('parses comments, blank lines and quoted values', () => {
    const path = writeEnv(
      '.env.formats',
      ['# a comment', '', 'PLAIN=value', 'QUOTED="quoted value"', 'EMPTY='].join('\n'),
    );
    const target: Record<string, string | undefined> = {};
    loadEnvFile(path, target);

    expect(target['PLAIN']).toBe('value');
    expect(target['QUOTED']).toBe('quoted value');
    expect(target['EMPTY']).toBe('');
  });

  it('reports not-found WITHOUT throwing when the file is absent', () => {
    // `prisma generate` and `next build` must keep working with no .env present.
    const target: Record<string, string | undefined> = {};
    const result = loadEnvFile(join(dir, 'does-not-exist'), target);

    expect(result.status).toBe('not-found');
    expect(target).toEqual({});
  });

  it('does not throw when the path is a directory', () => {
    const result = loadEnvFile(dir, {});
    expect(result.status).toBe('error');
  });

  it('preserves values already present in the target', () => {
    const path = writeEnv('.env.precedence', 'DATABASE_URL=postgresql://from-dotenv/db\n');
    const target: Record<string, string | undefined> = {
      DATABASE_URL: 'postgresql://from-real-env/db',
    };
    const result = loadEnvFile(path, target);

    expect(target['DATABASE_URL']).toBe('postgresql://from-real-env/db');
    if (result.status === 'loaded') {
      expect(result.applied).toEqual([]);
    }
  });

  it('resolves a relative path against the working directory', () => {
    const result = loadEnvFile('.env.definitely-missing', {});
    expect(result.status).toBe('not-found');
    if (result.status === 'not-found') {
      expect(result.path.startsWith('/')).toBe(true);
    }
  });

  it('never leaks file contents into the result', () => {
    const path = writeEnv('.env.secret', 'SECRET_TOKEN=super-secret-value\n');
    const result = loadEnvFile(path, {});
    // Only key names are reported, never values — results may be logged.
    expect(JSON.stringify(result)).not.toContain('super-secret-value');
    if (result.status === 'loaded') {
      expect(result.applied).toEqual(['SECRET_TOKEN']);
    }
  });
});

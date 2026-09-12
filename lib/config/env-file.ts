import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { parse as parseDotenv } from 'dotenv';

/**
 * Loads variables from a project `.env` file into `process.env`.
 *
 * ===========================================================================
 * WHY THIS EXISTS
 *
 * Prisma 7 no longer auto-loads `.env` for `prisma.config.ts`. Earlier Prisma versions did,
 * so a config that reads `process.env.DATABASE_URL` silently receives nothing and
 * `prisma migrate deploy` fails with "Connection url is empty."
 *
 * This module restores that behaviour explicitly rather than implicitly, so the precedence
 * rules are visible and testable.
 * ===========================================================================
 *
 * TWO RULES THIS ENFORCES
 *
 * 1. REAL ENVIRONMENT VARIABLES WIN. A value already present in `process.env` is never
 *    overwritten by the file. CI and production set variables directly; a stale local `.env`
 *    must not silently clobber them.
 *
 * 2. IT NEVER THROWS. A missing or unreadable `.env` is a normal state — `prisma generate`
 *    and `next build` must keep working without one. Failures are reported in the return
 *    value, not raised.
 *
 * No credential, host or connection string appears in this file: it only copies whatever the
 * developer's own ignored `.env` contains.
 */

export type EnvFileLoadResult =
  /** File read and parsed. `applied` lists the keys actually written to `process.env`. */
  | { readonly status: 'loaded'; readonly path: string; readonly applied: readonly string[] }
  /** No file at that path — expected when variables come from the real environment. */
  | { readonly status: 'not-found'; readonly path: string }
  /** The file exists but could not be read or parsed. */
  | { readonly status: 'error'; readonly path: string; readonly reason: string };

/**
 * Copies parsed values into `target`, skipping keys that already have a value.
 *
 * Pure and side-effect-free apart from the supplied `target`, so precedence can be tested
 * without touching the real `process.env`.
 *
 * @returns the keys that were actually written.
 */
export function applyParsedEnv(
  parsed: Readonly<Record<string, string>>,
  target: Record<string, string | undefined>,
): string[] {
  const applied: string[] = [];

  for (const [key, value] of Object.entries(parsed)) {
    const existing = target[key];
    // An empty string counts as unset: a blank value in the real environment is a mistake,
    // matching how lib/config/env.ts treats empty values.
    if (existing === undefined || existing === '') {
      target[key] = value;
      applied.push(key);
    }
  }

  return applied;
}

/**
 * Reads `.env` from the project root (or `filePath`) and applies it to `process.env`.
 *
 * @param filePath Absolute or cwd-relative path. Defaults to `.env` in the current directory.
 */
export function loadEnvFile(
  filePath = '.env',
  target: Record<string, string | undefined> = process.env,
): EnvFileLoadResult {
  const path = resolve(filePath);

  let contents: string;
  try {
    contents = readFileSync(path, 'utf8');
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      return { status: 'not-found', path };
    }
    return { status: 'error', path, reason: code ?? 'unreadable' };
  }

  try {
    const applied = applyParsedEnv(parseDotenv(contents), target);
    return { status: 'loaded', path, applied };
  } catch {
    return { status: 'error', path, reason: 'parse_failed' };
  }
}

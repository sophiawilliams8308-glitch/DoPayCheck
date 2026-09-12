import { z } from 'zod';

/**
 * Centralized, validated environment configuration (spec §57 "Environment secrets").
 *
 * ===========================================================================
 * PUBLIC vs SERVER configuration
 *
 * Configuration is split into two schemas on purpose:
 *
 *   PUBLIC  — values needed to render pages and build the site (site URL, log level,
 *             NODE_ENV). Contains no secrets. Safe to resolve during `next build`.
 *   SERVER  — the public values PLUS server-only secrets such as DATABASE_URL, which is
 *             mandatory in production.
 *
 * Why the split: `next build` executes with NODE_ENV=production but has no database. If
 * page rendering depended on the server schema, every build would require live database
 * credentials — coupling build-time to runtime infrastructure. Keeping them apart means a
 * misconfigured production deployment still fails fast (the server schema is enforced the
 * moment server code runs) without making builds need secrets.
 * ===========================================================================
 *
 * Nothing here is ever logged or returned to a client. DATABASE_URL in particular must never
 * leave the server (spec §57, §58).
 */

export const LOG_LEVELS = ['debug', 'info', 'warn', 'error'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

const publicSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  /** Canonical public base URL, without a trailing slash (spec §37). */
  NEXT_PUBLIC_SITE_URL: z
    .string()
    .url('NEXT_PUBLIC_SITE_URL must be an absolute URL')
    .refine((value) => !value.endsWith('/'), 'NEXT_PUBLIC_SITE_URL must not end with "/"')
    .default('http://localhost:3000'),

  LOG_LEVEL: z.enum(LOG_LEVELS).default('info'),
});

const serverSchema = publicSchema
  .extend({
    /**
     * PostgreSQL connection string. Optional outside production so the application can boot,
     * build and run its test suite before a database is provisioned.
     */
    DATABASE_URL: z
      .string()
      .min(1)
      .refine(
        (value) => value.startsWith('postgresql://') || value.startsWith('postgres://'),
        'DATABASE_URL must be a PostgreSQL connection string (postgresql://…)',
      )
      .optional(),
  })
  .superRefine((value, ctx) => {
    // A production deployment without a database is a misconfiguration, not a default.
    if (value.NODE_ENV === 'production' && value.DATABASE_URL === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['DATABASE_URL'],
        message: 'DATABASE_URL is required when NODE_ENV=production',
      });
    }
  });

export type PublicEnv = z.infer<typeof publicSchema>;
export type ServerEnv = z.infer<typeof serverSchema>;

export type ParseResult<T> =
  { success: true; env: T } | { success: false; errors: readonly string[] };

const PUBLIC_KEYS = ['NODE_ENV', 'NEXT_PUBLIC_SITE_URL', 'LOG_LEVEL'] as const;
const SERVER_KEYS = [...PUBLIC_KEYS, 'DATABASE_URL'] as const;

/**
 * Treats empty strings as "not set" — a blank value in a `.env` file is a mistake, not an
 * intentional empty configuration value.
 */
function clean(
  raw: Record<string, string | undefined>,
  keys: readonly string[],
): Record<string, string> {
  const output: Record<string, string> = {};
  for (const key of keys) {
    const value = raw[key];
    if (value !== undefined && value !== '') {
      output[key] = value;
    }
  }
  return output;
}

function formatIssues(error: z.ZodError): string[] {
  return error.issues.map((issue) => {
    const path = issue.path.join('.');
    return path === '' ? issue.message : `${path}: ${issue.message}`;
  });
}

/** Pure parser for public configuration. Accepts a raw record so tests never touch process.env. */
export function parsePublicEnv(raw: Record<string, string | undefined>): ParseResult<PublicEnv> {
  const result = publicSchema.safeParse(clean(raw, PUBLIC_KEYS));
  return result.success
    ? { success: true, env: result.data }
    : { success: false, errors: formatIssues(result.error) };
}

/** Pure parser for full server configuration, including secrets. */
export function parseServerEnv(raw: Record<string, string | undefined>): ParseResult<ServerEnv> {
  const result = serverSchema.safeParse(clean(raw, SERVER_KEYS));
  return result.success
    ? { success: true, env: result.data }
    : { success: false, errors: formatIssues(result.error) };
}

let cachedPublic: PublicEnv | undefined;
let cachedServer: ServerEnv | undefined;

/**
 * Public configuration. Safe during build and page rendering.
 * Throws only when a public value is genuinely malformed.
 */
export function getPublicEnv(): PublicEnv {
  if (cachedPublic !== undefined) {
    return cachedPublic;
  }
  const result = parsePublicEnv(process.env);
  if (!result.success) {
    throw new Error(`Invalid environment configuration:\n  - ${result.errors.join('\n  - ')}`);
  }
  cachedPublic = result.env;
  return cachedPublic;
}

/**
 * Full server configuration, including DATABASE_URL enforcement in production.
 * Call only from server-side runtime code — never from a module evaluated during build.
 *
 * The thrown message names the offending variables but never echoes their values.
 */
export function getServerEnv(): ServerEnv {
  if (cachedServer !== undefined) {
    return cachedServer;
  }
  const result = parseServerEnv(process.env);
  if (!result.success) {
    throw new Error(`Invalid environment configuration:\n  - ${result.errors.join('\n  - ')}`);
  }
  cachedServer = result.env;
  return cachedServer;
}

/** Test-only helper so memoization does not leak between test cases. */
export function resetEnvCacheForTesting(): void {
  cachedPublic = undefined;
  cachedServer = undefined;
}

import { PrismaPg } from '@prisma/adapter-pg';

import { getServerEnv } from '@/lib/config/env';
import { AppError, ErrorCode } from '@/lib/errors/app-error';

import { PrismaClient } from './generated/client';

/**
 * Database access layer (spec §3: "Database access ... should not contaminate core
 * calculation methodology").
 *
 * This module is the ONLY place a PrismaClient is constructed. Calculation code in
 * `lib/core` must stay free of database imports so the engine remains independently testable
 * (spec §4; CLAUDE.md §6).
 *
 * Prisma 7 connects through a driver adapter (`@prisma/adapter-pg`) rather than a `url` in
 * the schema.
 *
 * The client is created lazily so the application can boot, build and run unit tests without
 * a database configured.
 */

// Reuse the client across HMR reloads in development to avoid exhausting connections.
const globalForPrisma = globalThis as unknown as {
  __dopaycheckPrisma?: PrismaClient;
};

function createClient(): PrismaClient {
  const { DATABASE_URL, NODE_ENV } = getServerEnv();

  if (DATABASE_URL === undefined) {
    throw new AppError(
      ErrorCode.CONFIGURATION_ERROR,
      'DATABASE_URL is not configured; database access is unavailable',
      { publicMessage: 'The service is not correctly configured.' },
    );
  }

  const adapter = new PrismaPg({ connectionString: DATABASE_URL });

  return new PrismaClient({
    adapter,
    // Surface warnings and errors only; query logging can leak sensitive values (spec §58).
    log: NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });
}

/**
 * Returns the shared PrismaClient.
 *
 * @throws {AppError} CONFIGURATION_ERROR when DATABASE_URL is not set.
 */
export function getPrisma(): PrismaClient {
  const existing = globalForPrisma.__dopaycheckPrisma;
  if (existing !== undefined) {
    return existing;
  }

  const client = createClient();
  if (getServerEnv().NODE_ENV !== 'production') {
    globalForPrisma.__dopaycheckPrisma = client;
  }
  return client;
}

export type DatabaseStatus =
  | { readonly status: 'connected'; readonly latencyMs: number }
  | { readonly status: 'unconfigured' }
  | { readonly status: 'error'; readonly reason: string };

/**
 * Checks database connectivity with a trivial round-trip.
 *
 * Uses a raw `SELECT 1` rather than a model query, because the Phase 1 schema deliberately
 * declares no models.
 *
 * The returned `reason` is a short, non-sensitive classification — never a raw driver
 * message, which can contain host names or credentials (spec §57).
 */
export async function checkDatabase(): Promise<DatabaseStatus> {
  let databaseUrl: string | undefined;
  try {
    databaseUrl = getServerEnv().DATABASE_URL;
  } catch {
    return { status: 'error', reason: 'invalid_configuration' };
  }

  if (databaseUrl === undefined) {
    return { status: 'unconfigured' };
  }

  const startedAt = Date.now();
  try {
    await getPrisma().$queryRaw`SELECT 1`;
    return { status: 'connected', latencyMs: Date.now() - startedAt };
  } catch {
    return { status: 'error', reason: 'connection_failed' };
  }
}

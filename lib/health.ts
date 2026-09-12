/**
 * Health/status payload construction (spec §27 System Health).
 *
 * The payload builders are pure and live outside the route handlers so they can be unit
 * tested without the Next runtime.
 *
 * SECURITY (spec §57): health output must never expose configuration. No environment values,
 * connection strings, host names, versions of internal services, file paths or stack traces.
 */

import type { DatabaseStatus } from '@/lib/db/client';

export type HealthState = 'ok' | 'degraded' | 'error';

export interface AppHealth {
  readonly status: HealthState;
  readonly service: 'dopaycheck';
  readonly timestamp: string;
  readonly uptimeSeconds: number;
}

export interface DatabaseHealth {
  readonly status: HealthState;
  readonly database: 'connected' | 'unconfigured' | 'error';
  readonly timestamp: string;
  readonly latencyMs?: number;
  /** Short, non-sensitive classification. Never a raw driver message. */
  readonly reason?: string;
}

/** Liveness: is the application process up and serving? */
export function buildAppHealth(uptimeSeconds: number, now: Date = new Date()): AppHealth {
  return {
    status: 'ok',
    service: 'dopaycheck',
    timestamp: now.toISOString(),
    uptimeSeconds: Math.floor(uptimeSeconds),
  };
}

/**
 * Readiness: can the application reach its database?
 *
 * `unconfigured` maps to `degraded`, not `error` — before a database is provisioned that is
 * an expected development state, not a fault. A failed connection is a real error.
 */
export function buildDatabaseHealth(
  result: DatabaseStatus,
  now: Date = new Date(),
): DatabaseHealth {
  const timestamp = now.toISOString();

  switch (result.status) {
    case 'connected':
      return {
        status: 'ok',
        database: 'connected',
        timestamp,
        latencyMs: result.latencyMs,
      };
    case 'unconfigured':
      return {
        status: 'degraded',
        database: 'unconfigured',
        timestamp,
        reason: 'DATABASE_URL is not configured',
      };
    case 'error':
      return {
        status: 'error',
        database: 'error',
        timestamp,
        reason: result.reason,
      };
  }
}

/** HTTP status for a health state. `degraded` still answers 200 so liveness probes pass. */
export function healthHttpStatus(state: HealthState): number {
  return state === 'error' ? 503 : 200;
}

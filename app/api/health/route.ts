import { NextResponse } from 'next/server';

import { errorResponse } from '@/lib/errors/api-response';
import { buildAppHealth, healthHttpStatus } from '@/lib/health';

/**
 * GET /api/health — application liveness.
 *
 * Answers whether the process is up and serving requests. It does NOT touch the database:
 * see /api/health/db for connectivity, kept separate so a database outage does not make the
 * app look dead to a liveness probe.
 */

// Never cached: a cached health check is worse than no health check.
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export function GET(): NextResponse {
  try {
    const health = buildAppHealth(process.uptime());
    return NextResponse.json(health, {
      status: healthHttpStatus(health.status),
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    return errorResponse(error);
  }
}

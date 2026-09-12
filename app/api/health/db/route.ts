import { NextResponse } from 'next/server';

import { checkDatabase } from '@/lib/db/client';
import { errorResponse } from '@/lib/errors/api-response';
import { buildDatabaseHealth, healthHttpStatus } from '@/lib/health';

/**
 * GET /api/health/db — database readiness.
 *
 * Separate from /api/health so application liveness and database connectivity can be
 * distinguished (spec §27).
 *
 * Responds with a classification only — never the connection string, host, or driver error
 * text (spec §57).
 */

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(): Promise<NextResponse> {
  try {
    const health = buildDatabaseHealth(await checkDatabase());
    return NextResponse.json(health, {
      status: healthHttpStatus(health.status),
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    return errorResponse(error);
  }
}

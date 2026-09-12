import { NextResponse } from 'next/server';

import { getPublicEnv } from '@/lib/config/env';
import { logger } from '@/lib/logging/logger';

import { AppError, ErrorCode, toAppError } from './app-error';

/**
 * Safe API error responses (spec §16, §57).
 *
 * Stack traces and internal messages are logged server-side and never serialized to the
 * client. Validation issues ARE returned, because they describe the caller's own input.
 */

export interface ApiErrorBody {
  readonly error: {
    readonly code: ErrorCode;
    readonly message: string;
    readonly issues?: readonly { readonly path: string; readonly message: string }[];
  };
}

/** Converts any thrown value into a safe JSON response, logging the internal detail. */
export function errorResponse(error: unknown, requestId?: string): NextResponse<ApiErrorBody> {
  const appError: AppError = toAppError(error);

  const logContext: Record<string, unknown> = {
    code: appError.code,
    httpStatus: appError.httpStatus,
  };
  if (requestId !== undefined) {
    logContext['requestId'] = requestId;
  }

  if (appError.httpStatus >= 500) {
    logger.error(appError.message, { ...logContext, cause: describeCause(appError.cause) });
  } else {
    logger.warn(appError.message, logContext);
  }

  const body: ApiErrorBody = {
    error: {
      code: appError.code,
      message: appError.publicMessage,
      ...(appError.issues.length > 0 ? { issues: appError.issues } : {}),
    },
  };

  return NextResponse.json(body, {
    status: appError.httpStatus,
    headers: { 'Cache-Control': 'no-store' },
  });
}

/**
 * Builds the response body without constructing a NextResponse.
 * Exported so the shape can be unit-tested outside the Next runtime.
 */
export function buildApiErrorBody(error: unknown): ApiErrorBody {
  const appError = toAppError(error);
  return {
    error: {
      code: appError.code,
      message: appError.publicMessage,
      ...(appError.issues.length > 0 ? { issues: appError.issues } : {}),
    },
  };
}

/** True when detailed internal messages may be surfaced (never in production). */
export function shouldExposeInternalDetail(): boolean {
  return getPublicEnv().NODE_ENV !== 'production';
}

function describeCause(cause: unknown): string | undefined {
  if (cause === undefined) {
    return undefined;
  }
  return cause instanceof Error ? `${cause.name}: ${cause.message}` : String(cause);
}

/**
 * Structured application errors (spec §16, §57).
 *
 * Two rules drive this design:
 * 1. Internal detail (stack traces, driver messages, connection strings) must never reach a
 *    public client.
 * 2. Validation failures must be distinguishable from internal failures, both in code and in
 *    the API response.
 */

export const ErrorCode = {
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  NOT_FOUND: 'NOT_FOUND',
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  RATE_LIMITED: 'RATE_LIMITED',
  CONFIGURATION_ERROR: 'CONFIGURATION_ERROR',
  DATABASE_ERROR: 'DATABASE_ERROR',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

export interface FieldIssue {
  readonly path: string;
  readonly message: string;
}

export interface AppErrorOptions {
  /** Safe, user-facing message. Must not contain internal detail. */
  readonly publicMessage?: string;
  /** Underlying cause, retained server-side only. */
  readonly cause?: unknown;
  /** Field-level issues for validation failures. */
  readonly issues?: readonly FieldIssue[];
}

const DEFAULT_STATUS: Record<ErrorCode, number> = {
  VALIDATION_FAILED: 400,
  NOT_FOUND: 404,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  RATE_LIMITED: 429,
  CONFIGURATION_ERROR: 500,
  DATABASE_ERROR: 503,
  INTERNAL_ERROR: 500,
  SERVICE_UNAVAILABLE: 503,
};

const DEFAULT_PUBLIC_MESSAGE: Record<ErrorCode, string> = {
  VALIDATION_FAILED: 'The submitted data is not valid.',
  NOT_FOUND: 'The requested resource was not found.',
  UNAUTHORIZED: 'Authentication is required.',
  FORBIDDEN: 'You do not have permission to perform this action.',
  RATE_LIMITED: 'Too many requests. Please try again shortly.',
  CONFIGURATION_ERROR: 'The service is not correctly configured.',
  DATABASE_ERROR: 'A data storage error occurred.',
  INTERNAL_ERROR: 'An unexpected error occurred.',
  SERVICE_UNAVAILABLE: 'The service is temporarily unavailable.',
};

export class AppError extends Error {
  public override readonly name = 'AppError';
  public readonly code: ErrorCode;
  public readonly httpStatus: number;
  /** Safe to return to a client. */
  public readonly publicMessage: string;
  public readonly issues: readonly FieldIssue[];

  public constructor(code: ErrorCode, internalMessage: string, options: AppErrorOptions = {}) {
    super(internalMessage, options.cause === undefined ? undefined : { cause: options.cause });
    this.code = code;
    this.httpStatus = DEFAULT_STATUS[code];
    this.publicMessage = options.publicMessage ?? DEFAULT_PUBLIC_MESSAGE[code];
    this.issues = options.issues ?? [];
  }

  public get isValidationError(): boolean {
    return this.code === ErrorCode.VALIDATION_FAILED;
  }
}

/** Convenience constructor for validation failures. */
export function validationError(issues: readonly FieldIssue[], internalMessage?: string): AppError {
  return new AppError(
    ErrorCode.VALIDATION_FAILED,
    internalMessage ?? `Validation failed with ${String(issues.length)} issue(s)`,
    { issues },
  );
}

/** Normalizes any thrown value into an AppError without losing the original as `cause`. */
export function toAppError(error: unknown): AppError {
  if (error instanceof AppError) {
    return error;
  }

  const internalMessage =
    error instanceof Error ? error.message : `Non-Error thrown: ${String(error)}`;

  return new AppError(ErrorCode.INTERNAL_ERROR, internalMessage, { cause: error });
}

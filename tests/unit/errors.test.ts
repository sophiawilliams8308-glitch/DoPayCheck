import { describe, expect, it } from 'vitest';

import { buildApiErrorBody } from '@/lib/errors/api-response';
import { AppError, ErrorCode, toAppError, validationError } from '@/lib/errors/app-error';

/** Error-handling foundation tests (spec §16, §57). */

describe('AppError', () => {
  it('maps codes to sensible HTTP statuses', () => {
    expect(new AppError(ErrorCode.NOT_FOUND, 'x').httpStatus).toBe(404);
    expect(new AppError(ErrorCode.VALIDATION_FAILED, 'x').httpStatus).toBe(400);
    expect(new AppError(ErrorCode.INTERNAL_ERROR, 'x').httpStatus).toBe(500);
    expect(new AppError(ErrorCode.DATABASE_ERROR, 'x').httpStatus).toBe(503);
  });

  it('keeps the internal message separate from the public message', () => {
    const error = new AppError(ErrorCode.DATABASE_ERROR, 'connection to 10.0.0.5:5432 refused');
    expect(error.message).toContain('10.0.0.5');
    expect(error.publicMessage).not.toContain('10.0.0.5');
  });

  it('distinguishes validation errors', () => {
    expect(validationError([{ path: 'a', message: 'required' }]).isValidationError).toBe(true);
    expect(new AppError(ErrorCode.INTERNAL_ERROR, 'x').isValidationError).toBe(false);
  });
});

describe('toAppError', () => {
  it('passes an AppError through unchanged', () => {
    const original = new AppError(ErrorCode.NOT_FOUND, 'missing');
    expect(toAppError(original)).toBe(original);
  });

  it('wraps a plain Error as INTERNAL_ERROR and retains the cause', () => {
    const cause = new Error('boom');
    const wrapped = toAppError(cause);
    expect(wrapped.code).toBe(ErrorCode.INTERNAL_ERROR);
    expect(wrapped.cause).toBe(cause);
  });

  it('wraps non-Error throwables', () => {
    expect(toAppError('a string').code).toBe(ErrorCode.INTERNAL_ERROR);
  });
});

describe('buildApiErrorBody', () => {
  it('never leaks the internal message or a stack trace', () => {
    const body = buildApiErrorBody(new Error('SECRET internal detail at /srv/app/db.ts:42'));
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain('SECRET');
    expect(serialized).not.toContain('/srv/app');
    expect(serialized).not.toContain('stack');
    expect(body.error.code).toBe(ErrorCode.INTERNAL_ERROR);
  });

  it('returns field issues for validation failures, since they describe caller input', () => {
    const body = buildApiErrorBody(
      validationError([{ path: 'payFrequency', message: 'Required' }]),
    );
    expect(body.error.code).toBe(ErrorCode.VALIDATION_FAILED);
    expect(body.error.issues).toEqual([{ path: 'payFrequency', message: 'Required' }]);
  });

  it('omits the issues key entirely when there are none', () => {
    expect(buildApiErrorBody(new Error('x')).error.issues).toBeUndefined();
  });
});

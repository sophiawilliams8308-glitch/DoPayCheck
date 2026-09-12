import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { AppError, ErrorCode } from '@/lib/errors/app-error';
import { parseOrThrow, parseSafely, primitives, toFieldIssues } from '@/lib/validation';

/** Validation foundation tests (spec §57). */

const schema = z.object({
  name: primitives.nonEmptyString,
  amount: primitives.decimalString,
});

describe('parseOrThrow', () => {
  it('returns typed data for valid input', () => {
    expect(parseOrThrow(schema, { name: 'Bonus', amount: '1500.00' })).toEqual({
      name: 'Bonus',
      amount: '1500.00',
    });
  });

  it('throws an AppError with VALIDATION_FAILED for invalid input', () => {
    try {
      parseOrThrow(schema, { name: '', amount: 'abc' });
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).code).toBe(ErrorCode.VALIDATION_FAILED);
      expect((error as AppError).issues.length).toBeGreaterThan(0);
    }
  });
});

describe('parseSafely', () => {
  it('reports success without throwing', () => {
    const result = parseSafely(schema, { name: 'x', amount: '1' });
    expect(result.success).toBe(true);
  });

  it('reports field issues without throwing', () => {
    const result = parseSafely(schema, { name: 'x', amount: 'nope' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.issues[0]?.path).toBe('amount');
    }
  });
});

describe('primitives', () => {
  it('accepts decimal strings and rejects unsafe numeric forms', () => {
    for (const good of ['0', '-12.5', '1234.5678']) {
      expect(primitives.decimalString.safeParse(good).success).toBe(true);
    }
    for (const bad of ['', '1,234.00', '1e5', 'abc', '1.2.3']) {
      expect(primitives.decimalString.safeParse(bad).success).toBe(false);
    }
  });

  it('accepts lowercase hyphenated slugs only', () => {
    expect(primitives.slug.safeParse('new-york').success).toBe(true);
    expect(primitives.slug.safeParse('New_York').success).toBe(false);
    expect(primitives.slug.safeParse('new--york').success).toBe(false);
  });

  it('trims strings before validating', () => {
    expect(primitives.nonEmptyString.safeParse('  x  ')).toMatchObject({ data: 'x' });
    expect(primitives.nonEmptyString.safeParse('   ').success).toBe(false);
  });
});

describe('toFieldIssues', () => {
  it('flattens nested paths with dots', () => {
    const nested = z.object({ a: z.object({ b: z.string() }) });
    const result = nested.safeParse({ a: { b: 1 } });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(toFieldIssues(result.error)[0]?.path).toBe('a.b');
    }
  });
});

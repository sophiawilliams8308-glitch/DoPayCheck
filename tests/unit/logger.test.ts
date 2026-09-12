import { describe, expect, it } from 'vitest';

import { buildLogRecord, redact } from '@/lib/logging/logger';

/** Logging privacy tests (spec §58 — never log sensitive data). */

describe('redact', () => {
  it('redacts credentials and connection strings', () => {
    const output = redact({
      password: 'hunter2',
      apiKey: 'sk-live-abc',
      DATABASE_URL: 'postgresql://user:pw@host/db',
      authorization: 'Bearer xyz',
    }) as Record<string, unknown>;

    expect(output['password']).toBe('[REDACTED]');
    expect(output['apiKey']).toBe('[REDACTED]');
    expect(output['DATABASE_URL']).toBe('[REDACTED]');
    expect(output['authorization']).toBe('[REDACTED]');
  });

  it('redacts sensitive payroll and identity fields', () => {
    const output = redact({
      salary: '85000',
      grossPay: '3269.23',
      ssn: '000-00-0000',
      w4Dependents: '2',
      email: 'person@example.com',
    }) as Record<string, unknown>;

    for (const key of ['salary', 'grossPay', 'ssn', 'w4Dependents', 'email']) {
      expect(output[key]).toBe('[REDACTED]');
    }
  });

  it('matches keys case-insensitively and ignores separators', () => {
    const output = redact({ USER_PASSWORD: 'x', 'api-key': 'y' }) as Record<string, unknown>;
    expect(output['USER_PASSWORD']).toBe('[REDACTED]');
    expect(output['api-key']).toBe('[REDACTED]');
  });

  it('redacts nested values', () => {
    const output = redact({ outer: { inner: { token: 'secret' } } }) as {
      outer: { inner: Record<string, unknown> };
    };
    expect(output.outer.inner['token']).toBe('[REDACTED]');
  });

  it('preserves non-sensitive values', () => {
    const output = redact({ requestId: 'req-1', count: 3, ok: true }) as Record<string, unknown>;
    expect(output).toEqual({ requestId: 'req-1', count: 3, ok: true });
  });

  it('reduces an Error to name and message, dropping the stack', () => {
    const output = redact(new Error('boom')) as Record<string, unknown>;
    expect(output).toEqual({ name: 'Error', message: 'boom' });
    expect(output['stack']).toBeUndefined();
  });

  it('truncates deeply nested structures rather than recursing without bound', () => {
    type Nested = { next?: Nested; value?: string };
    let deep: Nested = { value: 'end' };
    for (let i = 0; i < 20; i += 1) {
      deep = { next: deep };
    }
    expect(JSON.stringify(redact(deep))).toContain('[TRUNCATED]');
  });
});

describe('buildLogRecord', () => {
  it('produces a structured, serializable record', () => {
    const record = buildLogRecord('info', 'something happened', { requestId: 'abc' });
    expect(record.level).toBe('info');
    expect(record.message).toBe('something happened');
    expect(record.context).toEqual({ requestId: 'abc' });
    expect(() => new Date(record.timestamp).toISOString()).not.toThrow();
  });

  it('omits context entirely when none is supplied', () => {
    expect(buildLogRecord('warn', 'no context').context).toBeUndefined();
  });

  it('redacts sensitive context before it can be emitted', () => {
    const record = buildLogRecord('error', 'db failure', {
      DATABASE_URL: 'postgresql://u:p@h/d',
    });
    expect(JSON.stringify(record)).not.toContain('postgresql://');
  });
});

import { describe, expect, it } from 'vitest';

import { buildAppHealth, buildDatabaseHealth, healthHttpStatus } from '@/lib/health';

/** Health/status foundation tests (spec §27, §57). */

const fixedNow = new Date('2026-01-01T00:00:00.000Z');

describe('buildAppHealth', () => {
  it('reports ok with a floored uptime', () => {
    const health = buildAppHealth(12.9, fixedNow);
    expect(health.status).toBe('ok');
    expect(health.service).toBe('dopaycheck');
    expect(health.uptimeSeconds).toBe(12);
    expect(health.timestamp).toBe('2026-01-01T00:00:00.000Z');
  });

  it('exposes no configuration whatsoever', () => {
    const serialized = JSON.stringify(buildAppHealth(1, fixedNow));
    for (const forbidden of ['DATABASE_URL', 'postgres', 'localhost', 'env', 'password']) {
      expect(serialized.toLowerCase()).not.toContain(forbidden.toLowerCase());
    }
  });
});

describe('buildDatabaseHealth', () => {
  it('maps a successful connection to ok', () => {
    const health = buildDatabaseHealth({ status: 'connected', latencyMs: 4 }, fixedNow);
    expect(health.status).toBe('ok');
    expect(health.database).toBe('connected');
    expect(health.latencyMs).toBe(4);
  });

  it('treats an unconfigured database as degraded, not an error', () => {
    const health = buildDatabaseHealth({ status: 'unconfigured' }, fixedNow);
    expect(health.status).toBe('degraded');
    expect(health.database).toBe('unconfigured');
  });

  it('maps a failed connection to error', () => {
    const health = buildDatabaseHealth({ status: 'error', reason: 'connection_failed' }, fixedNow);
    expect(health.status).toBe('error');
    expect(health.reason).toBe('connection_failed');
  });

  it('never includes a connection string in its output', () => {
    const serialized = JSON.stringify(
      buildDatabaseHealth({ status: 'error', reason: 'connection_failed' }, fixedNow),
    );
    expect(serialized).not.toContain('postgresql://');
    expect(serialized).not.toContain('@');
  });
});

describe('healthHttpStatus', () => {
  it('answers 200 for ok and degraded, 503 for error', () => {
    expect(healthHttpStatus('ok')).toBe(200);
    expect(healthHttpStatus('degraded')).toBe(200);
    expect(healthHttpStatus('error')).toBe(503);
  });
});

/**
 * Minimal structured logger (spec §57, §58).
 *
 * Deliberately dependency-free and small for Phase 1.
 *
 * PRIVACY RULE — never log sensitive data:
 *   passwords, API keys, tokens, session cookies, W-4 details, salary/wage amounts,
 *   or unnecessary personal information (spec §58 data minimization).
 *
 * `redact()` is a safety net, not permission to pass sensitive values in. Prefer never
 * putting them in a log context at all.
 */

import { LOG_LEVELS, type LogLevel } from '@/lib/config/env';

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

/**
 * Keys whose values are replaced with `[REDACTED]`. Matching is case-insensitive and
 * substring-based, so `userPassword` and `DATABASE_URL` are both caught.
 */
const SENSITIVE_KEY_PATTERNS: readonly string[] = [
  'password',
  'passwd',
  'secret',
  'token',
  'apikey',
  'api_key',
  'authorization',
  'auth',
  'cookie',
  'session',
  'credential',
  'connectionstring',
  'database_url',
  'databaseurl',
  'ssn',
  'socialsecurity',
  'taxid',
  'ein',
  'salary',
  'wage',
  'wages',
  'grosspay',
  'netpay',
  'compensation',
  'w4',
  'withholding',
  'bankaccount',
  'routing',
  'email',
];

const REDACTED = '[REDACTED]';
const MAX_DEPTH = 6;

export type LogContext = Record<string, unknown>;

export interface LogRecord {
  readonly timestamp: string;
  readonly level: LogLevel;
  readonly message: string;
  readonly context?: LogContext;
}

function isSensitiveKey(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[-_\s]/g, '');
  return SENSITIVE_KEY_PATTERNS.some((pattern) =>
    normalized.includes(pattern.replace(/[-_\s]/g, '')),
  );
}

/** Recursively replaces sensitive values. Exported for testing. */
export function redact(value: unknown, depth = 0): unknown {
  if (depth > MAX_DEPTH) {
    return '[TRUNCATED]';
  }

  if (value === null || typeof value !== 'object') {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => redact(item, depth + 1));
  }

  if (value instanceof Error) {
    return { name: value.name, message: value.message };
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  const output: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    output[key] = isSensitiveKey(key) ? REDACTED : redact(nested, depth + 1);
  }
  return output;
}

/** Builds a log record without emitting it. Exported for testing. */
export function buildLogRecord(level: LogLevel, message: string, context?: LogContext): LogRecord {
  const redactedContext = context === undefined ? undefined : (redact(context) as LogContext);

  return {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...(redactedContext === undefined ? {} : { context: redactedContext }),
  };
}

/**
 * Resolves the active level from the environment.
 * Falls back to `info` rather than throwing — logging must never break the app.
 */
function activeLevel(): LogLevel {
  const raw = process.env['LOG_LEVEL'];
  return raw !== undefined && (LOG_LEVELS as readonly string[]).includes(raw)
    ? (raw as LogLevel)
    : 'info';
}

function emit(level: LogLevel, message: string, context?: LogContext): void {
  if (LEVEL_PRIORITY[level] < LEVEL_PRIORITY[activeLevel()]) {
    return;
  }

  const record = buildLogRecord(level, message, context);
  const line = JSON.stringify(record);

  // Structured single-line JSON so logs stay machine-parseable in any host environment.
  if (level === 'error') {
    console.error(line);
  } else if (level === 'warn') {
    console.warn(line);
  } else {
    // eslint-disable-next-line no-console
    console.log(line);
  }
}

export const logger = {
  debug: (message: string, context?: LogContext): void => {
    emit('debug', message, context);
  },
  info: (message: string, context?: LogContext): void => {
    emit('info', message, context);
  },
  warn: (message: string, context?: LogContext): void => {
    emit('warn', message, context);
  },
  error: (message: string, context?: LogContext): void => {
    emit('error', message, context);
  },
} as const;

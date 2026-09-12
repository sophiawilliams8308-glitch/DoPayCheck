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
 * Sensitive-key matching.
 *
 * Matching is TOKEN-aware rather than naive substring matching. A key is split into words on
 * camelCase, snake_case, kebab-case and digit boundaries, then compared token by token.
 *
 * Why not plain substring matching: short patterns swallow innocent keys. `'auth'` matches
 * `author`/`authorId` and `'ein'` matches `being`/`protein`/`einsteinId`. Both are realistic
 * keys in this project — spec §38 gives blog posts an Author, §31 records an audit Actor — and
 * silently redacting them destroys debuggability while protecting nothing.
 *
 * Redaction still errs toward safety: a token matches when it EQUALS a sensitive token, or
 * ENDS WITH one that is at least `SUFFIX_MATCH_MIN_LENGTH` characters (so `userpassword` and
 * `accesstoken` are caught, while the short `auth`/`ein` patterns stay exact-match only).
 */

/** Sensitive as a standalone word. */
const SENSITIVE_TOKENS: readonly string[] = [
  'password',
  'passwd',
  'pwd',
  'secret',
  'token',
  'auth',
  'authorization',
  'cookie',
  'session',
  'credential',
  'credentials',
  'ssn',
  'ein',
  'taxid',
  'salary',
  'wage',
  'wages',
  'compensation',
  'withholding',
  'email',
  'iban',
  'w4',
];

/**
 * Minimum length for suffix matching. Keeps `userpassword` covered while preventing the
 * 3- and 4-character tokens (`ein`, `auth`, `pwd`, `ssn`, `wage`, `w4`) from matching inside
 * unrelated words.
 */
const SUFFIX_MATCH_MIN_LENGTH = 5;

/**
 * Sensitive only as an adjacent word sequence, so `pay` and `key` stay usable on their own
 * (`payFrequency` and `sortKey` are not secrets, but `grossPay` and `apiKey` are).
 */
const SENSITIVE_PHRASES: readonly (readonly string[])[] = [
  ['api', 'key'],
  ['access', 'key'],
  ['private', 'key'],
  ['secret', 'key'],
  ['database', 'url'],
  ['connection', 'string'],
  ['gross', 'pay'],
  ['net', 'pay'],
  ['take', 'home', 'pay'],
  ['pay', 'amount'],
  ['bank', 'account'],
  ['account', 'number'],
  ['routing', 'number'],
  ['social', 'security'],
  ['tax', 'id'],
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

/**
 * Splits a key into lowercase word tokens.
 *
 * `w4Dependents` → `['w4', 'dependents']`, `DATABASE_URL` → `['database', 'url']`,
 * `authorId` → `['author', 'id']`, `HTTPServer` → `['http', 'server']`.
 *
 * Exported for testing.
 */
export function tokenizeKey(key: string): string[] {
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .map((token) => token.toLowerCase())
    .filter((token) => token.length > 0);
}

function tokenIsSensitive(token: string): boolean {
  return SENSITIVE_TOKENS.some(
    (sensitive) =>
      token === sensitive ||
      (sensitive.length >= SUFFIX_MATCH_MIN_LENGTH && token.endsWith(sensitive)),
  );
}

function containsPhrase(tokens: readonly string[], phrase: readonly string[]): boolean {
  if (phrase.length > tokens.length) {
    return false;
  }
  for (let start = 0; start <= tokens.length - phrase.length; start += 1) {
    if (phrase.every((word, offset) => tokens[start + offset] === word)) {
      return true;
    }
  }
  return false;
}

/** Exported for testing. */
export function isSensitiveKey(key: string): boolean {
  const tokens = tokenizeKey(key);
  if (tokens.some(tokenIsSensitive)) {
    return true;
  }

  // Also catch run-on spellings with no separator to tokenize on, e.g. `apikey`.
  const joined = tokens.join('');
  return SENSITIVE_PHRASES.some(
    (phrase) => containsPhrase(tokens, phrase) || joined === phrase.join(''),
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

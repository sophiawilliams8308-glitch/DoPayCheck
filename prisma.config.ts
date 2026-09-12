import { defineConfig } from 'prisma/config';

import { loadEnvFile } from './lib/config/env-file';

/**
 * Prisma CLI configuration (Prisma 7).
 *
 * In Prisma 7 the datasource URL lives here rather than in `schema.prisma`, and the runtime
 * client connects through a driver adapter (see `lib/db/client.ts`).
 *
 * Read by the Prisma CLI only (`prisma validate`, `prisma generate`, `prisma migrate`,
 * `prisma studio`). It must never contain a hardcoded credential — the URL always comes from
 * the environment.
 *
 * ---------------------------------------------------------------------------
 * WHY `.env` IS LOADED EXPLICITLY
 *
 * Prisma 6 and earlier auto-loaded `.env` for the CLI. Prisma 7 does not, so a config that
 * reads `process.env.DATABASE_URL` receives nothing and `prisma migrate deploy` fails with
 * "Connection url is empty." even though the developer has a correct `.env`.
 *
 * `loadEnvFile()` restores that behaviour. It never overrides a variable already present in
 * the real environment, so CI and production settings still win over a local file, and it
 * never throws when `.env` is absent.
 * ---------------------------------------------------------------------------
 *
 * Why `process.env` with an empty fallback instead of Prisma's `env()` helper:
 *   `env()` throws when the variable is unset, which would make `prisma generate` — and
 *   therefore `next build` — require a live database URL. Client generation does not need a
 *   database. Commands that genuinely need a connection (`migrate`, `studio`) still fail with
 *   a clear Prisma error when the value is empty.
 */
loadEnvFile();

const databaseUrl = process.env['DATABASE_URL'] ?? '';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: databaseUrl,
  },
});

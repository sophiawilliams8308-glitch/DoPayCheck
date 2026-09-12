import { defineConfig } from 'prisma/config';

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
 * Why `process.env` with an empty fallback instead of Prisma's `env()` helper:
 *   `env()` throws when the variable is unset, which would make `prisma generate` — and
 *   therefore `next build` — require a live database URL. Client generation does not need a
 *   database. Commands that genuinely need a connection (`migrate`, `studio`) still fail with
 *   a clear Prisma error when the value is empty.
 */
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

# DoPayCheck — Local Development

How to run, test and build DoPayCheck locally.

This document covers **local development only**. It is not a specification.

- `docs/SPECIFICATION.md` — the authoritative Master Specification.
- `CLAUDE.md` — operating instructions for Claude Code sessions.

Deployment is deliberately **not** covered here; `docs/DEPLOYMENT.md` is created in a later
phase once the hosting runtime is confirmed (spec §62).

---

## 1. Prerequisites

| Requirement | Version                          | Notes                                    |
| ----------- | -------------------------------- | ---------------------------------------- |
| Node.js     | **>= 20.9.0** (22.x recommended) | Enforced by `engines` in `package.json`. |
| npm         | 10.x or newer                    | **npm is the project package manager.**  |
| PostgreSQL  | 16.x recommended                 | Only required for database features.     |

### Package manager

This project uses **npm**. There is exactly one lockfile: `package-lock.json`.

Do not use `pnpm`, `yarn` or `bun` — a second lockfile causes divergent dependency
resolution between machines and CI.

---

## 2. Installation

```bash
git clone https://github.com/sophiawilliams8308-glitch/DoPayCheck.git
cd DoPayCheck
npm install
```

That is all that is required. A `postinstall` script runs `prisma generate` automatically, so
the typed database client exists straight after install and `npm run typecheck` and
`npm run build` work on a fresh clone with no extra step.

The generated client lives in `lib/db/generated/` and is git-ignored — it is a build artifact,
regenerated from `prisma/schema.prisma` rather than committed. Regenerate it manually after
any schema change:

```bash
npm run db:generate
```

---

## 3. Environment setup

Copy the example file and edit your local copy:

```bash
cp .env.example .env
```

`.env` is git-ignored. **Never commit real credentials, API keys or production secrets.**
`.env.example` contains placeholders only and _is_ committed.

### Variables

| Variable               | Required                                 | Purpose                                                                                 |
| ---------------------- | ---------------------------------------- | --------------------------------------------------------------------------------------- |
| `NODE_ENV`             | no (defaults to `development`)           | `development` \| `test` \| `production`.                                                |
| `DATABASE_URL`         | **yes in production**, optional locally  | PostgreSQL connection string.                                                           |
| `NEXT_PUBLIC_SITE_URL` | no (defaults to `http://localhost:3000`) | Canonical base URL, **no trailing slash**. Used for canonical tags, robots and sitemap. |
| `LOG_LEVEL`            | no (defaults to `info`)                  | `debug` \| `info` \| `warn` \| `error`.                                                 |

Configuration is split into **public** and **server** schemas (`lib/config/env.ts`):

- **Public** (`getPublicEnv`) — no secrets; safe during `next build` and page rendering.
- **Server** (`getServerEnv`) — adds `DATABASE_URL`, which is mandatory when
  `NODE_ENV=production`.

This split is why a production build does not require live database credentials, while a
misconfigured production **runtime** still fails immediately.

**The app runs without a database.** `DATABASE_URL` may be omitted locally; `/api/health/db`
then reports `unconfigured` instead of failing.

---

## 4. Database setup

PostgreSQL is the database and Prisma is the ORM.

Start a local PostgreSQL however you prefer, for example with Docker:

```bash
docker run --name dopaycheck-db \
  -e POSTGRES_USER=dopaycheck \
  -e POSTGRES_PASSWORD=<choose-a-local-password> \
  -e POSTGRES_DB=dopaycheck \
  -p 5432:5432 -d postgres:16
```

Then set `DATABASE_URL` in `.env` to match.

### Prisma 7 notes

Prisma 7 differs from earlier versions in two ways that matter here:

1. The connection URL lives in **`prisma.config.ts`**, not in `schema.prisma`.
2. The runtime client connects through a **driver adapter** (`@prisma/adapter-pg`), wired up
   in `lib/db/client.ts`.

### Schema status

`prisma/schema.prisma` defines the Phase 2 rule & data system: `Jurisdiction`, `TaxYear`,
`Source`, `TaxRule`, `TaxRuleValue`, `TaxRuleSource`, `RuleConflict` and `AuditLog`.

See **`docs/DATA-MODEL.md`** for the architecture: versioning, effective dates, the publish
gate, source traceability, verification statuses, conflicts and decimal precision.

The schema contains **no tax values**. Every rate, bracket, threshold and wage base is
PENDING DATA until sourced from an official document.

### Commands

```bash
npm run db:generate        # regenerate the typed client (after any schema change)
npm run db:migrate         # create + apply a development migration
npm run db:migrate:deploy  # apply existing migrations (CI / production)
npm run db:seed            # reference geography + empty tax years ONLY (no tax data)
npm run db:reset           # drop, re-migrate and re-seed (destructive, local only)
npm run db:studio          # browse data
```

### Seed contents

`npm run db:seed` is idempotent and inserts **no tax data**:

- the federal jurisdiction plus 51 states/territories — reference geography;
- tax-year containers for 2025-2027 — empty shells with no rules.

It deliberately omits brackets, rates, wage bases, thresholds, withholding tables and sources.
Tax values arrive only through the draft -> review -> approve -> publish workflow, traceable to
an official document.

---

## 5. Commands

| Command                | Purpose                                               |
| ---------------------- | ----------------------------------------------------- |
| `npm run dev`          | Start the development server on http://localhost:3000 |
| `npm run build`        | Production build                                      |
| `npm run start`        | Serve a production build (run `build` first)          |
| `npm run lint`         | ESLint                                                |
| `npm run lint:fix`     | ESLint with autofix                                   |
| `npm run typecheck`    | `tsc --noEmit`                                        |
| `npm test`             | Run the test suite once                               |
| `npm run test:watch`   | Tests in watch mode                                   |
| `npm run test:db`      | Integration tests only — requires `DATABASE_URL`      |
| `npm run format`       | Format with Prettier                                  |
| `npm run format:check` | Verify formatting                                     |

### Before pushing

```bash
npm run typecheck && npm run lint && npm test && npm run build
```

All four must pass.

---

## 6. Health checks

| Endpoint              | Purpose                                                             | Responses                                              |
| --------------------- | ------------------------------------------------------------------- | ------------------------------------------------------ |
| `GET /api/health/`    | Liveness — is the process serving? Does **not** touch the database. | `200 ok`                                               |
| `GET /api/health/db/` | Readiness — database connectivity.                                  | `200 ok` / `200 degraded` (unconfigured) / `503 error` |

```bash
curl http://localhost:3000/api/health/
curl http://localhost:3000/api/health/db/
```

They are separate so a database outage does not make the application look dead to a liveness
probe. Neither endpoint exposes configuration, connection strings or stack traces (spec §57).

> Note the trailing slashes — the project uses `trailingSlash: true` to match the canonical
> URL policy in spec §37.

---

## 7. Project structure

DoPayCheck is **ONE integrated full-stack Next.js application**. There is deliberately no
separate `/frontend` or `/backend` application (spec §3) — do not introduce one.

```
app/                    Routes, layouts, API route handlers (App Router)
  api/health/           Liveness + database readiness endpoints
lib/
  config/               Validated environment configuration
  core/                 Framework-free logic. money.ts = decimal arithmetic foundation
  db/                   Prisma client, connectivity check, NUMERIC <-> Money bridge
  errors/               Structured errors + safe API responses
  logging/              Structured logger with sensitive-value redaction
  security/             HTTP security headers
  seo/                  Canonical URLs and metadata helpers
  validation/           Centralized Zod validation helpers
  rules/                Rule categories, payload schemas, lifecycle, verification,
                        validation, resolution, repository
  jurisdictions/        Jurisdiction access + hierarchy traversal
  tax-years/            Tax year access
  sources/              Official source access
  audit/                Append-only audit trail
prisma/                 Schema, migrations and seed
tests/unit/             Unit tests
tests/integration/      Database-backed tests
docs/                   SPECIFICATION.md (authoritative), DATA-MODEL.md, this file
```

Directories are created only when they hold real code. Empty scaffolding folders for future
phases are intentionally absent.

### Two rules that must not be broken

1. **Money never touches floating point.** All authoritative monetary arithmetic goes through
   `lib/core/money.ts`, which is built on `decimal.js`. `money()` refuses a JavaScript
   `number` on purpose, because a `number` may already have lost precision before arriving
   (spec §4). Persist and transport values as strings via `toStorageString()`.
2. **The calculation core stays independent.** `lib/core` must not import from `lib/db` or
   from UI code, so the engine remains testable in isolation (spec §3, §4).

---

## 8. Testing

[Vitest](https://vitest.dev) is the test runner.

```
tests/unit/          Pure, fast, no IO            (exists)
tests/integration/   Database-backed              (exists — requires PostgreSQL)
tests/golden/        Verified tax fixtures        (Phase 4+)
tests/e2e/           Full browser flows           (Phase 12)
```

Unit tests cover money arithmetic, environment validation, error handling, logger redaction,
validation helpers, health payloads, SEO helpers, and the Phase 2 rule categories, payload
schemas, lifecycle, verification semantics, validation and resolution.

Integration tests run against a real PostgreSQL database and cover schema integrity,
effective-date versioning, the overlap exclusion constraint, source traceability, NUMERIC
precision, conflicts, audit immutability and deletion safeguards.

**Integration suites skip when `DATABASE_URL` is unset**, so `npm test` still works without
PostgreSQL. Run `npm run test:db` to execute them explicitly.

**No test contains a tax rate, bracket, threshold or wage base.** Tax fixtures must come from
verified official sources and are introduced with the engine (spec §61; CLAUDE.md §4, §9).
Never invent a tax value to make a test pass.

---

## 9. Troubleshooting

**`Invalid environment configuration: NEXT_PUBLIC_SITE_URL must not end with "/"`**
Remove the trailing slash. Canonical URL building appends it.

**`DATABASE_URL is required when NODE_ENV=production`**
Server-side code ran with `NODE_ENV=production` and no `DATABASE_URL`. Set it, or use
`NODE_ENV=development` locally. Builds do not need it — only runtime does.

**`/api/health/db/` returns `connection_failed`**
`DATABASE_URL` is set but unreachable. Confirm PostgreSQL is running and the host, port,
credentials and database name are correct. The endpoint deliberately returns only a
classification — check server logs for detail.

**`/api/health/db/` returns `unconfigured`**
`DATABASE_URL` is not set. Expected before you provision a database.

**Prisma: `The datasource property 'url' is no longer supported in schema files`**
Prisma 7 moved it. The URL belongs in `prisma.config.ts` — see §4.

**Type errors mentioning `lib/db/generated`**
The client is missing or stale. `npm install` normally generates it via `postinstall`, so this
usually means the schema changed since — run `npm run db:generate`. (If you installed with
`--ignore-scripts`, `postinstall` did not run and you must generate it manually.)

**Editor cannot resolve `@/...` imports**
`@/*` maps to the repository root (`tsconfig.json`). Restart the TypeScript server.

**404 on a URL without a trailing slash**
Expected: `trailingSlash: true`. Next.js redirects; use the trailing-slash form directly.

**`23P01` / "conflicting key value violates exclusion constraint"**
Two ACTIVE versions of the same `ruleKey` cover the same period. Supersede the previous
version instead of adding a second active one — see `docs/DATA-MODEL.md` §4.

**`P2003` / foreign key constraint failed on delete**
Expected: jurisdictions, tax years and sources referenced by rules cannot be deleted.
Deactivate or archive them instead — see `docs/DATA-MODEL.md` §11.

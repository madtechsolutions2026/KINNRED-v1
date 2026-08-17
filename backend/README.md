# Kinnred backend

NestJS API for Kinnred. See [`../CLAUDE.md`](../CLAUDE.md) for architecture and safety rules,
[`../BACKEND_PLAN.md`](../BACKEND_PLAN.md) for the service-by-service build order, and
[`../DECISIONS.md`](../DECISIONS.md) for why things are the way they are.

**Current state: S7 complete.** Auth, Media, Myspace, Verification, Pings, Visibility and Grid have
shipped — Circles (S8) is next.

Three secrets have no defaults and the app will not boot without them: `JWT_SECRET`,
`KYC_WEBHOOK_SECRET`, and `GRID_LOCATION_SALT`. Generate each one; do not invent them. The last
seeds the per-user location offset, so anyone who learns it can subtract the fuzzing and recover
exact positions (CLAUDE.md §2.2).

---

## Local setup

Requires Docker Desktop. Everything else is handled by compose.

### 1. Start infrastructure

```sh
cd backend
docker compose up -d
docker compose ps        # both should read "healthy"
```

| Service | Image | Host port |
|---|---|---|
| PostgreSQL 17 + PostGIS 3.5 | `postgis/postgis:17-3.5-alpine` | **5433** |
| Redis 8 | `redis:8-alpine` | **6380** |

**The non-default ports are deliberate.** They keep the stack from colliding with any Postgres or
Redis already installed on the host. If a query ever behaves inexplicably, confirm which instance
you are actually connected to before debugging anything else.

PostGIS ships inside the image — there is no separate extension install step.

### 2. Configure environment

```sh
cp .env.example .env
```

The defaults already point at the compose services, so this works as-is for local dev. The Postgres
password is the throwaway one from `docker-compose.yml`.

**Never paste real credentials into a chat or commit them** — `.env` is gitignored (DECISIONS.md
D-010). This matters more as the project accumulates JWT keys, KYC vendor keys, and S3 credentials.

### 3. Install and migrate

```sh
npm install
npm run db:generate
npm run db:migrate
```

The `kinnred` database is created by compose. The first migration enables PostGIS.

---

## Running

Two processes, by design (DECISIONS.md D-002) — workers are separate so CPU-bound image work
cannot starve API request handling.

```sh
npm run start:dev          # API on http://localhost:3000
npm run start:worker:dev   # queue worker (idle until S2 adds consumers)
```

Verify:

```sh
curl http://localhost:3000/health          # {"status":"ok"} — public, status only
curl http://localhost:3000/health/detail   # full detail, NOT for public exposure
```

`/health` returns **503** if Postgres or Redis is unreachable, or if PostGIS is missing.

---

## Commands

| Command | Purpose |
|---|---|
| `npm run start:dev` | API with watch mode |
| `npm run start:worker:dev` | Queue worker with watch mode |
| `npm run build` | Compile to `dist/` |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint with `--fix` |
| `npm test` | Jest unit tests |
| `npm run db:generate` | Regenerate Prisma client into `src/generated/` |
| `npm run db:migrate` | Create + apply a migration (dev) |
| `npm run db:deploy` | Apply migrations (production) |
| `npm run db:studio` | Prisma Studio |

---

## Layout

```text
src/
  common/
    filters/          # global exception filter (no stack traces to clients)
    logging/          # Pino config + PII redaction paths
  config/             # Zod env schema, validated at boot, fail-fast
  health/             # /health + /health/detail, DB + PostGIS + Redis
  prisma/             # PrismaService (driver-adapter based)
  queue/              # BullMQ setup, queue names, default job options
  redis/              # shared ioredis client
  generated/          # Prisma client — GENERATED, gitignored, do not edit
  main.ts             # API entrypoint
  worker.ts           # queue worker entrypoint
prisma/
  schema.prisma       # models + PostGIS extension declaration
prisma.config.ts      # Prisma 7 CLI config (connection URL lives here)
```

---

## Gotchas worth knowing

- **Prisma 7 is not Prisma 6.** Connection config is in `prisma.config.ts` (not `schema.prisma`), a
  driver adapter is mandatory, and the generator emits TypeScript rather than compiled JS.
- **`src/generated/` is gitignored.** A fresh clone must run `npm run db:generate` before anything
  typechecks.
- **`prisma.config.ts` is excluded from `tsconfig.build.json`.** Including it moves the inferred
  `rootDir` and produces `dist/src/main.js` instead of `dist/main.js` — which breaks `start:prod`
  in production only. Do not "tidy" that exclude away.
- **The app refuses to boot on a bad `.env`.** That is intentional, not a bug.

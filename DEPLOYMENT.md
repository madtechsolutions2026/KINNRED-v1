# Deployment & transport security

What protects data **in transit** and **at rest**, what is wired vs. what is a
setting you flip on the host, and what is still open. This is the "TLS and
stuff" layer — deliberately *not* end-to-end encryption (see the note at the
end).

Operational how-to lives in [`backend/deploy/README.md`](backend/deploy/README.md).
Rationale is [DECISIONS.md D-059](DECISIONS.md).

---

## 1. TLS in transit — DONE

**Terminated at a reverse proxy, not in the app.**
[`backend/deploy/Caddyfile`](backend/deploy/Caddyfile) + Caddy in
[`docker-compose.prod.yml`](backend/deploy/docker-compose.prod.yml):

- Caddy listens on `:443` (+ HTTP/3) and redirects `:80` → `:443`.
- The certificate is fetched and renewed **automatically** from Let's Encrypt —
  no cert file, no renewal cron. It lives in the `caddy-data` volume, which must
  persist.
- Caddy forwards cleartext to `api:3000` over the private compose network. The
  API container is `expose`d, never `ports:` — unreachable from the host.

**The app is proxy-aware.** [`src/main.ts`](backend/src/main.ts):

- `app.set('trust proxy', config.TRUST_PROXY)` — set `TRUST_PROXY=1` in
  production (one hop: Caddy). Without it every request looks like it comes from
  Caddy's IP and the **per-IP `ThrottlerGuard` collapses into one shared
  bucket** — the OTP and write-endpoint rate limits stop working. `req.protocol`
  also stays `http`, breaking any "is this HTTPS?" check.
- The env schema **rejects `TRUST_PROXY=true` in production** — that trusts
  `X-Forwarded-For` from *anyone*, letting a client claim any IP.
- **HSTS** via helmet: `max-age=1y; includeSubDomains; preload` in production,
  **off** in dev (so a browser hitting `http://localhost` is never pinned to
  HTTPS on that host). Caddy sets it on its own responses too.
- Other headers (`X-Content-Type-Options`, frame options, etc.) come from
  `helmet()`, which was already wired.

## 2. Encryption at rest — HOST SETTING, not app code

The app stores plaintext in Postgres and objects in R2/S3. At-rest protection is
a property of those services:

| Store | How | Where |
|---|---|---|
| Postgres | Enable storage encryption | RDS: "Encryption" checkbox at create · Cloud SQL: on by default · self-managed: LUKS on the data volume |
| Redis | Enable encryption at rest + in transit | ElastiCache / Upstash setting |
| Object storage (R2 / S3) | On by default (SSE) | Confirm bucket policy; KYC bucket separately (CLAUDE.md §2.4) |
| Backups | Encrypt snapshots too | Same provider settings — an unencrypted backup defeats an encrypted DB |

There is nothing to build here — but it is **not done until the checkboxes are
ticked on the real services**, and that is outside this repo.

## 3. Access control — MOSTLY DONE (app), host work remains

Already enforced in code:

- Global `JwtAuthGuard` — every route needs a bearer token unless `@Public()`.
- `VisibilityService` (photo lock), `BlocksService` (symmetric blocks), incognito
  circles — all server-side, on every read.
- `ValidationPipe` with `whitelist` + `forbidNonWhitelisted` — no field
  smuggling into Prisma.
- Rate limiting: per-IP throttle + per-identity Redis counters (OTP, pings).
- Secrets validated at boot with hard minimums (`JWT_SECRET`,
  `KYC_WEBHOOK_SECRET`, `GRID_LOCATION_SALT` — all ≥32 chars, no defaults).

Host-side, still to do:

- **Least-privilege DB credentials** — the app's DB user needs DML only, not
  `SUPERUSER` / `CREATEDB`. Migrations can run as a separate, higher-privilege
  user in the one-shot `migrate` step.
- **Secrets manager** — `.env.prod` on disk is the starting point; move to
  the platform's secret store (SSM, Secret Manager, Doppler) before real users.
- **Network** — DB/Redis reachable only from the app's subnet/security group,
  never the public internet.
- **KYC bucket** — its own IAM policy + a retention/deletion lifecycle
  (CLAUDE.md §2.4) — compliance obligation, not optional.

## 4. Deploy mechanics — DONE

- **One image** ([`backend/Dockerfile`](backend/Dockerfile)), multi-stage,
  runs as a **non-root user**, carries only `dist/` + `node_modules` + the
  Prisma schema/migrations.
- **Migrations on deploy**: a one-shot `migrate` service runs
  `prisma migrate deploy` to completion; `api` and `worker` wait for it. New
  migrations apply automatically on redeploy.
- **Graceful shutdown**: `enableShutdownHooks()` drains Prisma/Redis on SIGTERM.
- **Health**: bare `/health` (DB + Redis reachability) — Caddy uses it for
  upstream health checks; point the platform's liveness probe at it too.

---

## Still open (tracked in CLAUDE.md §6 / BACKEND_PLAN.md S11)

- **Admin identity model** — `POST /verification/:id/decide` is still a shared
  `x-admin-token`. Close before real users.
- **The at-rest checkboxes** — must be verified on the actual managed services.
- **Secrets manager + least-privilege DB user** — `.env.prod` is a bootstrap,
  not a destination.
- **CI/CD** — the redeploy flow is manual (`git pull` + `compose up --build`).
- **Structured log shipping + PII-redaction audit** (S11).

## What this is NOT

This layer makes the *pipe* and the *disk* safe and locks down *who can call
the API*. It does **not** stop the server itself from reading message content —
that would be **end-to-end encryption**, which is a months-long change living
mostly in the (not-yet-built) mobile client, and it removes server-side
previews, search, and moderation. It is a separate, deliberate product decision,
not part of this checklist.

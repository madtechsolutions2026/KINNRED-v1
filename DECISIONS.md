# Decision log

Running record of every non-obvious choice made while building Kinnred, with the reasoning and
what would make us revisit it. Newest service at the bottom. If a decision here is reversed,
don't delete it — mark it **superseded** and link to the one that replaced it.

Format: what we chose, why, what we rejected, and the trigger that should make us change our mind.

---

## S0 — Platform foundation

### D-001 · Local infra runs natively on Windows, not in Docker
**Status:** ⛔ **SUPERSEDED by [D-014](#d-014--reversed-local-infra-runs-in-docker-after-all)** — kept because the reasoning still explains the compose file's shape
**Date:** 2026-08-17

Postgres 17 is already installed and running natively; PostGIS and Redis are not, and there is no
Docker and no WSL distro on the machine.

Measured before deciding: **C: has 16.4 GB free of 237 GB (6.9%)**. Docker Desktop would cost
~5–6 GB (app ~2.5 GB, WSL2 + docker-desktop distro ~1.5 GB, `postgis/postgis` ~1 GB, redis ~50 MB),
and WSL2's `ext4.vhdx` grows without shrinking back. Native PostGIS + Memurai costs ~200 MB.

**Chosen:** add PostGIS to the existing PG17, add Memurai for Redis. ~25× less disk.

**Why this is low-risk for *this* project specifically:** native PostGIS is the same PostGIS —
`ST_DWithin`, GIST, and the `geography` type behave identically to the container. The spatial layer
is where correctness matters most here, and it carries no divergence.

**The residual risk is Redis, not Postgres.** Memurai is a Redis-compatible reimplementation, not
Redis. Our usage (BullMQ, presence, pub/sub, rate-limit counters) is well within what it emulates,
but it is the one component to re-verify against real Redis before production.

**Rejected:** Docker Desktop (disk), WSL2-direct (same reboot cost, less reproducible without a
compose file driving it), defer-and-build-blind (S0 would end unverified, which defeats the point
of S0).

**Still shipping `docker-compose.yml` regardless** — it costs nothing, it is an S0 deliverable, and
it is what CI, production, and any future teammate will use. Native is how *this machine* runs it,
not how the project is defined.

**Revisit when:** C: has >40 GB free, or a second developer joins, or Memurai shows any behavioural
gap under BullMQ.

**Update (same day), verified state after investigating:**
- Postgres **17.6** running natively on 5432. ✅
- **Memurai was already installed and running** on 6379 — v8.1.240, reporting `redis_version:8.2.5`,
  replies `PONG`. The Redis half of this decision cost us nothing; it was already there.
- **PostGIS is the only actual gap.** PG17 ships 62 extensions but only `cube` and `earthdistance`
  are geo-adjacent, and neither is sufficient — no `geography` type, no GIST spatial index, no
  `ST_DWithin`. Installing via **StackBuilder** (already present at
  `C:\Program Files\PostgreSQL\17\bin\stackbuilder.exe`), which matches the PostGIS build to PG17.
  No winget package exists for it, so this step is a manual GUI install requiring elevation.

---

### D-002 · BullMQ workers run as a separate process, not in-process with the API
**Status:** accepted
**Date:** 2026-08-17

Two entrypoints (`main.ts`, `worker.ts`) sharing the same Nest modules.

**Why:** four later services push work to the queue — LLM categorization (S8), KYC webhooks (S4),
push dispatch (S10), and image derivative generation (S2). Image work in particular is CPU-bound
and would compete with the Node event loop serving API requests. Separate processes also scale
independently.

**Rejected:** in-process (simplest, but starves request handling under load) and
in-process-now-split-later (the extraction is exactly the refactor that gets deferred forever once
four services depend on the queue).

**Cost accepted:** slightly heavier dev ergonomics — two processes to run locally.

**Revisit when:** never expected to reverse; this is a one-way door we chose deliberately.

---

### D-003 · Zod for env validation, not Joi
**Status:** accepted
**Date:** 2026-08-17

`@nestjs/config` supports Joi natively via `validationSchema`, so Joi is the path of least
resistance. Chose Zod anyway and wired it through the `validate` callback (a ~10-line adapter).

**Why:** Zod infers a real TypeScript type from the schema, so config access is typed end-to-end
instead of `ConfigService.get<string>('KEY')` with a hand-maintained generic that silently drifts
from the schema. Given CLAUDE.md requires boot-time fail-fast on env, the schema *is* the contract —
having the type derive from it removes a whole class of "typo'd key returns undefined" bugs.

**Rejected:** Joi (native support, but no type inference; its TS types are hand-written and weak).

**Revisit when:** never expected; the adapter is trivial and isolated to one file.

---

### D-004 · Pino (`nestjs-pino`) as the logger, replacing Nest's default
**Status:** accepted
**Date:** 2026-08-17

**Why:** two requirements in the plan make this near-mandatory rather than a preference.
1. **PII redaction** (BACKEND_PLAN S11). This app logs around phone numbers, exact coordinates,
   JWTs, and KYC provider refs. Pino has `redact` as a first-class config option. Retrofitting
   redaction onto `console`-style logging means auditing every call site, forever.
2. **Request correlation IDs** (S0 requirement). `pino-http` generates and propagates them per
   request automatically; the default Nest logger has no request scope.

Structured JSON also means production logs are queryable without a parsing layer.

**Cost accepted:** logs are JSON and unreadable raw in dev — mitigated with `pino-pretty`, dev only.

**Redaction is configured now, not at S11.** A redaction list added after the fact is a list of
leaks you already shipped.

---

### D-005 · `@nestjs/terminus` for health checks, and `/health` stays shallow
**Status:** accepted
**Date:** 2026-08-17

Terminus gives proper 503-vs-200 semantics and ready-made DB/Redis indicators, which the S0
"done when" requires (health must prove DB **and** Redis reachable, not just process liveness).

**Second, separate decision:** the public `/health` returns **status only** — no versions, no
connection targets, no error strings. Terminus's default response echoes indicator detail, which on
an unauthenticated endpoint is free reconnaissance (DB reachable? what version? what host?).
Detailed output lives behind `/health/detail`, which is not exposed publicly.

**Revisit when:** adding a load balancer or k8s probes — split into `/health/live` (process only)
and `/health/ready` (dependencies), since a liveness probe that fails on a DB blip causes a restart
loop that makes the outage worse.

---

### D-006 · PostGIS columns via Prisma `Unsupported` + hand-written migration SQL
**Status:** accepted
**Date:** 2026-08-17

Prisma has no native `geography` type. Approach:
- Declare the extension in the datasource block using the `postgresqlExtensions` preview feature,
  so `postgis` is managed by Prisma migrations rather than an out-of-band `CREATE EXTENSION`.
- Model the column as `Unsupported("geography(Point, 4326)")` — Prisma tracks its existence but
  cannot read or filter it.
- **The GIST index is hand-written in the migration.** Prisma will not generate a spatial index, and
  without it `ST_DWithin` degrades to a sequential scan, which is exactly the "Postgres spikes"
  failure mode CLAUDE.md §4 is written to avoid.
- All spatial reads go through `$queryRaw` tagged templates (CLAUDE.md §3).

**Consequence to remember at S7:** because the column is `Unsupported`, Prisma's generated client
cannot select it. Every geo read is raw SQL by necessity, not by preference — so the injection
discipline is not optional there.

---

### D-007 · API is versioned from the first commit: `/api/v1`
**Status:** accepted
**Date:** 2026-08-17

A global prefix plus URI versioning, set up now while there is exactly one consumer and zero
endpoints.

**Why now:** the mobile client (Phase 2) ships to app stores, and store-installed clients cannot be
force-upgraded — old versions keep calling old routes for months. Adding versioning after the first
release means either breaking those clients or maintaining an unversioned legacy surface forever.
It costs one line today.

`/health` is deliberately excluded from the prefix so infrastructure probes are not version-coupled.

---

### D-008 · On Prisma 7 (7.9.1), and what it changed under us
**Status:** accepted (forced by the installed major)
**Date:** 2026-08-17

`npm install prisma` resolved to **7.9.1**, not the 6.x most existing documentation assumes. Ran
`prisma init` and read the output rather than writing a v6-shaped schema from memory. Three
breaking differences that matter:

1. **The datasource block no longer takes `url`.** Connection config moved to a new
   `prisma.config.ts` at the package root, which reads `process.env` via an explicit
   `import "dotenv/config"`. Consequence: **`dotenv` is now a required devDependency** — without it
   the Prisma CLI sees no `DATABASE_URL` and fails in a way that looks like a bad connection string
   rather than a missing import.
2. **The generator is `prisma-client`, not `prisma-client-js`**, and `output` is mandatory. The
   client generates to `backend/generated/prisma` (gitignored) instead of into `node_modules`.
3. `prisma init` also installed **9 Prisma agent-skills into three separate directories**
   (`.claude/skills/`, `.agents/skills/`, `.windsurf/skills/`) plus a `skills-lock.json`. Kept
   `.claude/skills/` — these are genuinely useful given v7 is new and its docs are thin — and
   deleted the `.agents/` and `.windsurf/` copies as unused duplicates.

**Note for later:** verify whether `postgresqlExtensions` is still a preview feature in v7 before
relying on Prisma to manage the PostGIS extension (D-006). If it is not, `CREATE EXTENSION postgis`
goes in a hand-written migration instead. **Do not assume — check.**

---

### D-009 · Prisma schema at `backend/prisma/`, PrismaService at `backend/src/prisma/`
**Status:** accepted — supersedes the repo layout drawn in CLAUDE.md §3
**Date:** 2026-08-17

CLAUDE.md's layout put everything Prisma under `src/prisma/`. Splitting it instead:

- **`backend/prisma/`** — `schema.prisma` + `migrations/`. This is Prisma's tool default, it is
  where the generated `prisma.config.ts` already points, and — the actual technical reason —
  `src/` is the Nest compilation root. A `.prisma` file there is a non-TypeScript artifact sitting
  in the build path, which forces asset-copying rules into `nest-cli.json` for no benefit.
- **`backend/src/prisma/`** — `PrismaModule` / `PrismaService`. These *are* TypeScript and *are*
  Nest providers, so they belong in the compilation root.

**Action:** CLAUDE.md §3's layout diagram must be corrected to match. A layout doc that disagrees
with the filesystem is worse than no layout doc.

---

### D-010 · The Postgres password is never entered into the assistant transcript
**Status:** accepted — standing practice, applies to all future secrets
**Date:** 2026-08-17

`pg_hba.conf` is `scram-sha-256`, so local Postgres requires a password. It is filled into
`backend/.env` by hand and never pasted into chat.

Where a command needs it, it is sourced rather than interpolated:

```sh
set -a; . ./.env; set +a; psql "$DATABASE_URL" -c '...'
```

**Why:** anything typed into the conversation lives in the transcript indefinitely and is not
recoverable once said. `.env` is already gitignored, so the credential stays in exactly one place.
This generalises to every secret this project will accumulate — JWT signing keys, the KYC vendor
key, S3/R2 credentials, FCM/APNs keys.

---

### D-011 · Backend stays CommonJS; Prisma's generator is pinned to match
**Status:** accepted
**Date:** 2026-08-17

Two defects surfaced from Prisma 7's generated client. Both were found by reading the generated
output, not by hitting them at runtime — worth noting because neither produces an obvious error
message when it bites.

**Problem 1 — the generated client is ESM-first.** It emitted `import.meta.url`, which is a hard
error in a CommonJS build, and NestJS scaffolds as CommonJS.
- **Rejected:** converting the backend to ESM. NestJS 11 supports it, but decorator metadata and
  `ts-jest` under ESM are both rough edges, and we would be adopting that risk across the whole
  10-service build to satisfy one dependency.
- **Chosen:** `moduleFormat = "cjs"` in the generator block. Verified `import.meta` occurrences
  dropped to zero after regenerating.

**Problem 2 — generated output location silently breaks the production build.** Prisma 7 emits
**TypeScript**, not compiled JS. With the default `output = "../generated/prisma"` (outside `src/`),
`tsc` infers `rootDir` as the longest common prefix of its inputs — `backend/` — and emits
`dist/src/main.js` rather than `dist/main.js`. `npm run start:prod` (`node dist/main`) would then
fail **only in production**, with a missing-module error that points nowhere near Prisma.
- **Chosen:** generate to `../src/generated/prisma`, keeping every compiled input under `src/` so
  the inferred root stays stable. Added `src/generated/` to `.gitignore`.

**Standing lesson for the rest of this build:** Prisma 7 is recent enough that most available
documentation describes v6. Read generated output and package internals before trusting recalled
API shapes. The same caution applied to Terminus paid off — v11 replaced the `HealthIndicator`
base-class API with an injected `HealthIndicatorService`.

**Confirmed by the build, not by reasoning.** The first `npm run build` did emit `dist/src/main.js`
with no `dist/main.js` — though via a cause not anticipated above: `prisma.config.ts` sits at the
package root and was itself a compilation input, which was enough to move the inferred root even
after the generated client had been relocated into `src/`. Fixed by excluding `prisma.config.ts` in
`tsconfig.build.json`; it is a CLI config loaded directly by Prisma and is not part of the app
build. Verified `dist/main.js` and `dist/worker.js` now exist at the expected paths.

---

### D-012 · Prisma runs through the `@prisma/adapter-pg` driver adapter
**Status:** accepted (required by Prisma 7)
**Date:** 2026-08-17

Prisma 7 makes a **driver adapter mandatory** — the client's type definitions state one is required
unless connecting through Prisma Accelerate. Installed `@prisma/adapter-pg` (+ `pg`, `@types/pg`),
constructed in `PrismaService` as
`new PrismaClient({ adapter: new PrismaPg({ connectionString }) })`.

**Not a workaround — this is now the supported path**, and it happens to suit this project:
queries run through node-postgres rather than the bundled Rust engine, which means the raw
`$queryRaw` PostGIS work in S7 sits on a plain, well-understood Postgres driver.

**Consequence:** `DATABASE_URL` is consumed **twice, by two different mechanisms** — by
`prisma.config.ts` for CLI operations (migrate, generate, studio) and by the driver adapter at
runtime. Both read the same `.env`, so they cannot drift, but anyone debugging a connection problem
needs to know which of the two is failing.

---

### D-013 · `/health` reports PostGIS presence, not just database reachability
**Status:** accepted
**Date:** 2026-08-17

The database indicator checks two things that fail independently: that the connection can execute
a statement, and that `postgis` appears in `pg_extension`.

**Why the second check exists:** a reachable Postgres *without* PostGIS is a silent trap. The app
boots perfectly, every health check passes, and the failure surfaces much later as
`function st_dwithin does not exist` from inside a Grid query — an error that points nowhere near
the actual cause. This is not hypothetical: the dev machine's Postgres 17 is in exactly that state
right now, with PostGIS pending a manual StackBuilder install.

Redis's indicator likewise reports the reported `redis_version`, because local dev runs Memurai
rather than Redis (D-001) and knowing which one answered has already been useful.

Both details appear only on `/health/detail`; the public `/health` still returns status alone
(D-005).

---

### D-014 · REVERSED: local infra runs in Docker after all
**Status:** accepted — supersedes [D-001](#d-001--local-infra-runs-natively-on-windows-not-in-docker)
**Date:** 2026-08-17

The user chose to install Docker Desktop, overriding D-001's disk-driven conclusion. Recording the
reversal rather than rewriting D-001, because the disk constraint was real and the reasoning is
what explains why `docker-compose.yml` looks the way it does.

**What actually happened:**
- Docker Desktop installed **per-user** to `%LOCALAPPDATA%\Programs\DockerDesktop`, not the usual
  `C:\Program Files\Docker`. Docker **29.7.2**, Compose **v5.3.1**, WSL2 backend.
- The install consumed ~7 GB, taking C: from 16.4 GB free down to **9.3 GB (3.9%)** — worse than
  the ~5–6 GB estimated in D-001. Work paused; the user reclaimed space to 21.8 GB (9.2%).
- Switched the Postgres image to **`postgis/postgis:17-3.5-alpine`** (~400 MB vs ~1 GB+) given the
  remaining headroom is still modest. Same PostGIS build, smaller base.

**What this decision bought us:** PostGIS ships inside the image, so the manual StackBuilder GUI
install disappeared entirely — that was the most awkward remaining setup step, and it is now gone
for every future machine too.

**Ports:** compose binds **5433** and **6380**, exactly as D-001 anticipated, so the native
Postgres 17 and Memurai still on 5432/6379 do not collide. `.env` now points at the containers.
⚠️ Two Postgres instances now run on this machine. If a query behaves inexplicably, check which
one you are connected to before debugging anything else.

**Verified working:** PostgreSQL 17.11 (alpine/musl) + PostGIS 3.5.7, Redis 8.10.0, both healthy;
`ST_DWithin` confirmed callable against real `geography` points.

**Two setup gotchas worth remembering:**
1. Invoking `docker.exe` by absolute path fails with
   `error getting credentials - docker-credential-desktop not found in %PATH%`. The credential
   helper is resolved via PATH, so Docker's `resources\bin` must be *on* PATH — not merely
   addressed directly.
2. The `postgis/postgis` image's init script creates **four** extensions (`postgis`,
   `postgis_topology`, `fuzzystrmatch`, `postgis_tiger_geocoder`). Declaring only `postgis` in
   `schema.prisma` makes Prisma treat the other three as drift and demand a database reset on
   **every** migrate. All four are now declared so the schema matches the image. Only `postgis` is
   actually used by the Grid.

---

### D-015 · Excluding a route from the API prefix requires opting out of versioning too
**Status:** accepted
**Date:** 2026-08-17

`setGlobalPrefix('api', { exclude: [...] })` alone was **not** sufficient to serve health at bare
`/health`. URI versioning is applied independently, so the route still resolved under the versioned
surface and `/health` returned 404 while the startup log cheerfully reported
`HealthController {/api/health} (version: 1)`.

**Fix — both, together:**
- `exclude` entries given as `{ path, method: RequestMethod.GET }` objects rather than bare strings.
- `@Controller({ path: 'health', version: VERSION_NEUTRAL })` on the controller.

**Why it matters beyond health:** this is the same trap for any future infrastructure route —
metrics, readiness probes, webhook receivers. A probe URL that shifts when the API version changes
is a probe that silently starts 404ing after a deploy, and the health check reporting "fine"
because nothing is calling it is precisely the failure you cannot afford in a monitoring endpoint.

---

### D-016 · Boot failures must print something
**Status:** accepted — found by testing, not by review
**Date:** 2026-08-17

`NestFactory.create(AppModule, { bufferLogs: true })` buffers startup logs until `useLogger()`
attaches Pino. If `create()` itself throws — unreachable database, bad Redis host — that line is
never reached, the buffer is discarded, and **the process exits having printed absolutely nothing**.

Observed directly during S0: with an unreachable database the API died silently, with an exit code
that a container runtime reads as a clean shutdown.

**Fix:** both entrypoints now `.catch()` at the top level, write the stack to `console.error`
(deliberately *not* a logger — at that point no working logger is guaranteed to exist), and
`process.exit(1)` so orchestrators see a real failure.

**Confirmed working:** a subsequent port conflict produced
`FATAL: API failed to start. Error: listen EADDRINUSE :::3000` with a full stack, where the same
class of failure had previously produced silence.

**Keep this in mind for S1 onward:** `bufferLogs` is worth having for clean structured startup
logs, but it trades away early-failure visibility unless this guard is present. Do not remove it.

---

## S1 — Auth

### D-017 · Gender is an enum; photo-lock is a SEPARATE column
**Status:** accepted — **user decision**, safety-critical
**Date:** 2026-08-17

`Gender` is `FEMALE | MALE | NON_BINARY | PREFER_NOT_TO_SAY`. Photo-lock is its own boolean,
`User.photosLocked`, seeded from gender at signup (`true` for FEMALE and NON_BINARY) and owned by
the user thereafter.

**Why not derive the lock from gender on every read** — the literal reading of CLAUDE.md §2.1:
1. It makes `PREFER_NOT_TO_SAY` an unanswerable question *inside the security path*. There is no
   correct default when the field is deliberately absent, and a security check with an ambiguous
   input is a bug waiting to be discovered by a user.
2. It denies privacy to anyone the rule does not happen to name. A man with a stalker cannot lock
   his photos.
3. It forces every read path to re-derive the rule, which is exactly how the same rule ends up
   implemented four slightly different ways — the failure mode S6's `VisibilityService` exists to
   prevent.

**Database default is `true` — fail closed.** A row inserted without an explicit value is LOCKED.
The gender-based seeding lives in `AuthService`; the column default only governs what happens if
that logic is ever bypassed, and the safe answer there is "locked".

**Consequence for S6:** `VisibilityService` reads `photosLocked`, never `gender`. Gender remains a
Grid *filter*, not an authorisation input.

---

### D-018 · scrypt (Node built-in) for hashing, not argon2 or bcrypt
**Status:** accepted
**Date:** 2026-08-17

Both alternatives are native modules requiring a compile toolchain — a recurring source of failure
on Windows, and an install-time risk on every CI machine and deploy image. `crypto.scrypt` is built
into Node, is a memory-hard KDF, and is entirely adequate here.

**Two hashing strategies, deliberately different** (`common/crypto/secret-hash.ts`):

| | OTP codes | Refresh tokens |
|---|---|---|
| Entropy | ~10⁶ (6 digits) | 256 bits |
| Hash | **scrypt + random salt** | **SHA-256, unsalted** |
| Why | trivially enumerable against a fast hash | brute force already infeasible |

SHA-256 for refresh tokens is not a weaker shortcut — it is **required**. Tokens are looked up *by
hash* on refresh, which needs a deterministic, indexable digest. A per-row random salt would make
that lookup impossible.

Comparison is `timingSafeEqual`; `===` leaks how many leading characters matched.

---

### D-019 · Mock SMS provider that refuses to run in production
**Status:** accepted — **user decision**
**Date:** 2026-08-17

`MockSmsProvider` writes the OTP to the log behind the `SMS_PROVIDER` token, so the whole flow is
testable today with no vendor account. Especially relevant in India, where DLT template
registration takes days.

**It throws at construction if `NODE_ENV === 'production'.`** Logging a live login code is a
credential leak into log storage — and logs get shipped to third-party aggregators, retained for
months, and read by people who should not be able to log in as your users. A refusal to boot is
enormously preferable to discovering this via a log search.

---

### D-020 · The auth guard does NOT hit the database
**Status:** accepted — has consequences every later service must respect
**Date:** 2026-08-17

`JwtAuthGuard` verifies the signature, checks the token type, and attaches `{ userId }`. It does
not load the user, because that would add a query to every request.

**The consequence, which is the important part:** claims are a snapshot up to `JWT_ACCESS_TTL`
(15m) old. Any authorisation decision depending on state that can *change* —
- `isVerified` (gates circle creation in S8 and elevated viewing in S6),
- `photosLocked`,
- block lists

— **must read the database at the point of decision**. Never put these in the token, and never
trust a cached copy. A 15-minute-stale `isVerified` is a 15-minute window of unearned privilege.

---

### D-021 · Global fail-closed auth guard with explicit `@Public()` opt-out
**Status:** accepted
**Date:** 2026-08-17

`JwtAuthGuard` is registered as an `APP_GUARD`, so **every route is protected unless it opts out**.

**Why this direction:** forgetting to add a guard silently exposes an endpoint and nothing
complains. Forgetting `@Public()` produces a loud 401 in development. Given this codebase gates
locked photos and precise location, the failure mode we can afford is the noisy one.

Five `@Public()` routes exist today, all in auth, all necessarily reachable without a token because
they are how a token is obtained. Each is a deliberate hole in the auth surface — keep them
countable.

---

### D-022 · Registration ticket, with a `typ` claim on every token
**Status:** accepted
**Date:** 2026-08-17

OTP verification consumes the code. If the number has no account yet we cannot simply ask for the
code again — it is spent — so `/auth/otp/verify` returns a short-lived (10m) **registration
ticket** which `/auth/register` exchanges for an account.

The phone number comes from the *signed ticket*, never from the request body. That is what stops a
caller registering someone else's number.

**Every token carries a `typ` claim, checked on every verify path.** Without it the guard would
happily accept a registration ticket as an access token — handing full authenticated access to
anyone who merely passes OTP, with `sub` undefined. Verified by test: the guard rejects a
registration ticket with 401.

---

### D-023 · Two independent rate-limit layers on OTP
**Status:** accepted
**Date:** 2026-08-17

1. **Per-IP** — `ThrottlerGuard`, 5/min on `otp/request`.
2. **Per-phone** — 3/hour, counted in **Redis** (`AuthService.enforcePerPhoneRateLimit`).

Neither replaces the other. Per-IP alone is defeated by rotating IPs while still billing us for a
message every time; per-phone alone does nothing against an attacker walking many numbers. The
per-phone cap is the one that actually protects SMS spend.

The window TTL is set only on the first increment, so a burst cannot keep pushing the expiry out
and reset its own budget.

⚠️ **Known gap:** `ThrottlerModule` uses in-memory storage, so the per-IP limit is per-instance —
the effective limit becomes (limit × instances) once scaled horizontally. Must move to Redis-backed
storage before running more than one API process. The per-phone cap is already correct across
instances.

**Also note:** guards run *before* validation pipes in Nest, so a throttled request returns 429
before a malformed body returns 400. This surfaced as two confusing smoke-test failures and is
correct behaviour, not a bug.

---

### D-024 · Auth endpoints reveal nothing about who is registered
**Status:** accepted
**Date:** 2026-08-17

- `/auth/otp/request` returns an **identical response** whether or not the number has an account.
- `/auth/otp/verify` returns **one generic message** for every failure — wrong code, expired code,
  no code requested, attempts exhausted.
- `/auth/logout` is a silent no-op on an unknown token.
- The guard never echoes the underlying JWT error ("expired" vs "bad signature" aids a forger).
- `/auth/me` uses an explicit `select` that **omits `phone` entirely**.

Together these prevent the auth surface from becoming an oracle for "is this person on Kinnred?" —
which for a proximity-based social app is a safety question, not merely a privacy one.

---

### D-025 · HS256 for now, and the trigger to revisit
**Status:** accepted
**Date:** 2026-08-17

Symmetric signing is correct while a single service both issues and verifies tokens, and it is one
less key-management problem.

**Revisit when** a second service needs to *verify* tokens without holding the power to *mint*
them — that is the point at which RS256's asymmetry earns its complexity, and not before.

`JWT_SECRET` has **no default and a 32-character minimum**, enforced at boot. A signing key with a
fallback default is the most dangerous kind of config: every deployment that forgets to set it
shares one key, and anyone who can read the source can mint tokens for any user.

---

## S2 — Media

### D-026 · Storage is vendor-neutral by construction: MinIO locally, Cloudflare R2 in production
**Status:** accepted — **user decision** (R2 now, swappable later)
**Date:** 2026-08-17

Cloudflare R2 is the production target. Rather than assert portability, the setup makes it
mechanically true:

- Env vars are named **`STORAGE_*`, not `R2_*`**, with an explicit `STORAGE_ENDPOINT`.
- Access goes through `@aws-sdk/client-s3` with `forcePathStyle: true` — required by MinIO,
  harmless for R2.
- **MinIO runs in `docker-compose.yml`** for local development. Switching to R2 is: change the
  endpoint, swap four credential values, run `npm run storage:init`. No code change.
- `scripts/ensure-buckets.js` bootstraps buckets against *either* backend, using the same env vars
  the app reads. If the script works, the app's credentials work.

Adopted because R2 credentials were an hour away and waiting would have blocked all of S2. The
side effect is better than the original plan: portability is now **tested** rather than claimed.

**Two buckets, two separately-scoped credentials** (`kinnred-media`, `kinnred-kyc`) per
CLAUDE.md §2.4 — a leaked media token must not reach biometric ID documents. Under MinIO both
currently use the dev root credentials; **on R2 they must be two separately-scoped API tokens**,
or the separation is cosmetic.

**R2 has no S3-style bucket event notifications** without Cloudflare Queues + a Cloudflare Worker —
which would couple us to Cloudflare exactly where portability was the requirement. So the
post-upload pipeline is instead: client calls `POST /media/:id/confirm` → enqueue a BullMQ job →
**the worker fetches the object from storage itself** and validates it. The client triggers
processing but is never trusted about content, and abandoned uploads stay unreadable and get swept.

**Also fixed here:** `npm audit` reported 2 high-severity issues — `js-yaml` 5.2.1
(GHSA-pm4m-ph32-ghv5, DoS via exponential parsing) reaching us through `@nestjs/swagger`.
`npm audit fix --force` would have **downgraded** Swagger to 11.4.5. Instead, a `package.json`
override pins `js-yaml@^5.3.0` **scoped to that dependency path only** — a blanket override would
have broken the js-yaml v3 also present in the tree. Result: 0 vulnerabilities, Swagger unchanged.

---

### D-027 · Two regressions caught while wiring S2, both worth remembering
**Status:** fixed
**Date:** 2026-08-17

**1. The global auth guard silently swept up `/health`.** Adding `JwtAuthGuard` as an `APP_GUARD`
in S1 (D-021) made health return **401**. Health was verified working *before* the guard landed,
so nothing re-checked it.

This is the worst possible shape of failure for a health endpoint: every load-balancer probe fails,
the platform concludes the service is down, and it restarts a perfectly healthy process — the exact
outcome a health check exists to prevent.

Fixed with `@Public()` on `HealthController`. **Guarded by `health.controller.spec.ts`**, which
asserts all three properties that have now broken at least once: `@Public()`, `VERSION_NEUTRAL`
(D-015), and the mount path. Metadata assertions, so they run in milliseconds with no infrastructure.

*The design worked as intended* — fail-closed produced a loud 401 rather than a silent hole. But it
confirms that every global guard needs a sweep of existing routes, not just new ones.

**2. Jest could not load anything importing Prisma.** Prisma 7 generates TypeScript whose relative
imports carry `.js` extensions (`./enums.js` → `./enums.ts`). `tsc` resolves this; Jest does not,
failing with `Cannot find module './internal/class.js'`. Any test touching a service would have hit
it. Fixed with a `moduleNameMapper` stripping the extension, plus excluding `generated/**` from
coverage. (Note: Jest rejects unknown config keys, so the usual `"//comment"` trick is not
available inside the `jest` block — the explanation lives here instead.)

---

### D-028 · EXIF stripping is a location-privacy control, not image hygiene
**Status:** accepted — safety-critical
**Date:** 2026-08-17

Every uploaded image is decoded and re-encoded to JPEG with **all metadata discarded**.

**This is load-bearing for §2.2, not tidiness.** Phone photos routinely embed GPS coordinates in
EXIF. Serving one would hand out the user's exact position — meaning the Grid's deterministic
coordinate fuzzing could be implemented flawlessly and the photograph would give the location away
anyway. The two controls protect the same secret and both must hold.

Implementation details that matter:
- `.rotate()` is called **before** metadata is dropped. It bakes the EXIF orientation tag into the
  pixels; without it, stripping the tag leaves portrait photos displayed sideways.
- `withMetadata()` must **never** be called — sharp discards metadata on output by default, and
  that call would put it back.
- **Format is determined by decoding**, never from the client's declared content type. That is
  strictly stronger than magic-byte checks: it proves the file really is a decodable image, not
  merely that it starts with the right signature.
- **SVG is rejected.** It is a scriptable document format, not an image in the sense meant here.
- `limitInputPixels` (~50 MP) guards decompression bombs — a ~1 KB PNG can declare dimensions that
  decode to gigabytes. A byte-size limit does not catch this, which is why both limits exist.

Verified end-to-end against a fixture carrying real GPS EXIF, asserting both that sharp reports no
EXIF **and** that the marker strings are absent from the raw bytes.

**⚠️ The first version of that verification was worthless, and it is worth knowing why.** The test
fixture wrote GPS tags under a `GPS:` key. sharp's `Exif` type accepts only `IFD0`–`IFD3`, and
**GPS belongs in IFD3** — an unrecognised group is *silently dropped*, no error. So the fixture
carried no GPS at all, and "GPS is stripped" was passing against data that was never there. The
suite reported green while testing nothing.

It surfaced only because `tsc` rejected the key; at runtime it was invisible.

Both the unit spec and the integration smoke test now begin with a **meta-test**: build the same
image with and without the GPS block and assert the EXIF payload is measurably larger with it
(+114 bytes observed). A fixture that stops carrying GPS now fails loudly instead of quietly
weakening the assertion that matters most in this service.

**General principle worth carrying into S6:** a security test that constructs its own adversarial
input must first prove the input is actually adversarial. Otherwise it degrades into a test that
the code does not crash.

---

### D-029 · The blurred derivative is downscaled before blurring, and generated once
**Status:** accepted
**Date:** 2026-08-17

Built at upload time and stored under its own key — never generated per request.

**Order matters: resize to 64px, THEN blur, then scale back up.** Blurring at full resolution is
partially reversible; deconvolution can recover a surprising amount of detail. Throwing the pixels
away first makes the loss genuine, because the information is no longer in the file at all. For a
feature whose entire purpose is that a locked photo cannot be seen, "mostly blurred" is not a
property worth shipping.

KYC documents get **no** derivative — they are never displayed to anyone, so generating one would
create a second copy of biometric data for no purpose.

---

### D-030 · Producer/consumer split is enforced structurally, not by convention
**Status:** accepted
**Date:** 2026-08-17

`worker.ts` now bootstraps **`WorkerModule`**, not `AppModule`. `WorkerModule` imports `AppModule`
(shared infrastructure) plus `MediaWorkerModule`, which is the only place the `@Processor` is
declared.

**Why not just declare the processor in `MediaModule`:** it would be instantiated wherever that
module is loaded — including the API process, as a side effect of registering the controller. The
API would then quietly run sharp decoding on the same event loop serving requests, which is exactly
what D-002 exists to prevent. The separation must be structural; a comment saying "worker only"
would not survive contact with a refactor.

The reconciliation sweep is registered here too, via BullMQ's `upsertJobScheduler` (the v6 API —
passing `repeat` to `queue.add` no longer type-checks). Redis holds the schedule, so several
workers still produce one sweep per interval rather than one each.

---

### D-031 · Four bugs the media tests caught, and what each would have cost
**Status:** fixed
**Date:** 2026-08-17

None of these were visible by reading the code; all four surfaced from running the pipeline.

1. **`jobId` containing `:` is rejected by BullMQ** ("Custom Id cannot contain :" — colons are its
   Redis key separator). Confirm returned 500 for every upload. Now `media-${id}`.

2. **Status was updated before the job was enqueued.** When the enqueue above failed, the row was
   already `PROCESSING`, so nothing was queued and nothing would ever revisit it — a permanently
   stranded asset, one of which is still visible in the test database. Reversed: **enqueue first,
   then update**. That order fails safe in both directions — a failed enqueue leaves it `PENDING`
   and retryable, and a failed status write is harmless because the processor accepts any non-READY
   status.

3. **`sharp()` throws in its constructor, not only in `metadata()`.** An empty buffer raises
   "Input Buffer is empty" before the guarded call was reached, escaping as a generic `Error` — so
   the worker treated an empty upload as a system fault and retried it three times instead of
   rejecting it once. Both calls are now inside the guard.

4. **No reconciliation existed for stranded assets.** Added `sweepStale()`, covering abandoned
   `PENDING` (presigned URL expired, upload never arrived) and stuck `PROCESSING` (worker died, or
   BullMQ exhausted retries). Without it both accumulate forever — rows counting against the user's
   photo limit, and objects costing money to store.

**The general lesson:** every one of these is a state-machine or integration-boundary bug. Reading
the code was not going to find them, and unit tests alone would not have either — it took running
the real pipeline against real storage and a real queue.

---

## S3 — Myspace

### D-032 · The visibility resolver ships as a deliberately over-restrictive stub
**Status:** accepted — replaced by S6
**Date:** 2026-08-17

`common/visibility/VisibilityService` exists now, with the full interface S6 will need, but
`decide()` can only evaluate two of the four cases: *self* and *owner has not locked*. A locked
profile is **BLURRED for everyone else, with no unlock path at all**.

**Why ship a stub rather than the real rule:** two of the three unlock conditions depend on
services that do not exist. Rules 1 and 2 need ping history (S5); rule 3 needs verified status
(S4) *and* is still blocked on the gender-attestation decision in CLAUDE.md §6.

**Why a stub rather than an unguarded read:** erring restrictive is the only safe direction here.
An over-restrictive stub produces a visible product gap that someone reports and fixes. An
over-permissive one silently exposes photos, and nobody files a bug for photos being *too*
visible. "Temporarily" unguarded is how a locked-photo rule ends up not existing.

**Properties fixed now, which must survive S6 replacing `decide()`:**
- **Fail closed by construction.** `resolveMany` pre-seeds every requested id as `LOCKED` before
  querying, so anything the query does not account for is denied without anyone remembering to
  handle it. Ids are never *absent* from the result — a missing key is indistinguishable from "no
  restriction" at a careless call site.
- **Batch-first.** The Grid resolves ~50 profiles per page; per-user resolution is an N+1 that
  pushes people toward caching, and a cached stale unlock is a safety failure. The fix has to be
  batching, so the primary API is `resolveMany`.
- **Decision and rendering are separate.** `MediaService.listViewablePhotos` takes an already-made
  `PhotoAccess` as an argument rather than computing one. That is what stops the photo-lock rule
  quietly acquiring a second implementation in the media layer.
- **BLURRED never falls back to the real key.** If a blurred derivative is missing, the photo is
  omitted entirely. A fallback to the original would silently defeat the lock.

Covered by `visibility.service.spec.ts`, including an explicit invariant that the stub never
returns `UNLOCKED` to a third party — if that test fails, an unlock path was added without the
checks that justify it.

---

### D-033 · "Who viewed me" stores one row per pair, and the setting is symmetric
**Status:** accepted — resolves an open question from BACKEND_PLAN S3
**Date:** 2026-08-17

Two decisions, both about limiting what the feature is capable of.

**1. One row per (viewer, viewed) pair, upserted — not an append-only log.** An append-only view
log on a proximity dating app is a precise, permanent browsing history for every user: who looked
at whom, when, how often. That is a standing privacy liability and a subpoena target, and it grows
without bound. The upsert shape answers the only question the feature actually asks — "who looked,
and how recently" — while storing strictly less.

**2. `recordProfileViews` is symmetric.** A user who turns it off browses invisibly *and* loses
access to their own viewer list. Taking the benefit of invisibility while still consuming other
people's visibility is a one-way mirror, and it is exactly the asymmetry that makes such a setting
worth abusing.

This resolves the "is who-viewed-me gated?" open question in the plan. Note the remaining exposure
is inherent to the feature: appearing in someone's viewer list reveals that you looked. The
setting is the control for that, which is why it must be honoured on the *write* path (nothing is
recorded) rather than filtered on read.

---

### D-034 · Age is exposed; date of birth is not
**Status:** accepted
**Date:** 2026-08-17

`GET /users/:publicShortId` returns `age` as a number and never `dateOfBirth`. Exact DOB is both a
privacy leak and one of the most common identity-verification answers in use anywhere.

Public profiles also omit the internal `id` — lookup is by `publicShortId` only, which is random
and non-enumerable (S1). A client never needs the cuid to view a profile, so it never receives one.
And `phone` has no path out of the service layer at all.

**Identity fields are structurally unsettable.** `UpdateProfileDto` and `UpdateSettingsDto` cannot
express `gender`, `isVerified`, `phone`, or `publicShortId`, and the global `ValidationPipe` runs
with `forbidNonWhitelisted` — so sending one is a 400, not a silently ignored field. Verified by
test for all four. That is what closes the "self-grant verification" and "change the gender that
verification froze" (D-017) paths.

---

### D-035 · Interests are normalised at the DTO boundary, with a hand-written GIN index
**Status:** accepted
**Date:** 2026-08-17

Interest tags are trimmed, lowercased, de-blanked and deduplicated in the DTO transform, before
they ever reach the service. Without it `"Coffee"`, `"coffee "` and `"coffee"` are three distinct
tags and interest matching quietly stops working — the same class of bug as unnormalised phone
numbers defeating a unique constraint (D-…/S1).

Stored as a Postgres `text[]` rather than a join table: the only query shape needed is overlap
(`interests && ARRAY[...]`) for the wavelength feed, which a GIN index serves directly.

**The GIN index is hand-written into the migration.** Prisma cannot express a GIN index on a scalar
array and will never generate one — and without it that feed degrades to a sequential scan over
every profile. Exactly the failure mode CLAUDE.md §4 describes for missing spatial indexes, and the
reason the `prisma-schema-change` skill says to review generated SQL rather than trust it.

---

### D-036 · Rule 3 (verified-female photo unlock) is removed entirely, not deferred
**Status:** accepted — closes the "gender attestation" open decision in CLAUDE.md §6
**Date:** 2026-08-17

An earlier draft of the photo-lock rule had three unlock conditions. Rules 1 and 2 are actions the
owner took (she pinged you; she accepted your ping). Rule 3 was different: *verified female viewers
can see locked photos* — an unlock granted by an attribute of the **viewer**.

**Why it is gone rather than pending a vendor decision.** Rule 3 could not be implemented safely by
any vendor, because nothing can actually prove the claim it depends on:

- `gender` is self-declared, freely editable, and carries no attestation.
- Selfie-liveness attests *"a live human matching the profile photos"* — presence, not gender. No
  KYC product on the market attests gender as an identity claim.
- The exploit is therefore trivial and needs no technical skill: declare `FEMALE` → pass liveness →
  read every locked profile in the system. That is precisely the population the rule exists to
  protect, exposed by the mechanism meant to protect them.

**Why not ask the vendor to attest gender from an ID document.** Considered and rejected on its own
terms, independent of the exploit. Document-derived gender hard-excludes trans women whose documents
do not match, and it turns a safety feature into an identity-document checkpoint. A rule that
protects women by excluding some women is not the rule we want.

**What this buys, beyond closing the hole.** With rule 3 gone, **no viewer attribute grants photo
access anywhere in the system**. `isVerified` gates circle creation and nothing else. Gender is a
Grid *filter* and the signup seed for `photosLocked`, and carries no permission weight at all —
which is what makes it safe to treat as ordinary user-editable data (D-017) rather than a frozen
security field.

**Propagated, not merely decided:** CLAUDE.md §2.1 rewritten with "**That is the complete list**",
the `user_settings.stay_locked_regardless` column dropped, `VisibilityService.decide()` simplified,
and `visibility.service.spec.ts` updated. D-032's stub is now two cases short of complete rather
than three, and S6 needs only ping history to finish it.

**Revisit only if** a mechanism appears that attests the relevant property *without* excluding trans
women and *without* being self-declared. The bar is not "a vendor offers a gender field".

---

### D-037 · The GIN index moved from hand-written SQL to a native Prisma declaration
**Status:** accepted — amends D-035
**Date:** 2026-08-17

D-035 records the interests GIN index as hand-written into the migration, on the belief that Prisma
cannot express it. **That was wrong for this schema, and the error failed in the worst possible
way:** because `schema.prisma` did not declare the index, the very next `migrate diff` saw an index
in the database with no counterpart in the model and generated a `DROP INDEX` for it. The
hand-written index would have been silently removed by a routine migration, degrading the
wavelength feed to a sequential scan, with nothing in the diff review to suggest it mattered.

Now declared natively:

```prisma
@@index([interests(ops: ArrayOps)], type: Gin)
```

**The general rule this establishes:** hand-written DDL in a migration is only safe when Prisma
*genuinely* cannot model the object — PostGIS `geography` columns and their GiST indexes are the
real case (see the `prisma-schema-change` skill). Anything Prisma *can* model must be declared in
the schema, because the schema is what `migrate diff` compares against. An object the model does not
know about is not "extra", it is scheduled for deletion.

**Check when reviewing any future migration:** a `DROP INDEX` you did not ask for is this bug.

---

### D-038 · A KYC decision passes three independent guards, in a fixed order
**Status:** accepted
**Date:** 2026-08-17

`isVerified` gates circle creation, so the webhook that sets it is the highest-value
unauthenticated endpoint in the system. It is protected by three guards defeating three different
attacks, and the **order matters as much as the presence**:

1. **Signature**, HMAC-SHA256 over the **raw body**, compared with `timingSafeEqual`. Proves the
   vendor sent it. Without this, anyone who can reach the URL self-verifies.
2. **Replay**, a unique `(provider, eventId)` row. A signature proves origin, never freshness — a
   captured approval would otherwise be replayable forever, including to resurrect a verification
   that was revoked.
3. **State**, only `PENDING` transitions. Stops a late or duplicate delivery re-opening a settled
   decision.

**Why the signature must come first, before any write.** If the replay record were written first, an
attacker who merely *observed* event ids could burn them with unsigned requests and permanently
block the real callback from ever applying. `verification.service.spec.ts` asserts this ordering
directly — that the failing-signature path performs no writes and does not even parse the payload.

**Why the replay guard is a unique constraint, not a read-then-write.** A `findFirst`-then-create
races: two concurrent deliveries of the same event both pass the check. The constraint *is* the
guard; the `P2002` catch is only how it reports.

**Why `rawBody: true` in main.ts is load-bearing.** Signatures cover exact bytes. Re-serialising
parsed JSON reorders keys and drops whitespace, so verification against a re-serialised body fails
for every legitimate callback — and the tempting "fix" is to skip verification. A test asserts that
two byte-different payloads which `JSON.parse` to the same object do **not** share a signature, so
anyone who introduces a normalising step breaks a test rather than the product.

**Decisions are applied in a transaction.** Request state and the `isVerified` flag move together.
Split apart, a crash between them leaves an APPROVED request beside an unverified user (support
burden) or — far worse — a verified user with no approved request behind it, which is unauditable.

**Non-decision events are acknowledged with 200, not rejected.** Vendors send informational events on
the same endpoint; a 4xx makes them retry indefinitely.

---

### D-039 · The KYC vendor is mocked behind an interface that refuses to boot in production
**Status:** accepted — vendor choice remains open
**Date:** 2026-08-17

The vendor (Persona / Onfido / Rekognition) is still undecided, so `MockKycProvider` implements the
whole `KycProvider` interface: session creation, signature verification, webhook parsing. That makes
the entire state machine — including all three guards of D-038 — exercisable end to end today with
no vendor account. Swapping in a real vendor is one binding in `verification.module.ts`; nothing
outside `kyc/` knows a vendor payload shape.

**`MockKycProvider` throws in its constructor when `NODE_ENV === 'production'`.** A mock KYC provider
in production means anyone who reaches the webhook grants themselves verified status. That is a
config mistake rather than a code mistake, which is exactly the kind that ships — so the process
refuses to start rather than serving a permanently open verification endpoint. Covered by a test,
because the guard is worthless if a later refactor drops it.

**The admin decision endpoint is explicitly a stopgap.** `POST /verification/:id/decide` is guarded
by a shared `x-admin-token`, compared in constant time — this endpoint can verify any user, so it is
the credential most worth grinding character-by-character. There is no admin identity model yet, so
decisions are attributable to *whoever holds a secret*, not to a person. Acceptable while no vendor
is wired, unacceptable at deployment; marked as such in the service and excluded from the published
Swagger schema.

---

### D-040 · The verification expiry sweep is a correctness requirement, not housekeeping
**Status:** accepted
**Date:** 2026-08-17

`submit()` permits **one live attempt per user**, which stops a user opening unlimited vendor
sessions we are billed for. That guard has a failure mode: if a webhook is dropped, misrouted, or
never sent, the request sits `PENDING` forever and the user becomes **permanently unable to
re-submit**, with no action available to them. The failure mode of a vendor outage would be a cohort
of accounts that can never become verified — and nothing in the product would report it.

The hourly sweep expires stale `PENDING` requests past `KYC_REQUEST_TTL_HOURS`. It only ever moves
`PENDING → EXPIRED`, so it can never revoke a decision that was legitimately made.

Scheduled with a BullMQ **job scheduler** rather than an in-process timer, so N workers still produce
one sweep per interval — Redis holds the schedule, not the process — and `upsertJobScheduler` makes
restarts idempotent instead of stacking duplicates. Registered in `VerificationWorkerModule`, which
is imported only by `worker.module.ts`, so the API can never schedule or run it (D-030).

Hourly rather than every few minutes because the TTL it enforces is measured in hours; a tighter
interval would only add `updateMany` calls that match nothing. A request may therefore read `PENDING`
for up to an hour past its expiry, which is harmless — nothing treats `EXPIRED` as an authorisation
signal.

---

### D-041 · Two things S4's tests caught that the smoke test could not
**Status:** noted
**Date:** 2026-08-17

**1. `assertAdmin` compared the admin token with `!==`.** String comparison short-circuits at the
first differing byte, so response timing leaks how many leading characters were correct and the
secret is recoverable one character at a time. Now `timingSafeEqual`, with an explicit length check
first because it *throws* rather than returning `false` on a length mismatch. An end-to-end test
cannot see this: right-token and wrong-token both returned the correct status code the whole time.

**2. The smoke test was not re-runnable, and its second run looked like a broken approval path.**
`kyc_webhook_events` is a permanent replay ledger, so fixed event ids (`evt-1`…) fail on their
*first* use in run two — six assertions failed, every one of them the replay guard working
correctly. Event ids are now namespaced per run.

Worth generalising: **any test that writes to an append-only integrity ledger must namespace its
keys**, or a passing suite silently becomes a failing one on re-run and the failure points at the
wrong component.

---

### D-042 · One ping row per unordered pair, so rejection is terminal by construction
**Status:** accepted
**Date:** 2026-08-17

`Ping.pairKey` is the two user ids sorted and joined, with a UNIQUE index. Both directions compute
the same value, so A→B and B→A collide on insert. This is the central structural decision on the
1:1 surface and it does three jobs at once:

- **Rejection is terminal without any extra logic.** A REJECTED row still occupies the pair's only
  slot, so a declined user physically cannot re-ping. The harassment control is a database
  constraint, not a check in `send()` that someone might refactor away. Compare the alternative —
  "look for a previous rejection before inserting" — which is a read-then-write race and one
  forgotten call site away from being no control at all.
- **No crossed conversations.** Without the constraint, A→B and B→A are two independent threads for
  the same two people, and every downstream reader (chat list, visibility, notifications) has to
  reconcile them.
- **Mutual pings collapse.** See D-043.

`fromId`/`toId` are retained on top of the pair key because DIRECTION is what the safety rule turns
on: photos unlock when the OWNER pinged the viewer or accepted the viewer's ping (CLAUDE.md §2.1).
A symmetric-only model could not express that, so S6 would have nothing to read.

**The cost, accepted knowingly:** the person who *declined* also cannot later initiate. The
asymmetric alternative — "the rejecter may reopen" — adds state transitions to the surface most in
need of being simple, and a rare change of mind is a smaller harm than a re-ping loophole.

**Revisit if** product data shows meaningful demand for reopening a declined connection. That is a
product decision, not a safety one, but it must not be implemented by relaxing the unique index —
it would need an explicit, rate-limited "invite again" action initiated by the person who declined.

---

### D-043 · Reverse ping accepts; withdrawal deletes
**Status:** accepted
**Date:** 2026-08-17

Two consequences of D-042, both chosen rather than fallen into.

**A ping back is an acceptance.** If B has pinged A and is waiting, A pinging B is unambiguous
consent from both sides. The service accepts the existing request instead of erroring on the pair
key. Erroring would be both confusing ("you can't ping them", no reason given) and an **existence
oracle** — a distinct "they already pinged you" error tells the caller something about someone who
has not consented to contact.

**Withdrawal deletes the row rather than moving it to a state.** There is deliberately no
`CANCELLED` or `WITHDRAWN` member in `PingState`:

- It frees the pair slot, so a withdrawn ping is not accidentally as terminal as a rejection.
- It leaves **no residue for the recipient**. "Someone pinged you and took it back" is precisely
  the kind of trace this surface should not keep, and a state row would make it recoverable.

**Rate limiting counts only NEW connections.** Accepting an inbound request or replying in an open
thread does not consume the daily budget. Otherwise a popular user is rate-limited out of replying
to people who contacted *them*, which inverts what the limit is for.

---

### D-044 · Blocks are stored directionally, enforced symmetrically, and reported as "not found"
**Status:** accepted
**Date:** 2026-08-17

Three separate decisions in one model.

**1. Stored directionally.** The row records who blocked whom, because "who initiated this" is not
recoverable from a symmetric row and abuse review needs it.

**2. Enforced symmetrically.** Every read checks BOTH directions. A block that only hid the blocker
from the blocked user would leave the blocked user's content still visible to the person who asked
not to see them — the opposite of what was requested. `blockedIdsAmong` is the batch form, and
exists because every list endpoint (and later the Grid, paging ~50 users) must exclude blocked
pairs; doing that per-row is an N+1 that pushes toward caching block state, and a stale block cache
means a blocked user reappears.

**3. A block is indistinguishable from "no such user".** Pinging someone who blocked you returns
404 with the same message as an unknown short id. A distinct error would confirm both that the
account exists and that it blocked you — which is exactly what someone checks after being blocked,
and it is information the blocker never agreed to share.

**Blocks are filtered on READ as well as enforced on WRITE.** A pair can become blocked after a ping
already exists, so the stale row must not keep surfacing in Requests or Chats. Enforcing only at
write time would leave every pre-existing conversation visible forever.

**Independent of Ping**, because blocking someone you never pinged has to work. That is why it is
its own model and its own controller path rather than a ping state.

**Consumed by S6/S7/S8:** `BlocksService` is exported. Visibility, Grid and Circles must all honour
blocks, and each re-deriving "is this pair blocked" is how one of them ends up not.

---

### D-045 · Realtime delivers; REST writes. One write path, always
**Status:** accepted
**Date:** 2026-08-17

There are deliberately **no client-to-server message events** on the gateway. Sending a message is
a REST call; the socket only delivers.

**Why:** a socket-side write would need validation, block checks, and ping-state authorisation
re-implemented against a completely different input path — and the copy that drifted would be the
one nobody was reading. On a surface where "may these two people exchange messages" is a safety
question, two answers is one too many.

**PingsService depends on a `REALTIME` seam, not on the gateway class.** Two reasons, the second
being the important one:

1. The service is unit-testable without standing up a socket server.
2. **Realtime delivery is best-effort; the domain write is not.** If the service held a `Server`
   directly it would be far too easy to let a socket failure abort a database transaction. A
   message that was persisted but not delivered is a UI refresh away from correct; a message that
   failed to persist because a socket was down is data loss. `emitToUser` therefore swallows its
   own errors by contract, and a test asserts it does not throw even when the adapter is down.

The same property is why the worker process — which builds the same module graph but serves no
sockets — can call into this harmlessly.

---

### D-046 · The socket.io Redis adapter is wired from day one, and proven with two instances
**Status:** accepted
**Date:** 2026-08-17

Socket.io keeps room membership in the memory of the process that accepted the connection. With two
API instances behind a load balancer, an emit issued by instance A never reaches a user whose socket
landed on instance B.

**Why this cannot be a later scaling task:** the failure is invisible in development — one process,
everything works — and appears in production as "messages sometimes don't arrive", intermittently,
depending on which instance served which request. It is not reproducible on demand, and retrofitting
it means re-testing every realtime path.

Wired in `main.ts` **before** `listen()` and awaited: `createIOServer` runs during listen, so an
adapter still connecting at that point is silently skipped and the gateway falls back to
single-instance behaviour. The fallback logs at ERROR rather than passing quietly, because a silent
fallback is exactly how single-instance-only realtime reaches production.

**Dedicated Redis connections, not the shared `REDIS_CLIENT`:** a connection in subscriber mode
cannot run ordinary commands, so reusing the shared client would break rate-limit counters and
presence the moment the adapter subscribed on it.

**Proven, not assumed.** The S5 smoke test starts **two API instances on different ports**, connects
the recipient's socket to instance B, and drives every write through instance A. On a single
instance those assertions pass either way, which is the entire reason the test is built this way.

---

### D-047 · Socket auth belongs in handshake middleware, not `handleConnection`
**Status:** accepted — fixes a defect found by the S5 smoke test
**Date:** 2026-08-17

The gateway originally verified the JWT in `handleConnection` and called `socket.disconnect()` on
failure. The smoke test asserted that a bogus token cannot open a socket, and **it failed**: the
client's `connect` event fired.

`handleConnection` runs *after* the connection is established. An unauthenticated client had
therefore already completed a handshake, been assigned a socket id, and seen `connect` fire before
being torn down. It never joined a room and never received data, so nothing leaked — but "briefly
connected then disconnected" is not the property we want to defend, and it invites a later "just
check auth when they subscribe" shortcut.

Verification now runs in socket.io connection middleware (`server.use`), which refuses the upgrade
outright: no connection exists at any point. `handleConnection` only routes the already-identified
socket into its room, with a defensive disconnect if it somehow arrives without an identity.

**Two properties carried over from the HTTP side deliberately:**
- The **token type** is checked (`typ === 'access'`). Without it a registration ticket — handed to
  anyone who merely passes OTP, before an account exists — would open a socket.
- The rejection reason is **logged, never sent**. "Expired" vs "forged" vs "wrong type" over the
  wire is reconnaissance, exactly as it is in `JwtAuthGuard`.

A regression test pins this: if the check ever moves back into `handleConnection`, it fails.

**General lesson worth keeping:** for any transport, find out whether the framework's "on connect"
hook runs before or after the connection is real. The two look identical in code review.

---

### D-048 · `PrismaService.ping()` renamed — model names claim delegate names
**Status:** noted
**Date:** 2026-08-17

Adding the `Ping` model broke compilation across the whole codebase: `PrismaClient` exposes one
accessor per model, so `prisma.ping` became the delegate — and `PrismaService`'s hand-written
`ping()` health-check method shadowed it. Every `prisma.ping.findUnique(...)` failed to typecheck,
and so did `PrismaService` itself.

Renamed to `checkConnection()`. The model name is domain vocabulary and is not moving.

**The rule this establishes:** any method added to `PrismaService` must avoid colliding with a
current *or future* model name. `user()`, `message()`, `block()` and `profile()` are all now
unavailable for the same reason. Prefer names that describe the infrastructure concern
(`checkConnection`, `postgisVersion`) rather than the domain — the domain namespace belongs to
Prisma.

Cheap to fix because it was a compile error. Worth recording because the failure mode reads as
"Prisma is broken" rather than "you named a method after a table".

---

### D-049 · The photo-lock rule, decided: PENDING unlocks, REJECTED re-locks, a block overrides both
**Status:** accepted — completes D-032, implements CLAUDE.md §2.1
**Date:** 2026-08-18

S6 replaced `VisibilityService.decide()`. CLAUDE.md §2.1 states the rule in terms of two owner
actions — "the owner has pinged the requesting user" and "the owner has accepted a ping from the
requesting user" — neither of which names a ping *state*. Against the real schema (one row per
unordered pair, D-042) that leaves three cells genuinely undecided. This is how they were decided.

**A PENDING ping from the owner unlocks.** The owner reached out; that is the action rule 1 names,
and the recipient needs to see who is pinging them for the Requests folder to be usable at all. The
unlock is revocable by the person it exposes: withdrawing deletes the row (D-043), so the unlock
disappears with it and there is no separate revoke path to maintain or forget.

**REJECTED unlocks nothing, in either direction.** The literal text of rule 1 argues for keeping the
unlock when the owner was the sender — she pinged, and that happened. It was rejected anyway,
because rejection is terminal by database constraint (D-042): the owner *cannot* withdraw a rejected
row. Reading it literally would leave her permanently visible to someone who declined her, with no
action available to undo it. A decline is the clearest available evidence that the relationship the
unlock was predicated on does not exist.

**A block overrides everything except self, and returns LOCKED rather than BLURRED.** This is the
case a write-time check structurally cannot catch: a pair that accepted first and blocked afterwards
(CLAUDE.md §2.5). An unlock decided once at ping time would stand forever. It is also checked ahead
of `photosLocked`, so it hides a profile that was never locked — blocking is symmetric invisibility,
not a photo setting. `LOCKED` and not `BLURRED` because a blurred photo still confirms a person and
their outline; for a pair that asked not to see each other, nothing is the right amount.

**Two cases that needed no code, which is the point of D-042/D-043:**
- A ping back is an acceptance, which mutates the existing row rather than inserting a second one.
  It therefore lands on "state is ACCEPTED" and unlocks with no special case.
- Withdrawal deletes the row, so revocation is the absence of a rule rather than a rule.

**What did NOT become an input, and the reason it is worth naming again:** `isVerified` and `gender`
are not merely unused here — the resolver does not `select` them. A test asserts the query's select
clause contains exactly `id` and `photosLocked`. Data that is never loaded cannot be reached for by
a later edit that "just needs one more condition", which is the shape rule 3 (D-036) would come back
in.

**Cost accepted:** the resolver duplicates `pairKeyFor` rather than importing it from `PingsService`,
because `common/` must not depend on a domain module. A cross-check test asserts the two agree.
Without it, a divergence would fail *silently and safely* — every pair would resolve to "no
relationship" and photos would stay blurred forever — and nobody files a bug for photos being too
private.

**Revisit if:** the product wants a "hide me from people I rejected" or a re-ping flow. Both are
changes to D-042 first, and this rule follows from it.

---

### D-050 · `BlocksService` moved to `common/`, and the profile read now 404s on a block
**Status:** accepted — forced by D-049
**Date:** 2026-08-18

`VisibilityService` needs block state (D-049), and `BlocksService` lived in `modules/pings/`. A
resolver in `common/` importing from a domain module inverts the dependency and creates a cycle the
moment pings needs visibility back — which S9's circle chat will want. Moved to
`src/common/blocks/` behind a `@Global` `BlocksModule`, mirroring `VisibilityModule`. Its own doc
comment already argued blocking is not a pings concept; CLAUDE.md §2.5 requires every surface to
honour it. `BlocksController` stayed in pings: the REST surface belongs to the 1:1 surface even
though the rule does not.

**A gap this surfaced.** `GET /users/:publicShortId` never checked blocks at all. S5 added blocking
after S3 shipped the profile read, and enforcement was added to the ping paths only — exactly the
"enforce on write, forget to filter on read" failure §2.5 warns about. A blocked user could still
fetch a target's bio, interests, age and verified status by short id, and the request recorded a
profile view on the way, so the block was *visible to the blocker as a view count*.

Routing photos through the resolver would have fixed the photos and left the rest. The read now
throws `NotFoundException('Profile not found')` — byte-identical to the unknown-short-id response,
because a distinct error confirms both that the account exists and that it blocked you, which is
precisely what someone checks after being blocked.

**The general lesson, and it is not the first time:** when a rule ships *after* the surfaces it
governs, adding it to the module that introduced it is not adding it. The audit that catches this is
"list every read path that returns another user's data", not "grep for the new service".

---

### D-051 · The fuzzed point is a stored column, and `user_locations` is `UNLOGGED`
**Status:** accepted
**Date:** 2026-08-18

CLAUDE.md §2.2 requires that fuzzing be applied *before* anything a client can observe is computed.
The obvious reading is "displace the point on the way out", which makes the requirement a rule every
future query has to remember — and the first query that forgets leaks exact position permanently,
silently, to everyone.

`user_locations` therefore carries **two** geography columns. `geog` is exact; `geog_fuzzed` is the
same point displaced by `ST_Project` using a per-user offset derived at write time. Both are written
by one statement, so they cannot drift. The GIST index is on the fuzzed column **only**, and every
client-observable expression — `ST_DWithin`, `ST_Distance`, the ordering, the cursor boundary —
reads it. The exact column is referenced exactly once per request: as the searcher's own origin,
selected by primary key.

**Why storing beats computing.** A per-request offset cannot be indexed, so the proximity search
would have to scan. More importantly, the stored form makes the safety property structural: the
precise value is not in scope in the query that produces results, so there is nothing to remember.
`geog` is deliberately left *unindexed* for the same reason — a query that reaches for it by mistake
shows up as a sequential scan rather than as quietly-leaked precision.

**What this does not defend against, stated plainly:** an attacker who spoofs their own position,
searches from several origins and trilaterates recovers the **fuzzed** point. They never recover the
exact one, because it is not an input to anything they can observe. That bound is the design, not a
gap in it.

**`UNLOGGED`, and the collision it creates.** §4 calls for `UNLOGGED` on this table: it is ephemeral
and rebuildable (clients re-post within seconds), so exempting it from WAL removes the largest single
source of write amplification. The migration also sets `fillfactor = 70` — leaving page space for
HOT updates, which skip index maintenance entirely — and drops the autovacuum scale factors to 0.02,
because dead tuples accumulate here at one per active user per minute, a rate no other table
approaches.

⚠ But **§4 also says read load scales out with a replica, and `UNLOGGED` tables are not streamed to
physical standbys** — a replica would serve an empty Grid. The two instructions collide. This
migration follows the explicit `UNLOGGED` instruction; **adding a read replica requires
`ALTER TABLE user_locations SET LOGGED` first**, which is safe and cheap precisely because the data
is rebuildable. Recorded here because the failure mode otherwise is "the Grid works on the primary
and returns nothing on the replica", which reads as a routing bug rather than a storage decision.

**Revisit if:** a read replica is introduced (flip to `LOGGED`), or `pg_stat` proves location writes
are the hotspot (then, and only then, §4 step 3 — a Redis write buffer). Step 3 stays unbuilt: below
~100k DAU the debounce alone suffices, and a buffer introduces a second source of truth for position.

---

### D-052 · "Online" is derived from `updated_at`, not from a presence store
**Status:** accepted
**Date:** 2026-08-18

The Grid needs an `online` filter and there was no presence infrastructure. Redis heartbeats were
the assumed answer (CLAUDE.md §1 lists presence under Redis), but the write debounce already
produces the signal for free: it persists when the user has moved far enough **or** when
`GRID_DEBOUNCE_SECONDS` have elapsed, so any client still posting rewrites its row at least once a
minute. `updated_at` is therefore fresh to within the debounce interval by construction.

Chosen over Redis heartbeats because a second liveness store is a second source of truth, and the
two disagree in exactly the situation that matters — when one of them is stale. A boot-time check
enforces `GRID_ONLINE_WINDOW_SECONDS > GRID_DEBOUNCE_SECONDS`, without which an active user flickers
offline between two persisted writes.

**Revisit if:** a surface needs presence for users who are *not* posting location — an open app that
never moves and has location permission denied, say, or the Circles chat in S9. That is a genuinely
different signal and would justify a real presence store; it should not be bolted onto this one.

---

### D-053 · The Grid gets a block exclusion **list**, not a block predicate
**Status:** accepted
**Date:** 2026-08-18

Two rules in tension. CLAUDE.md §2.5: never re-derive "is this pair blocked" per module — use
`BlocksService`. The `postgis-proximity-query` skill: combine filters inside the one query, because
a post-query filter pass breaks page sizes and pagination. Filtering the result set afterwards would
return 22 rows for a page of 25 and corrupt the cursor; writing
`NOT EXISTS (SELECT 1 FROM blocks …)` into the query restates the symmetric-block rule in SQL, which
is how it ends up with two implementations that disagree.

Resolved with `BlocksService.blockedIdsFor(userId)` — every id blocked in either direction, with no
candidate list to intersect against (the Grid's candidates do not exist until the spatial query has
run, so `blockedIdsAmong` cannot serve it). The Grid passes the result to the query as a plain
`NOT IN`. The rule stays in one place; the SQL never expresses what "blocked" means, only which ids
to skip. A test asserts the generated SQL contains no reference to the blocks table at all.

Unbounded by design: block lists are small because blocking is a deliberate per-person act. If that
stops being true, the fix is a semi-join against a temp table — not a per-row check, and not moving
the rule into SQL.

---

### D-054 · The radius filter is quantised to the bucket edges
**Status:** accepted
**Date:** 2026-08-18

§2.2 requires coarse distance buckets so that an exact distance cannot be combined with a fuzzed
point to recover the true position. Bucketing the *reported* distance is only half of it: a
free-form `radiusMeters` reintroduces the precision through the filter. Present at 1000m and absent
at 900m brackets the true distance to 100m, and a binary search over ~14 requests recovers it to the
meter — at which point the labels are decoration.

So `GRID_RADIUS_METERS` is a single array that is **both** the permitted search radii and the bucket
boundaries, and the DTO enforces it with `@IsIn`. One array, so the two cannot drift; a test asserts
each permitted radius lands exactly on a bucket transition, meaning "within 3000m" tells a caller
nothing the label had not already told them.

The cursor follows the same logic. The natural cursor for a distance-ordered set is `(distance, id)`,
but a base64 cursor is readable and that distance is exact by construction. The cursor carries the
last row's **public short id** instead, and the server re-derives that user's distance to form the
page boundary — so the exact value never leaves the service layer. The cost is that a searcher who
moves mid-page may skip or repeat a few results; the alternative, pinning the origin inside the
cursor, would put their exact coordinates on the wire.

**Revisit if:** the product wants a map view. That needs the fuzzed coordinate in the payload, which
the stored column already supports without a schema change — but it is a §2.2 decision, not a
rendering one.


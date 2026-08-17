# Kinnred — Project & Engineering Guidelines

Location-based social discovery app connecting people through nearby discovery and interest-based communities (Circles).

---

## 1. Project Overview & Architecture

### Four Core Surfaces
1. **Grid**: Nearby discovery using geolocation with server-enforced safety rules.
2. **Pings**: 1:1 interaction lifecycle (`PENDING` requests → `ACCEPTED` chats / `REJECTED`).
3. **Circles**: Community hubs across 3 privacy tiers (`OPEN`, `INVITE_ONLY`, `INCOGNITO`). Features admin posts and group chats.
4. **Myspace**: User profile management, QR identity sharing, media, and settings.

### Tech Stack
- **Framework**: Node.js + NestJS (`/backend`)
- **Database & ORM**: PostgreSQL + PostGIS, Prisma ORM
- **Spatial**: PostGIS is the **single source of truth** for all spatial queries (GIST index on `geography`). Do **not** introduce Redis Geo or a second spatial index — see §4.
- **Cache & Realtime State**: Redis — presence/heartbeats, socket pub/sub, rate-limit counters, job queue backing store. Not a spatial index.
- **Background Jobs**: BullMQ on Redis. Anything calling a third party (LLM, KYC, FCM/APNs) or doing image work runs in a worker, never in the request path.
- **Realtime Transport**: Socket.io (`@nestjs/platform-socket.io`) + Redis Adapter (wire the adapter from day one, not as a later scaling step).
- **Object Storage**: S3 / Cloudflare R2 via presigned URLs (never buffer image bytes through API memory).
- **Notifications**: FCM (Android) + APNs (iOS), dispatched via queue.
- **AI Categorization**: LLM API integration on Circle creation — async, enum-constrained (see §5).

---

## 2. Safety-Critical Imperatives (Non-Negotiable)

Do not weaken any rule in this section without explicit sign-off.

### 2.1 Women's Safety Default (Server-Side Enforcement)
- **`User.photosLocked` is the single source of truth.** It is an explicit column, seeded from
  gender at signup (`true` for FEMALE and NON_BINARY, opt-in for others) and owned by the user
  thereafter. Its database default is `true` — **fail closed**.
- **Never derive lock state from `gender` at read time** (DECISIONS.md D-017). Gender is a Grid
  *filter*, not an authorisation input. Deriving it makes `PREFER_NOT_TO_SAY` an unanswerable
  question inside the security path, denies privacy to anyone the rule does not name, and
  guarantees the rule gets re-implemented slightly differently in each read path.
- When `photosLocked` is true, photos unlock **only** when one of these holds:
  1. The owner has pinged the requesting user, **or**
  2. The owner has accepted a ping from the requesting user.

  **That is the complete list.** Both conditions are an action *the owner took*. There is no path
  by which a viewer's own attributes — verified status, gender, anything else — grant access to a
  locked profile. If a proposed feature would add one, it is a change to this rule and needs
  explicit sign-off.

  **Resolved against ping state (D-049), since the two conditions above do not name one:** a
  `PENDING` ping from the owner unlocks (withdrawing it deletes the row, so the unlock revokes
  itself); `REJECTED` unlocks in neither direction, because rejection is terminal by database
  constraint and the owner could not otherwise revoke; and **a block (§2.5) re-locks the pair
  regardless**, which is the only way to catch a pair that accepted first and blocked afterwards.

> **Removed 2026-08-17 (DECISIONS.md D-036):** an earlier draft granted access to *verified female*
> viewers. Dropped because nothing could actually prove the viewer was female — gender is
> self-declared and selfie-liveness attests "a live human matching the profile photos", not gender.
> The exploit was: declare FEMALE → pass liveness → view every locked profile. `isVerified` now
> gates circle creation only, and never photo access.
- **Never rely on client-side filtering.** Resolve visibility in the service layer and redact/omit private image URLs before returning any payload over REST *or* WebSockets.
- All photo-bearing read paths (Grid results, profile fetch, ping/chat participant payloads, circle member lists) must route through **one shared `VisibilityService`**. Do not reimplement the rule per module — a single resolver is the only way this stays auditable.
- Serve authorized images as **short-lived presigned URLs (≤5 min TTL)**. A presigned URL is a bearer capability: once issued it survives a later block/revoke until it expires, so keep the TTL tight.
- The blurred variant is a **pre-generated derivative** produced by the upload worker and stored under a separate key. Never blur per-request, and never ship the full-resolution key to a client that will blur it.

**Consequence worth stating plainly:** because no viewer attribute grants photo access, `gender`
carries **no permission weight anywhere in the system**. It is a Grid filter and a signup default
for `photosLocked`, nothing more. This is what makes it safe to treat gender as user-editable
data rather than a security field — and it removes any need for the KYC vendor to attest gender,
which would have hard-excluded trans women whose documents do not match.

### 2.2 Location Privacy & Triangulation Defense
- Exact coordinates are **system-internal only**. They may be used for distance computation but must never leave the service layer.
- Public proximity payloads are served from a **fuzzed** coordinate with a ~100–300m offset that is **deterministic and stable per user** — seed the offset from `userId` + a slowly-rotating server salt, or snap to a geohash grid cell.
  - **Never re-randomize the offset per request.** Random-per-read jitter is *weaker* than no jitter: an attacker polling the same profile N times averages the samples and the error collapses by √N (~200m of noise over 100 polls recovers position to ~20m). Polling a discovery feed is free.
- **Quantize distance too.** Return coarse buckets ("<1 km", "1–3 km", "3–10 km"), never exact meters — an exact distance alongside a fuzzed point leaks the true position straight back.
  - **And quantize every filter that observes distance** (D-054). Bucketing the reported value is only half the job: a free-form search radius brackets the true distance by presence and absence (1000m yes, 900m no), and a ~14-request binary search recovers it to the meter. The permitted radii and the bucket edges are one array in `distance-buckets.ts` so they cannot drift apart. The same applies to a distance-ordered **cursor** — it carries a public short id, never an encoded distance.
- Apply fuzzing **before** computing anything a client can observe. Nothing derived from the exact point may reach the response.
- Location history is not retained. `user_locations` holds the current position only; there is no append-only location log.

### 2.3 Identity & Auth Integrity
- Trust **only** JWT claims via `@CurrentUser()` / `JwtAuthGuard`. Never accept a client-supplied `userId` in a body, query, or socket payload.
- Gate elevated permissions on `isVerified` — which today means **Circle creation and nothing else**. It must never gate photo access (§2.1, D-036).
- Refresh tokens are **revocable**: persist a token/family record and check it on refresh. Logout, password/phone change, and re-verification all revoke outstanding families.
- **Rate-limit auth before anything else.** OTP-request is a direct cost-abuse vector (SMS bombing) — limit per phone number, per IP, and per device, with backoff. Write-heavy endpoints (pings, posts, uploads) are limited too, but auth is the priority.

### 2.4 Sensitive Media Handling
- KYC selfies and ID documents are **biometric data** and never share a bucket or access path with profile photos. Separate bucket/prefix, separate IAM policy, explicit retention + deletion lifecycle.
- Never log, cache, or return a KYC asset URL on any user-facing endpoint.

### 2.5 Blocking (Symmetric, and Every Surface Honours It)
- A block is **stored directionally** (who blocked whom, for abuse review) but **enforced symmetrically**. A block that only hid the blocker from the blocked user leaves the blocked user's content visible to the person who asked not to see them — the opposite of what was requested.
- **Every new surface must honour blocks**: Grid results, circle member lists, notifications, search — not just pings. Use the shared `BlocksService` (`blockedIdsAmong` is the batch form); do not re-derive "is this pair blocked" per module, for the same reason the photo-lock rule has exactly one resolver.
- **Enforce on write AND filter on read.** A pair can become blocked after a ping, chat, or membership already exists, so write-time checks alone leave every pre-existing relationship visible forever.
- **A block is indistinguishable from "no such user".** Never return a distinct error for a blocked target — it confirms both that the account exists and that it blocked you, which is exactly what someone checks after being blocked.

---

## 3. Repo Structure & Module Conventions

### Repository Layout
```text
KINNRED-v1/
├── backend/                  # NestJS API (Current Focus)
│   ├── src/
│   │   ├── modules/
│   │   │   ├── auth/         # JWT, refresh-token families, OTP state
│   │   │   ├── users/        # Myspace & user profiles
│   │   │   ├── grid/         # Proximity search, PostGIS spatial queries
│   │   │   ├── pings/        # 1:1 request lifecycle & messaging
│   │   │   ├── circles/      # Tiered communities, admin posts, group chat
│   │   │   ├── verification/ # KYC / liveness integration
│   │   │   ├── media/        # Presigned URLs, upload worker, derivatives
│   │   │   └── notifications/# Push notification dispatch (FCM/APNs)
│   │   ├── common/
│   │   │   ├── visibility/   # Shared photo-lock resolver (§2.1) — single source of truth
│   │   │   ├── blocks/       # Shared block rule (§2.5) — global, consumed by visibility too
│   │   │   ├── logging/      # Pino config + PII redaction paths
│   │   │   ├── filters/      # Global exception filter
│   │   │   └── guards/ interceptors/ pipes/ decorators/
│   │   ├── config/           # Zod env schema, validated fail-fast at boot
│   │   ├── queue/            # BullMQ setup, queue names, job options
│   │   ├── redis/            # Shared ioredis client
│   │   ├── health/           # /health (public, status only) + /health/detail
│   │   ├── prisma/           # PrismaService/PrismaModule (TypeScript only)
│   │   ├── generated/        # Prisma client — GENERATED, gitignored
│   │   ├── main.ts           # API entrypoint
│   │   ├── worker.ts         # Queue worker entrypoint (separate process)
│   │   └── app.module.ts
│   ├── prisma/               # schema.prisma + migrations (NOT under src/)
│   ├── prisma.config.ts      # Prisma 7 CLI config — connection URL lives here
│   ├── test/
│   ├── docker-compose.yml    # Postgres + PostGIS, Redis (CI/prod; see D-001)
│   └── .env.example
├── mobile/                   # React Native app (Phase 2)
├── BACKEND_PLAN.md           # Service-by-service build order
└── CLAUDE.md
```

### Module Conventions
- Every domain module follows the standard Nest shape: `*.module.ts`, `*.controller.ts`, `*.service.ts`, `dto/`.
- **Controllers stay thin.** Validation via DTOs (`class-validator`), business logic in the service, and the service is the only layer that talks to Prisma.
- Visibility and permission rules (photo lock, incognito circles, admin checks) are enforced in the **service layer on every read** — never filtered client-side, never assumed from a previous call.
- Raw SQL (PostGIS) always goes through Prisma's tagged-template `$queryRaw` / `Prisma.sql`. **Never string-concatenate SQL.**
- Use the `nest-backend-module` skill when scaffolding a module or resource.
- Use the `prisma-schema-change` skill for any schema/migration change — PostGIS `geography` columns need a specific pattern Prisma doesn't model natively.
- Use the `postgis-proximity-query` skill for any nearby/distance query on the Grid.

---

## 4. Spatial Architecture & the Location Write Path

**Reads are not the bottleneck.** `ST_DWithin` over a GIST-indexed `geography` column is single-digit milliseconds across millions of rows, distance-ordered paging uses KNN GIST (`<->`), and the Grid's filters (age, gender, online, looking-for) narrow the set *inside the same query*. Read load scales out with a replica. Keep one query path.

**Writes are the bottleneck.** Location updates are what spikes Postgres: each `UPDATE` writes a new row version (MVCC), churns the GIST index, amplifies WAL, and loads autovacuum — which is what actually falls over first. Mitigate in this order:

1. **Debounce writes** (do this from day one, it is nearly free). Only persist when the user has moved >100m or >60s has elapsed. Sub-100m movement isn't even observable through the §2.2 fuzzing.
2. **Isolate the hot row.** Location lives in a narrow `user_locations` table (`user_id`, `geog`, `geog_fuzzed`, `updated_at`) — not on the wide `users` row. Tune `autovacuum` aggressively and lower `fillfactor` on it. It is ephemeral and rebuildable, so `UNLOGGED` is on the table.

   > ⚠ **`UNLOGGED` and the read replica above are mutually exclusive** (D-051). Unlogged tables are
   > not streamed to physical standbys, so a replica serves an *empty Grid* — which reads as a
   > routing bug, not a storage decision. The table ships `UNLOGGED`; **introducing a replica means
   > `ALTER TABLE user_locations SET LOGGED` first**, which is safe precisely because the data is
   > rebuildable.

   **Two points, and only one of them is public.** `geog` is exact and system-internal; `geog_fuzzed` is the §2.2-displaced point, written by the same statement so the two cannot drift. The GIST index is on the **fuzzed column only** — every client-observable expression (`ST_DWithin`, `ST_Distance`, ordering, cursor boundary) reads it, and `geog` is left unindexed so a query that reaches for it surfaces as a sequential scan rather than as quietly-leaked precision.
3. **Only if `pg_stat` proves it's the hotspot:** buffer writes through Redis and flush dirty entries from a worker every ~10s. This uses Redis as a **write buffer, not a spatial index** — one read path, no dual-index consistency bugs, no "user missing from the Grid" failures.

Below ~100k DAU, step 1 alone is sufficient. Do not pre-build step 3.

---

## 5. Third-Party & Async Boundaries

Nothing that calls a third party blocks a user request.

- **AI categorization**: Circle is created immediately with `category = PENDING`; a worker calls the LLM and backfills. The model must be constrained to the ~20 fixed categories via structured output, and the result **re-validated against the enum server-side** before it's written — a hallucinated category must never reach the DB. Falls back to `OTHER` on failure.
- **KYC / liveness**: vendor flows are webhook-driven, not synchronous. Verification is a state machine (`PENDING → APPROVED / REJECTED / EXPIRED`) advanced by a signed, replay-protected vendor callback — "never attempted" is the *absence* of a request row, not a `NONE` state on one. The callback passes three independent guards in a fixed order: **signature over the raw body → replay via a unique `(provider, eventId)` → state, `PENDING` only** (D-038). The signature check must come first and must write nothing. Keep the provider behind a swappable interface; the mock provider refuses to construct in production, because a mock KYC provider there lets anyone self-verify.
- **Push notifications**: dispatched from a queue; token invalidation feedback is processed asynchronously.
- **Media**: upload is presigned direct-to-storage, which means the API never sees the bytes — so a **post-upload hook (storage event → worker)** is mandatory to verify real content type and size, reject what fails, and generate the blurred derivative (§2.1). There is no other point at which validation can happen.

---

## 6. Open Decisions

| Decision | Blocks | Status |
|---|---|---|
| Gender attestation for rule-3 unlock (§2.1) | Verification, Visibility | ✅ **Resolved** — rule 3 dropped entirely (D-036) |
| KYC / liveness vendor (Persona, Onfido, AWS Rekognition) | Nothing — the mock sits behind a swappable interface and refuses to boot in production (D-039) | Open |
| Admin identity model, replacing the shared `x-admin-token` on the verification decision endpoint | Deployment (D-039) | Open — close before shipping |
| Expo vs bare React Native | Push + media client contracts | Open |

---

## 7. Commands

Run from `backend/`. Full setup instructions in [backend/README.md](backend/README.md).

| Command | Purpose |
|---|---|
| `npm run start:dev` | API with watch mode (port 3000) |
| `npm run start:worker:dev` | Queue worker, separate process (§1, D-002) |
| `npm run build` | Compile to `dist/` |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint with `--fix` |
| `npm test` | Jest |
| `npm run db:generate` | Regenerate Prisma client into `src/generated/` |
| `npm run db:migrate` | Create + apply migration (dev) |
| `npm run db:deploy` | Apply migrations (production) |

**Toolchain notes that will bite if forgotten:**
- **Prisma is v7**, which differs materially from v6: connection config lives in
  `prisma.config.ts` (not `schema.prisma`), a **driver adapter is mandatory** (`@prisma/adapter-pg`),
  and the generator emits TypeScript rather than compiled JS. Do not apply v6 patterns from memory.
- `src/generated/` is gitignored — a fresh clone must `npm run db:generate` before it typechecks.
- Local dev runs on **Docker Compose**, with Postgres on **5433** and Redis on **6380** — offset
  from the defaults so they cannot collide with host-installed instances (D-014). If a query
  behaves inexplicably, confirm which instance you are connected to first.
- Health lives at bare `/health`, outside `/api/v1`. Excluding a route from the prefix also
  requires `VERSION_NEUTRAL` on the controller — doing only one leaves it versioned (D-015).

---

## 8. Decision log

Every non-obvious choice is recorded in [DECISIONS.md](DECISIONS.md) with its reasoning, what was
rejected, and what should trigger revisiting it. **Add an entry when you make a call that a future
reader would otherwise have to reverse-engineer** — particularly anything touching §2, anything
forced by a dependency's behaviour, and anything where the obvious approach was rejected.

# Backend build plan — service by service

Build order is **dependency order**, not a calendar. Each service ends with a working, testable
slice: endpoints run and the happy path is verified for real (REST client or test), not just
"it compiles". Don't start a service until the ones it depends on are functional and reviewed.

Assumes NestJS + Prisma + PostgreSQL/PostGIS + Redis + BullMQ, per [CLAUDE.md](CLAUDE.md).

## Dependency graph

```text
S0 Platform ✅
      │
      ▼
S1 Auth ✅
      │
      ▼
S2 Media ✅
      │
      ├──────────────┐
      ▼              ▼
S3 Users/Myspace ✅  S4 Verification ✅
      │                    │
      ▼                    │  (gates circle creation only)
S5 Pings ✅                │
      │                    │
      ▼                    ▼
S6 Visibility ✅ ► S7 Grid ✅  S8 Circles I ──► S9 Circles II
                                  │
                                  ▼
                     S10 Notifications ──► S11 Hardening
```

**Why this order and not the obvious one:** Grid looks like it should come early, but the
women's-safety photo rule is defined in terms of ping history — Grid cannot correctly gate a
single result until Pings exists. So Pings ships first, then the shared visibility resolver (S6),
then Grid consumes it. Media ships before Users because profile photos need the upload pipeline
and the derivative worker to exist first.

**Amended by D-036:** S4 is no longer on the path to S6. Removing rule 3 removed visibility's only
dependency on verification, so S4 now feeds **only** circle creation (S8) and the two branches are
independent.

**Next up is S8 Circles I.** S7 consumed the resolver as intended — a Grid page is one batch call
to `VisibilityService` and one exclusion list from `BlocksService`, with neither rule restated.
S8's only remaining dependency is S4, which gates circle creation and nothing else (D-036).

---

## S0 — Platform foundation

**Purpose:** everything else has a place to plug into.

- NestJS scaffold, TypeScript / ESLint / Prettier.
- `docker-compose.yml`: Postgres with PostGIS extension, Redis.
- Prisma init; enable `postgis` extension via migration.
- Config module with **env schema validation that fails fast at boot** (no silently-undefined secrets).
- Global exception filter, `ValidationPipe` with `whitelist: true` + `forbidNonWhitelisted: true`
  registered globally, request-id logging.
- **BullMQ setup + shared worker bootstrap** — stand this up now; four later services depend on it
  and retrofitting a queue is worse than having an idle one.
- `/health` endpoint (checks DB + Redis, not just process liveness).
- `.env.example`, README bootstrap steps.

**Done when:** `docker compose up` + `npm run start:dev` serves `/health` reporting DB and Redis
both reachable, and a trivial no-op job round-trips through BullMQ.

---

## S1 — Auth ✅ COMPLETE

**Purpose:** a trustworthy acting identity for every subsequent service.

> **Shipped 2026-08-17.** Phone+OTP, revocable refresh-token families with reuse detection, a
> global fail-closed `JwtAuthGuard`, `@CurrentUser()`, two-layer rate limiting, and Swagger docs.
> Verified end-to-end: 16/18 smoke assertions plus 5 validation cases (the 2 "failures" were the
> rate limiter correctly firing before validation), and 21 unit tests green.
>
> **Decisions that constrain later services:** D-017 (photo-lock is `User.photosLocked`, NOT
> derived from gender — S6 must read the column), D-020 (the guard does not hit the database, so
> `isVerified` must be re-read at every decision point), D-023 (per-IP throttling is in-memory and
> must move to Redis before scaling out).

**Depends on:** S0.

**Schema:** `User` (id, public short ID, phone, `gender`, DOB, `isVerified`, timestamps),
`RefreshTokenFamily` (id, userId, revokedAt, replacedBy, userAgent/deviceId).

**Endpoints:** OTP request, OTP verify, token refresh, logout, logout-all.

**Rules:**
- Phone + OTP (decided — `auth/` owns OTP state). OTP is hashed at rest, single-use,
  short-expiry, with an attempt counter that locks after N tries.
- JWT access token (short) + **revocable refresh-token families**. Refresh checks the family
  record; reuse of a rotated token revokes the whole family (theft detection).
- `JwtAuthGuard` + `@CurrentUser()` decorator. **No endpoint anywhere accepts a client-supplied
  `userId`** — including WebSocket payloads later.
- **Rate limiting lands here, not in a later hardening pass.** OTP-request is limited per phone,
  per IP, and per device with backoff — it's a direct SMS cost-abuse vector.
- `gender` is immutable once `isVerified` is true (see CLAUDE.md §2.1 interim hardening).

**Done when:** register → log in → hit a protected route with a bearer token → refresh → logout-all
invalidates the old refresh token. OTP spam is provably throttled.

**Watch out:** don't let the OTP endpoint reveal whether a phone number is registered.

---

## S2 — Media ✅ COMPLETE

**Purpose:** the upload pipeline and the derivative worker that the safety rule depends on.

> **Shipped 2026-08-17.** Presigned direct-to-storage upload, confirm endpoint, BullMQ worker doing
> decode-validation + EXIF strip + blur derivative, reconciliation sweep, separate KYC bucket.
> Verified end-to-end against real storage: **20/20 smoke assertions**, including a fixture
> carrying real GPS EXIF proving it is stripped. **34 unit tests** green.
>
> **Storage:** Cloudflare R2 in production; MinIO in `docker-compose.yml` for local development.
> Same S3 API — switching is 7 env vars and `npm run storage:init`, no code change (D-026).
>
> **Deviation from the plan below:** R2 has no S3-style bucket event notifications without
> Cloudflare Queues, which would couple us to Cloudflare. The trigger is instead a client
> `POST /media/:id/confirm`, with the worker independently fetching and validating the object — the
> client is trusted only to say "done", never about content.

**Depends on:** S0, S1.

**Schema:** `MediaAsset` (id, ownerId, kind `PROFILE_PHOTO | KYC_DOC`, storageKey,
blurredKey, status `PENDING | READY | REJECTED`, contentType, bytes, createdAt).

**Endpoints:** request presigned upload URL, confirm upload, delete asset.

**Rules:**
- Presigned **direct-to-storage** upload; API never buffers bytes.
- Because the API never sees the bytes, a **storage-event → worker hook is mandatory**: verify real
  content type via magic bytes (not the client's header), enforce size caps, reject and mark
  `REJECTED` on failure, strip EXIF (**GPS EXIF on a profile photo defeats §2.2 entirely**), and
  **generate the blurred derivative** under a separate key.
- Asset is not readable by anyone until the worker marks it `READY`.
- Reads are issued as **≤5 min presigned URLs**, minted per request — never stored, never cached in
  a response body that outlives the TTL.
- **KYC assets use a separate bucket/prefix with their own IAM policy and retention lifecycle.**
  A KYC key must never be returned by a user-facing endpoint.

**Done when:** an authenticated user uploads a photo directly to storage, the worker produces both
a stripped original and a blurred derivative, and a fresh short-TTL URL is issued on read. An
upload with a spoofed content type is rejected.

---

## S3 — Users / Myspace ✅ COMPLETE

**Purpose:** the profile surface.

> **Shipped 2026-08-17.** Profile, settings, QR code, public profile by short id, and "who viewed
> me". **33/33 smoke assertions**, 44 unit tests.
>
> **Amended by D-036:** the `stay_locked_regardless` setting shipped here has since been **dropped**.
> It existed only to opt out of rule 3, and rule 3 no longer exists.
>
> **`VisibilityService` now exists** as a deliberately over-restrictive stub (D-032) — a locked
> profile is blurred for everyone but its owner, with no unlock path. S6 replaces `decide()` only;
> the fail-closed, batch-first, decision-separate-from-rendering properties are already fixed and
> test-guarded.
>
> **Open question resolved:** "who viewed me" is symmetric (D-033) — browsing invisibly costs you
> your own viewer list.

**Depends on:** S1, S2.

**Schema:** `Profile` (bio, interests, looking-for, photo ordering), `UserSettings`, `ProfileView`
(viewerId, viewedId, viewedAt) for "who viewed your profile".

**Endpoints:** get/update own profile, get another user's profile, settings CRUD, QR payload for
the public short ID.

**Rules:**
- Profile reads of *another* user must go through the visibility resolver — **stub it here** as a
  deliberately over-restrictive placeholder (locked unless it's your own profile) and replace it in
  S6. Never ship an unguarded photo read "temporarily".
- QR encodes the public short ID only. **No phone numbers are ever exposed between users.**
- Decide now whether "who viewed your profile" is itself gated — a locked-profile owner seeing her
  viewers can leak information about a viewer who has not pinged her.

**Done when:** a user can create/edit their profile, attach uploaded photos, read settings, and
fetch their QR. Another user's profile fetch returns locked photos.

---

## S4 — Verification ✅ COMPLETE

**Purpose:** the `isVerified` flag that gates circle creation. **And nothing else** — see below.

> **Shipped 2026-08-17.** Submit / status / vendor webhook / admin decision, a mock KYC provider
> behind a swappable interface, and an hourly expiry sweep in the worker.
> **26/26 smoke assertions**, 44 unit tests (88 across the suite).
>
> **The blocker is gone, not deferred.** Rule 3 — verified-female photo unlock — was **removed
> entirely** (D-036). Nothing can attest gender: it is self-declared, and liveness proves *a live
> human matching the profile photos*, not gender. The exploit was declare `FEMALE` → pass liveness →
> read every locked profile. So `isVerified` now gates **circle creation only** and never photo
> access, and `gender` carries no permission weight anywhere in the system.
>
> **`gender` is NOT frozen on approval.** An earlier draft of this section said it was, and that
> `isVerified` should be revoked on a gender change. Both were consequences of rule 3 and both are
> gone with it (D-017, D-036) — gender is ordinary user-editable profile data.

**Depends on:** S1, S2 (KYC bucket), S0 (queue).

**Schema:** `VerificationRequest` (userId, state `PENDING | APPROVED | REJECTED | EXPIRED`, provider,
providerRef, selfie/document asset ids, decidedBy, decidedAt, reason) and `KycWebhookEvent`
(provider, eventId — the unique replay ledger). No `NONE` state: "never attempted" is the absence of
a row, not a row claiming nothing happened.

**Endpoints:** `POST /verification` (submit), `GET /verification/status`, `POST
/verification/webhook` (public, HMAC-authenticated), `POST /verification/:id/decide` (admin token).

**What shipped, and the reasoning that must survive a refactor:**
- **Submission takes media asset ids, never bytes.** KYC images therefore follow the same validated
  pipeline as everything else and land in the separate KYC bucket (CLAUDE.md §2.4). Assets are
  checked for ownership (404, not 403 — a 403 is an existence oracle), `KYC_DOCUMENT` kind, and
  `READY` status.
- **Three independent webhook guards, in a fixed order** (D-038): signature over the **raw body** →
  replay via a unique `(provider, eventId)` → state, `PENDING` only. The signature check must stay
  first and must write nothing, or observed event ids can be burned to block the real callback.
- **`rawBody: true` in `main.ts` is load-bearing**, not incidental — signatures cover exact bytes.
- **One live attempt per user**, so unlimited billable vendor sessions cannot be opened. That guard
  is what makes the **hourly expiry sweep a correctness requirement** (D-040): without it a dropped
  webhook locks a user out of verification permanently.
- **`MockKycProvider` refuses to construct in production** (D-039). A mock KYC provider in production
  means anyone who reaches the webhook self-verifies.
- **`applyDecision` is the only place `isVerified` is ever written**, inside a transaction with the
  request state.

**Done when:** ✅ a user submits, ✅ a signed callback flips `isVerified`, ✅ a forged signature is a
401 that verifies nobody, ✅ a replayed callback is a no-op, ✅ a late callback cannot re-decide a
settled request, ✅ a rejected user may retry.

**Left for later, deliberately:**
- **The admin endpoint is a stopgap.** A shared `x-admin-token` with no admin identity model —
  decisions are attributable to whoever holds a secret, not to a person. Must be replaced before
  deployment (S11).
- **The real vendor is still unchosen.** Swapping one in is a single binding in
  `verification.module.ts`; nothing outside `kyc/` knows a vendor payload shape.

---

## S5 — Pings ✅ COMPLETE

**Purpose:** the 1:1 lifecycle, and the ping history the safety rule reads from.

> **Shipped 2026-08-17.** Full lifecycle, messaging with cursor-paginated history, read receipts,
> blocking, and a Socket.io gateway on the Redis adapter.
> **59/59 smoke assertions** (run against **two API instances**), 60 unit tests (148 across the
> suite).
>
> **This unblocks S6.** Ping history now exists, which was the only thing the visibility resolver
> was waiting on.

**Depends on:** S1, S3.

**Schema:** `Ping` (**`pairKey` unique**, fromId, toId, state `PENDING | ACCEPTED | REJECTED`,
openingMessage, lastMessageAt), `Message` (pingId, senderId, body, sentAt, readAt), `Block`
(blockerId, blockedId, unique on the pair).

**Endpoints:** `POST /pings`, `POST /pings/:id/accept`, `POST /pings/:id/reject`, `DELETE /pings/:id`
(withdraw), `GET /pings/requests|sent|chats`, `GET|POST /pings/:id/messages`, `POST /pings/:id/read`,
and `GET|POST /blocks`, `DELETE /blocks/:publicShortId`.

**What shipped, and the reasoning that must survive a refactor:**
- **One row per unordered pair** via a unique `pairKey` (D-042). This is the structural core:
  a REJECTED row occupies the pair's only slot, so **rejection is terminal by database constraint**
  rather than by a check in `send()` that a refactor could drop. Terminal in both directions — the
  accepted cost is that the decliner also cannot later initiate.
- **A ping back is an acceptance** (D-043). Mutual consent expressed the long way round; erroring
  instead would be an existence oracle about someone who has not consented to contact.
- **Withdrawal deletes the row**, so it frees the pair and leaves the recipient no trace.
- **Blocks: stored directionally, enforced symmetrically, reported as 404** (D-044). Filtered on
  read as well as enforced on write, because a pair can become blocked after the ping exists.
- **Rate limiting counts only NEW connections** — replying and accepting are free, or a popular
  user is limited out of answering the people who contacted them.
- **Everything is addressed by public short id.** No endpoint accepts or returns an internal user
  id, asserted explicitly in both the unit and smoke tests.

**Realtime:** Socket.io with the **Redis adapter wired from the start** (D-046), authenticated at
the handshake off the JWT.
- **The gateway delivers; REST writes** (D-045). No client-to-server message events — one write
  path means validation, block checks and ping-state authorisation exist in exactly one place.
- The service depends on a `REALTIME` seam, not the gateway, so a socket failure can never abort a
  committed write.

**Done when:** ✅ two users ping, accept, and exchange messages in real time across **two separate
API instances** — the smoke test connects the recipient to instance B and drives every write through
instance A, because on a single instance those assertions pass whether or not the adapter is wired.

**Found and fixed while building (D-047):** socket auth originally ran in `handleConnection`, which
fires *after* the connection is established — a bogus token completed a handshake and fired the
client's `connect` event before being torn down. Moved into connection middleware, which refuses the
upgrade outright. A regression test pins it.

---

## S6 — Visibility (shared resolver) ✅ COMPLETE

**Purpose:** one auditable implementation of the photo-lock rule. This is the most safety-critical
code in the backend — it is a service, not a helper scattered across modules.

> **Shipped 2026-08-18.** `decide()` replaced with the real rule; the stub's fail-closed,
> batch-first, decision-separate-from-rendering properties carried over untouched. **26 unit tests**
> on the resolver alone (162 across the suite), covering every cell of the matrix.
>
> **The three cells §2.1 did not specify, decided in D-049:** a `PENDING` ping *from the owner*
> unlocks (and withdrawing it deletes the row, so the unlock revokes itself); `REJECTED` unlocks in
> neither direction, because rejection is terminal and the owner could not otherwise revoke; a
> **block overrides everything** and returns `LOCKED`, which is the only way to catch a pair that
> accepted first and blocked afterwards.
>
> **Two cases needed no code at all**, which is D-042/D-043 paying out: a ping back mutates the
> existing row to `ACCEPTED` and unlocks through the ordinary path, and withdrawal deletes the row
> so revocation is the absence of a rule rather than a rule.
>
> **Forced move (D-050):** `BlocksService` relocated from `modules/pings/` to `common/blocks/` as a
> `@Global` module — `common/` must not depend on a domain module. That audit also found
> `GET /users/:publicShortId` **never checked blocks at all**: a blocked user could still read a
> target's bio, interests and age, and the request recorded a profile view. Now a 404 identical to
> the unknown-user response.

**Depends on:** S3, **S5** — no longer S4. Removing rule 3 (D-036) removed this service's only
dependency on verification. It needs ping history and nothing else.

**Deliverable:** `common/visibility/VisibilityService` — given a viewer and a set of target users,
returns per-target photo access (`LOCKED | BLURRED | UNLOCKED`) plus the keys to sign.

**Rules encoded (CLAUDE.md §2.1):** if `User.photosLocked` is true, unlock **iff** the owner pinged
the viewer **or** the owner accepted the viewer's ping. **That is the complete list.** Both are
actions the *owner* took.

⚠️ **No viewer attribute unlocks anything.** Not `gender`, not `isVerified`, not anything added
later. Rule 3 (verified-female unlock) was removed entirely because nothing can attest gender — the
exploit was declare `FEMALE` → pass liveness → read every locked profile (D-036). If a proposed
feature would add a viewer-attribute unlock, it is a change to CLAUDE.md §2.1 and needs sign-off.

⚠️ **Read `photosLocked`, never `gender`** (D-017). Gender is a Grid filter, not an authorisation
input.

**Must be:**
- **Batch-capable.** Grid resolves 50 profiles per page; a per-user query is an N+1 that will push
  you toward caching it, and a cached stale unlock is a safety failure.
- The **only** place the rule exists. S3's stub (D-032) has its `decide()` replaced here; its
  fail-closed, batch-first, decision-separate-from-rendering properties already hold and are
  test-guarded — do not regress them while swapping the rule in.
- Covered by an explicit test matrix: ping state × direction × ping status × `photosLocked`. Smaller
  than the original matrix precisely because no viewer attribute participates. Still the test suite
  that matters most in the whole project.

**Done when:** ✅ the matrix passes, ✅ S3's profile read is routed through it, ✅ grepping for
`photosLocked` finds it read as an authorisation input in exactly one file (elsewhere it is only
seeded at signup and edited by its owner), and ✅ the resolver's target query selects `id` and
`photosLocked` and nothing else — asserted by a test, so no viewer attribute can be reached for.

---

## S7 — Grid ✅ COMPLETE

**Purpose:** proximity discovery.

> **Shipped 2026-08-18.** `user_locations` + `PUT/DELETE /grid/location` + `GET /grid/nearby`.
> **52 unit tests** across the Grid's three specs (214 across the suite), plus a **46-assertion** end-to-end smoke run
> against the real API and a real PostGIS instance — which is where this stage's risk actually lives,
> since unit tests mock Prisma and cannot catch a malformed spatial expression or a parameter-type
> inference failure.
>
> **who-viewed-me needed no work:** S3 already shipped it as `GET /users/me/viewers`, batch-resolved
> through `VisibilityService`, with the invisibility symmetry rule attached. It is listed under this
> stage's endpoints below, but it was never outstanding.
>
> **The fuzzed point became a stored column (D-051).** `geog` and `geog_fuzzed` are written by one
> statement; the GIST index is on the fuzzed one only and every client-observable expression reads
> it. That turns "fuzz before computing anything observable" from a rule each future query must
> remember into a property of the schema — the exact value is simply not in scope. `geog` is left
> deliberately unindexed so a query that reaches for it surfaces as a sequential scan rather than as
> quietly-leaked precision. Verified: `EXPLAIN` shows `Index Scan using user_locations_geog_fuzzed_idx`,
> and the stored displacements measure 173–199 m.
>
> **The radius filter had to be quantised too (D-054).** Bucketing the reported distance is only half
> the job: a free-form radius brackets the true distance by presence/absence (1000m yes, 900m no) and
> a ~14-request binary search recovers it to the meter. `GRID_RADIUS_METERS` is now one array serving
> as both the permitted radii and the bucket edges. The cursor carries a public short id rather than
> an encoded distance for the same reason.
>
> **`online` needed no new infrastructure (D-052).** The write debounce persists at least once a
> minute for any client still posting, so `updated_at` *is* the liveness signal. Redis heartbeats
> were rejected as a second source of truth that disagrees precisely when it is stale.
>
> **Blocks entered as a list, not a predicate (D-053).** §2.5 forbids re-deriving the block rule per
> module; the proximity skill forbids post-query filtering (it breaks page sizes and pagination).
> New `BlocksService.blockedIdsFor` resolves it — the SQL excludes ids it was handed and never
> expresses what "blocked" means. A test asserts the generated query does not mention the blocks
> table at all.
>
> **⚠ Carried forward:** the table is `UNLOGGED` per §4, which excludes it from streaming
> replication. Introducing the read replica §4 also calls for requires `ALTER TABLE user_locations
> SET LOGGED` first, or the Grid returns nothing on the replica (D-051).

**Depends on:** S6, S3.

**Schema:** narrow **`user_locations`** table (`user_id`, `geog` geography(Point,4326),
`updated_at`) with a GIST index — deliberately *not* on the wide `users` row (CLAUDE.md §4).
Current position only; **no location history**.

**Endpoints:** update location, delete location, nearby search (filters: age, gender, distance,
online, looking-for), who-viewed-me *(already shipped in S3)*.

**Rules:**
- ✅ `ST_DWithin` via Prisma `$queryRaw` tagged templates — **never concatenated SQL**.
- ✅ **Write debounce from day one:** persist only on >100m movement or >60s elapsed. This is the
  single cheapest thing protecting Postgres, and it's invisible to users given the fuzzing radius.
- ✅ **Fuzzing (CLAUDE.md §2.2):** deterministic per-user offset seeded from `userId` + rotating
  salt — *never re-randomized per request*, which averages away under polling. Distance is returned
  as coarse buckets, never exact meters. **And the radius filter is quantised to the same edges**
  (D-054), without which the buckets are decoration.
- ✅ Every result is resolved through `VisibilityService` in **one batch call**.
- ✅ Exclude blocked pairs and users who have disabled discovery.
- ✅ Cursor pagination — offset paging over a moving distance-sorted set duplicates and skips users.

**Done when:** ✅ nearby search returns correctly filtered, correctly gated, correctly fuzzed
results; ✅ polling the same target 100× yields an identical fuzzed point (asserted end-to-end
against the running API, waiting out the deliberate 30/min throttle); and ✅ no exact coordinate or
exact distance appears anywhere in a response body.

**Next up is S8 Circles.**

---

## S8 — Circles I (structure + membership)

**Purpose:** the differentiator surface.

**Depends on:** S4 (verified gate), S1.

**Schema:** `Circle` (shortId, name, description, tier `OPEN | INVITE_ONLY | INCOGNITO`, category,
categoryStatus, adminId), `CircleMember` (role `ADMIN | MEMBER`), `JoinRequest`, `CircleInvite`.

**Endpoints:** create, update, get by short ID, search/browse, join, request-to-join,
approve/reject, invite, leave, kick.

**Rules:**
- **Circle creation gates on `isVerified`.**
- **Incognito circles must be invisible on every read path** — search, browse, get-by-short-ID, and
  member-list — to anyone not explicitly invited. Treat "not invited" as 404, never 403 (a 403
  confirms existence). This is the same class of rule as the photo lock: enforce server-side on
  every read, and test it as a matrix.
- **AI categorization is async (CLAUDE.md §5):** circle is created immediately with
  `category = PENDING`; a worker calls the LLM, and the response is **re-validated against the
  fixed ~20-value enum server-side** before write. Falls back to `OTHER`. Circle creation never
  blocks on, or fails because of, the LLM.
- Short ID must be collision-safe and non-enumerable (don't use a sequence).

**Done when:** a verified user creates a circle of each tier, join rules behave per tier,
an incognito circle 404s for a non-invited user across *all* read paths, and categorization
backfills without blocking creation.

---

## S9 — Circles II (posts + chat)

**Purpose:** activity inside a circle.

**Depends on:** S8, S5 (gateway).

**Schema:** `CirclePost` (authorId, body, scheduledFor, reminderAt), `CircleMessage`,
`Circle.chatEnabled`.

**Rules:**
- Posts are admin-authored; timers/reminders/schedules enqueue delayed jobs (BullMQ delayed jobs,
  not a polling cron).
- Group chat reuses S5's gateway and Redis adapter. Admin can enable/disable.
- **Re-check membership and role on every message and every read** — do not trust a socket room
  join from earlier in the session; membership can be revoked mid-connection. A kicked member must
  stop receiving messages immediately.

**Done when:** an admin posts with a reminder that fires, members chat when enabled, a
non-member receives nothing, and a kicked member's live socket stops delivering.

---

## S10 — Notifications

**Purpose:** push dispatch.

**Depends on:** S0 (queue), S5, S8, S9.

**Schema:** `DeviceToken` (userId, platform, token, lastSeenAt, invalidatedAt).

**Rules:**
- **Queue-dispatched only** — never inline in the triggering request.
- Triggers: new ping, ping accepted, new circle post, circle invite.
- Process FCM/APNs invalidation feedback asynchronously and prune dead tokens.
- **Notification content must respect visibility.** A push preview must not leak a locked photo,
  an exact location, or the existence of an incognito circle.
- Respect per-user notification settings and quiet hours.

**Done when:** each trigger produces a push through the queue, dead tokens are pruned, and no
notification body leaks gated content.

---

## S11 — Hardening & deployment prep

**Depends on:** everything.

- End-to-end pass: signup → verify → grid → ping → chat → circle → post → notification.
- **Security review** against CLAUDE.md §2, specifically:
  - `JwtAuthGuard` on every non-public route (audit by enumerating routes, not by reading code).
  - Visibility matrix re-verified; confirm exactly one implementation exists.
  - Incognito-circle invisibility re-verified on every read path.
  - All PostGIS raw SQL uses tagged templates.
  - No exact coordinates or distances in any response.
  - Rate limits present on auth, pings, posts, uploads.
- Swagger/OpenAPI generation.
- Production Docker image, secrets checklist, migration-on-deploy strategy, structured logging with
  PII redaction.

---

## Cross-cutting rules that apply to every service

1. New protected route → `JwtAuthGuard` + `@CurrentUser()`, never a body `userId`.
2. New photo-bearing read path → route it through `VisibilityService`.
3. New third-party call → it goes in a worker, not the request path.
4. New geo query → `$queryRaw` tagged template, fuzzed output, bucketed distance.
5. New list endpoint → cursor pagination, and confirm blocked pairs are excluded.

## Open decisions

| Decision | Blocks | Status |
|---|---|---|
| Gender attestation for the verified-female unlock | S4, S6 | ✅ **Resolved** — rule 3 dropped entirely (D-036) |
| Is "who viewed me" gated for locked profiles? | S3 | ✅ Resolved — symmetric setting (D-033) |
| KYC / liveness vendor | nothing — mock ships behind a swappable interface (D-039) | Open |
| Admin identity model to replace the shared `x-admin-token` | S11 | Open — must close before deployment |
| Re-ping allowed after rejection? | S5 | ✅ **Resolved** — no, and enforced by the unique pair key rather than a check (D-042) |
| Expo vs bare React Native | S10 client contracts | Open |

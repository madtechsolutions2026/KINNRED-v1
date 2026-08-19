# External Services — the paid-vendor register

Every third party Kinnred talks to that **bills us per call, per message, or per byte**, plus what
it would cost if abused. One row per vendor boundary, kept current as services land.

**Add an entry the moment a new vendor boundary appears — before the integration is written**, not
after. A boundary that isn't in this file is a bill nobody is expecting.

**Scope.** This file covers *metered third parties*. Postgres and Redis are self-hosted
infrastructure with a flat cost that doesn't move with user behaviour — they belong in deployment
docs, not here. The test is: *can a stranger with a script make this line item go up?* If yes, it
belongs here.

**The rule every entry below follows** (CLAUDE.md §5): nothing that calls a third party blocks a
user request, and every vendor sits behind an interface with an injection token so it can be
swapped without touching the calling service.

---

## Status at a glance

| # | Service | Purpose | Status | Billed on |
|---|---|---|---|---|
| 1 | **SMS / OTP delivery** | Signup + login codes | 🟡 Mock (logs to console) | Per message sent |
| 2 | **KYC / liveness** | `isVerified`, gates circle creation | 🟡 Mock (auto-approves) | Per verification attempt |
| 3 | **Object storage (R2/S3)** | Profile media + KYC documents | 🟢 Real SDK wired | Stored GB + operations |
| 4 | **LLM categorization** | Circle category on creation | ⚪ Not built (S8) | Per token |
| 5 | **Push (FCM / APNs)** | Ping + message notifications | ⚪ Not built (S10) | Free tier, see notes |

🟢 real vendor · 🟡 mock stands in, vendor undecided · ⚪ not yet built

---

## 1 · SMS / OTP delivery

| | |
|---|---|
| **Boundary** | `backend/src/modules/auth/sms/sms-provider.interface.ts` (`SMS_PROVIDER`) |
| **Current impl** | `sms/mock-sms.provider.ts` — writes the code to the log, sends nothing |
| **Bound in** | `auth/auth.module.ts` → `{ provide: SMS_PROVIDER, useClass: MockSmsProvider }` |
| **Called from** | `AuthService.requestOtp` |
| **Vendor** | **Undecided.** MSG91 / Twilio are the candidates for India |
| **Cost driver** | One outbound SMS per OTP request. Roughly ₹0.15–0.25 per message domestically; international is an order of magnitude worse |

**Why it's still a mock** (DECISIONS.md D-019): the vendor is an open decision, and Indian DLT
template registration takes days. The flow had to be exercisable end-to-end before that lands. The
mock **throws at construction when `NODE_ENV=production`** — a live login code in log storage is a
credential leak, and logs get shipped to aggregators and retained for months.

**Cost controls already in place:**
- Per-phone cap, counted in Redis — `OTP_MAX_PER_PHONE_PER_HOUR`, default 3, window set only on
  first increment so a burst can't push its own expiry out.
- `ThrottlerGuard` per IP on the controller. This is a *second* layer, not a substitute: an attacker
  rotating IPs sails past it while still billing us for every message.
- Requesting a new code consumes any earlier live challenge, so codes can't accumulate.

**This is the app's single largest cost-abuse surface.** SMS bombing is cheap to run and bills the
victim — us. Treat any change that loosens the per-phone cap as a spend decision.

**Before production:**
- [ ] Pick a vendor; write `<vendor>-sms.provider.ts` next to the mock
- [ ] Swap the one `useClass` line in `auth.module.ts`
- [ ] Add a `SMS_PROVIDER` env key mirroring `KYC_PROVIDER` — see the asymmetry note below
- [ ] Complete DLT template registration (start early; it gates launch)
- [ ] Set a hard monthly spend cap in the vendor console, not just in our code

**Env:** `OTP_TTL_SECONDS`, `OTP_MAX_ATTEMPTS`, `OTP_MAX_PER_PHONE_PER_HOUR`. No vendor credentials
yet.

> ⚠ **Asymmetry worth closing.** KYC selects its provider through a validated env key
> (`KYC_PROVIDER: z.enum(['mock'])`), so production deployment fails at boot on a bad value. SMS is
> hardcoded to `MockSmsProvider` in the module instead. The production guard inside the mock still
> catches the dangerous case, but the two boundaries should be configured the same way.

---

## 2 · KYC / liveness

| | |
|---|---|
| **Boundary** | `backend/src/modules/verification/kyc/kyc-provider.interface.ts` (`KYC_PROVIDER`) |
| **Current impl** | `kyc/mock-kyc.provider.ts` |
| **Bound in** | `verification/verification.module.ts` |
| **Vendor** | **Undecided** — Persona, Onfido, AWS Rekognition (CLAUDE.md §6) |
| **Cost driver** | Per verification attempt. Typically $0.50–$2.00 each, and **retries usually bill again** |

Webhook-driven, never synchronous. The callback passes three guards in a fixed order — signature
over the raw body → replay via unique `(provider, eventId)` → state, `PENDING` only (D-038). The
mock **refuses to construct in production**: a mock KYC provider there lets anyone self-verify.

**What it does *not* need:** gender attestation. The verified-female photo unlock was removed
(D-036), so no vendor gender check is required — which is what lets us avoid a check that would have
hard-excluded trans women whose documents don't match.

**Cost note specific to this one:** vendors bill on *attempts*, not approvals, so a user retrying a
failed liveness check five times costs five times. Whatever retry allowance we expose to users is
directly a spend decision.

**Before production:** pick the vendor, implement the adapter, extend the `KYC_PROVIDER` enum, and
**close the admin identity model** — the decision endpoint is still on a shared `x-admin-token`
(CLAUDE.md §6).

**Env:** `KYC_PROVIDER`, `KYC_WEBHOOK_SECRET` (≥32 chars), `KYC_REQUEST_TTL_HOURS`.

---

## 3 · Object storage — Cloudflare R2 / S3

| | |
|---|---|
| **Boundary** | `backend/src/modules/media/storage/storage.service.ts` |
| **Current impl** | **Real** — `@aws-sdk/client-s3`, R2 in production, MinIO locally (D-026) |
| **Cost driver** | Stored GB/month + Class A (write) and Class B (read) operations. **R2 charges no egress**, which is why it was chosen over S3 |

The only vendor on this list that is genuinely wired. Uploads are presigned direct-to-storage, so
the API never sees the bytes — meaning a post-upload hook (storage event → worker) is the *only*
place content type and size can be validated (CLAUDE.md §5).

**Two clients, two credential sets, two buckets** — profile media and KYC biometrics must not be
reachable with the same key (CLAUDE.md §2.4). The duplication in that file is the security control;
don't let a refactor "simplify" it into one client.

**Cost controls:** presigned read URLs are ≤5 min (`STORAGE_READ_TTL_SECONDS`), which caps
re-fetching as much as it caps leakage. Size limits are enforced in the post-upload worker — the
presigned PUT itself can't reject an oversized body, so that worker is also the spend control.

**Env:** `STORAGE_ENDPOINT`, `STORAGE_REGION`, `STORAGE_MEDIA_BUCKET` + its key pair,
`STORAGE_KYC_BUCKET` + its **separate** key pair, `STORAGE_READ_TTL_SECONDS`,
`STORAGE_UPLOAD_TTL_SECONDS`.

**Watch:** a retention/deletion lifecycle for KYC assets is required (CLAUDE.md §2.4) and is both a
compliance obligation and the thing that stops biometric storage growing forever.

---

## 4 · LLM circle categorization — not built

| | |
|---|---|
| **Lands in** | S8 · queue `CATEGORIZATION` (reserved in `queue/queue.constants.ts`) |
| **Vendor** | Undecided |
| **Cost driver** | Per token, on every circle creation |

Circle is created immediately with `category = PENDING`; a worker calls the model and backfills.
Output must be constrained to the ~20 fixed categories via structured output **and re-validated
against the enum server-side** — a hallucinated category must never reach the DB. Falls back to
`OTHER` on failure.

**Cost shape when it lands:** bounded by circle-creation volume, which is gated on `isVerified` —
so KYC is an unplanned rate limiter on this line item. Inputs are short (circle name + description),
so pick the cheapest adequate model and cap output tokens hard. Retries on a malformed response are
the thing most likely to multiply the bill unexpectedly; bound them.

---

## 5 · Push notifications — not built

| | |
|---|---|
| **Lands in** | S10 · queue `NOTIFICATIONS` (reserved) |
| **Vendor** | FCM (Android) + APNs (iOS) |
| **Cost driver** | **Both are free at any volume we will reach.** Listed because it's an external dependency with a failure and quota surface, not because it bills |

Dispatched from a queue; token invalidation feedback processed asynchronously. The real risk here is
quota and reputation, not spend — and it becomes a paid line item the moment a relay (Expo's push
service, OneSignal, Firebase paid tiers) is introduced. **If a relay is chosen, revisit this entry.**

---

## Adding a new vendor

1. Define the boundary interface + injection `Symbol` in the owning module.
2. Write the mock first, and make it **refuse to construct in production** if a permissive mock there
   would be a security hole (SMS: leaked codes; KYC: self-verification).
3. Select the impl through a validated env enum so a bad value fails at boot.
4. Put every call in a worker — never the request path.
5. Rate-limit whatever a stranger can trigger, and check the *per-identity* limit exists, not just
   the per-IP one.
6. **Add the row here, and set a spend cap in the vendor's own console.** Our limits protect against
   the abuse we predicted; the vendor cap is what protects against the abuse we didn't.

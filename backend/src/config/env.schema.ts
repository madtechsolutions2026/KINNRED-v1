import { z } from 'zod';

/**
 * The environment contract.
 *
 * This schema is the single source of truth for configuration (DECISIONS.md
 * D-003). The AppConfig type is *inferred* from it, so config access is typed
 * end-to-end and a key that is not declared here cannot be read.
 *
 * Validation runs at boot and throws. See `validateEnv` for why that is
 * non-negotiable rather than a nice-to-have.
 */
export const envSchema = z
  .object({
    // --- Runtime -------------------------------------------------------------
    NODE_ENV: z
      .enum(['development', 'test', 'production'])
      .default('development'),

    // Env vars are always strings; coerce, then constrain to a real port range
    // so a typo'd "300O" fails at boot instead of binding somewhere unexpected.
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),

    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace'])
      .default('info'),

    // --- Database ------------------------------------------------------------
    // Prisma needs a postgres:// or postgresql:// URL. Checking the prefix here
    // turns an obscure Prisma runtime error into an explicit boot failure.
    DATABASE_URL: z
      .string()
      .min(1, 'DATABASE_URL is required')
      .refine(
        (url) =>
          url.startsWith('postgres://') || url.startsWith('postgresql://'),
        'DATABASE_URL must be a postgres:// or postgresql:// connection string',
      ),

    // --- Redis ---------------------------------------------------------------
    REDIS_HOST: z.string().min(1).default('localhost'),
    REDIS_PORT: z.coerce.number().int().min(1).max(65535).default(6379),
    // Empty locally (Memurai, no auth). Optional rather than defaulted to '' so
    // we can distinguish "not set" from "deliberately blank" at the call site.
    REDIS_PASSWORD: z.string().optional(),

    // --- Queue ---------------------------------------------------------------
    QUEUE_PREFIX: z.string().min(1).default('kinnred'),

    // --- Auth (S1) -----------------------------------------------------------
    // No default, and a hard minimum length. A signing key with a fallback
    // default is the single most dangerous kind of config: every deployment
    // that forgets to set it shares the same key, and anyone who reads the
    // source can mint valid tokens for any user.
    JWT_SECRET: z
      .string()
      .min(
        32,
        'JWT_SECRET must be at least 32 characters — generate one, do not invent it',
      ),

    /// Short-lived on purpose: an access token cannot be revoked, so its
    /// blast radius is bounded only by how quickly it expires.
    ///
    /// The regex is not decoration — jsonwebtoken accepts a `ms`-style duration,
    /// and an unparseable value ("15min") is interpreted as *milliseconds*,
    /// silently producing tokens that expire almost immediately.
    JWT_ACCESS_TTL: z
      .string()
      .regex(
        /^\d+[smhd]$/,
        'JWT_ACCESS_TTL must look like 15m, 3600s, 2h or 7d',
      )
      .default('15m'),

    /// Long-lived, but revocable — refresh tokens are tracked in the database
    /// as families and can be withdrawn (see RefreshTokenFamily).
    JWT_REFRESH_TTL: z
      .string()
      .regex(/^\d+[smhd]$/, 'JWT_REFRESH_TTL must look like 30d, 12h or 900s')
      .default('30d'),

    /// OTP lifetime. Short window shrinks the guessing budget.
    OTP_TTL_SECONDS: z.coerce.number().int().min(30).max(900).default(300),

    /// Wrong guesses before the challenge is dead. With 6 digits this is what
    /// makes brute force infeasible: 5 tries against 1,000,000 codes.
    OTP_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(10).default(5),

    /// Max OTP requests per phone number per hour. This is the SMS cost-abuse
    /// control — without it, one script can bill you for unlimited messages.
    OTP_MAX_PER_PHONE_PER_HOUR: z.coerce.number().int().min(1).default(3),

    // --- Object storage (S2) -------------------------------------------------
    // Named STORAGE_* rather than R2_* on purpose. Cloudflare R2 is the choice
    // today, but it is S3-compatible, so moving to AWS S3 or a local MinIO is an
    // endpoint + credential change and nothing else (DECISIONS.md D-026).
    //
    // R2: https://<ACCOUNT_ID>.r2.cloudflarestorage.com
    STORAGE_ENDPOINT: z.string().url('STORAGE_ENDPOINT must be a full URL'),

    /// R2 ignores region but the S3 SDK requires one; "auto" is R2's convention.
    STORAGE_REGION: z.string().min(1).default('auto'),

    // Profile media and KYC documents live in SEPARATE buckets with SEPARATE
    // credentials (CLAUDE.md §2.4). This is the whole point: a leaked or
    // over-broad media token must not be able to reach biometric ID documents.
    // Do not "simplify" these into one shared credential.
    STORAGE_MEDIA_BUCKET: z.string().min(1),
    STORAGE_MEDIA_ACCESS_KEY_ID: z.string().min(1),
    STORAGE_MEDIA_SECRET_ACCESS_KEY: z.string().min(1),

    STORAGE_KYC_BUCKET: z.string().min(1),
    STORAGE_KYC_ACCESS_KEY_ID: z.string().min(1),
    STORAGE_KYC_SECRET_ACCESS_KEY: z.string().min(1),

    /// TTL for presigned READ URLs. Capped at 5 minutes by CLAUDE.md §2.1: a
    /// presigned URL is a bearer capability that keeps working until it expires,
    /// even if the owner blocks the viewer or re-locks their photos in between.
    STORAGE_READ_TTL_SECONDS: z.coerce
      .number()
      .int()
      .min(30)
      .max(300)
      .default(300),

    /// TTL for presigned UPLOAD URLs. Longer than reads — a phone on a poor
    /// connection needs time to finish — but still bounded.
    STORAGE_UPLOAD_TTL_SECONDS: z.coerce
      .number()
      .int()
      .min(60)
      .max(3600)
      .default(900),

    /// Hard ceiling on a single upload, enforced twice: declared up front in the
    /// presigned URL's content-length condition, and re-checked against the
    /// actual object by the worker. The client is never trusted about size.
    MEDIA_MAX_UPLOAD_BYTES: z.coerce
      .number()
      .int()
      .min(1024)
      .default(10 * 1024 * 1024),

    // --- Verification / KYC (S4) ---------------------------------------------
    /// Which KYC adapter to use. Vendor is still undecided (CLAUDE.md §6); the
    /// mock is fully functional for development and refuses to run in
    /// production, so this cannot be left on `mock` by accident.
    KYC_PROVIDER: z.enum(['mock']).default('mock'),

    /// HMAC secret for inbound provider webhooks. No default and a 32-char
    /// minimum, same reasoning as JWT_SECRET: a shared fallback secret means
    /// anyone who reads the source can forge an approval and self-verify.
    KYC_WEBHOOK_SECRET: z
      .string()
      .min(32, 'KYC_WEBHOOK_SECRET must be at least 32 characters'),

    /// How long a PENDING verification may wait before the sweep expires it.
    /// Generous — real vendors can take hours for manual review.
    KYC_REQUEST_TTL_HOURS: z.coerce.number().int().min(1).max(168).default(72),

    // --- Pings (S5) ----------------------------------------------------------
    /// New outbound pings per user per rolling day.
    ///
    /// This is the harassment control on the 1:1 surface. Unlike OTP there is no
    /// per-message cost to us, so the limit exists purely to bound how many
    /// strangers one account can contact — which is the abuse pattern, not
    /// volume itself. Counted in Redis so it holds across API instances.
    ///
    /// Only NEW connections count; accepting a request or replying in an open
    /// thread does not consume the budget.
    PING_MAX_PER_DAY: z.coerce.number().int().min(1).max(1000).default(30),

    // --- Grid (S7) -----------------------------------------------------------
    /// Seed for the per-user location offset (CLAUDE.md §2.2). No default and a
    /// 32-char minimum, same reasoning as JWT_SECRET: a shared fallback would
    /// mean anyone who reads the source can recompute every user's offset and
    /// subtract it, which turns the fuzzed point straight back into the exact
    /// one. This is the secret that makes the fuzzing worth anything.
    ///
    /// Rotating it re-fuzzes everyone, but only as each user's next location
    /// write lands — stored offsets are not backfilled. Rotate slowly and
    /// rarely: each rotation hands a patient observer a second independent
    /// sample of the same person, which is exactly the averaging attack the
    /// determinism exists to prevent.
    GRID_LOCATION_SALT: z
      .string()
      .min(32, 'GRID_LOCATION_SALT must be at least 32 characters'),

    /// Bounds of the displacement, in meters. The offset is drawn deterministic-
    /// ally from this range per user and then never changes for that user.
    GRID_FUZZ_MIN_METERS: z.coerce
      .number()
      .int()
      .min(50)
      .max(5000)
      .default(100),
    GRID_FUZZ_MAX_METERS: z.coerce
      .number()
      .int()
      .min(50)
      .max(5000)
      .default(300),

    /// Write debounce (CLAUDE.md §4). A location write is persisted only when the
    /// user has moved further than this OR this many seconds have passed. Below
    /// the fuzz radius by design — movement smaller than the offset is not even
    /// observable through the Grid, so persisting it buys nothing and costs a row
    /// version, index churn and WAL.
    GRID_DEBOUNCE_METERS: z.coerce.number().int().min(0).max(5000).default(100),
    GRID_DEBOUNCE_SECONDS: z.coerce.number().int().min(0).max(3600).default(60),

    /// How recently a location must have been written for its owner to count as
    /// "online". Must stay comfortably above GRID_DEBOUNCE_SECONDS, or an active
    /// user flickers offline between two persisted writes.
    GRID_ONLINE_WINDOW_SECONDS: z.coerce
      .number()
      .int()
      .min(60)
      .max(3600)
      .default(300),
  })
  // Cross-field checks. Per-field bounds cannot express these, and each one
  // fails silently at runtime rather than loudly: an inverted fuzz range
  // produces a NEGATIVE displacement (the exact point, mirrored — no privacy at
  // all), and an online window shorter than the debounce makes active users
  // flicker offline between writes.
  .refine((c) => c.GRID_FUZZ_MIN_METERS <= c.GRID_FUZZ_MAX_METERS, {
    path: ['GRID_FUZZ_MIN_METERS'],
    message:
      'GRID_FUZZ_MIN_METERS must not exceed GRID_FUZZ_MAX_METERS — an inverted range produces a negative offset, which is not fuzzing',
  })
  .refine((c) => c.GRID_ONLINE_WINDOW_SECONDS > c.GRID_DEBOUNCE_SECONDS, {
    path: ['GRID_ONLINE_WINDOW_SECONDS'],
    message:
      'GRID_ONLINE_WINDOW_SECONDS must exceed GRID_DEBOUNCE_SECONDS, or an active user appears offline between two persisted writes',
  });

export type AppConfig = z.infer<typeof envSchema>;

/**
 * A `ms`-style duration string, e.g. `15m`.
 *
 * jsonwebtoken types `expiresIn` as `number | StringValue`, where StringValue
 * comes from the `ms` package — a transitive dependency we should not import
 * from directly. Declaring the shape here lets the config values satisfy that
 * signature without a bare `any` cast, and the regexes above guarantee the
 * runtime value actually matches.
 */
export type DurationString = `${number}${'s' | 'm' | 'h' | 'd'}`;

/**
 * Boot-time validation, wired into ConfigModule's `validate` hook.
 *
 * Fails fast and loudly, by design. The alternative — booting with an absent
 * or malformed value and discovering it later — means the failure surfaces
 * inside a request path. In this codebase those paths handle phone numbers,
 * exact coordinates, and KYC references, so a half-configured process is a
 * worse outcome than no process.
 *
 * Errors are aggregated so you fix every problem in one pass rather than
 * restarting once per missing variable.
 */
export function validateEnv(raw: Record<string, unknown>): AppConfig {
  const parsed = envSchema.safeParse(raw);

  if (!parsed.success) {
    const problems = parsed.error.issues
      .map(
        (issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`,
      )
      .join('\n');

    throw new Error(
      `Invalid environment configuration:\n${problems}\n\n` +
        `Compare your .env against .env.example. The app will not start until these are fixed.`,
    );
  }

  return parsed.data;
}

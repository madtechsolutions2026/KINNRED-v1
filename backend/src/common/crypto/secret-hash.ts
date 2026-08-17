import {
  createHash,
  randomBytes,
  randomInt,
  scrypt,
  timingSafeEqual,
} from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt);

const SCRYPT_KEYLEN = 64;
const SALT_BYTES = 16;

/**
 * Two hashing strategies, because OTPs and refresh tokens have opposite
 * requirements. Using one for both would be wrong in one direction or the
 * other, so the distinction is deliberate.
 *
 *   OTP codes      — 6 digits. Only ~1,000,000 possibilities, so an attacker
 *                    with the database could enumerate every code instantly
 *                    against a fast hash. Needs a SLOW, SALTED KDF (scrypt).
 *
 *   Refresh tokens — 256 bits of CSPRNG output. Brute force is already
 *                    infeasible, so a slow KDF buys nothing. More importantly
 *                    we must LOOK TOKENS UP by hash, which requires a
 *                    deterministic, indexable digest. A per-row random salt
 *                    would make that lookup impossible.
 *
 * scrypt is used rather than argon2/bcrypt because it is built into Node —
 * no native module, no build toolchain, nothing to break on a Windows dev
 * machine (DECISIONS.md D-017).
 */

/**
 * Hashes a low-entropy secret (an OTP code) with scrypt and a random salt.
 * Returns `salt:derivedKey`, both hex.
 */
export async function hashLowEntropySecret(plain: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const derived = (await scryptAsync(plain, salt, SCRYPT_KEYLEN)) as Buffer;
  return `${salt.toString('hex')}:${derived.toString('hex')}`;
}

/**
 * Verifies a low-entropy secret against a stored `salt:derivedKey`.
 *
 * Comparison is timing-safe: a plain `===` leaks how many leading characters
 * matched, which over enough attempts recovers the value.
 */
export async function verifyLowEntropySecret(
  plain: string,
  stored: string,
): Promise<boolean> {
  const [saltHex, expectedHex] = stored.split(':');
  if (!saltHex || !expectedHex) return false;

  const expected = Buffer.from(expectedHex, 'hex');
  const derived = (await scryptAsync(
    plain,
    Buffer.from(saltHex, 'hex'),
    SCRYPT_KEYLEN,
  )) as Buffer;

  // timingSafeEqual throws on length mismatch, so guard first.
  if (expected.length !== derived.length) return false;
  return timingSafeEqual(expected, derived);
}

/**
 * Deterministic digest for high-entropy tokens, so they can be indexed and
 * looked up. See the note above for why this is NOT a weaker choice here.
 */
export function hashHighEntropyToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** 256 bits of CSPRNG output, url-safe. Used as the raw refresh token. */
export function generateRefreshToken(): string {
  return randomBytes(32).toString('base64url');
}

/**
 * Numeric OTP code.
 *
 * Uses `randomInt` (CSPRNG) rather than `Math.random`, which is seeded,
 * predictable, and completely unsuitable for anything that grants access.
 * Padded so codes with leading zeros are still full length.
 */
export function generateOtpCode(digits = 6): string {
  const max = 10 ** digits;
  return String(randomInt(0, max)).padStart(digits, '0');
}

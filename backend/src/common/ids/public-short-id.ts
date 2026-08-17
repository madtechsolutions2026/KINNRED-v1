import { randomInt } from 'node:crypto';

/**
 * Alphabet for public short IDs (Crockford base32, without the ambiguous
 * characters).
 *
 * I, L, O and U are excluded on purpose:
 *   - I / 1 / L and O / 0 are indistinguishable in many fonts, and these IDs
 *     are meant to be read off a screen, said aloud, and typed by hand.
 *   - U is dropped to reduce the chance of generating an offensive string.
 */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** 10 chars over a 32-symbol alphabet = 32^10 ≈ 1.1e15 possibilities. */
const DEFAULT_LENGTH = 10;

/**
 * Generates a public, shareable identifier — the value behind a user's or
 * circle's QR code.
 *
 * Random rather than sequential, and that is a safety property, not a
 * cosmetic one: a sequential or guessable ID lets anyone walk the entire user
 * base by counting. For an app whose whole premise is controlling who can see
 * whom, enumerable identity is a serious hole.
 *
 * Uses `randomInt` (CSPRNG), never `Math.random`.
 *
 * Note the caller must still handle collision: the column is UNIQUE, so the
 * correct pattern is to retry on a unique-constraint violation rather than
 * pre-checking existence (which races).
 */
export function generatePublicShortId(length = DEFAULT_LENGTH): string {
  let out = '';
  for (let i = 0; i < length; i += 1) {
    out += ALPHABET[randomInt(0, ALPHABET.length)];
  }
  return out;
}

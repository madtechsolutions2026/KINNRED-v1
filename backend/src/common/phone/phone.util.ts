import { parsePhoneNumberFromString } from 'libphonenumber-js';

/**
 * Normalises a phone number to canonical E.164 (`+919876543210`).
 *
 * Every phone value MUST pass through here before it touches the database.
 * `User.phone` is UNIQUE, and a uniqueness constraint is only as good as the
 * normalisation in front of it: `+91 98765 43210`, `+919876543210` and
 * `09876543210` are the same person but three distinct strings, which would
 * let one person hold multiple accounts and silently defeat any per-phone
 * rate limit or ban.
 *
 * Input must already carry a country code. We deliberately do NOT assume a
 * default region — guessing turns a user's typo into someone else's number.
 *
 * @returns the E.164 string, or null if the input is not a valid number.
 */
export function normalizeToE164(raw: string): string | null {
  const trimmed = raw?.trim();
  if (!trimmed || !trimmed.startsWith('+')) return null;

  const parsed = parsePhoneNumberFromString(trimmed);
  if (!parsed?.isValid()) return null;

  return parsed.number;
}

/**
 * Partially masks a phone number for safe display and logging
 * (`+9198765xxxxx` → `+91987•••••10`).
 *
 * Used anywhere a number would otherwise appear in a response or an error.
 * Never emit a full number back to a client: it confirms to an attacker
 * exactly which numbers are registered.
 */
export function maskPhone(e164: string): string {
  if (e164.length <= 6) return '•'.repeat(e164.length);
  const head = e164.slice(0, 6);
  const tail = e164.slice(-2);
  return `${head}${'•'.repeat(Math.max(0, e164.length - 8))}${tail}`;
}

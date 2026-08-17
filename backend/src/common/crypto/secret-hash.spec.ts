import {
  generateOtpCode,
  generateRefreshToken,
  hashHighEntropyToken,
  hashLowEntropySecret,
  verifyLowEntropySecret,
} from './secret-hash';

describe('secret-hash', () => {
  describe('low-entropy secrets (OTP codes)', () => {
    it('verifies a correct code', async () => {
      const stored = await hashLowEntropySecret('482913');
      await expect(verifyLowEntropySecret('482913', stored)).resolves.toBe(
        true,
      );
    });

    it('rejects an incorrect code', async () => {
      const stored = await hashLowEntropySecret('482913');
      await expect(verifyLowEntropySecret('482914', stored)).resolves.toBe(
        false,
      );
    });

    it('salts, so the same code hashes differently every time', async () => {
      const a = await hashLowEntropySecret('111111');
      const b = await hashLowEntropySecret('111111');

      // Without a per-hash salt, identical OTPs would produce identical
      // digests and a leaked database would reveal which users share a code.
      expect(a).not.toEqual(b);
      await expect(verifyLowEntropySecret('111111', a)).resolves.toBe(true);
      await expect(verifyLowEntropySecret('111111', b)).resolves.toBe(true);
    });

    it('returns false rather than throwing on a malformed stored value', async () => {
      await expect(verifyLowEntropySecret('123456', 'garbage')).resolves.toBe(
        false,
      );
      await expect(verifyLowEntropySecret('123456', '')).resolves.toBe(false);
    });
  });

  describe('high-entropy tokens (refresh tokens)', () => {
    it('is deterministic, so tokens can be looked up by hash', () => {
      // This is the whole reason refresh tokens use a plain digest rather
      // than a salted KDF — the DB lookup is by hash.
      expect(hashHighEntropyToken('abc')).toEqual(hashHighEntropyToken('abc'));
    });

    it('produces different digests for different tokens', () => {
      expect(hashHighEntropyToken('abc')).not.toEqual(
        hashHighEntropyToken('abd'),
      );
    });

    it('never returns the plaintext', () => {
      const token = generateRefreshToken();
      expect(hashHighEntropyToken(token)).not.toContain(token);
    });
  });

  describe('generators', () => {
    it('generates 6-digit OTP codes, preserving leading zeros', () => {
      for (let i = 0; i < 200; i += 1) {
        expect(generateOtpCode(6)).toMatch(/^\d{6}$/);
      }
    });

    it('generates unique refresh tokens', () => {
      const tokens = new Set(
        Array.from({ length: 500 }, () => generateRefreshToken()),
      );
      expect(tokens.size).toBe(500);
    });
  });
});

import { createHmac } from 'node:crypto';
import { MockKycProvider } from './mock-kyc.provider';
import type { AppConfig } from '../../../config/env.schema';

const SECRET = 'test-kyc-webhook-secret-value';

function build(nodeEnv = 'test'): MockKycProvider {
  return new MockKycProvider({
    NODE_ENV: nodeEnv,
    KYC_WEBHOOK_SECRET: SECRET,
  } as unknown as AppConfig);
}

function sign(body: Buffer, secret = SECRET): string {
  return createHmac('sha256', secret).update(body).digest('hex');
}

describe('MockKycProvider', () => {
  describe('production guard', () => {
    /**
     * The single most dangerous misconfiguration in the system: a mock KYC
     * provider in production means anyone who can reach the webhook endpoint
     * can grant themselves verified status, which gates circle creation.
     * Failing at boot is the only acceptable behaviour.
     */
    it('refuses to construct in production', () => {
      expect(() => build('production')).toThrow(/never run in production/i);
    });

    it('constructs outside production', () => {
      expect(() => build('development')).not.toThrow();
      expect(() => build('test')).not.toThrow();
    });
  });

  describe('verifySignature', () => {
    const provider = build();
    const body = Buffer.from(
      JSON.stringify({
        eventId: 'evt-1',
        providerRef: 'mock_x',
        outcome: 'APPROVED',
      }),
      'utf8',
    );

    it('accepts a correctly signed body', () => {
      expect(provider.verifySignature(body, sign(body))).toBe(true);
    });

    it('rejects a missing signature', () => {
      expect(provider.verifySignature(body, undefined)).toBe(false);
      expect(provider.verifySignature(body, '')).toBe(false);
    });

    it('rejects a signature made with the wrong secret', () => {
      expect(provider.verifySignature(body, sign(body, 'not-the-secret'))).toBe(
        false,
      );
    });

    /**
     * The attack this actually defends against: an attacker composes their own
     * approval payload. They cannot sign it, so a signature valid for ANY
     * other body must not carry over.
     */
    it('rejects a valid signature over different bytes', () => {
      const other = Buffer.from(
        JSON.stringify({
          eventId: 'evt-1',
          providerRef: 'mock_attacker',
          outcome: 'APPROVED',
        }),
        'utf8',
      );
      expect(provider.verifySignature(other, sign(body))).toBe(false);
    });

    /**
     * Signatures are computed over exact bytes. Re-serialising parsed JSON
     * reorders keys and drops whitespace, so this asserts the property that
     * forces `rawBody: true` in main.ts — if this ever passes, someone has
     * introduced a normalising step and the raw-body requirement can be
     * silently dropped, breaking every real vendor callback.
     */
    it('is sensitive to byte-level differences that JSON.parse would erase', () => {
      const spaced = Buffer.from(
        '{ "eventId": "evt-1", "providerRef": "mock_x", "outcome": "APPROVED" }',
        'utf8',
      );
      expect(JSON.parse(spaced.toString())).toEqual(
        JSON.parse(body.toString()),
      );
      expect(provider.verifySignature(spaced, sign(body))).toBe(false);
    });

    /**
     * timingSafeEqual throws on a length mismatch rather than returning false,
     * so a short or overlong signature must be screened out first. A throw
     * here would surface as a 500 instead of a 401.
     */
    it('returns false rather than throwing on a wrong-length signature', () => {
      expect(() => provider.verifySignature(body, 'abc')).not.toThrow();
      expect(provider.verifySignature(body, 'abc')).toBe(false);
      expect(provider.verifySignature(body, sign(body) + 'ff')).toBe(false);
    });

    it('rejects a hex signature of the right length but wrong value', () => {
      const wrong = 'a'.repeat(64);
      expect(wrong).toHaveLength(sign(body).length);
      expect(provider.verifySignature(body, wrong)).toBe(false);
    });
  });

  describe('parseWebhook', () => {
    const provider = build();

    it('parses a well-formed decision', () => {
      expect(
        provider.parseWebhook({
          eventId: 'evt-1',
          providerRef: 'mock_x',
          outcome: 'REJECTED',
          reason: 'blurry',
        }),
      ).toEqual({
        eventId: 'evt-1',
        providerRef: 'mock_x',
        outcome: 'REJECTED',
        reason: 'blurry',
      });
    });

    it.each([
      ['null', null],
      ['a string', 'APPROVED'],
      ['a number', 7],
      ['an array', []],
    ])('returns null for %s', (_label, payload) => {
      expect(provider.parseWebhook(payload)).toBeNull();
    });

    it.each([
      ['a missing eventId', { providerRef: 'mock_x', outcome: 'APPROVED' }],
      ['a missing providerRef', { eventId: 'e', outcome: 'APPROVED' }],
      ['a missing outcome', { eventId: 'e', providerRef: 'mock_x' }],
      [
        'an unknown outcome',
        { eventId: 'e', providerRef: 'mock_x', outcome: 'MAYBE' },
      ],
      [
        'a lowercase outcome',
        { eventId: 'e', providerRef: 'mock_x', outcome: 'approved' },
      ],
      [
        'a non-string eventId',
        { eventId: 1, providerRef: 'mock_x', outcome: 'APPROVED' },
      ],
    ])('returns null for %s', (_label, payload) => {
      expect(provider.parseWebhook(payload)).toBeNull();
    });

    /**
     * Informational events (session.opened and friends) are common and must be
     * a benign no-op, not an error — a 4xx would make the vendor retry forever.
     */
    it('treats a non-decision event as null rather than throwing', () => {
      expect(
        provider.parseWebhook({ eventId: 'evt-1', type: 'session.opened' }),
      ).toBeNull();
    });

    it('drops a non-string reason instead of passing it through', () => {
      const parsed = provider.parseWebhook({
        eventId: 'e',
        providerRef: 'mock_x',
        outcome: 'REJECTED',
        reason: { nested: 'object' },
      });
      expect(parsed?.reason).toBeUndefined();
    });
  });

  describe('createSession', () => {
    it('mints a unique providerRef per session', async () => {
      const provider = build();
      const a = await provider.createSession({
        userId: 'u1',
        selfieAssetId: 's1',
      });
      const b = await provider.createSession({
        userId: 'u1',
        selfieAssetId: 's1',
      });

      expect(a.providerRef).toMatch(/^mock_/);
      expect(a.providerRef).not.toEqual(b.providerRef);
    });
  });
});

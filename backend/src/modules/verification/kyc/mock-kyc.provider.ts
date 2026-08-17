import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { KycDecision, KycProvider, KycSession } from './kyc-provider.interface';
import { APP_CONFIG } from '../../../config/config.module';
import type { AppConfig } from '../../../config/env.schema';

/**
 * Development KYC adapter.
 *
 * Opens a "session" that does nothing, and accepts webhook callbacks signed
 * with `KYC_WEBHOOK_SECRET`. That lets the entire verification state machine —
 * including signature checking and replay protection — be exercised end to end
 * with no vendor account.
 *
 * SAFETY: refuses to construct when NODE_ENV is production. A mock KYC
 * provider in production means anyone who can reach the webhook can grant
 * themselves verified status, which gates circle creation. Failing at boot is
 * vastly preferable to discovering that from abuse reports.
 */
@Injectable()
export class MockKycProvider implements KycProvider {
  readonly name = 'mock';

  private readonly logger = new Logger(MockKycProvider.name);
  private readonly secret: string;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    if (config.NODE_ENV === 'production') {
      throw new Error(
        'MockKycProvider must never run in production — it would let anyone self-verify. ' +
          'Configure a real KYC provider before deploying.',
      );
    }
    this.secret = config.KYC_WEBHOOK_SECRET;
  }

  createSession(input: {
    userId: string;
    selfieAssetId: string;
    documentAssetId?: string;
  }): Promise<KycSession> {
    const providerRef = `mock_${randomUUID()}`;

    this.logger.warn(
      `[DEV ONLY] KYC session ${providerRef} opened for user ${input.userId}. ` +
        `POST a signed decision to /api/v1/verification/webhook to resolve it.`,
    );

    return Promise.resolve({ providerRef });
  }

  /**
   * HMAC-SHA256 over the raw body, compared in constant time.
   *
   * `timingSafeEqual` throws on length mismatch, so lengths are checked first —
   * and a plain `===` here would leak how many leading characters matched,
   * which over enough attempts recovers a valid signature.
   */
  verifySignature(rawBody: Buffer, signature: string | undefined): boolean {
    if (!signature) return false;

    const expected = createHmac('sha256', this.secret)
      .update(rawBody)
      .digest('hex');

    const provided = Buffer.from(signature, 'utf8');
    const expectedBuf = Buffer.from(expected, 'utf8');

    if (provided.length !== expectedBuf.length) return false;
    return timingSafeEqual(provided, expectedBuf);
  }

  parseWebhook(payload: unknown): KycDecision | null {
    if (typeof payload !== 'object' || payload === null) return null;

    const p = payload as Record<string, unknown>;

    const eventId = typeof p.eventId === 'string' ? p.eventId : null;
    const providerRef =
      typeof p.providerRef === 'string' ? p.providerRef : null;
    const outcome = p.outcome;

    if (!eventId || !providerRef) return null;
    if (outcome !== 'APPROVED' && outcome !== 'REJECTED') return null;

    return {
      eventId,
      providerRef,
      outcome,
      reason: typeof p.reason === 'string' ? p.reason : undefined,
    };
  }

  /** Test helper: signs a payload the way a vendor would. Dev/test only. */
  sign(rawBody: Buffer): string {
    return createHmac('sha256', this.secret).update(rawBody).digest('hex');
  }
}

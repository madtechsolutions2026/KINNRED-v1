import { timingSafeEqual } from 'node:crypto';
import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { KYC_PROVIDER } from './kyc/kyc-provider.interface';
import type { KycProvider } from './kyc/kyc-provider.interface';
import { APP_CONFIG } from '../../config/config.module';
import {
  MediaKind,
  MediaStatus,
  VerificationState,
} from '../../generated/prisma/enums';
import type { AppConfig } from '../../config/env.schema';

export const VERIFICATION_SWEEP_JOB = 'sweep-expired';

@Injectable()
export class VerificationService {
  private readonly logger = new Logger(VerificationService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(KYC_PROVIDER) private readonly kyc: KycProvider,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  // -------------------------------------------------------------------------
  // Submission
  // -------------------------------------------------------------------------

  /**
   * Opens a verification attempt.
   *
   * The selfie and document must already be uploaded as KYC media (S2) — this
   * endpoint takes asset ids, never bytes, so KYC images follow exactly the
   * same validated path as everything else and land in the separate KYC bucket
   * (CLAUDE.md §2.4).
   */
  async submit(
    userId: string,
    selfieAssetId: string,
    documentAssetId?: string,
  ) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, isVerified: true },
    });
    if (!user) throw new NotFoundException('Account no longer exists');

    if (user.isVerified) {
      throw new BadRequestException('You are already verified');
    }

    // One live attempt at a time. Without this a user could open unlimited
    // sessions, each costing a vendor API call we are billed for.
    const pending = await this.prisma.verificationRequest.findFirst({
      where: { userId, state: VerificationState.PENDING },
    });
    if (pending) {
      throw new BadRequestException(
        'You already have a verification in progress',
      );
    }

    await this.assertUsableKycAsset(userId, selfieAssetId, 'selfie');
    if (documentAssetId) {
      await this.assertUsableKycAsset(userId, documentAssetId, 'document');
    }

    const session = await this.kyc.createSession({
      userId,
      selfieAssetId,
      documentAssetId,
    });

    const request = await this.prisma.verificationRequest.create({
      data: {
        userId,
        provider: this.kyc.name,
        providerRef: session.providerRef,
        selfieAssetId,
        documentAssetId,
        state: VerificationState.PENDING,
      },
      select: { id: true, state: true, createdAt: true },
    });

    this.logger.log(`Verification ${request.id} opened for user ${userId}`);

    return {
      requestId: request.id,
      state: request.state,
      hostedUrl: session.hostedUrl,
      submittedAt: request.createdAt,
    };
  }

  /**
   * Confirms an asset is the caller's own, is KYC media, and passed
   * validation.
   *
   * All three matter. Ownership stops a user submitting someone else's
   * documents; the KIND check stops a profile photo being passed off as a
   * selfie (it would also be in the wrong bucket); and the READY check stops
   * an unvalidated upload — possibly not even an image — reaching the vendor.
   */
  private async assertUsableKycAsset(
    userId: string,
    assetId: string,
    label: string,
  ): Promise<void> {
    const asset = await this.prisma.mediaAsset.findUnique({
      where: { id: assetId },
      select: { ownerId: true, kind: true, status: true },
    });

    // 404 rather than 403 for someone else's asset — a 403 confirms the id
    // exists, which is an existence oracle over the media table.
    if (!asset || asset.ownerId !== userId) {
      throw new NotFoundException(`${label} asset not found`);
    }
    if (asset.kind !== MediaKind.KYC_DOCUMENT) {
      throw new BadRequestException(
        `${label} must be uploaded as KYC_DOCUMENT, not a profile photo`,
      );
    }
    if (asset.status !== MediaStatus.READY) {
      throw new BadRequestException(
        `${label} is ${asset.status.toLowerCase()} — wait for processing to finish`,
      );
    }
  }

  // -------------------------------------------------------------------------
  // Status
  // -------------------------------------------------------------------------

  async getStatus(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { isVerified: true },
    });
    if (!user) throw new NotFoundException('Account no longer exists');

    const latest = await this.prisma.verificationRequest.findFirst({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        state: true,
        reason: true,
        createdAt: true,
        decidedAt: true,
      },
    });

    return {
      isVerified: user.isVerified,
      // Absent request means never attempted. Deliberately not modelled as a
      // NONE state on the row — see the schema comment.
      latestRequest: latest ?? null,
    };
  }

  // -------------------------------------------------------------------------
  // Provider webhook
  // -------------------------------------------------------------------------

  /**
   * Applies a provider decision.
   *
   * Three independent guards, in order — each defeats a different attack:
   *
   *   1. SIGNATURE, over the RAW body. Proves the vendor sent it. Without
   *      this, anyone who can reach the endpoint self-verifies.
   *   2. REPLAY, via a unique (provider, eventId). A signature proves origin,
   *      not freshness — a captured approval could otherwise be replayed
   *      forever, including to resurrect a revoked verification.
   *   3. STATE, only PENDING transitions. Stops a late duplicate reopening a
   *      decision that has already been made.
   */
  async handleWebhook(
    rawBody: Buffer,
    signature: string | undefined,
    payload: unknown,
  ): Promise<{ applied: boolean; reason?: string }> {
    if (!this.kyc.verifySignature(rawBody, signature)) {
      this.logger.warn('Rejected KYC webhook with an invalid signature');
      throw new UnauthorizedException('Invalid signature');
    }

    const decision = this.kyc.parseWebhook(payload);
    if (!decision) {
      // Vendors send informational events too. Acknowledge so they stop
      // retrying, but change nothing.
      return { applied: false, reason: 'not-a-decision' };
    }

    // Replay guard. The unique constraint is the actual protection — checking
    // first would race two concurrent deliveries of the same event.
    try {
      await this.prisma.kycWebhookEvent.create({
        data: { provider: this.kyc.name, eventId: decision.eventId },
      });
    } catch (error: unknown) {
      if ((error as { code?: string })?.code === 'P2002') {
        this.logger.log(`Duplicate KYC event ${decision.eventId} ignored`);
        return { applied: false, reason: 'duplicate-event' };
      }
      throw error;
    }

    const request = await this.prisma.verificationRequest.findUnique({
      where: { providerRef: decision.providerRef },
      select: { id: true, userId: true, state: true },
    });

    if (!request) {
      this.logger.warn(
        `KYC decision for unknown providerRef ${decision.providerRef}`,
      );
      return { applied: false, reason: 'unknown-request' };
    }

    if (request.state !== VerificationState.PENDING) {
      this.logger.warn(
        `KYC decision for request ${request.id} already ${request.state}`,
      );
      return { applied: false, reason: 'already-decided' };
    }

    await this.applyDecision(
      request.id,
      request.userId,
      decision.outcome,
      `webhook:${this.kyc.name}`,
      decision.reason,
    );

    return { applied: true };
  }

  // -------------------------------------------------------------------------
  // Admin
  // -------------------------------------------------------------------------

  /**
   * Manual decision path, for when no vendor is wired or a case needs review.
   *
   * NOTE: there is no admin role model yet. This is guarded by a shared
   * `x-admin-token` at the controller, which is a stopgap — before any real
   * deployment it needs a proper admin identity so decisions are attributable
   * to a person rather than to whoever holds a secret.
   */
  async adminDecide(
    requestId: string,
    outcome: 'APPROVED' | 'REJECTED',
    reason: string | undefined,
    actor: string,
  ) {
    const request = await this.prisma.verificationRequest.findUnique({
      where: { id: requestId },
      select: { id: true, userId: true, state: true },
    });

    if (!request) throw new NotFoundException('Verification request not found');

    if (request.state !== VerificationState.PENDING) {
      throw new BadRequestException(
        `Request is already ${request.state.toLowerCase()}`,
      );
    }

    await this.applyDecision(
      request.id,
      request.userId,
      outcome,
      `admin:${actor}`,
      reason,
    );

    return { requestId: request.id, outcome };
  }

  /**
   * The only place `isVerified` is ever written.
   *
   * Request state and the user flag move together in a transaction. Split
   * apart, a crash between them leaves an APPROVED request beside an
   * unverified user (support burden) or — far worse — a verified user with no
   * approved request behind it, which is unauditable.
   */
  private async applyDecision(
    requestId: string,
    userId: string,
    outcome: 'APPROVED' | 'REJECTED',
    decidedBy: string,
    reason?: string,
  ): Promise<void> {
    const approved = outcome === 'APPROVED';

    await this.prisma.$transaction(async (tx) => {
      await tx.verificationRequest.update({
        where: { id: requestId },
        data: {
          state: approved
            ? VerificationState.APPROVED
            : VerificationState.REJECTED,
          decidedBy,
          decidedAt: new Date(),
          reason,
        },
      });

      if (approved) {
        await tx.user.update({
          where: { id: userId },
          data: { isVerified: true },
        });
      }
    });

    this.logger.log(
      `Verification ${requestId} ${outcome} by ${decidedBy}` +
        (reason ? ` (${reason})` : ''),
    );
  }

  // -------------------------------------------------------------------------
  // Sweep
  // -------------------------------------------------------------------------

  /**
   * Expires PENDING requests whose decision never arrived.
   *
   * Without this a dropped webhook leaves a user permanently unable to
   * re-submit — the one-live-attempt guard above would block them forever with
   * no way to clear it themselves.
   */
  async sweepExpired(): Promise<number> {
    const cutoff = new Date(
      Date.now() - this.config.KYC_REQUEST_TTL_HOURS * 3600 * 1000,
    );

    const result = await this.prisma.verificationRequest.updateMany({
      where: { state: VerificationState.PENDING, createdAt: { lt: cutoff } },
      data: {
        state: VerificationState.EXPIRED,
        decidedAt: new Date(),
        decidedBy: 'system:sweep',
        reason: 'No decision was received in time. Please try again.',
      },
    });

    if (result.count > 0) {
      this.logger.warn(`Expired ${result.count} stale verification requests`);
    }
    return result.count;
  }

  /**
   * Guards the admin endpoint. Compared against the configured KYC secret.
   *
   * Constant-time, for the same reason the webhook signature check is: `!==`
   * short-circuits at the first differing byte, so response timing leaks how
   * many leading characters were correct and the secret can be recovered one
   * character at a time. This endpoint can approve verification for any user,
   * which is the credential most worth grinding for.
   *
   * `timingSafeEqual` throws on a length mismatch, so lengths are compared
   * first — that does leak the secret's length, which is not worth defending.
   */
  assertAdmin(token: string | undefined): void {
    if (!token) throw new ForbiddenException('Admin token required');

    const provided = Buffer.from(token, 'utf8');
    const expected = Buffer.from(this.config.KYC_WEBHOOK_SECRET, 'utf8');

    if (
      provided.length !== expected.length ||
      !timingSafeEqual(provided, expected)
    ) {
      throw new ForbiddenException('Admin token required');
    }
  }
}

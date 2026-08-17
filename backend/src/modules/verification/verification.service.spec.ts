import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { VerificationService } from './verification.service';
import { VerificationState } from '../../generated/prisma/enums';
import type { KycProvider } from './kyc/kyc-provider.interface';
import type { PrismaService } from '../../prisma/prisma.service';
import type { AppConfig } from '../../config/env.schema';

const ADMIN_SECRET = 'admin-and-webhook-shared-secret';

/**
 * `expect.objectContaining` is typed `any`, which trips no-unsafe-assignment
 * when nested inside an object literal. Narrowing to `unknown` here keeps the
 * matchers readable without scattering casts through the assertions.
 */
const like = (shape: Record<string, unknown>): unknown =>
  expect.objectContaining(shape) as unknown;

/**
 * These tests exist for the three webhook guards specifically. Each one alone
 * is sufficient to self-grant verified status, which gates circle creation, so
 * each is asserted independently rather than through one happy path.
 *
 * End-to-end coverage lives in the S4 smoke test; this file pins the ORDER and
 * the short-circuit behaviour, which an integration test cannot observe.
 */
describe('VerificationService — webhook guards', () => {
  // Held as standalone mocks rather than reached through `kyc.x`: asserting on
  // `expect(verifySignature)` detaches the method from its object, which
  // the unbound-method rule rightly objects to.
  let verifySignature: jest.Mock;
  let parseWebhook: jest.Mock;
  let kyc: KycProvider;
  let prisma: {
    kycWebhookEvent: { create: jest.Mock };
    verificationRequest: {
      findUnique: jest.Mock;
      update: jest.Mock;
      updateMany: jest.Mock;
    };
    user: { update: jest.Mock };
    $transaction: jest.Mock;
  };
  let service: VerificationService;

  const RAW = Buffer.from('{"eventId":"evt-1"}', 'utf8');
  const DECISION = {
    eventId: 'evt-1',
    providerRef: 'mock_ref',
    outcome: 'APPROVED' as const,
  };

  beforeEach(() => {
    verifySignature = jest.fn().mockReturnValue(true);
    parseWebhook = jest.fn().mockReturnValue(DECISION);

    kyc = {
      name: 'mock',
      createSession: jest.fn(),
      verifySignature,
      parseWebhook,
    };

    prisma = {
      kycWebhookEvent: { create: jest.fn().mockResolvedValue({}) },
      verificationRequest: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'req-1',
          userId: 'user-1',
          state: VerificationState.PENDING,
        }),
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      user: { update: jest.fn().mockResolvedValue({}) },
      // Runs the callback against the same mocks, so writes inside the
      // transaction are observable.
      $transaction: jest.fn((cb: (tx: unknown) => unknown) => cb(prisma)),
    };

    service = new VerificationService(prisma as unknown as PrismaService, kyc, {
      KYC_WEBHOOK_SECRET: ADMIN_SECRET,
      KYC_REQUEST_TTL_HOURS: 24,
    } as unknown as AppConfig);
  });

  describe('guard 1 — signature', () => {
    it('throws 401 when the signature does not verify', async () => {
      verifySignature.mockReturnValue(false);

      await expect(
        service.handleWebhook(RAW, 'bad', { any: 'thing' }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    /**
     * The guard must short-circuit before ANY write. If the replay record were
     * written first, an attacker could burn event ids they had merely observed
     * and block the real callback from ever applying.
     */
    it('performs no writes and does not even parse when the signature fails', async () => {
      verifySignature.mockReturnValue(false);

      await expect(
        service.handleWebhook(RAW, 'bad', {}),
      ).rejects.toBeInstanceOf(UnauthorizedException);

      expect(parseWebhook).not.toHaveBeenCalled();
      expect(prisma.kycWebhookEvent.create).not.toHaveBeenCalled();
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('verifies against the raw bytes, not the parsed payload', async () => {
      await service.handleWebhook(RAW, 'sig', { parsed: true });
      expect(verifySignature).toHaveBeenCalledWith(RAW, 'sig');
    });
  });

  describe('guard 2 — replay', () => {
    /**
     * The unique constraint is the protection, not a prior read: a
     * findFirst-then-create would let two concurrent deliveries of the same
     * event both pass the check.
     */
    it('treats a P2002 on the event record as a duplicate, not an error', async () => {
      prisma.kycWebhookEvent.create.mockRejectedValue({ code: 'P2002' });

      await expect(service.handleWebhook(RAW, 'sig', {})).resolves.toEqual({
        applied: false,
        reason: 'duplicate-event',
      });
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('records the event before looking the request up', async () => {
      const order: string[] = [];
      prisma.kycWebhookEvent.create.mockImplementation(() => {
        order.push('event');
        return Promise.resolve({});
      });
      prisma.verificationRequest.findUnique.mockImplementation(() => {
        order.push('lookup');
        return Promise.resolve({
          id: 'req-1',
          userId: 'user-1',
          state: VerificationState.PENDING,
        });
      });

      await service.handleWebhook(RAW, 'sig', {});
      expect(order).toEqual(['event', 'lookup']);
    });

    it('rethrows database errors that are not uniqueness violations', async () => {
      prisma.kycWebhookEvent.create.mockRejectedValue(
        Object.assign(new Error('connection lost'), { code: 'P1001' }),
      );

      await expect(service.handleWebhook(RAW, 'sig', {})).rejects.toThrow(
        'connection lost',
      );
    });
  });

  describe('guard 3 — state', () => {
    it.each([
      VerificationState.APPROVED,
      VerificationState.REJECTED,
      VerificationState.EXPIRED,
    ])('refuses to re-decide a request that is already %s', async (state) => {
      prisma.verificationRequest.findUnique.mockResolvedValue({
        id: 'req-1',
        userId: 'user-1',
        state,
      });

      await expect(service.handleWebhook(RAW, 'sig', {})).resolves.toEqual({
        applied: false,
        reason: 'already-decided',
      });
      expect(prisma.user.update).not.toHaveBeenCalled();
      expect(prisma.verificationRequest.update).not.toHaveBeenCalled();
    });

    it('is a no-op for an unknown providerRef', async () => {
      prisma.verificationRequest.findUnique.mockResolvedValue(null);

      await expect(service.handleWebhook(RAW, 'sig', {})).resolves.toEqual({
        applied: false,
        reason: 'unknown-request',
      });
    });

    /**
     * Acknowledged with 200 rather than rejected: vendors send informational
     * events on the same endpoint, and a 4xx makes them retry indefinitely.
     */
    it('acknowledges a non-decision event without changing anything', async () => {
      parseWebhook.mockReturnValue(null);

      await expect(service.handleWebhook(RAW, 'sig', {})).resolves.toEqual({
        applied: false,
        reason: 'not-a-decision',
      });
      expect(prisma.kycWebhookEvent.create).not.toHaveBeenCalled();
    });
  });

  describe('applying a decision', () => {
    it('sets isVerified and the request state in one transaction on APPROVED', async () => {
      await expect(service.handleWebhook(RAW, 'sig', {})).resolves.toEqual({
        applied: true,
      });

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(prisma.verificationRequest.update).toHaveBeenCalledWith(
        like({
          where: { id: 'req-1' },
          data: like({
            state: VerificationState.APPROVED,
            decidedBy: 'webhook:mock',
          }),
        }),
      );
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { isVerified: true },
      });
    });

    /** A rejection must never touch isVerified, in either direction. */
    it('never writes isVerified on REJECTED', async () => {
      parseWebhook.mockReturnValue({ ...DECISION, outcome: 'REJECTED' });

      await service.handleWebhook(RAW, 'sig', {});

      expect(prisma.user.update).not.toHaveBeenCalled();
      expect(prisma.verificationRequest.update).toHaveBeenCalledWith(
        like({
          data: like({ state: VerificationState.REJECTED }),
        }),
      );
    });
  });

  describe('sweepExpired', () => {
    /**
     * The sweep exists because `submit()` allows one live attempt per user: a
     * webhook that never arrives would otherwise lock that user out of
     * verification permanently. It must only ever move PENDING -> EXPIRED, so
     * it can never revoke a decision that was legitimately made.
     */
    it('only touches PENDING requests older than the TTL', async () => {
      const before = Date.now();
      await service.sweepExpired();

      expect(prisma.verificationRequest.updateMany).toHaveBeenCalledTimes(1);

      const calls = prisma.verificationRequest.updateMany.mock
        .calls as unknown[][];
      const call = calls[0][0] as {
        where: { state: string; createdAt: { lt: Date } };
        data: { state: string };
      };

      expect(call.where.state).toBe(VerificationState.PENDING);
      expect(call.data.state).toBe(VerificationState.EXPIRED);

      // TTL is 24h in this fixture; assert the cutoff is genuinely in the past
      // by roughly that much rather than pinning an exact timestamp.
      const ageMs = before - call.where.createdAt.lt.getTime();
      expect(ageMs).toBeGreaterThanOrEqual(24 * 3600 * 1000);
      expect(ageMs).toBeLessThan(25 * 3600 * 1000);
    });

    it('returns how many it expired', async () => {
      prisma.verificationRequest.updateMany.mockResolvedValue({ count: 3 });
      await expect(service.sweepExpired()).resolves.toBe(3);
    });
  });

  describe('assertAdmin', () => {
    it('accepts the configured token', () => {
      expect(() => service.assertAdmin(ADMIN_SECRET)).not.toThrow();
    });

    it.each([
      ['undefined', undefined],
      ['empty', ''],
      ['wrong', 'nope'],
      ['a prefix of the real token', ADMIN_SECRET.slice(0, -1)],
      ['the real token plus a suffix', `${ADMIN_SECRET}x`],
    ])('rejects %s', (_label, token) => {
      expect(() => service.assertAdmin(token)).toThrow(ForbiddenException);
    });
  });
});

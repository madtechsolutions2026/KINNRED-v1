import { BadRequestException, NotFoundException } from '@nestjs/common';
import { BlocksService } from './blocks.service';
import type { PrismaService } from '../../prisma/prisma.service';

const ALICE = 'user-alice';
const BOB = 'user-bob';
const CAROL = 'user-carol';

describe('BlocksService', () => {
  let prisma: {
    user: { findUnique: jest.Mock };
    block: {
      upsert: jest.Mock;
      deleteMany: jest.Mock;
      findFirst: jest.Mock;
      findMany: jest.Mock;
    };
  };
  let service: BlocksService;

  beforeEach(() => {
    prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue({ id: BOB }),
      },
      block: {
        upsert: jest.fn().mockResolvedValue({}),
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
      },
    };

    service = new BlocksService(prisma as unknown as PrismaService);
  });

  describe('block', () => {
    it('addresses the target by public short id, never an internal id', async () => {
      await service.block(ALICE, 'BOB123');

      const call = (prisma.user.findUnique.mock.calls as unknown[][])[0][0] as {
        where: Record<string, unknown>;
      };
      expect(call.where).toEqual({ publicShortId: 'BOB123' });
    });

    /**
     * Idempotent on purpose. A client retrying after a dropped response must
     * not be told a safety action failed when it already succeeded.
     */
    it('is idempotent — upsert, not create', async () => {
      await service.block(ALICE, 'BOB123');
      await service.block(ALICE, 'BOB123');

      expect(prisma.block.upsert).toHaveBeenCalledTimes(2);
    });

    it('refuses self-blocking', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: ALICE });

      await expect(service.block(ALICE, 'ALICE1')).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(prisma.block.upsert).not.toHaveBeenCalled();
    });

    it('404s for an unknown short id', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(service.block(ALICE, 'NOPE')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('isBlockedEitherWay', () => {
    /**
     * The direction of the stored row must not matter. A check that only
     * looked at `blockerId: viewer` would leave the blocker still seeing the
     * person they blocked — the opposite of what they asked for.
     */
    it('queries both directions', async () => {
      await service.isBlockedEitherWay(ALICE, BOB);

      const call = (prisma.block.findFirst.mock.calls as unknown[][])[0][0] as {
        where: { OR: Array<{ blockerId: string; blockedId: string }> };
      };

      expect(call.where.OR).toEqual(
        expect.arrayContaining([
          { blockerId: ALICE, blockedId: BOB },
          { blockerId: BOB, blockedId: ALICE },
        ]),
      );
    });

    it('is true when a row exists', async () => {
      prisma.block.findFirst.mockResolvedValue({ id: 'b1' });
      await expect(service.isBlockedEitherWay(ALICE, BOB)).resolves.toBe(true);
    });

    it('is false when none does', async () => {
      await expect(service.isBlockedEitherWay(ALICE, BOB)).resolves.toBe(false);
    });
  });

  describe('blockedIdsAmong', () => {
    it('returns the other party regardless of which side blocked', async () => {
      prisma.block.findMany.mockResolvedValue([
        // Alice blocked Bob.
        { blockerId: ALICE, blockedId: BOB },
        // Carol blocked Alice — the reverse direction, equally hidden.
        { blockerId: CAROL, blockedId: ALICE },
      ]);

      const blocked = await service.blockedIdsAmong(ALICE, [BOB, CAROL]);

      expect(blocked).toEqual(new Set([BOB, CAROL]));
    });

    /** Empty input must not issue a query — every list endpoint calls this. */
    it('short-circuits on an empty candidate list', async () => {
      const blocked = await service.blockedIdsAmong(ALICE, []);

      expect(blocked.size).toBe(0);
      expect(prisma.block.findMany).not.toHaveBeenCalled();
    });

    it('deduplicates candidate ids before querying', async () => {
      await service.blockedIdsAmong(ALICE, [BOB, BOB, CAROL]);

      const call = (prisma.block.findMany.mock.calls as unknown[][])[0][0] as {
        where: { OR: Array<{ blockedId?: { in: string[] } }> };
      };
      expect(call.where.OR[0].blockedId?.in).toEqual([BOB, CAROL]);
    });

    it('returns an empty set when nothing is blocked', async () => {
      await expect(
        service.blockedIdsAmong(ALICE, [BOB, CAROL]),
      ).resolves.toEqual(new Set());
    });
  });

  describe('listBlocked', () => {
    it('lists only blocks the caller made', async () => {
      await service.listBlocked(ALICE);

      const call = (prisma.block.findMany.mock.calls as unknown[][])[0][0] as {
        where: Record<string, unknown>;
      };
      expect(call.where).toEqual({ blockerId: ALICE });
    });
  });
});

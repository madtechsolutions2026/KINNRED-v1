import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  NotFoundException,
} from '@nestjs/common';
import { PingsService } from './pings.service';
import { RealtimeEvent } from './realtime.interface';
import { PingState } from '../../generated/prisma/enums';
import type { BlocksService } from '../../common/blocks/blocks.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { AppConfig } from '../../config/env.schema';

const ALICE = 'user-alice';
const BOB = 'user-bob';

describe('PingsService', () => {
  let prisma: {
    user: { findUnique: jest.Mock };
    ping: {
      findUnique: jest.Mock;
      findMany: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
      delete: jest.Mock;
    };
    message: {
      create: jest.Mock;
      findMany: jest.Mock;
      updateMany: jest.Mock;
    };
    $transaction: jest.Mock;
  };
  let blocks: {
    isBlockedEitherWay: jest.Mock;
    blockedIdsAmong: jest.Mock;
  };
  let emitToUser: jest.Mock;
  let redis: { incr: jest.Mock; expire: jest.Mock; ttl: jest.Mock };
  let service: PingsService;

  const bobUser = { id: BOB, publicShortId: 'BOB123' };

  beforeEach(() => {
    prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue({
          ...bobUser,
          profile: { displayName: 'Bob' },
        }),
      },
      ping: {
        findUnique: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockResolvedValue({
          id: 'ping-1',
          state: PingState.PENDING,
          createdAt: new Date('2026-08-17T10:00:00Z'),
        }),
        update: jest.fn().mockResolvedValue({
          id: 'ping-1',
          state: PingState.ACCEPTED,
          decidedAt: new Date('2026-08-17T10:05:00Z'),
        }),
        delete: jest.fn().mockResolvedValue({}),
      },
      message: {
        create: jest.fn().mockResolvedValue({
          id: 'msg-1',
          body: 'hello',
          sentAt: new Date('2026-08-17T10:10:00Z'),
        }),
        findMany: jest.fn().mockResolvedValue([]),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      $transaction: jest.fn((cb: (tx: unknown) => unknown) => cb(prisma)),
    };

    blocks = {
      isBlockedEitherWay: jest.fn().mockResolvedValue(false),
      blockedIdsAmong: jest.fn().mockResolvedValue(new Set<string>()),
    };

    emitToUser = jest.fn();
    redis = {
      incr: jest.fn().mockResolvedValue(1),
      expire: jest.fn().mockResolvedValue(1),
      ttl: jest.fn().mockResolvedValue(3600),
    };

    service = new PingsService(
      prisma as unknown as PrismaService,
      blocks as unknown as BlocksService,
      { emitToUser },
      redis as unknown as never,
      { PING_MAX_PER_DAY: 30 } as unknown as AppConfig,
    );
  });

  // ---------------------------------------------------------------------
  describe('pairKeyFor', () => {
    /**
     * The whole "one connection per pair" invariant rests on this being
     * order-independent. If it ever stops being symmetric, A→B and B→A stop
     * colliding, duplicate rows become possible, and a rejected user can
     * re-ping — silently, because nothing else would fail.
     */
    it('is identical regardless of argument order', () => {
      expect(PingsService.pairKeyFor(ALICE, BOB)).toBe(
        PingsService.pairKeyFor(BOB, ALICE),
      );
    });

    it('is different for different pairs', () => {
      expect(PingsService.pairKeyFor(ALICE, BOB)).not.toBe(
        PingsService.pairKeyFor(ALICE, 'user-carol'),
      );
    });

    it('sorts deterministically rather than depending on insertion order', () => {
      expect(PingsService.pairKeyFor('b', 'a')).toBe('a:b');
      expect(PingsService.pairKeyFor('a', 'b')).toBe('a:b');
    });
  });

  // ---------------------------------------------------------------------
  describe('send', () => {
    it('creates a PENDING ping and notifies the recipient', async () => {
      const result = await service.send(ALICE, 'BOB123', 'hi');

      expect(result.state).toBe(PingState.PENDING);
      expect(prisma.ping.create).toHaveBeenCalledTimes(1);
      expect(emitToUser).toHaveBeenCalledWith(
        BOB,
        RealtimeEvent.PING_RECEIVED,
        expect.anything(),
      );
    });

    it('rejects pinging yourself', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: ALICE,
        publicShortId: 'ALICE1',
      });

      await expect(service.send(ALICE, 'ALICE1')).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('404s for an unknown short id', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(service.send(ALICE, 'NOPE')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    /**
     * A block must be indistinguishable from "no such user". A distinct error
     * would confirm the account exists AND that it blocked you, which is
     * exactly what someone checks after being blocked.
     */
    it('reports a blocked target as not found, and writes nothing', async () => {
      blocks.isBlockedEitherWay.mockResolvedValue(true);

      await expect(service.send(ALICE, 'BOB123')).rejects.toThrow(
        'User not found',
      );
      expect(prisma.ping.create).not.toHaveBeenCalled();
    });

    /**
     * Mutual interest expressed the long way round. Bob pinged Alice and is
     * waiting; Alice pinging back is unambiguous consent, so it accepts rather
     * than colliding on the pair key.
     */
    it('accepts the inbound request when the target already pinged you', async () => {
      prisma.ping.findUnique.mockResolvedValue({
        id: 'ping-1',
        fromId: BOB,
        toId: ALICE,
        state: PingState.PENDING,
      });

      const result = await service.send(ALICE, 'BOB123');

      expect(result.state).toBe(PingState.ACCEPTED);
      expect(prisma.ping.create).not.toHaveBeenCalled();
      expect(emitToUser).toHaveBeenCalledWith(
        BOB,
        RealtimeEvent.PING_ACCEPTED,
        expect.anything(),
      );
    });

    it('refuses a duplicate outbound ping', async () => {
      prisma.ping.findUnique.mockResolvedValue({
        id: 'ping-1',
        fromId: ALICE,
        toId: BOB,
        state: PingState.PENDING,
      });

      await expect(service.send(ALICE, 'BOB123')).rejects.toThrow(
        /already pinged/i,
      );
    });

    /**
     * Rejection is terminal for the PAIR. This is the harassment control, and
     * the message must not reveal who declined or when.
     */
    it.each([
      ['the original sender retrying', ALICE, BOB],
      ['the original recipient initiating', BOB, ALICE],
    ])('blocks a re-ping after rejection (%s)', async (_label, from, to) => {
      prisma.ping.findUnique.mockResolvedValue({
        id: 'ping-1',
        fromId: from,
        toId: to,
        state: PingState.REJECTED,
      });

      const error = await service.send(ALICE, 'BOB123').catch((e: Error) => e);

      expect(error).toBeInstanceOf(BadRequestException);
      expect((error as Error).message).not.toMatch(/reject|declin/i);
      expect(prisma.ping.create).not.toHaveBeenCalled();
    });

    it('refuses when already connected', async () => {
      prisma.ping.findUnique.mockResolvedValue({
        id: 'ping-1',
        fromId: ALICE,
        toId: BOB,
        state: PingState.ACCEPTED,
      });

      await expect(service.send(ALICE, 'BOB123')).rejects.toThrow(
        /already connected/i,
      );
    });

    describe('rate limiting', () => {
      it('throws 429 past the daily cap', async () => {
        redis.incr.mockResolvedValue(31);

        const error = await service
          .send(ALICE, 'BOB123')
          .catch((e: Error) => e);

        expect(error).toBeInstanceOf(HttpException);
        expect((error as HttpException).getStatus()).toBe(429);
        expect(prisma.ping.create).not.toHaveBeenCalled();
      });

      it('sets the window only on the first increment', async () => {
        redis.incr.mockResolvedValue(5);
        await service.send(ALICE, 'BOB123');
        expect(redis.expire).not.toHaveBeenCalled();
      });

      /**
       * Accepting an inbound request must not consume the OUTBOUND budget —
       * otherwise a popular user is rate-limited out of replying to people who
       * contacted them, which inverts what the limit is for.
       */
      it("does not count accepting someone else's request", async () => {
        prisma.ping.findUnique.mockResolvedValue({
          id: 'ping-1',
          fromId: BOB,
          toId: ALICE,
          state: PingState.PENDING,
        });

        await service.send(ALICE, 'BOB123');

        expect(redis.incr).not.toHaveBeenCalled();
      });
    });
  });

  // ---------------------------------------------------------------------
  describe('accept / reject', () => {
    const pending = {
      id: 'ping-1',
      fromId: BOB,
      toId: ALICE,
      state: PingState.PENDING,
    };

    /**
     * Accepting unlocks the accepter's photos to the sender (CLAUDE.md §2.1),
     * so "only the recipient may accept" is an authorisation rule, not
     * bookkeeping. If the SENDER could accept their own ping, they would
     * unlock the recipient's photos unilaterally.
     */
    it('lets only the recipient accept', async () => {
      prisma.ping.findUnique.mockResolvedValue(pending);

      await expect(service.accept(BOB, 'ping-1')).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(prisma.ping.update).not.toHaveBeenCalled();

      await expect(service.accept(ALICE, 'ping-1')).resolves.toEqual(
        expect.objectContaining({ state: PingState.ACCEPTED }),
      );
    });

    it('lets only the recipient reject', async () => {
      prisma.ping.findUnique.mockResolvedValue(pending);

      await expect(service.reject(BOB, 'ping-1')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    /** 404 rather than 403 — a 403 confirms the ping id is real. */
    it('404s for a ping that does not exist', async () => {
      prisma.ping.findUnique.mockResolvedValue(null);

      await expect(service.accept(ALICE, 'nope')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it.each([PingState.ACCEPTED, PingState.REJECTED])(
      'refuses to re-decide a ping that is already %s',
      async (state) => {
        prisma.ping.findUnique.mockResolvedValue({ ...pending, state });

        await expect(service.accept(ALICE, 'ping-1')).rejects.toBeInstanceOf(
          BadRequestException,
        );
      },
    );

    /**
     * Blocks are re-checked at decision time. The pair may have become blocked
     * after the ping was sent, and acceptance is the moment access is granted.
     */
    it('refuses to accept when the pair has since become blocked', async () => {
      prisma.ping.findUnique.mockResolvedValue(pending);
      blocks.isBlockedEitherWay.mockResolvedValue(true);

      await expect(service.accept(ALICE, 'ping-1')).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(prisma.ping.update).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------
  describe('withdraw', () => {
    it('lets only the sender withdraw, and deletes the row', async () => {
      prisma.ping.findUnique.mockResolvedValue({
        id: 'ping-1',
        fromId: ALICE,
        toId: BOB,
        state: PingState.PENDING,
      });

      await expect(service.withdraw(BOB, 'ping-1')).rejects.toBeInstanceOf(
        NotFoundException,
      );

      await service.withdraw(ALICE, 'ping-1');

      // Deleted, not parked in a state: the pair slot is freed and the
      // recipient is left with no trace of the request.
      expect(prisma.ping.delete).toHaveBeenCalledWith({
        where: { id: 'ping-1' },
      });
      expect(emitToUser).toHaveBeenCalledWith(
        BOB,
        RealtimeEvent.PING_WITHDRAWN,
        expect.anything(),
      );
    });

    it('cannot withdraw an already-decided ping', async () => {
      prisma.ping.findUnique.mockResolvedValue({
        id: 'ping-1',
        fromId: ALICE,
        toId: BOB,
        state: PingState.ACCEPTED,
      });

      await expect(service.withdraw(ALICE, 'ping-1')).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(prisma.ping.delete).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------
  describe('messaging', () => {
    const accepted = {
      id: 'ping-1',
      fromId: ALICE,
      toId: BOB,
      state: PingState.ACCEPTED,
    };

    it('sends a message and notifies the other participant', async () => {
      prisma.ping.findUnique.mockResolvedValue(accepted);

      const result = await service.sendMessage(ALICE, 'ping-1', 'hello');

      expect(result.messageId).toBe('msg-1');
      expect(emitToUser).toHaveBeenCalledWith(
        BOB,
        RealtimeEvent.MESSAGE_NEW,
        expect.anything(),
      );
    });

    /**
     * The request/accept split exists so nobody can push text at someone who
     * has not consented. Messaging a PENDING ping would defeat it entirely.
     */
    it('refuses to message a ping that has not been accepted', async () => {
      prisma.ping.findUnique.mockResolvedValue({
        ...accepted,
        state: PingState.PENDING,
      });

      await expect(
        service.sendMessage(ALICE, 'ping-1', 'hello'),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.message.create).not.toHaveBeenCalled();
    });

    it('refuses a non-participant, as a 404', async () => {
      prisma.ping.findUnique.mockResolvedValue(accepted);

      await expect(
        service.sendMessage('user-carol', 'ping-1', 'hello'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    /**
     * A block closes the thread on EVERY messaging path, not just the write
     * one (CLAUDE.md §2.5). These four cases are one rule, enforced at the
     * shared gate — a pair can become blocked long after acceptance, and the
     * client still holds the ping id from before the block landed.
     *
     * All of them 404, byte-identical to a thread that was never yours: §2.5
     * requires a block to be indistinguishable from "no such thing".
     */
    describe('a block closes the thread on every path', () => {
      beforeEach(() => {
        prisma.ping.findUnique.mockResolvedValue(accepted);
        blocks.isBlockedEitherWay.mockResolvedValue(true);
      });

      it('refuses to message after a block, and writes nothing', async () => {
        await expect(
          service.sendMessage(ALICE, 'ping-1', 'hello'),
        ).rejects.toBeInstanceOf(NotFoundException);
        expect(prisma.message.create).not.toHaveBeenCalled();
      });

      /**
       * The regression this exists for: the history route is reachable with a
       * retained ping id and never touches the chats list, so the filtering
       * `listChats` does was not protecting it.
       */
      it('refuses to read history after a block, and queries nothing', async () => {
        await expect(service.getThread(ALICE, 'ping-1')).rejects.toBeInstanceOf(
          NotFoundException,
        );
        expect(prisma.message.findMany).not.toHaveBeenCalled();
      });

      /**
       * markRead is not a harmless read: it emits MESSAGE_READ to the other
       * participant, so leaving it unguarded is a live delivery channel
       * pointed at the person who asked not to hear from them.
       */
      it('refuses to mark read after a block, and emits nothing', async () => {
        await expect(service.markRead(ALICE, 'ping-1')).rejects.toBeInstanceOf(
          NotFoundException,
        );
        expect(prisma.message.updateMany).not.toHaveBeenCalled();
        expect(emitToUser).not.toHaveBeenCalled();
      });

      /**
       * The block test runs BEFORE the ping-state test. Otherwise a blocked
       * pair on an unaccepted ping answers 403 while a blocked pair on an
       * accepted one answers 404, and the difference tells the caller which
       * of the two they are looking at.
       */
      it('reports a blocked pair identically whatever the ping state', async () => {
        prisma.ping.findUnique.mockResolvedValue({
          ...accepted,
          state: PingState.PENDING,
        });

        await expect(service.getThread(ALICE, 'ping-1')).rejects.toBeInstanceOf(
          NotFoundException,
        );
      });
    });

    it('writes the message and the thread timestamp in one transaction', async () => {
      prisma.ping.findUnique.mockResolvedValue(accepted);

      await service.sendMessage(ALICE, 'ping-1', 'hello');

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(prisma.ping.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { lastMessageAt: new Date('2026-08-17T10:10:00Z') },
        }),
      );
    });

    it('reads history newest-first and reports a cursor only when more remain', async () => {
      prisma.ping.findUnique.mockResolvedValue(accepted);
      prisma.message.findMany.mockResolvedValue(
        Array.from({ length: 3 }, (_, i) => ({
          id: `m${i}`,
          body: `b${i}`,
          senderId: ALICE,
          sentAt: new Date(),
          readAt: null,
        })),
      );

      const page = await service.getThread(ALICE, 'ping-1', undefined, 2);

      // Asked for 2, the query fetched 3 to detect "more", so 2 come back.
      expect(page.messages).toHaveLength(2);
      expect(page.nextCursor).toBe('m1');
    });

    it('reports no cursor on the last page', async () => {
      prisma.ping.findUnique.mockResolvedValue(accepted);
      prisma.message.findMany.mockResolvedValue([
        {
          id: 'm0',
          body: 'b',
          senderId: BOB,
          sentAt: new Date(),
          readAt: null,
        },
      ]);

      const page = await service.getThread(ALICE, 'ping-1', undefined, 2);

      expect(page.nextCursor).toBeNull();
      expect(page.messages[0].sentByMe).toBe(false);
    });

    /**
     * Marking read must never touch your OWN messages — that would emit a read
     * receipt to the other party that they never gave.
     */
    it("marks only the other participant's messages read", async () => {
      prisma.ping.findUnique.mockResolvedValue(accepted);
      prisma.message.updateMany.mockResolvedValue({ count: 2 });

      await service.markRead(ALICE, 'ping-1');

      const call = (
        prisma.message.updateMany.mock.calls as unknown[][]
      )[0][0] as {
        where: { senderId: { not: string }; readAt: null };
      };
      expect(call.where.senderId).toEqual({ not: ALICE });
      expect(call.where.readAt).toBeNull();

      expect(emitToUser).toHaveBeenCalledWith(
        BOB,
        RealtimeEvent.MESSAGE_READ,
        expect.anything(),
      );
    });

    it('emits nothing when there was nothing unread', async () => {
      prisma.ping.findUnique.mockResolvedValue(accepted);
      prisma.message.updateMany.mockResolvedValue({ count: 0 });

      await service.markRead(ALICE, 'ping-1');

      expect(emitToUser).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------
  describe('lists', () => {
    it('never leaks an internal user id from the chats list', async () => {
      prisma.ping.findMany.mockResolvedValue([
        {
          id: 'ping-1',
          fromId: ALICE,
          toId: BOB,
          lastMessageAt: new Date(),
          decidedAt: new Date(),
          from: { id: ALICE, publicShortId: 'ALICE1', profile: null },
          to: { id: BOB, publicShortId: 'BOB123', profile: null },
          messages: [],
        },
      ]);

      const chats = await service.listChats(ALICE);

      expect(chats).toHaveLength(1);
      expect(JSON.stringify(chats)).not.toContain(BOB);
      expect(chats[0]).not.toHaveProperty('otherId');
    });

    /**
     * Blocks are filtered on READ, not only enforced on write: a pair can
     * become blocked after the ping existed, and the stale row must not keep
     * surfacing.
     */
    it('filters blocked counterparts out of the requests folder', async () => {
      prisma.ping.findMany.mockResolvedValue([
        {
          id: 'ping-1',
          openingMessage: null,
          createdAt: new Date(),
          from: { id: BOB, publicShortId: 'BOB123', profile: null },
        },
      ]);
      blocks.blockedIdsAmong.mockResolvedValue(new Set([BOB]));

      await expect(service.listRequests(ALICE)).resolves.toEqual([]);
    });
  });
});

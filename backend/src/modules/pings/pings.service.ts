import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Redis } from 'ioredis';
import { PrismaService } from '../../prisma/prisma.service';
import { BlocksService } from '../../common/blocks/blocks.service';
import { REALTIME, RealtimeEvent } from './realtime.interface';
import type { Realtime } from './realtime.interface';
import { REDIS_CLIENT } from '../../redis/redis.module';
import { APP_CONFIG } from '../../config/config.module';
import { PingState } from '../../generated/prisma/enums';
import type { AppConfig } from '../../config/env.schema';

/** Shape returned for the other participant in any ping payload. */
interface Counterpart {
  publicShortId: string;
  displayName: string | null;
}

@Injectable()
export class PingsService {
  private readonly logger = new Logger(PingsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly blocks: BlocksService,
    @Inject(REALTIME) private readonly realtime: Realtime,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /**
   * The unordered-pair key: both ids sorted, joined.
   *
   * Deterministic, so A→B and B→A produce the same string and collide on the
   * unique index. That collision is what makes "one connection per pair" a
   * database invariant instead of a rule the service has to remember —
   * including the part that matters most, that a rejected user cannot re-ping
   * by inserting a second row.
   *
   * Static and pure so it can be tested directly, and so nothing is tempted to
   * compute it a second way somewhere else.
   */
  static pairKeyFor(a: string, b: string): string {
    return a < b ? `${a}:${b}` : `${b}:${a}`;
  }

  // -------------------------------------------------------------------------
  // Sending
  // -------------------------------------------------------------------------

  /**
   * Sends a ping, addressed by PUBLIC SHORT ID.
   *
   * The interesting case is the reverse ping: if the target has already pinged
   * the caller and is waiting, this is mutual consent expressed the long way
   * round, so the existing request is ACCEPTED rather than rejected as a
   * duplicate. Erroring there would be both confusing ("you can't ping them,
   * no reason given") and an existence oracle — a distinct error for "they
   * already pinged you" tells the caller something about someone who has not
   * consented to contact.
   */
  async send(fromId: string, toShortId: string, openingMessage?: string) {
    const target = await this.prisma.user.findUnique({
      where: { publicShortId: toShortId },
      select: { id: true, publicShortId: true },
    });

    if (!target) throw new NotFoundException('User not found');

    if (target.id === fromId) {
      throw new BadRequestException('You cannot ping yourself');
    }

    // Blocks first, and the response is deliberately indistinguishable from
    // "no such user". Confirming that an account exists but has blocked you is
    // information the blocker did not agree to share, and it is exactly what
    // someone would use to check whether a block landed.
    if (await this.blocks.isBlockedEitherWay(fromId, target.id)) {
      throw new NotFoundException('User not found');
    }

    const pairKey = PingsService.pairKeyFor(fromId, target.id);

    const existing = await this.prisma.ping.findUnique({
      where: { pairKey },
      select: { id: true, fromId: true, toId: true, state: true },
    });

    if (existing) {
      return this.resolveExisting(fromId, target, existing);
    }

    // Only counted for genuinely NEW connections. Accepting an inbound request
    // or replying in a thread must not consume the outbound budget.
    await this.enforceSendRateLimit(fromId);

    const ping = await this.prisma.ping.create({
      data: {
        pairKey,
        fromId,
        toId: target.id,
        openingMessage,
        state: PingState.PENDING,
      },
      select: { id: true, state: true, createdAt: true },
    });

    this.realtime.emitToUser(target.id, RealtimeEvent.PING_RECEIVED, {
      pingId: ping.id,
      from: await this.counterpartOf(fromId),
      openingMessage: openingMessage ?? null,
      createdAt: ping.createdAt,
    });

    this.logger.log(`Ping ${ping.id}: ${fromId} -> ${target.id}`);

    return {
      pingId: ping.id,
      state: ping.state,
      to: { publicShortId: target.publicShortId },
      createdAt: ping.createdAt,
    };
  }

  /** Decides what a second send against an existing pair row means. */
  private async resolveExisting(
    fromId: string,
    target: { id: string; publicShortId: string },
    existing: { id: string; fromId: string; toId: string; state: PingState },
  ) {
    // They pinged us and are waiting: this send IS the acceptance.
    if (existing.state === PingState.PENDING && existing.toId === fromId) {
      return this.accept(fromId, existing.id);
    }

    if (existing.state === PingState.PENDING) {
      throw new BadRequestException(
        'You have already pinged this person. Wait for them to respond.',
      );
    }

    if (existing.state === PingState.ACCEPTED) {
      throw new BadRequestException(
        'You are already connected with this person.',
      );
    }

    // REJECTED. Terminal for the pair, in both directions.
    //
    // The message is deliberately vague about WHO rejected and WHEN. "They
    // declined you" is a notification the recipient never opted into sending,
    // and repeated attempts would otherwise let a sender confirm a decline
    // they were never told about.
    throw new BadRequestException('This connection is not available.');
  }

  /**
   * Per-user cap on NEW outbound pings.
   *
   * This is the harassment control on this surface: unbounded outbound
   * requests to strangers is the abuse pattern, and unlike SMS it costs the
   * attacker nothing. Counted in Redis rather than by querying pings, so the
   * limit holds across API instances and does not get slower as the table
   * grows.
   *
   * Deliberately a rolling daily window rather than the per-IP ThrottlerGuard:
   * the guard stops bursts, this stops sustained volume, and an attacker
   * rotating IPs sails past the former.
   */
  private async enforceSendRateLimit(fromId: string): Promise<void> {
    const key = `ping:rate:${fromId}`;
    const count = await this.redis.incr(key);

    if (count === 1) {
      // Window set only on first increment, so a burst cannot keep pushing the
      // expiry out and refresh its own budget.
      await this.redis.expire(key, 24 * 3600);
    }

    if (count > this.config.PING_MAX_PER_DAY) {
      const ttl = await this.redis.ttl(key);
      this.logger.warn(`Ping rate limit hit by ${fromId}`);
      throw new HttpException(
        `You have sent too many pings today. Try again in ${Math.max(
          Math.ceil(ttl / 3600),
          1,
        )} hour(s).`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  // -------------------------------------------------------------------------
  // Deciding
  // -------------------------------------------------------------------------

  /**
   * Accepts an inbound ping. Only the RECIPIENT may do this.
   *
   * Accepting is what opens messaging, and — via VisibilityService (S6) — what
   * unlocks the accepter's photos to the sender. It is therefore an
   * authorisation-granting action, and the guard that only `toId` may call it
   * is load-bearing, not tidiness.
   */
  async accept(userId: string, pingId: string) {
    const ping = await this.loadDecidable(userId, pingId);

    // Re-check blocks at decision time. The state may have changed since the
    // ping was sent, and accepting is the moment access is granted — a check
    // performed only at send time would be stale exactly when it matters.
    if (await this.blocks.isBlockedEitherWay(ping.fromId, ping.toId)) {
      throw new NotFoundException('Ping not found');
    }

    const updated = await this.prisma.ping.update({
      where: { id: ping.id },
      data: { state: PingState.ACCEPTED, decidedAt: new Date() },
      select: { id: true, state: true, decidedAt: true },
    });

    this.realtime.emitToUser(ping.fromId, RealtimeEvent.PING_ACCEPTED, {
      pingId: updated.id,
      by: await this.counterpartOf(userId),
      decidedAt: updated.decidedAt,
    });

    this.logger.log(`Ping ${ping.id} accepted by ${userId}`);

    return {
      pingId: updated.id,
      state: updated.state,
      decidedAt: updated.decidedAt,
    };
  }

  /**
   * Declines an inbound ping. Only the RECIPIENT may do this.
   *
   * TERMINAL for the pair. The row stays, occupying the pair's only slot, so
   * the sender cannot re-ping — the unique index enforces it rather than a
   * check somewhere in `send`.
   *
   * The cost of that is real and accepted: the person who declined also cannot
   * later initiate. Chosen deliberately — the asymmetric alternative ("the
   * rejecter may reopen") adds state transitions to the surface most in need
   * of being simple, and a rare change of mind is a smaller harm than a
   * re-ping loophole.
   */
  async reject(userId: string, pingId: string) {
    const ping = await this.loadDecidable(userId, pingId);

    const updated = await this.prisma.ping.update({
      where: { id: ping.id },
      data: { state: PingState.REJECTED, decidedAt: new Date() },
      select: { id: true, state: true, decidedAt: true },
    });

    // The sender IS told, because silence is worse: without it the product has
    // to show a request pending forever, and people re-send. What they are not
    // told is anything about the decider beyond the fact of the decision.
    this.realtime.emitToUser(ping.fromId, RealtimeEvent.PING_REJECTED, {
      pingId: updated.id,
      decidedAt: updated.decidedAt,
    });

    this.logger.log(`Ping ${ping.id} rejected by ${userId}`);

    return { pingId: updated.id, state: updated.state };
  }

  /**
   * The sender withdraws their own request before it is decided.
   *
   * DELETES the row rather than moving it to a state. Two reasons: it frees
   * the pair slot so a withdrawn ping is not accidentally as terminal as a
   * rejection, and it leaves no residue for the recipient — "someone pinged
   * you and took it back" is precisely the kind of trace this surface should
   * not keep.
   */
  async withdraw(userId: string, pingId: string) {
    const ping = await this.prisma.ping.findUnique({
      where: { id: pingId },
      select: { id: true, fromId: true, toId: true, state: true },
    });

    // 404 rather than 403 for someone else's ping — a 403 confirms the id
    // exists, which is an existence oracle over the pings table.
    if (!ping || ping.fromId !== userId) {
      throw new NotFoundException('Ping not found');
    }

    if (ping.state !== PingState.PENDING) {
      throw new BadRequestException(
        'This ping has already been decided and cannot be withdrawn.',
      );
    }

    await this.prisma.ping.delete({ where: { id: ping.id } });

    this.realtime.emitToUser(ping.toId, RealtimeEvent.PING_WITHDRAWN, {
      pingId: ping.id,
    });

    this.logger.log(`Ping ${ping.id} withdrawn by ${userId}`);

    return { pingId: ping.id, withdrawn: true };
  }

  /** Loads a ping the caller is entitled to DECIDE, i.e. is the recipient of. */
  private async loadDecidable(userId: string, pingId: string) {
    const ping = await this.prisma.ping.findUnique({
      where: { id: pingId },
      select: { id: true, fromId: true, toId: true, state: true },
    });

    // Not the recipient => 404, not 403. Same existence-oracle reasoning as
    // everywhere else: a distinct 403 confirms the ping id is real.
    if (!ping || ping.toId !== userId) {
      throw new NotFoundException('Ping not found');
    }

    if (ping.state !== PingState.PENDING) {
      throw new BadRequestException(
        `This ping has already been ${ping.state.toLowerCase()}.`,
      );
    }

    return ping;
  }

  // -------------------------------------------------------------------------
  // Lists
  // -------------------------------------------------------------------------

  /** The Requests folder: inbound and undecided. */
  async listRequests(userId: string) {
    const pings = await this.prisma.ping.findMany({
      where: { toId: userId, state: PingState.PENDING },
      orderBy: { createdAt: 'desc' },
      take: 100,
      select: {
        id: true,
        openingMessage: true,
        createdAt: true,
        from: {
          select: {
            id: true,
            publicShortId: true,
            profile: { select: { displayName: true } },
          },
        },
      },
    });

    // Blocks are filtered on READ as well as enforced on write. A pair can
    // become blocked after the ping was created, and a request from someone
    // you have since blocked must not keep appearing.
    const blocked = await this.blocks.blockedIdsAmong(
      userId,
      pings.map((p) => p.from.id),
    );

    return pings
      .filter((p) => !blocked.has(p.from.id))
      .map((p) => ({
        pingId: p.id,
        from: {
          publicShortId: p.from.publicShortId,
          displayName: p.from.profile?.displayName ?? null,
        },
        openingMessage: p.openingMessage,
        createdAt: p.createdAt,
      }));
  }

  /** The caller's own outbound requests, still undecided. */
  async listSent(userId: string) {
    const pings = await this.prisma.ping.findMany({
      where: { fromId: userId, state: PingState.PENDING },
      orderBy: { createdAt: 'desc' },
      take: 100,
      select: {
        id: true,
        createdAt: true,
        to: {
          select: {
            id: true,
            publicShortId: true,
            profile: { select: { displayName: true } },
          },
        },
      },
    });

    const blocked = await this.blocks.blockedIdsAmong(
      userId,
      pings.map((p) => p.to.id),
    );

    return pings
      .filter((p) => !blocked.has(p.to.id))
      .map((p) => ({
        pingId: p.id,
        to: {
          publicShortId: p.to.publicShortId,
          displayName: p.to.profile?.displayName ?? null,
        },
        createdAt: p.createdAt,
      }));
  }

  /** The Chats folder: accepted connections, most recently active first. */
  async listChats(userId: string) {
    const pings = await this.prisma.ping.findMany({
      where: {
        state: PingState.ACCEPTED,
        OR: [{ fromId: userId }, { toId: userId }],
      },
      // Nulls last so a freshly accepted chat with no messages yet does not
      // sort above active conversations.
      orderBy: [
        { lastMessageAt: { sort: 'desc', nulls: 'last' } },
        { decidedAt: 'desc' },
      ],
      take: 100,
      select: {
        id: true,
        fromId: true,
        toId: true,
        lastMessageAt: true,
        decidedAt: true,
        from: {
          select: {
            id: true,
            publicShortId: true,
            profile: { select: { displayName: true } },
          },
        },
        to: {
          select: {
            id: true,
            publicShortId: true,
            profile: { select: { displayName: true } },
          },
        },
        messages: {
          orderBy: { sentAt: 'desc' },
          take: 1,
          select: { body: true, senderId: true, sentAt: true, readAt: true },
        },
      },
    });

    const others = pings.map((p) => (p.fromId === userId ? p.to : p.from));
    const blocked = await this.blocks.blockedIdsAmong(
      userId,
      others.map((o) => o.id),
    );

    return (
      pings
        .map((p) => {
          const other = p.fromId === userId ? p.to : p.from;
          const last = p.messages[0];
          return {
            pingId: p.id,
            otherId: other.id,
            with: {
              publicShortId: other.publicShortId,
              displayName: other.profile?.displayName ?? null,
            },
            lastMessage: last
              ? {
                  body: last.body,
                  sentByMe: last.senderId === userId,
                  sentAt: last.sentAt,
                  read: last.readAt !== null,
                }
              : null,
            lastActivityAt: p.lastMessageAt ?? p.decidedAt,
          };
        })
        .filter((c) => !blocked.has(c.otherId))
        // `otherId` is an internal cuid, carried only to drive the block
        // filter above. Stripped explicitly rather than by destructuring so
        // it is obvious that dropping it is the point, not a side effect.
        .map((c) => {
          const shaped: Omit<typeof c, 'otherId'> & { otherId?: string } = {
            ...c,
          };
          delete shaped.otherId;
          return shaped;
        })
    );
  }

  // -------------------------------------------------------------------------
  // Messaging
  // -------------------------------------------------------------------------

  /**
   * Posts a message into an accepted thread.
   *
   * Every authorisation fact is re-read here rather than inferred from the
   * client having a ping id: participation, ACCEPTED state, and the block list.
   * A ping id is not a capability — it is guessable in principle and shared
   * between two people in practice.
   */
  async sendMessage(userId: string, pingId: string, body: string) {
    const ping = await this.loadParticipating(userId, pingId);

    // Blocks were already enforced by loadParticipating, for this path and for
    // both read paths alike — do not re-check here. A second check would be
    // unreachable (the gate throws first) and would answer with a different
    // status than the gate does, which is how one surface ends up telling a
    // blocked user something the other two are careful not to.
    const otherId = ping.fromId === userId ? ping.toId : ping.fromId;

    // The message row and the thread's activity stamp move together, so the
    // Chats list can never show a conversation ordered by a message that was
    // not written.
    const message = await this.prisma.$transaction(async (tx) => {
      const created = await tx.message.create({
        data: { pingId: ping.id, senderId: userId, body },
        select: { id: true, body: true, sentAt: true },
      });

      await tx.ping.update({
        where: { id: ping.id },
        data: { lastMessageAt: created.sentAt },
      });

      return created;
    });

    this.realtime.emitToUser(otherId, RealtimeEvent.MESSAGE_NEW, {
      pingId: ping.id,
      messageId: message.id,
      from: await this.counterpartOf(userId),
      body: message.body,
      sentAt: message.sentAt,
    });

    return {
      messageId: message.id,
      pingId: ping.id,
      body: message.body,
      sentAt: message.sentAt,
      sentByMe: true,
    };
  }

  /**
   * Message history, newest first, cursor-paginated.
   *
   * Cursor rather than offset: a thread grows from the end while it is being
   * read, so `skip`-based paging silently repeats or drops messages as new
   * ones arrive. The cursor is a message id, which is stable.
   *
   * Holding a ping id grants nothing on its own: `loadParticipating` re-reads
   * participation, block state and ping state on every call. This route is
   * reachable without ever listing the chats it belongs to, so the filtering
   * `listChats` does is not what protects it.
   */
  async getThread(userId: string, pingId: string, cursor?: string, limit = 50) {
    const ping = await this.loadParticipating(userId, pingId);

    const take = Math.min(Math.max(limit, 1), 100);

    const messages = await this.prisma.message.findMany({
      where: { pingId: ping.id },
      orderBy: { sentAt: 'desc' },
      take: take + 1, // one extra, purely to detect "there is more"
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: {
        id: true,
        body: true,
        senderId: true,
        sentAt: true,
        readAt: true,
      },
    });

    const hasMore = messages.length > take;
    const page = hasMore ? messages.slice(0, take) : messages;

    return {
      pingId: ping.id,
      messages: page.map((m) => ({
        messageId: m.id,
        body: m.body,
        sentByMe: m.senderId === userId,
        sentAt: m.sentAt,
        read: m.readAt !== null,
      })),
      nextCursor: hasMore ? page[page.length - 1].id : null,
    };
  }

  /**
   * Marks the OTHER participant's messages as read.
   *
   * Scoped to `senderId: { not: userId }` deliberately: a user marking their
   * own sent messages read would show the sender a read receipt nobody gave.
   *
   * Guarded by `loadParticipating` for the same reason `sendMessage` is: this
   * emits MESSAGE_READ to the other participant, so it is a write and a
   * delivery channel, not the harmless read its name suggests.
   */
  async markRead(userId: string, pingId: string) {
    const ping = await this.loadParticipating(userId, pingId);
    const otherId = ping.fromId === userId ? ping.toId : ping.fromId;

    const now = new Date();
    const result = await this.prisma.message.updateMany({
      where: { pingId: ping.id, senderId: { not: userId }, readAt: null },
      data: { readAt: now },
    });

    if (result.count > 0) {
      this.realtime.emitToUser(otherId, RealtimeEvent.MESSAGE_READ, {
        pingId: ping.id,
        readAt: now,
        count: result.count,
      });
    }

    return { pingId: ping.id, markedRead: result.count };
  }

  /**
   * Loads a ping the caller participates in and which is open for messaging.
   *
   * THE GATE FOR EVERY MESSAGING PATH — read and write alike. `sendMessage`,
   * `getThread` and `markRead` all come through here, which is the only reason
   * the three of them cannot drift apart on what "may these two people still
   * exchange messages" means.
   */
  private async loadParticipating(userId: string, pingId: string) {
    const ping = await this.prisma.ping.findUnique({
      where: { id: pingId },
      select: { id: true, fromId: true, toId: true, state: true },
    });

    if (!ping || (ping.fromId !== userId && ping.toId !== userId)) {
      throw new NotFoundException('Conversation not found');
    }

    // Blocks are enforced on READS as well as writes (CLAUDE.md §2.5), and this
    // is where that happens for the whole surface.
    //
    // A pair can become blocked long after the ping was accepted, so checking
    // only on the write path leaves every pre-existing thread readable forever
    // to someone who has since been blocked — the client already holds the ping
    // id, because the thread was in its Chats list before the block landed.
    // `listChats` hides it, but hiding a thread from a list is not the same as
    // closing it, and `GET /pings/:id/messages` is reachable without the list.
    // `markRead` matters just as much: it emits MESSAGE_READ to the other
    // participant, so an unguarded read path is also a live delivery channel
    // pointed at the person who asked not to hear from them.
    //
    // 404, byte-identical to the non-participant case above, because §2.5
    // requires a block to be indistinguishable from "no such thing". A distinct
    // error would confirm both that the thread exists and that the pair is
    // blocked, which is exactly what someone checks after being blocked.
    //
    // Checked BEFORE the state test below, so a blocked pair cannot be told
    // apart from an unaccepted one either.
    const otherId = ping.fromId === userId ? ping.toId : ping.fromId;
    if (await this.blocks.isBlockedEitherWay(userId, otherId)) {
      throw new NotFoundException('Conversation not found');
    }

    // A PENDING ping is not a conversation — messaging before acceptance would
    // let a sender push unlimited text at someone who has not consented, which
    // is the whole thing the request/accept split exists to prevent.
    if (ping.state !== PingState.ACCEPTED) {
      throw new ForbiddenException(
        'This conversation is not open. The ping must be accepted first.',
      );
    }

    return ping;
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  /**
   * The public-safe description of a user, for realtime payloads.
   *
   * Short id and display name only. Realtime payloads are the easiest place to
   * leak an internal id by accident, because they are assembled by hand rather
   * than by a serializer someone reviewed.
   */
  private async counterpartOf(userId: string): Promise<Counterpart> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        publicShortId: true,
        profile: { select: { displayName: true } },
      },
    });

    return {
      publicShortId: user?.publicShortId ?? 'unknown',
      displayName: user?.profile?.displayName ?? null,
    };
  }
}

import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { BlocksService } from '../../common/blocks/blocks.service';
import { APP_CONFIG } from '../../config/config.module';
import { generatePublicShortId } from '../../common/ids/public-short-id';
import {
  REALTIME,
  RealtimeEvent,
} from '../../common/realtime/realtime.interface';
import type { Realtime } from '../../common/realtime/realtime.interface';
import { QUEUES } from '../../queue/queue.constants';
import {
  CircleCategory,
  CircleMemberRole,
  CircleMembershipStatus,
  CircleTier,
} from '../../generated/prisma/enums';
import type { AppConfig } from '../../config/env.schema';
import type { CreateCircleDto } from './dto/create-circle.dto';
import type { UpdateCircleDto } from './dto/update-circle.dto';
import type { BrowseCirclesDto } from './dto/browse-circles.dto';
import type { CreatePostDto } from './dto/create-post.dto';
import type { CircleFeedQueryDto } from './dto/circle-feed-query.dto';

/**
 * Delayed-job names on the SCHEDULING queue (S9). Both are one-shot jobs the
 * API enqueues with a `delay`; the worker's SchedulingProcessor consumes them.
 * Declared here, next to the code that produces them, mirroring
 * `MEDIA_SWEEP_JOB` / `VERIFICATION_SWEEP_JOB`.
 */
export const PUBLISH_POST_JOB = 'publish-post';
export const POST_REMINDER_JOB = 'post-reminder';

/** Payload for both scheduling jobs — just the post id; everything else is re-read. */
export interface ScheduledPostJob {
  postId: string;
}

/** The membership row shape every read path loads for the acting viewer. */
type ViewerMembership = {
  id: string;
  role: CircleMemberRole;
  status: CircleMembershipStatus;
} | null;

/**
 * S8 — Circles: structure and membership.
 *
 * Two rules are enforced here on EVERY read, server-side, and tested as a
 * matrix — never assumed from a previous call and never left to the client:
 *
 *  1. INCOGNITO invisibility (CLAUDE.md §1). A circle whose tier is INCOGNITO
 *     does not exist for anyone who is not a member or a pending invitee.
 *     "Not invited" is answered with the same 404 as "no such circle" — a 403
 *     would confirm the circle is real, which is exactly what the tier hides.
 *
 *  2. Blocks (CLAUDE.md §2.5). The shared `BlocksService` is the only place the
 *     block rule lives; this module calls it, never re-derives it. A viewer
 *     blocked with the circle's creator gets a 404 for the circle, and member
 *     lists filter blocked pairs symmetrically.
 *
 * There is no async LLM categorization (DECISIONS.md D-058): `category` is a
 * plain enum the creator picks, validated by the DTO and re-checked here.
 */
@Injectable()
export class CirclesService {
  private readonly logger = new Logger(CirclesService.name);

  /** Post fields returned to a client — no internal author id leaks past shapePost. */
  private readonly POST_SELECT = {
    id: true,
    body: true,
    scheduledFor: true,
    reminderAt: true,
    createdAt: true,
    authorId: true,
    author: {
      select: {
        publicShortId: true,
        profile: { select: { displayName: true } },
      },
    },
  } satisfies Prisma.CirclePostSelect;

  /** Chat message fields returned to a client. */
  private readonly MESSAGE_SELECT = {
    id: true,
    body: true,
    sentAt: true,
    senderId: true,
    sender: {
      select: {
        publicShortId: true,
        profile: { select: { displayName: true } },
      },
    },
  } satisfies Prisma.CircleMessageSelect;

  constructor(
    private readonly prisma: PrismaService,
    private readonly blocks: BlocksService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(REALTIME) private readonly realtime: Realtime,
    @InjectQueue(QUEUES.SCHEDULING) private readonly scheduling: Queue,
  ) {}

  // -------------------------------------------------------------------------
  // Creation & editing
  // -------------------------------------------------------------------------

  /**
   * Creates a circle and makes the caller its first ADMIN member.
   *
   * Gated on `isVerified`, re-read from the database here rather than trusted
   * from the JWT (D-020): the token is not hit on every request and a stale
   * "verified" claim must not be enough to create a circle.
   */
  async create(userId: string, dto: CreateCircleDto) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { isVerified: true },
    });
    if (!user) throw new NotFoundException('Account no longer exists');

    if (!user.isVerified) {
      throw new ForbiddenException(
        'Only verified users can create circles. Complete verification first.',
      );
    }

    // Second bound on top of the verified gate: one account cannot spin up
    // circles without limit.
    const owned = await this.prisma.circleMembership.count({
      where: {
        userId,
        role: CircleMemberRole.ADMIN,
        status: CircleMembershipStatus.ACTIVE,
      },
    });
    if (owned >= this.config.CIRCLE_MAX_OWNED) {
      throw new BadRequestException(
        `You already own the maximum of ${this.config.CIRCLE_MAX_OWNED} circles.`,
      );
    }

    // Re-validate the category against the enum even though the DTO already
    // did — the DB write is the last line of defence and a hallucinated or
    // hand-crafted value must never reach it.
    const category = this.assertCategory(dto.category);

    const circle = await this.createWithUniqueShortId(userId, dto, category);

    this.logger.log(
      `Circle ${circle.id} (${circle.tier}) created by ${userId}`,
    );

    return this.shapeDetail(
      circle,
      {
        id: 'seed',
        role: CircleMemberRole.ADMIN,
        status: CircleMembershipStatus.ACTIVE,
      },
      1,
    );
  }

  /** Admin-only edit. Tier is not editable — see UpdateCircleDto. */
  async update(userId: string, shortId: string, dto: UpdateCircleDto) {
    const { circle } = await this.loadForViewer(userId, shortId);
    await this.assertAdmin(circle.id, userId);

    const category =
      dto.category === undefined
        ? undefined
        : this.assertCategory(dto.category);

    const updated = await this.prisma.circle.update({
      where: { id: circle.id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(category !== undefined && { category }),
        ...(dto.chatEnabled !== undefined && { chatEnabled: dto.chatEnabled }),
      },
    });

    // Turning the chat OFF is the case worth telling members about: their open
    // thread should close now, not on their next failed send. Turning it back
    // on needs no push — they will find it when they next open the circle.
    if (dto.chatEnabled === false && circle.chatEnabled) {
      await this.fanOutToMembers(
        circle.id,
        userId,
        RealtimeEvent.CIRCLE_CHAT_DISABLED,
        { circle: { publicShortId: circle.publicShortId } },
        { includeActor: true },
      );
    }

    const memberCount = await this.countActive(circle.id);
    return this.shapeDetail(
      updated,
      {
        id: 'admin',
        role: CircleMemberRole.ADMIN,
        status: CircleMembershipStatus.ACTIVE,
      },
      memberCount,
    );
  }

  // -------------------------------------------------------------------------
  // Reading
  // -------------------------------------------------------------------------

  /** One circle by public short id, subject to the two read rules above. */
  async getByShortId(viewerId: string, shortId: string) {
    const { circle, membership } = await this.loadForViewer(viewerId, shortId);
    const memberCount = await this.countActive(circle.id);
    return this.shapeDetail(circle, membership, memberCount);
  }

  /**
   * Browse / search.
   *
   * INCOGNITO circles are excluded here structurally — the `where` cannot match
   * them, regardless of the query. Circles created by someone the viewer is
   * blocked with are excluded via an id list from `BlocksService` (D-053): the
   * SQL never expresses what "blocked" means, it just omits ids handed to it.
   * Cursor is a `publicShortId`, never an encoded offset or rank.
   */
  async browse(viewerId: string, dto: BrowseCirclesDto) {
    const take = Math.min(Math.max(dto.limit ?? 25, 1), 50);
    const blockedIds = await this.blocks.blockedIdsFor(viewerId);

    const rows = await this.prisma.circle.findMany({
      where: {
        tier: { in: [CircleTier.OPEN, CircleTier.INVITE_ONLY] },
        ...(dto.category && { category: dto.category }),
        ...(dto.q && { name: { contains: dto.q, mode: 'insensitive' } }),
        ...(blockedIds.size > 0 && {
          createdById: { notIn: [...blockedIds] },
        }),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: take + 1,
      ...(dto.cursor ? { cursor: { publicShortId: dto.cursor }, skip: 1 } : {}),
      select: {
        publicShortId: true,
        name: true,
        description: true,
        tier: true,
        category: true,
        createdAt: true,
        _count: {
          select: {
            memberships: { where: { status: CircleMembershipStatus.ACTIVE } },
          },
        },
      },
    });

    const hasMore = rows.length > take;
    const page = hasMore ? rows.slice(0, take) : rows;

    return {
      circles: page.map((c) => ({
        publicShortId: c.publicShortId,
        name: c.name,
        description: c.description,
        tier: c.tier,
        category: c.category,
        memberCount: c._count.memberships,
        createdAt: c.createdAt,
      })),
      nextCursor: hasMore ? page[page.length - 1].publicShortId : null,
    };
  }

  /**
   * Active members of a circle.
   *
   * The viewer must be able to see the circle at all (INCOGNITO ⇒ member or
   * invitee only). The returned list then has blocked pairs removed
   * symmetrically — a member you have since blocked, or who has blocked you,
   * does not appear (CLAUDE.md §2.5, "filter on read").
   */
  async listMembers(viewerId: string, shortId: string) {
    const { circle } = await this.loadForViewer(viewerId, shortId);

    const members = await this.prisma.circleMembership.findMany({
      where: { circleId: circle.id, status: CircleMembershipStatus.ACTIVE },
      orderBy: [{ role: 'asc' }, { createdAt: 'asc' }],
      select: {
        role: true,
        createdAt: true,
        user: {
          select: {
            id: true,
            publicShortId: true,
            profile: { select: { displayName: true } },
          },
        },
      },
    });

    const blocked = await this.blocks.blockedIdsAmong(
      viewerId,
      members.map((m) => m.user.id),
    );

    return {
      circle: { publicShortId: circle.publicShortId, name: circle.name },
      members: members
        .filter((m) => !blocked.has(m.user.id))
        .map((m) => ({
          publicShortId: m.user.publicShortId,
          displayName: m.user.profile?.displayName ?? null,
          role: m.role,
          joinedAt: m.createdAt,
        })),
    };
  }

  /** The admin's pending join-request queue for one circle. */
  async listJoinRequests(userId: string, shortId: string) {
    const { circle } = await this.loadForViewer(userId, shortId);
    await this.assertAdmin(circle.id, userId);

    const pending = await this.prisma.circleMembership.findMany({
      where: { circleId: circle.id, status: CircleMembershipStatus.PENDING },
      orderBy: { createdAt: 'asc' },
      select: {
        createdAt: true,
        user: {
          select: {
            id: true,
            publicShortId: true,
            profile: { select: { displayName: true } },
          },
        },
      },
    });

    // A request from someone the admin has since blocked is filtered out — the
    // block is symmetric and enforced on read, not only at request time.
    const blocked = await this.blocks.blockedIdsAmong(
      userId,
      pending.map((p) => p.user.id),
    );

    return pending
      .filter((p) => !blocked.has(p.user.id))
      .map((p) => ({
        publicShortId: p.user.publicShortId,
        displayName: p.user.profile?.displayName ?? null,
        requestedAt: p.createdAt,
      }));
  }

  /** Every circle the caller is in or invited to. */
  async listMine(userId: string) {
    const rows = await this.prisma.circleMembership.findMany({
      where: {
        userId,
        status: {
          in: [
            CircleMembershipStatus.ACTIVE,
            CircleMembershipStatus.INVITED,
            CircleMembershipStatus.PENDING,
          ],
        },
      },
      orderBy: { createdAt: 'desc' },
      select: {
        role: true,
        status: true,
        circle: {
          select: {
            publicShortId: true,
            name: true,
            tier: true,
            category: true,
          },
        },
      },
    });

    return rows.map((r) => ({
      publicShortId: r.circle.publicShortId,
      name: r.circle.name,
      tier: r.circle.tier,
      category: r.circle.category,
      role: r.role,
      membershipStatus: r.status,
    }));
  }

  // -------------------------------------------------------------------------
  // Joining
  // -------------------------------------------------------------------------

  /** OPEN circles only: join and become ACTIVE immediately. */
  async join(userId: string, shortId: string) {
    const { circle, membership } = await this.loadForViewer(userId, shortId);

    if (membership?.status === CircleMembershipStatus.ACTIVE) {
      throw new BadRequestException('You are already a member.');
    }

    if (circle.tier === CircleTier.INVITE_ONLY) {
      throw new BadRequestException(
        'This circle is invite-only. Request to join instead.',
      );
    }
    // INCOGNITO never reaches here — loadForViewer already 404s a non-member.

    const invited = membership?.status === CircleMembershipStatus.INVITED;

    await this.prisma.circleMembership.upsert({
      where: { circleId_userId: { circleId: circle.id, userId } },
      create: {
        circleId: circle.id,
        userId,
        role: CircleMemberRole.MEMBER,
        status: CircleMembershipStatus.ACTIVE,
      },
      update: { status: CircleMembershipStatus.ACTIVE },
    });

    this.logger.log(
      `${userId} joined circle ${circle.id}${invited ? ' (had invite)' : ''}`,
    );
    return { publicShortId: circle.publicShortId, membershipStatus: 'ACTIVE' };
  }

  /** INVITE_ONLY circles only: create a PENDING request for an admin to decide. */
  async requestToJoin(userId: string, shortId: string) {
    const { circle, membership } = await this.loadForViewer(userId, shortId);

    if (membership?.status === CircleMembershipStatus.ACTIVE) {
      throw new BadRequestException('You are already a member.');
    }
    if (membership?.status === CircleMembershipStatus.PENDING) {
      throw new BadRequestException('Your request is already pending.');
    }
    if (membership?.status === CircleMembershipStatus.INVITED) {
      // They were invited — accepting is the path, not requesting.
      throw new BadRequestException(
        'You have an invite to this circle. Accept it instead.',
      );
    }

    if (circle.tier === CircleTier.OPEN) {
      throw new BadRequestException('This circle is open — just join it.');
    }

    await this.prisma.circleMembership.create({
      data: {
        circleId: circle.id,
        userId,
        role: CircleMemberRole.MEMBER,
        status: CircleMembershipStatus.PENDING,
      },
    });

    this.logger.log(`${userId} requested to join circle ${circle.id}`);
    return { publicShortId: circle.publicShortId, membershipStatus: 'PENDING' };
  }

  /** Admin approves or rejects a PENDING request, addressed by the user's short id. */
  async decideRequest(
    userId: string,
    shortId: string,
    targetShortId: string,
    approve: boolean,
  ) {
    const { circle } = await this.loadForViewer(userId, shortId);
    await this.assertAdmin(circle.id, userId);

    const target = await this.resolveUser(targetShortId);
    const row = await this.prisma.circleMembership.findUnique({
      where: { circleId_userId: { circleId: circle.id, userId: target.id } },
      select: { id: true, status: true },
    });

    if (!row || row.status !== CircleMembershipStatus.PENDING) {
      throw new NotFoundException('No pending request from that user.');
    }

    if (approve) {
      await this.prisma.circleMembership.update({
        where: { id: row.id },
        data: {
          status: CircleMembershipStatus.ACTIVE,
          decidedBy: `admin:${userId}`,
        },
      });
      this.logger.log(
        `Request by ${target.id} to circle ${circle.id} approved by ${userId}`,
      );
      return { publicShortId: targetShortId, membershipStatus: 'ACTIVE' };
    }

    // Reject deletes the row — no residue, and the user may request again
    // later (the throttler is the spam control, not a terminal state).
    await this.prisma.circleMembership.delete({ where: { id: row.id } });
    this.logger.log(
      `Request by ${target.id} to circle ${circle.id} rejected by ${userId}`,
    );
    return { publicShortId: targetShortId, membershipStatus: 'NONE' };
  }

  // -------------------------------------------------------------------------
  // Invites
  // -------------------------------------------------------------------------

  /**
   * Admin invites a user. Works for every tier, and for INCOGNITO it is the
   * only way in. An INVITED row is also what makes an incognito circle visible
   * to that user.
   */
  async invite(userId: string, shortId: string, targetShortId: string) {
    const { circle } = await this.loadForViewer(userId, shortId);
    await this.assertAdmin(circle.id, userId);

    const target = await this.resolveUser(targetShortId);
    if (target.id === userId) {
      throw new BadRequestException('You are already in this circle.');
    }

    // A block between the admin and the invitee hides the invitee exactly as
    // "no such user" would — same reasoning as pings (D-044).
    if (await this.blocks.isBlockedEitherWay(userId, target.id)) {
      throw new NotFoundException('User not found');
    }

    const existing = await this.prisma.circleMembership.findUnique({
      where: { circleId_userId: { circleId: circle.id, userId: target.id } },
      select: { status: true },
    });

    if (existing?.status === CircleMembershipStatus.ACTIVE) {
      throw new BadRequestException('That user is already a member.');
    }
    if (existing?.status === CircleMembershipStatus.INVITED) {
      throw new BadRequestException('That user has already been invited.');
    }

    // A PENDING request + an admin invite is consent from both sides: promote
    // straight to ACTIVE rather than parking an invite behind a request.
    if (existing?.status === CircleMembershipStatus.PENDING) {
      await this.prisma.circleMembership.update({
        where: { circleId_userId: { circleId: circle.id, userId: target.id } },
        data: {
          status: CircleMembershipStatus.ACTIVE,
          decidedBy: `admin:${userId}`,
        },
      });
      return { publicShortId: targetShortId, membershipStatus: 'ACTIVE' };
    }

    await this.prisma.circleMembership.create({
      data: {
        circleId: circle.id,
        userId: target.id,
        role: CircleMemberRole.MEMBER,
        status: CircleMembershipStatus.INVITED,
        decidedBy: `admin:${userId}`,
      },
    });

    this.logger.log(`${target.id} invited to circle ${circle.id} by ${userId}`);
    return { publicShortId: targetShortId, membershipStatus: 'INVITED' };
  }

  /** Invitee accepts: INVITED → ACTIVE. */
  async acceptInvite(userId: string, shortId: string) {
    const { circle, membership } = await this.loadForViewer(userId, shortId);

    if (membership?.status === CircleMembershipStatus.ACTIVE) {
      throw new BadRequestException('You are already a member.');
    }
    if (membership?.status !== CircleMembershipStatus.INVITED) {
      throw new NotFoundException('You have no invite to this circle.');
    }

    await this.prisma.circleMembership.update({
      where: { circleId_userId: { circleId: circle.id, userId } },
      data: { status: CircleMembershipStatus.ACTIVE },
    });

    this.logger.log(`${userId} accepted invite to circle ${circle.id}`);
    return { publicShortId: circle.publicShortId, membershipStatus: 'ACTIVE' };
  }

  // -------------------------------------------------------------------------
  // Leaving & removal
  // -------------------------------------------------------------------------

  /**
   * Leave a circle (also declines a pending invite or withdraws a request —
   * all three just delete the caller's row).
   *
   * The last remaining member leaving deletes the circle. An admin with other
   * active members still present cannot leave — admin transfer is not in this
   * slice, and a circle with members and no admin has no one who can approve
   * requests, invite, or moderate.
   */
  async leave(userId: string, shortId: string) {
    const { circle, membership } = await this.loadForViewer(userId, shortId);

    if (!membership) {
      throw new BadRequestException('You are not in this circle.');
    }

    if (
      membership.role === CircleMemberRole.ADMIN &&
      membership.status === CircleMembershipStatus.ACTIVE
    ) {
      const otherActive = await this.prisma.circleMembership.count({
        where: {
          circleId: circle.id,
          status: CircleMembershipStatus.ACTIVE,
          NOT: { userId },
        },
      });
      if (otherActive > 0) {
        throw new BadRequestException(
          'You are the admin. Remove the other members first, or the circle would be left with no one who can manage it.',
        );
      }

      // Sole member and admin: leaving dissolves the circle. Cascade clears the
      // remaining (non-active) membership rows.
      await this.prisma.circle.delete({ where: { id: circle.id } });
      this.logger.log(`Circle ${circle.id} dissolved — last member left`);
      return {
        publicShortId: circle.publicShortId,
        left: true,
        dissolved: true,
      };
    }

    await this.prisma.circleMembership.delete({
      where: { circleId_userId: { circleId: circle.id, userId } },
    });
    this.logger.log(`${userId} left circle ${circle.id}`);
    return {
      publicShortId: circle.publicShortId,
      left: true,
      dissolved: false,
    };
  }

  /** Admin removes another member. Cannot remove another admin, or themselves. */
  async kick(userId: string, shortId: string, targetShortId: string) {
    const { circle } = await this.loadForViewer(userId, shortId);
    await this.assertAdmin(circle.id, userId);

    const target = await this.resolveUser(targetShortId);
    if (target.id === userId) {
      throw new BadRequestException('Use leave to remove yourself.');
    }

    const row = await this.prisma.circleMembership.findUnique({
      where: { circleId_userId: { circleId: circle.id, userId: target.id } },
      select: { id: true, role: true },
    });
    if (!row) {
      throw new NotFoundException('That user is not in this circle.');
    }
    if (row.role === CircleMemberRole.ADMIN) {
      throw new BadRequestException('You cannot remove another admin.');
    }

    await this.prisma.circleMembership.delete({ where: { id: row.id } });
    this.logger.log(
      `${target.id} removed from circle ${circle.id} by ${userId}`,
    );
    return { publicShortId: targetShortId, removed: true };
  }

  // -------------------------------------------------------------------------
  // S9 — Posts (admin broadcast)
  // -------------------------------------------------------------------------

  /**
   * Admin posts an announcement.
   *
   * `scheduledFor` in the future hides the post until then (the read filter
   * does that, not a job) and enqueues a delayed job that drives the
   * realtime/push fan-out at publish time. `reminderAt` enqueues a second
   * delayed job. Both instants must be in the future and within
   * CIRCLE_SCHEDULE_MAX_DAYS — an unbounded delay parks a job in Redis
   * indefinitely.
   */
  async createPost(userId: string, shortId: string, dto: CreatePostDto) {
    const { circle } = await this.loadForViewer(userId, shortId);
    await this.assertAdmin(circle.id, userId);

    const now = Date.now();
    const horizon = now + this.config.CIRCLE_SCHEDULE_MAX_DAYS * 86_400_000;
    const scheduledFor = this.parseFutureInstant(
      dto.scheduledFor,
      now,
      horizon,
      'scheduledFor',
    );
    const reminderAt = this.parseFutureInstant(
      dto.reminderAt,
      now,
      horizon,
      'reminderAt',
    );

    const post = await this.prisma.circlePost.create({
      data: {
        circleId: circle.id,
        authorId: userId,
        body: dto.body,
        scheduledFor,
        reminderAt,
      },
      select: this.POST_SELECT,
    });

    const isScheduled = scheduledFor !== null && scheduledFor.getTime() > now;

    if (isScheduled) {
      await this.enqueueScheduledJob(
        PUBLISH_POST_JOB,
        post.id,
        scheduledFor.getTime() - now,
      );
    } else {
      // Live now — fan out immediately. (S10 will also enqueue push here.)
      await this.fanOutToMembers(
        circle.id,
        userId,
        RealtimeEvent.CIRCLE_POST_NEW,
        this.postEventPayload(circle.publicShortId, post),
      );
    }

    if (reminderAt !== null) {
      await this.enqueueScheduledJob(
        POST_REMINDER_JOB,
        post.id,
        reminderAt.getTime() - now,
      );
    }

    this.logger.log(
      `Post ${post.id} created in circle ${circle.id} by ${userId}` +
        `${isScheduled ? ' (scheduled)' : ''}`,
    );

    return this.shapePost(post, userId);
  }

  /**
   * The circle feed, newest first, cursor-paginated.
   *
   * Members only — a circle's posts are not public even for an OPEN circle
   * (browse shows the circle exists; joining shows its content). Non-published
   * scheduled posts are visible only to an ACTIVE admin; everyone else sees
   * `scheduledFor IS NULL OR scheduledFor <= now`. Posts whose author the
   * viewer is blocked with are dropped (CLAUDE.md §2.5).
   */
  async listPosts(userId: string, shortId: string, dto: CircleFeedQueryDto) {
    const { circle, membership } = await this.loadForViewer(userId, shortId);
    this.assertActiveMember(membership);
    const isAdmin =
      membership?.role === CircleMemberRole.ADMIN &&
      membership?.status === CircleMembershipStatus.ACTIVE;

    const take = Math.min(Math.max(dto.limit ?? 25, 1), 50);

    const rows = await this.prisma.circlePost.findMany({
      where: {
        circleId: circle.id,
        ...(isAdmin
          ? {}
          : {
              OR: [
                { scheduledFor: null },
                { scheduledFor: { lte: new Date() } },
              ],
            }),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: take + 1,
      ...(dto.cursor ? { cursor: { id: dto.cursor }, skip: 1 } : {}),
      select: this.POST_SELECT,
    });

    const blocked = await this.blocks.blockedIdsAmong(
      userId,
      rows.map((r) => r.authorId),
    );
    const visible = rows.filter((r) => !blocked.has(r.authorId));

    const hasMore = rows.length > take;
    // `hasMore` is computed on the pre-block-filter rows so a page that loses
    // entries to a block still advances the cursor rather than stalling.
    const page = hasMore ? visible.slice(0, take) : visible;

    return {
      posts: page.map((p) => this.shapePost(p, userId)),
      nextCursor: hasMore ? rows[Math.min(take, rows.length) - 1].id : null,
    };
  }

  /** Author or an ACTIVE admin deletes a post. Also cancels its pending jobs. */
  async deletePost(userId: string, shortId: string, postId: string) {
    const { circle } = await this.loadForViewer(userId, shortId);

    const post = await this.prisma.circlePost.findUnique({
      where: { id: postId },
      select: { id: true, circleId: true, authorId: true },
    });
    // Same 404 whether the id is unknown or belongs to another circle — a post
    // id is not a capability and must not confirm cross-circle existence.
    if (!post || post.circleId !== circle.id) {
      throw new NotFoundException('Post not found');
    }

    if (post.authorId !== userId) {
      await this.assertAdmin(circle.id, userId);
    }

    await this.prisma.circlePost.delete({ where: { id: post.id } });

    // Best effort: the jobs also no-op on a missing post, so a lost race here
    // is harmless (D-066). Never let a queue hiccup fail the delete.
    await this.cancelScheduledJobs(post.id);

    this.logger.log(
      `Post ${post.id} deleted from circle ${circle.id} by ${userId}`,
    );
    return { deleted: true };
  }

  // -------------------------------------------------------------------------
  // S9 — Group chat
  // -------------------------------------------------------------------------

  /**
   * Chat history, newest first, cursor-paginated.
   *
   * ACTIVE members only, and only while `chatEnabled` — both re-read here, not
   * trusted from a prior call or a socket room. Messages from a sender the
   * viewer is blocked with are dropped (CLAUDE.md §2.5, filter on read).
   */
  async listMessages(userId: string, shortId: string, dto: CircleFeedQueryDto) {
    const { circle, membership } = await this.loadForViewer(userId, shortId);
    this.assertActiveMember(membership);
    this.assertChatOpen(circle);

    const take = Math.min(Math.max(dto.limit ?? 25, 1), 50);

    const rows = await this.prisma.circleMessage.findMany({
      where: { circleId: circle.id },
      orderBy: [{ sentAt: 'desc' }, { id: 'desc' }],
      take: take + 1,
      ...(dto.cursor ? { cursor: { id: dto.cursor }, skip: 1 } : {}),
      select: this.MESSAGE_SELECT,
    });

    const blocked = await this.blocks.blockedIdsAmong(
      userId,
      rows.map((r) => r.senderId),
    );
    const visible = rows.filter((r) => !blocked.has(r.senderId));

    const hasMore = rows.length > take;
    const page = hasMore ? visible.slice(0, take) : visible;

    return {
      messages: page.map((m) => this.shapeMessage(m, userId)),
      nextCursor: hasMore ? rows[Math.min(take, rows.length) - 1].id : null,
    };
  }

  /**
   * Post a chat message.
   *
   * The write path re-checks everything: the viewer sees the circle
   * (loadForViewer), is an ACTIVE member, and the chat is open. A kicked member
   * has no membership row, so this throws before any row is written — and the
   * fan-out below, resolved from the live member list, never reaches them
   * again either.
   */
  async sendMessage(userId: string, shortId: string, body: string) {
    const { circle, membership } = await this.loadForViewer(userId, shortId);
    this.assertActiveMember(membership);
    this.assertChatOpen(circle);

    const message = await this.prisma.circleMessage.create({
      data: { circleId: circle.id, senderId: userId, body },
      select: this.MESSAGE_SELECT,
    });

    await this.fanOutToMembers(
      circle.id,
      userId,
      RealtimeEvent.CIRCLE_MESSAGE_NEW,
      {
        circle: { publicShortId: circle.publicShortId },
        message: this.shapeMessage(message, ''),
      },
    );

    return this.shapeMessage(message, userId);
  }

  // -------------------------------------------------------------------------
  // S9 — Delayed-job handlers (called only from SchedulingProcessor)
  // -------------------------------------------------------------------------

  /**
   * A scheduled post reached its publish time. Fan out the "new post" event.
   *
   * Re-reads the post: if it was deleted, or edited past its window, this is a
   * no-op rather than an error (D-066) — cancelling the job on delete is best
   * effort and this is the backstop.
   */
  async publishScheduledPost(postId: string): Promise<void> {
    const post = await this.prisma.circlePost.findUnique({
      where: { id: postId },
      select: {
        ...this.POST_SELECT,
        circle: { select: { id: true, publicShortId: true } },
      },
    });
    if (!post) {
      this.logger.debug(`publish-post: post ${postId} gone, skipping`);
      return;
    }

    await this.fanOutToMembers(
      post.circle.id,
      post.authorId,
      RealtimeEvent.CIRCLE_POST_NEW,
      this.postEventPayload(post.circle.publicShortId, post),
    );
    this.logger.log(`Scheduled post ${postId} published`);
  }

  /** A post reminder fired. Nudge members. No-ops if the post is gone. */
  async firePostReminder(postId: string): Promise<void> {
    const post = await this.prisma.circlePost.findUnique({
      where: { id: postId },
      select: {
        ...this.POST_SELECT,
        circle: { select: { id: true, publicShortId: true } },
      },
    });
    if (!post) {
      this.logger.debug(`post-reminder: post ${postId} gone, skipping`);
      return;
    }

    await this.fanOutToMembers(
      post.circle.id,
      post.authorId,
      RealtimeEvent.CIRCLE_POST_REMINDER,
      this.postEventPayload(post.circle.publicShortId, post),
    );
    this.logger.log(`Reminder fired for post ${postId}`);
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  /**
   * Loads a circle for a viewer, applying the two read rules. Every read and
   * every mutation goes through here, so INCOGNITO invisibility and the
   * creator-block check cannot be forgotten by one path.
   *
   * Returns the circle and the viewer's own membership row (or null).
   * Throws a 404 — byte-identical to "no such circle" — when:
   *   - the short id matches nothing, or
   *   - the circle is INCOGNITO and the viewer has no membership row, or
   *   - the viewer is blocked with the circle's creator.
   */
  private async loadForViewer(viewerId: string, shortId: string) {
    const circle = await this.prisma.circle.findUnique({
      where: { publicShortId: shortId },
      select: {
        id: true,
        publicShortId: true,
        name: true,
        description: true,
        tier: true,
        category: true,
        chatEnabled: true,
        createdById: true,
        createdAt: true,
        memberships: {
          where: { userId: viewerId },
          select: { id: true, role: true, status: true },
          take: 1,
        },
      },
    });

    if (!circle) throw new NotFoundException('Circle not found');

    const membership: ViewerMembership = circle.memberships[0] ?? null;

    if (circle.tier === CircleTier.INCOGNITO && membership === null) {
      throw new NotFoundException('Circle not found');
    }

    // A block with the creator hides the circle wholesale, the same 404 as an
    // unknown short id (CLAUDE.md §2.5). Checked after the incognito test so a
    // blocked viewer cannot tell the two cases apart.
    if (await this.blocks.isBlockedEitherWay(viewerId, circle.createdById)) {
      throw new NotFoundException('Circle not found');
    }

    return { circle, membership };
  }

  /** Asserts the user is an ACTIVE ADMIN of the circle. 403 otherwise. */
  private async assertAdmin(circleId: string, userId: string): Promise<void> {
    const row = await this.prisma.circleMembership.findUnique({
      where: { circleId_userId: { circleId, userId } },
      select: { role: true, status: true },
    });
    if (
      !row ||
      row.role !== CircleMemberRole.ADMIN ||
      row.status !== CircleMembershipStatus.ACTIVE
    ) {
      throw new ForbiddenException('Only a circle admin can do that.');
    }
  }

  private async resolveUser(shortId: string) {
    const user = await this.prisma.user.findUnique({
      where: { publicShortId: shortId },
      select: { id: true },
    });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  private countActive(circleId: string): Promise<number> {
    return this.prisma.circleMembership.count({
      where: { circleId, status: CircleMembershipStatus.ACTIVE },
    });
  }

  /**
   * Guards the category one more time before it reaches the database. The DTO's
   * `@IsEnum` already ran, but this method is also called from `update`, and a
   * DB write is the wrong place to discover a bad enum value.
   */
  private assertCategory(value: CircleCategory | undefined): CircleCategory {
    if (value === undefined) return CircleCategory.OTHER;
    if (!Object.values(CircleCategory).includes(value)) {
      throw new BadRequestException('Unknown circle category.');
    }
    return value;
  }

  private async createWithUniqueShortId(
    userId: string,
    dto: CreateCircleDto,
    category: CircleCategory,
  ) {
    const MAX_ATTEMPTS = 5;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      try {
        return await this.prisma.$transaction(async (tx) => {
          const circle = await tx.circle.create({
            data: {
              publicShortId: generatePublicShortId(),
              name: dto.name,
              description: dto.description ?? null,
              tier: dto.tier,
              category,
              createdById: userId,
            },
          });

          await tx.circleMembership.create({
            data: {
              circleId: circle.id,
              userId,
              role: CircleMemberRole.ADMIN,
              status: CircleMembershipStatus.ACTIVE,
            },
          });

          return circle;
        });
      } catch (error: unknown) {
        const code = (error as { code?: string })?.code;
        const target = (error as { meta?: { target?: string[] } })?.meta
          ?.target;
        const isShortIdCollision =
          code === 'P2002' && target?.includes('public_short_id');

        if (!isShortIdCollision || attempt === MAX_ATTEMPTS) throw error;
        this.logger.warn(
          `Circle publicShortId collision on attempt ${attempt}; regenerating`,
        );
      }
    }

    throw new Error('Failed to allocate a unique circle publicShortId');
  }

  /** The detail payload. No internal ids, no creator user id. */
  private shapeDetail(
    circle: {
      publicShortId: string;
      name: string;
      description: string | null;
      tier: CircleTier;
      category: CircleCategory;
      chatEnabled: boolean;
      createdAt: Date;
    },
    membership: ViewerMembership,
    memberCount: number,
  ) {
    return {
      publicShortId: circle.publicShortId,
      name: circle.name,
      description: circle.description,
      tier: circle.tier,
      category: circle.category,
      chatEnabled: circle.chatEnabled,
      memberCount,
      createdAt: circle.createdAt,
      viewer: {
        role: membership?.role ?? null,
        membershipStatus: membership?.status ?? null,
        isAdmin:
          membership?.role === CircleMemberRole.ADMIN &&
          membership?.status === CircleMembershipStatus.ACTIVE,
      },
    };
  }

  // -------------------------------------------------------------------------
  // S9 internals
  // -------------------------------------------------------------------------

  /** ACTIVE membership required for the post feed and the chat. 403 otherwise. */
  private assertActiveMember(membership: ViewerMembership): void {
    if (membership?.status !== CircleMembershipStatus.ACTIVE) {
      throw new ForbiddenException('You must be a member of this circle.');
    }
  }

  /** The chat re-check that every message read and write runs (BACKEND_PLAN S9). */
  private assertChatOpen(circle: { chatEnabled: boolean }): void {
    if (!circle.chatEnabled) {
      throw new ForbiddenException('Group chat is turned off for this circle.');
    }
  }

  /**
   * Validates a client-supplied schedule instant: parseable, strictly in the
   * future, and within CIRCLE_SCHEDULE_MAX_DAYS. Returns `null` for an omitted
   * value.
   */
  private parseFutureInstant(
    raw: string | undefined,
    now: number,
    horizon: number,
    field: string,
  ): Date | null {
    if (raw === undefined) return null;
    const t = Date.parse(raw);
    if (Number.isNaN(t)) {
      throw new BadRequestException(`${field} is not a valid date`);
    }
    if (t <= now) {
      throw new BadRequestException(`${field} must be in the future`);
    }
    if (t > horizon) {
      throw new BadRequestException(
        `${field} is more than ${this.config.CIRCLE_SCHEDULE_MAX_DAYS} days ahead`,
      );
    }
    return new Date(t);
  }

  private scheduledJobId(name: string, postId: string): string {
    // Hyphen, not colon — BullMQ rejects a custom job id containing ':'.
    return `${name}-${postId}`;
  }

  /** Enqueues one delayed scheduling job, deduplicated on the post id. */
  private async enqueueScheduledJob(
    name: typeof PUBLISH_POST_JOB | typeof POST_REMINDER_JOB,
    postId: string,
    delayMs: number,
  ): Promise<void> {
    await this.scheduling.add(name, { postId } satisfies ScheduledPostJob, {
      delay: Math.max(delayMs, 0),
      jobId: this.scheduledJobId(name, postId),
    });
  }

  /**
   * Best-effort cancel of a post's pending jobs on delete. The job handlers
   * also no-op on a missing post (D-066), so losing this race is harmless —
   * never let a queue error fail the delete.
   */
  private async cancelScheduledJobs(postId: string): Promise<void> {
    try {
      await Promise.all([
        this.scheduling.remove(this.scheduledJobId(PUBLISH_POST_JOB, postId)),
        this.scheduling.remove(this.scheduledJobId(POST_REMINDER_JOB, postId)),
      ]);
    } catch (err: unknown) {
      this.logger.warn(
        `Could not cancel scheduled jobs for post ${postId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  /**
   * Delivers an event to every ACTIVE member of a circle, one `emitToUser` per
   * member, resolved from the live membership table at call time.
   *
   * Deliberately NOT a `circle:<id>` socket room: a room join outlives a kick
   * until the socket disconnects, so a removed member would keep receiving
   * posts and chat. A fresh member lookup drops them immediately (D-065).
   *
   * The actor (author / sender / admin) is excluded unless `includeActor`, and
   * members blocked with the actor are skipped symmetrically (CLAUDE.md §2.5).
   */
  private async fanOutToMembers(
    circleId: string,
    actorId: string,
    event: RealtimeEvent,
    payload: unknown,
    opts: { includeActor?: boolean } = {},
  ): Promise<void> {
    const members = await this.prisma.circleMembership.findMany({
      where: { circleId, status: CircleMembershipStatus.ACTIVE },
      select: { userId: true },
    });

    const targets = members
      .map((m) => m.userId)
      .filter((id) => opts.includeActor || id !== actorId);
    if (targets.length === 0) return;

    const blocked = await this.blocks.blockedIdsAmong(actorId, targets);
    for (const id of targets) {
      if (blocked.has(id)) continue;
      this.realtime.emitToUser(id, event, payload);
    }
  }

  /** The `circle:post:*` realtime payload, shared by the live and scheduled paths. */
  private postEventPayload(
    circleShortId: string,
    post: PostRow,
  ): {
    circle: { publicShortId: string };
    post: ReturnType<CirclesService['shapePost']>;
  } {
    return {
      circle: { publicShortId: circleShortId },
      post: this.shapePost(post, ''),
    };
  }

  /** Post payload. Internal author id is dropped; `mine` is derived from it first. */
  private shapePost(post: PostRow, viewerId: string) {
    return {
      id: post.id,
      body: post.body,
      author: {
        publicShortId: post.author.publicShortId,
        displayName: post.author.profile?.displayName ?? null,
      },
      mine: post.authorId === viewerId,
      scheduledFor: post.scheduledFor,
      reminderAt: post.reminderAt,
      createdAt: post.createdAt,
    };
  }

  /** Chat message payload. Internal sender id dropped; `mine` derived first. */
  private shapeMessage(message: MessageRow, viewerId: string) {
    return {
      id: message.id,
      body: message.body,
      sender: {
        publicShortId: message.sender.publicShortId,
        displayName: message.sender.profile?.displayName ?? null,
      },
      mine: message.senderId === viewerId,
      sentAt: message.sentAt,
    };
  }
}

/** Row shape from POST_SELECT. */
type PostRow = Prisma.CirclePostGetPayload<{
  select: {
    id: true;
    body: true;
    scheduledFor: true;
    reminderAt: true;
    createdAt: true;
    authorId: true;
    author: {
      select: {
        publicShortId: true;
        profile: { select: { displayName: true } };
      };
    };
  };
}>;

/** Row shape from MESSAGE_SELECT. */
type MessageRow = Prisma.CircleMessageGetPayload<{
  select: {
    id: true;
    body: true;
    sentAt: true;
    senderId: true;
    sender: {
      select: {
        publicShortId: true;
        profile: { select: { displayName: true } };
      };
    };
  };
}>;

import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { BlocksService } from '../../common/blocks/blocks.service';
import { APP_CONFIG } from '../../config/config.module';
import { generatePublicShortId } from '../../common/ids/public-short-id';
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

  constructor(
    private readonly prisma: PrismaService,
    private readonly blocks: BlocksService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
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
      },
    });

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
}

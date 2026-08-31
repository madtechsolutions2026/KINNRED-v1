import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { CirclesService } from './circles.service';
import {
  CircleCategory,
  CircleMemberRole,
  CircleMembershipStatus,
  CircleTier,
} from '../../generated/prisma/enums';
import type { BlocksService } from '../../common/blocks/blocks.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { AppConfig } from '../../config/env.schema';

const ADMIN = 'user-admin';
const OUTSIDER = 'user-outsider';

/**
 * `expect.objectContaining` is typed `any`, which trips no-unsafe-assignment
 * when nested in an object literal. Narrowing to `unknown` keeps the matchers
 * readable (same helper as verification.service.spec).
 */
const like = (shape: Record<string, unknown>): unknown =>
  expect.objectContaining(shape) as unknown;

/** First argument of every recorded call to a jest mock. */
const firstArgs = (mock: { mock: { calls: unknown[][] } }): unknown[] =>
  mock.mock.calls.map((c) => c[0]);

type MembershipRow = {
  id: string;
  role: CircleMemberRole;
  status: CircleMembershipStatus;
};

type CircleRow = {
  id: string;
  publicShortId: string;
  name: string;
  description: string | null;
  tier: CircleTier;
  category: CircleCategory;
  chatEnabled: boolean;
  createdById: string;
  createdAt: Date;
  memberships: MembershipRow[];
};

function circleRow(over: Partial<CircleRow> = {}): CircleRow {
  return {
    id: 'circle-1',
    publicShortId: 'CIRCLE0001',
    name: 'Trail Runners',
    description: null,
    tier: CircleTier.OPEN,
    category: CircleCategory.SPORTS,
    chatEnabled: true,
    createdById: ADMIN,
    createdAt: new Date('2026-08-31T10:00:00Z'),
    memberships: [],
    ...over,
  };
}

function postRow(over: Record<string, unknown> = {}) {
  return {
    id: 'post-1',
    body: 'Trail cleanup Saturday',
    scheduledFor: null,
    reminderAt: null,
    createdAt: new Date('2026-08-31T12:00:00Z'),
    authorId: ADMIN,
    author: { publicShortId: 'USERADMIN', profile: { displayName: 'Ada' } },
    ...over,
  };
}

function messageRow(over: Record<string, unknown> = {}) {
  return {
    id: 'msg-1',
    body: 'see you there',
    sentAt: new Date('2026-08-31T12:05:00Z'),
    senderId: 'user-mira',
    sender: { publicShortId: 'USERMIRA', profile: { displayName: 'Mira' } },
    ...over,
  };
}

const activeAdmin: MembershipRow = {
  id: 'm-admin',
  role: CircleMemberRole.ADMIN,
  status: CircleMembershipStatus.ACTIVE,
};

function build(opts: {
  circle?: CircleRow | null;
  isVerified?: boolean;
  ownedCount?: number;
  blockedWith?: string[];
  membershipLookup?: MembershipRow | null;
  activeMemberCount?: number;
  activeMemberIds?: string[];
  posts?: Array<Record<string, unknown>>;
  messages?: Array<Record<string, unknown>>;
  postLookup?: Record<string, unknown> | null;
  now?: string;
}) {
  const circleFindUnique = jest
    .fn()
    .mockResolvedValue(opts.circle === undefined ? circleRow() : opts.circle);

  const membershipFindUnique = jest
    .fn()
    .mockResolvedValue(opts.membershipLookup ?? null);
  const membershipFindMany = jest
    .fn()
    .mockImplementation((args: { select?: { userId?: boolean } }) => {
      // fanOutToMembers asks only for { userId: true }
      if (args?.select?.userId) {
        return Promise.resolve(
          (opts.activeMemberIds ?? []).map((userId) => ({ userId })),
        );
      }
      return Promise.resolve([]);
    });
  const membershipCount = jest
    .fn()
    .mockResolvedValue(opts.activeMemberCount ?? opts.ownedCount ?? 0);
  const membershipCreate = jest.fn().mockResolvedValue({ id: 'm-new' });
  const membershipUpdate = jest.fn().mockResolvedValue({ id: 'm-1' });
  const membershipUpsert = jest.fn().mockResolvedValue({ id: 'm-1' });
  const membershipDelete = jest.fn().mockResolvedValue({ id: 'm-1' });

  const circleCreate = jest
    .fn()
    .mockResolvedValue(circleRow({ memberships: undefined as never }));
  const circleUpdate = jest
    .fn()
    .mockImplementation((args: { data?: Record<string, unknown> }) =>
      Promise.resolve(circleRow(args.data ?? {})),
    );
  const circleDelete = jest.fn().mockResolvedValue(circleRow());
  const circleFindMany = jest.fn().mockResolvedValue([]);

  const circlePostCreate = jest
    .fn()
    .mockImplementation((args: { data?: Record<string, unknown> }) =>
      Promise.resolve(postRow(args.data ?? {})),
    );
  const circlePostFindMany = jest.fn().mockResolvedValue(opts.posts ?? []);
  const circlePostFindUnique = jest
    .fn()
    .mockResolvedValue(opts.postLookup === undefined ? null : opts.postLookup);
  const circlePostDelete = jest.fn().mockResolvedValue(postRow());

  const circleMessageCreate = jest
    .fn()
    .mockImplementation((args: { data?: Record<string, unknown> }) =>
      Promise.resolve(messageRow(args.data ?? {})),
    );
  const circleMessageFindMany = jest
    .fn()
    .mockResolvedValue(opts.messages ?? []);

  const userFindUnique = jest.fn().mockImplementation((args: unknown) => {
    const where = (args as { where: { id?: string; publicShortId?: string } })
      .where;
    if (where.id) {
      return Promise.resolve({ isVerified: opts.isVerified ?? true });
    }
    return Promise.resolve({ id: `id-of-${where.publicShortId}` });
  });

  const prisma = {
    user: { findUnique: userFindUnique },
    circle: {
      findUnique: circleFindUnique,
      findMany: circleFindMany,
      create: circleCreate,
      update: circleUpdate,
      delete: circleDelete,
    },
    circleMembership: {
      findUnique: membershipFindUnique,
      findMany: membershipFindMany,
      count: membershipCount,
      create: membershipCreate,
      update: membershipUpdate,
      upsert: membershipUpsert,
      delete: membershipDelete,
    },
    circlePost: {
      create: circlePostCreate,
      findMany: circlePostFindMany,
      findUnique: circlePostFindUnique,
      delete: circlePostDelete,
    },
    circleMessage: {
      create: circleMessageCreate,
      findMany: circleMessageFindMany,
    },
    $transaction: jest.fn((cb: (tx: unknown) => unknown) => cb(prisma)),
  } as unknown as PrismaService;

  const blocks = {
    isBlockedEitherWay: jest
      .fn()
      .mockImplementation((a: string, b: string) =>
        Promise.resolve(
          (opts.blockedWith ?? []).includes(a) ||
            (opts.blockedWith ?? []).includes(b),
        ),
      ),
    blockedIdsAmong: jest
      .fn()
      .mockResolvedValue(new Set(opts.blockedWith ?? [])),
    blockedIdsFor: jest.fn().mockResolvedValue(new Set(opts.blockedWith ?? [])),
  } as unknown as BlocksService;

  const config = {
    CIRCLE_MAX_OWNED: 25,
    CIRCLE_SCHEDULE_MAX_DAYS: 90,
  } as AppConfig;

  const realtime = { emitToUser: jest.fn() };
  const scheduling = {
    add: jest.fn().mockResolvedValue(undefined),
    remove: jest.fn().mockResolvedValue(1),
  };

  return {
    service: new CirclesService(
      prisma,
      blocks,
      config,
      realtime,
      scheduling as never,
    ),
    prisma,
    blocks,
    realtime,
    scheduling,
    mocks: {
      circleFindUnique,
      circleFindMany,
      circleCreate,
      circleUpdate,
      circleDelete,
      membershipFindUnique,
      membershipFindMany,
      membershipCount,
      membershipCreate,
      membershipUpdate,
      membershipUpsert,
      membershipDelete,
      circlePostCreate,
      circlePostFindMany,
      circlePostFindUnique,
      circlePostDelete,
      circleMessageCreate,
      circleMessageFindMany,
    },
  };
}

describe('CirclesService', () => {
  // -----------------------------------------------------------------------
  // create — the verified gate (CLAUDE.md §2.3, D-020)
  // -----------------------------------------------------------------------
  describe('create', () => {
    const dto = {
      name: 'Trail Runners',
      tier: CircleTier.OPEN,
      category: CircleCategory.SPORTS,
    };

    it('rejects an unverified user', async () => {
      const { service } = build({ isVerified: false });
      await expect(service.create(ADMIN, dto)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('rejects once the owned-circle cap is reached', async () => {
      const { service } = build({ isVerified: true, ownedCount: 25 });
      await expect(service.create(ADMIN, dto)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('creates the circle and an ACTIVE ADMIN membership for the creator', async () => {
      const { service, mocks } = build({ isVerified: true, ownedCount: 0 });
      const res = await service.create(ADMIN, dto);

      expect(mocks.circleCreate).toHaveBeenCalledTimes(1);
      expect(mocks.membershipCreate).toHaveBeenCalledWith({
        data: {
          circleId: 'circle-1',
          userId: ADMIN,
          role: CircleMemberRole.ADMIN,
          status: CircleMembershipStatus.ACTIVE,
        },
      });
      expect(res.viewer.isAdmin).toBe(true);
    });

    it('defaults an omitted category to OTHER', async () => {
      const { service, mocks } = build({ isVerified: true, ownedCount: 0 });
      await service.create(ADMIN, { name: 'X', tier: CircleTier.OPEN });

      const calls = mocks.circleCreate.mock.calls as unknown as Array<
        [{ data: { category: CircleCategory } }]
      >;
      expect(calls[0][0].data.category).toBe(CircleCategory.OTHER);
    });
  });

  // -----------------------------------------------------------------------
  // loadForViewer — the INCOGNITO invisibility matrix (CLAUDE.md §1)
  // -----------------------------------------------------------------------
  describe('incognito visibility', () => {
    it('404s an incognito circle for a non-member', async () => {
      const { service } = build({
        circle: circleRow({ tier: CircleTier.INCOGNITO, memberships: [] }),
      });
      await expect(
        service.getByShortId(OUTSIDER, 'CIRCLE0001'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('shows an incognito circle to an INVITED user', async () => {
      const { service } = build({
        circle: circleRow({
          tier: CircleTier.INCOGNITO,
          memberships: [
            {
              id: 'm-1',
              role: CircleMemberRole.MEMBER,
              status: CircleMembershipStatus.INVITED,
            },
          ],
        }),
      });
      const res = await service.getByShortId(OUTSIDER, 'CIRCLE0001');
      expect(res.viewer.membershipStatus).toBe(CircleMembershipStatus.INVITED);
    });

    it('shows an incognito circle to an ACTIVE member', async () => {
      const { service } = build({
        circle: circleRow({
          tier: CircleTier.INCOGNITO,
          memberships: [activeAdmin],
        }),
      });
      const res = await service.getByShortId(ADMIN, 'CIRCLE0001');
      expect(res.viewer.isAdmin).toBe(true);
    });

    it('404s an unknown short id', async () => {
      const { service } = build({ circle: null });
      await expect(
        service.getByShortId(OUTSIDER, 'NOPE'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  // -----------------------------------------------------------------------
  // blocks (CLAUDE.md §2.5)
  // -----------------------------------------------------------------------
  describe('blocks', () => {
    it('404s an OPEN circle when the viewer is blocked with the creator', async () => {
      const { service } = build({
        circle: circleRow({ tier: CircleTier.OPEN }),
        blockedWith: [OUTSIDER],
      });
      await expect(
        service.getByShortId(OUTSIDER, 'CIRCLE0001'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('filters blocked pairs out of the member list', async () => {
      const { service, blocks, mocks } = build({
        circle: circleRow({ memberships: [activeAdmin] }),
      });
      mocks.membershipFindMany.mockResolvedValueOnce([
        {
          role: CircleMemberRole.MEMBER,
          createdAt: new Date(),
          user: { id: 'blocked-user', publicShortId: 'BLK', profile: null },
        },
        {
          role: CircleMemberRole.MEMBER,
          createdAt: new Date(),
          user: { id: 'ok-user', publicShortId: 'OKK', profile: null },
        },
      ]);
      (blocks.blockedIdsAmong as jest.Mock).mockResolvedValueOnce(
        new Set(['blocked-user']),
      );

      const res = await service.listMembers(ADMIN, 'CIRCLE0001');
      expect(res.members.map((m) => m.publicShortId)).toEqual(['OKK']);
    });
  });

  // -----------------------------------------------------------------------
  // joining, per tier
  // -----------------------------------------------------------------------
  describe('join', () => {
    it('makes an OPEN-circle joiner ACTIVE', async () => {
      const { service, mocks } = build({
        circle: circleRow({ tier: CircleTier.OPEN, memberships: [] }),
      });
      const res = await service.join(OUTSIDER, 'CIRCLE0001');
      expect(mocks.membershipUpsert).toHaveBeenCalled();
      expect(res.membershipStatus).toBe('ACTIVE');
    });

    it('refuses a plain join on an INVITE_ONLY circle', async () => {
      const { service } = build({
        circle: circleRow({ tier: CircleTier.INVITE_ONLY, memberships: [] }),
      });
      await expect(service.join(OUTSIDER, 'CIRCLE0001')).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('refuses to re-join when already ACTIVE', async () => {
      const { service } = build({
        circle: circleRow({
          tier: CircleTier.OPEN,
          memberships: [
            {
              id: 'm-1',
              role: CircleMemberRole.MEMBER,
              status: CircleMembershipStatus.ACTIVE,
            },
          ],
        }),
      });
      await expect(service.join(OUTSIDER, 'CIRCLE0001')).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });
  });

  describe('requestToJoin', () => {
    it('creates a PENDING row for an INVITE_ONLY circle', async () => {
      const { service, mocks } = build({
        circle: circleRow({ tier: CircleTier.INVITE_ONLY, memberships: [] }),
      });
      const res = await service.requestToJoin(OUTSIDER, 'CIRCLE0001');
      expect(mocks.membershipCreate).toHaveBeenCalledWith({
        data: {
          circleId: 'circle-1',
          userId: OUTSIDER,
          role: CircleMemberRole.MEMBER,
          status: CircleMembershipStatus.PENDING,
        },
      });
      expect(res.membershipStatus).toBe('PENDING');
    });

    it('tells an OPEN-circle requester to just join', async () => {
      const { service } = build({
        circle: circleRow({ tier: CircleTier.OPEN, memberships: [] }),
      });
      await expect(
        service.requestToJoin(OUTSIDER, 'CIRCLE0001'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  // -----------------------------------------------------------------------
  // admin authority
  // -----------------------------------------------------------------------
  describe('admin-gated actions', () => {
    it('refuses invite from a non-admin', async () => {
      const { service, mocks } = build({
        circle: circleRow({ memberships: [] }),
      });
      mocks.membershipFindUnique.mockResolvedValue(null); // assertAdmin lookup
      await expect(
        service.invite(OUTSIDER, 'CIRCLE0001', 'SOMEONE'),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('creates an INVITED row when an admin invites', async () => {
      const { service, mocks } = build({
        circle: circleRow({ memberships: [activeAdmin] }),
      });
      mocks.membershipFindUnique
        .mockResolvedValueOnce(activeAdmin) // assertAdmin
        .mockResolvedValueOnce(null); // existing membership for target
      const res = await service.invite(ADMIN, 'CIRCLE0001', 'INVITEE');
      expect(res.membershipStatus).toBe('INVITED');
      expect(mocks.membershipCreate).toHaveBeenCalled();
    });

    it('404s an invite to a user the admin is blocked with', async () => {
      const { service, mocks } = build({
        circle: circleRow({ memberships: [activeAdmin] }),
        blockedWith: ['id-of-INVITEE'],
      });
      mocks.membershipFindUnique.mockResolvedValueOnce(activeAdmin);
      await expect(
        service.invite(ADMIN, 'CIRCLE0001', 'INVITEE'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('approves a pending request to ACTIVE', async () => {
      const { service, mocks } = build({
        circle: circleRow({ memberships: [activeAdmin] }),
      });
      mocks.membershipFindUnique
        .mockResolvedValueOnce(activeAdmin) // assertAdmin
        .mockResolvedValueOnce({
          id: 'm-req',
          status: CircleMembershipStatus.PENDING,
        });
      const res = await service.decideRequest(
        ADMIN,
        'CIRCLE0001',
        'REQUESTER',
        true,
      );
      expect(res.membershipStatus).toBe('ACTIVE');
      expect(mocks.membershipUpdate).toHaveBeenCalled();
    });

    it('rejects a pending request by deleting the row', async () => {
      const { service, mocks } = build({
        circle: circleRow({ memberships: [activeAdmin] }),
      });
      mocks.membershipFindUnique
        .mockResolvedValueOnce(activeAdmin)
        .mockResolvedValueOnce({
          id: 'm-req',
          status: CircleMembershipStatus.PENDING,
        });
      await service.decideRequest(ADMIN, 'CIRCLE0001', 'REQUESTER', false);
      expect(mocks.membershipDelete).toHaveBeenCalledWith({
        where: { id: 'm-req' },
      });
    });

    it('will not let an admin kick another admin', async () => {
      const { service, mocks } = build({
        circle: circleRow({ memberships: [activeAdmin] }),
      });
      mocks.membershipFindUnique
        .mockResolvedValueOnce(activeAdmin) // assertAdmin
        .mockResolvedValueOnce({ id: 'm-2', role: CircleMemberRole.ADMIN });
      await expect(
        service.kick(ADMIN, 'CIRCLE0001', 'CO_ADMIN'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  // -----------------------------------------------------------------------
  // leaving
  // -----------------------------------------------------------------------
  describe('leave', () => {
    it('blocks the sole admin from leaving while other members remain', async () => {
      const { service, mocks } = build({
        circle: circleRow({ memberships: [activeAdmin] }),
      });
      mocks.membershipCount.mockResolvedValue(2); // other active members
      await expect(service.leave(ADMIN, 'CIRCLE0001')).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('dissolves the circle when the last member (an admin) leaves', async () => {
      const { service, mocks } = build({
        circle: circleRow({ memberships: [activeAdmin] }),
      });
      mocks.membershipCount.mockResolvedValue(0);
      const res = await service.leave(ADMIN, 'CIRCLE0001');
      expect(mocks.circleDelete).toHaveBeenCalledWith({
        where: { id: 'circle-1' },
      });
      expect(res.dissolved).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // browse
  // -----------------------------------------------------------------------
  describe('browse', () => {
    it('never queries INCOGNITO circles and passes blocked ids to notIn', async () => {
      const { service, mocks } = build({ blockedWith: ['bad-creator'] });

      await service.browse(OUTSIDER, {});

      const calls = mocks.circleFindMany.mock.calls as unknown as Array<
        [
          {
            where: {
              tier: { in: CircleTier[] };
              createdById?: { notIn: string[] };
            };
          },
        ]
      >;
      expect(calls[0][0].where.tier.in).toEqual([
        CircleTier.OPEN,
        CircleTier.INVITE_ONLY,
      ]);
      expect(calls[0][0].where.createdById?.notIn).toContain('bad-creator');
    });
  });

  // -----------------------------------------------------------------------
  // S9 — posts
  // -----------------------------------------------------------------------
  describe('createPost', () => {
    const MEMBER = 'user-mira';
    const adminCircle = () => circleRow({ memberships: [activeAdmin] });

    it('rejects a non-admin', async () => {
      const { service } = build({
        circle: adminCircle(),
        membershipLookup: {
          id: 'm',
          role: CircleMemberRole.MEMBER,
          status: CircleMembershipStatus.ACTIVE,
        },
      });
      await expect(
        service.createPost(MEMBER, 'CIRCLE0001', { body: 'hi' }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('fans an immediate post out to the other active members, not the author', async () => {
      const { service, realtime, scheduling } = build({
        circle: adminCircle(),
        membershipLookup: activeAdmin,
        activeMemberIds: [ADMIN, MEMBER],
      });

      const res = await service.createPost(ADMIN, 'CIRCLE0001', {
        body: 'Trail cleanup Saturday',
      });

      expect(res.mine).toBe(true);
      expect(scheduling.add).not.toHaveBeenCalled();
      expect(realtime.emitToUser).toHaveBeenCalledTimes(1);
      expect(realtime.emitToUser).toHaveBeenCalledWith(
        MEMBER,
        'circle:post:new',
        like({ post: like({ id: 'post-1' }) }),
      );
    });

    it('a future scheduledFor enqueues a delayed publish job and does not fan out now', async () => {
      const { service, realtime, scheduling } = build({
        circle: adminCircle(),
        membershipLookup: activeAdmin,
        activeMemberIds: [ADMIN, MEMBER],
      });
      const when = new Date(Date.now() + 3 * 86_400_000).toISOString();

      await service.createPost(ADMIN, 'CIRCLE0001', {
        body: 'Race day',
        scheduledFor: when,
      });

      expect(realtime.emitToUser).not.toHaveBeenCalled();
      const call = scheduling.add.mock.calls[0] as unknown as [
        string,
        { postId: string },
        { delay: number; jobId: string },
      ];
      expect(call[0]).toBe('publish-post');
      expect(call[2].jobId).toBe('publish-post-post-1');
      expect(call[2].delay).toBeGreaterThan(0);
    });

    it('a reminderAt enqueues a reminder job', async () => {
      const { service, scheduling } = build({
        circle: adminCircle(),
        membershipLookup: activeAdmin,
        activeMemberIds: [ADMIN],
      });
      const when = new Date(Date.now() + 86_400_000).toISOString();

      await service.createPost(ADMIN, 'CIRCLE0001', {
        body: 'Race day',
        reminderAt: when,
      });

      expect(scheduling.add).toHaveBeenCalledWith(
        'post-reminder',
        { postId: 'post-1' },
        expect.objectContaining({ jobId: 'post-reminder-post-1' }),
      );
    });

    it('rejects a scheduledFor in the past', async () => {
      const { service } = build({
        circle: adminCircle(),
        membershipLookup: activeAdmin,
      });
      await expect(
        service.createPost(ADMIN, 'CIRCLE0001', {
          body: 'x',
          scheduledFor: new Date(Date.now() - 1000).toISOString(),
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects a scheduledFor beyond the horizon', async () => {
      const { service } = build({
        circle: adminCircle(),
        membershipLookup: activeAdmin,
      });
      await expect(
        service.createPost(ADMIN, 'CIRCLE0001', {
          body: 'x',
          scheduledFor: new Date(Date.now() + 200 * 86_400_000).toISOString(),
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('listPosts', () => {
    it('rejects a non-member', async () => {
      const { service } = build({
        circle: circleRow({ memberships: [] }),
      });
      await expect(
        service.listPosts(OUTSIDER, 'CIRCLE0001', {}),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('applies the scheduled-post visibility filter for a non-admin member', async () => {
      const { service, mocks } = build({
        circle: circleRow({
          memberships: [
            {
              id: 'm',
              role: CircleMemberRole.MEMBER,
              status: CircleMembershipStatus.ACTIVE,
            },
          ],
        }),
        posts: [postRow()],
      });

      await service.listPosts('user-mira', 'CIRCLE0001', {});

      const where = (
        firstArgs(mocks.circlePostFindMany)[0] as { where: { OR?: unknown[] } }
      ).where;
      expect(where.OR).toBeDefined();
    });

    it('shows an admin every post, scheduled included', async () => {
      const { service, mocks } = build({
        circle: circleRow({ memberships: [activeAdmin] }),
        posts: [postRow({ scheduledFor: new Date(Date.now() + 1e6) })],
      });

      await service.listPosts(ADMIN, 'CIRCLE0001', {});

      const where = (
        firstArgs(mocks.circlePostFindMany)[0] as { where: { OR?: unknown[] } }
      ).where;
      expect(where.OR).toBeUndefined();
    });

    it('drops posts whose author the viewer is blocked with', async () => {
      const { service } = build({
        circle: circleRow({
          memberships: [
            {
              id: 'm',
              role: CircleMemberRole.MEMBER,
              status: CircleMembershipStatus.ACTIVE,
            },
          ],
        }),
        posts: [postRow({ authorId: 'blocked-admin' })],
        blockedWith: ['blocked-admin'],
      });

      const res = await service.listPosts('user-mira', 'CIRCLE0001', {});
      expect(res.posts).toHaveLength(0);
    });
  });

  describe('deletePost', () => {
    it('404s a post that belongs to another circle', async () => {
      const { service } = build({
        circle: circleRow({ memberships: [activeAdmin] }),
        postLookup: { id: 'post-1', circleId: 'other', authorId: ADMIN },
      });
      await expect(
        service.deletePost(ADMIN, 'CIRCLE0001', 'post-1'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('lets the author delete and cancels the pending jobs', async () => {
      const { service, mocks, scheduling } = build({
        circle: circleRow({ memberships: [activeAdmin] }),
        postLookup: {
          id: 'post-1',
          circleId: 'circle-1',
          authorId: 'user-mira',
        },
      });

      const res = await service.deletePost('user-mira', 'CIRCLE0001', 'post-1');

      expect(res.deleted).toBe(true);
      expect(mocks.circlePostDelete).toHaveBeenCalled();
      expect(scheduling.remove).toHaveBeenCalledWith('publish-post-post-1');
      expect(scheduling.remove).toHaveBeenCalledWith('post-reminder-post-1');
    });

    it('forbids a non-author non-admin', async () => {
      const { service } = build({
        circle: circleRow({ memberships: [] }),
        postLookup: { id: 'post-1', circleId: 'circle-1', authorId: ADMIN },
        membershipLookup: {
          id: 'm',
          role: CircleMemberRole.MEMBER,
          status: CircleMembershipStatus.ACTIVE,
        },
      });
      await expect(
        service.deletePost('user-mira', 'CIRCLE0001', 'post-1'),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  // -----------------------------------------------------------------------
  // S9 — group chat
  // -----------------------------------------------------------------------
  describe('sendMessage', () => {
    const activeMember = {
      id: 'm',
      role: CircleMemberRole.MEMBER,
      status: CircleMembershipStatus.ACTIVE,
    };

    it('rejects a non-member (e.g. someone just kicked)', async () => {
      const { service } = build({ circle: circleRow({ memberships: [] }) });
      await expect(
        service.sendMessage(OUTSIDER, 'CIRCLE0001', 'hi'),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('rejects when the chat is disabled', async () => {
      const { service } = build({
        circle: circleRow({ chatEnabled: false, memberships: [activeMember] }),
      });
      await expect(
        service.sendMessage('user-mira', 'CIRCLE0001', 'hi'),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('fans out to other active members, block-filtered, never the sender', async () => {
      const { service, realtime } = build({
        circle: circleRow({ memberships: [activeMember] }),
        activeMemberIds: ['user-mira', 'user-ada', 'user-blocked'],
        blockedWith: ['user-blocked'],
      });

      await service.sendMessage('user-mira', 'CIRCLE0001', 'see you there');

      const recipients = firstArgs(realtime.emitToUser);
      expect(recipients).toEqual(['user-ada']);
    });
  });

  describe('listMessages', () => {
    const activeMember = {
      id: 'm',
      role: CircleMemberRole.MEMBER,
      status: CircleMembershipStatus.ACTIVE,
    };

    it('rejects when the chat is disabled', async () => {
      const { service } = build({
        circle: circleRow({ chatEnabled: false, memberships: [activeMember] }),
      });
      await expect(
        service.listMessages('user-mira', 'CIRCLE0001', {}),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('drops messages from a blocked sender', async () => {
      const { service } = build({
        circle: circleRow({ memberships: [activeMember] }),
        messages: [messageRow({ senderId: 'user-blocked' })],
        blockedWith: ['user-blocked'],
      });
      const res = await service.listMessages('user-mira', 'CIRCLE0001', {});
      expect(res.messages).toHaveLength(0);
    });
  });

  describe('update — chat toggle', () => {
    it('fans out CIRCLE_CHAT_DISABLED when an admin turns the chat off', async () => {
      const { service, realtime } = build({
        circle: circleRow({ memberships: [activeAdmin] }),
        membershipLookup: activeAdmin,
        activeMemberIds: [ADMIN, 'user-mira'],
      });

      await service.update(ADMIN, 'CIRCLE0001', { chatEnabled: false });

      expect(realtime.emitToUser).toHaveBeenCalledWith(
        'user-mira',
        'circle:chat:disabled',
        expect.anything(),
      );
    });
  });

  // -----------------------------------------------------------------------
  // S9 — delayed-job handlers
  // -----------------------------------------------------------------------
  describe('publishScheduledPost', () => {
    it('no-ops when the post was deleted before the job ran', async () => {
      const { service, realtime } = build({ postLookup: null });
      await service.publishScheduledPost('gone');
      expect(realtime.emitToUser).not.toHaveBeenCalled();
    });

    it('fans out CIRCLE_POST_NEW when the post is still there', async () => {
      const { service, realtime } = build({
        activeMemberIds: [ADMIN, 'user-mira'],
        postLookup: {
          ...postRow(),
          circle: { id: 'circle-1', publicShortId: 'CIRCLE0001' },
        },
      });

      await service.publishScheduledPost('post-1');

      expect(realtime.emitToUser).toHaveBeenCalledWith(
        'user-mira',
        'circle:post:new',
        expect.anything(),
      );
    });
  });

  describe('firePostReminder', () => {
    it('no-ops when the post is gone', async () => {
      const { service, realtime } = build({ postLookup: null });
      await service.firePostReminder('gone');
      expect(realtime.emitToUser).not.toHaveBeenCalled();
    });
  });
});

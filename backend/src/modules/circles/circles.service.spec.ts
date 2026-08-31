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
    createdById: ADMIN,
    createdAt: new Date('2026-08-31T10:00:00Z'),
    memberships: [],
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
}) {
  const circleFindUnique = jest
    .fn()
    .mockResolvedValue(opts.circle === undefined ? circleRow() : opts.circle);

  const membershipFindUnique = jest
    .fn()
    .mockResolvedValue(opts.membershipLookup ?? null);
  const membershipFindMany = jest.fn().mockResolvedValue([]);
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
  const circleUpdate = jest.fn().mockResolvedValue(circleRow());
  const circleDelete = jest.fn().mockResolvedValue(circleRow());
  const circleFindMany = jest.fn().mockResolvedValue([]);

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

  const config = { CIRCLE_MAX_OWNED: 25 } as AppConfig;

  return {
    service: new CirclesService(prisma, blocks, config),
    prisma,
    blocks,
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
});

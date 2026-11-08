import { PlansService } from './plans.service';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { BrowsePlansDto, CreatePlanDto } from './dto/plan.dto';
function fixture() {
  const plan = {
    id: 'internal-plan',
    publicShortId: 'PUBLICPLAN',
    ownerId: 'host',
    cancelled: false,
    startsAt: new Date(Date.now() + 86400000),
    title: 'Coffee',
    description: '',
    place: 'Public cafe',
    owner: {
      id: 'host',
      publicShortId: 'HOSTPUBLIC',
      username: 'host_user',
      profile: { displayName: 'Host' },
    },
    requests: [],
  };
  const prisma = {
    plan: {
      findUnique: jest.fn().mockResolvedValue(plan),
      findMany: jest.fn().mockResolvedValue([plan]),
      count: jest.fn().mockResolvedValue(0),
      create: jest.fn().mockResolvedValue(plan),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    planRequest: {
      upsert: jest.fn().mockResolvedValue({ state: 'PENDING' }),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      deleteMany: jest.fn(),
    },
    user: { findUnique: jest.fn().mockResolvedValue({ id: 'guest' }) },
    $queryRaw: jest.fn().mockResolvedValue([{ id: 'internal-plan' }]),
  };
  const blocks = {
    isBlockedEitherWay: jest.fn().mockResolvedValue(false),
    blockedIdsFor: jest.fn().mockResolvedValue(new Set()),
  };
  return {
    plan,
    prisma,
    blocks,
    service: new PlansService(prisma as never, blocks as never),
  };
}
describe('Plans permissions and discovery', () => {
  it('shows all discoverable plans without a radius by default', async () => {
    const f = fixture();
    await f.service.browse('guest', new BrowsePlansDto());
    const sql = f.prisma.$queryRaw.mock.calls[0][0].strings.join('');
    expect(sql).not.toContain('ST_DWithin');
    expect(sql).toContain('COALESCE(s.discoverable,true)');
  });
  it('rejects past or excessively distant dates before writing', async () => {
    const f = fixture();
    for (const startsAt of [
      '2000-01-01',
      new Date(Date.now() + 181 * 86400000).toISOString(),
    ])
      await expect(
        f.service.create('host', {
          title: 'Coffee',
          place: 'Public cafe',
          startsAt,
        }),
      ).rejects.toThrow('future time');
    expect(f.prisma.plan.create).not.toHaveBeenCalled();
  });
  it('prevents a non-host deciding join requests', async () => {
    const f = fixture();
    await expect(
      f.service.decide('stranger', 'PUBLICPLAN', 'GUEST', 'ACCEPTED'),
    ).rejects.toThrow('Plan not found');
    expect(f.prisma.planRequest.updateMany).not.toHaveBeenCalled();
  });
  it('hides blocked hosts and refuses requests without writing', async () => {
    const f = fixture();
    f.blocks.isBlockedEitherWay.mockResolvedValue(true);
    await expect(f.service.request('guest', 'PUBLICPLAN')).rejects.toThrow(
      'Plan not found',
    );
    expect(f.prisma.planRequest.upsert).not.toHaveBeenCalled();
  });
  it('rejects requests for cancelled plans', async () => {
    const f = fixture();
    f.plan.cancelled = true;
    await expect(f.service.request('guest', 'PUBLICPLAN')).rejects.toThrow(
      'Plan not found',
    );
  });
  it('makes requesting idempotent without resetting rejected or accepted state', async () => {
    const f = fixture();
    await f.service.request('guest', 'PUBLICPLAN');
    expect(f.prisma.planRequest.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { planId_userId: { planId: 'internal-plan', userId: 'guest' } },
        update: {},
      }),
    );
  });
  it('never lets the host join their own plan', async () => {
    const f = fixture();
    await expect(f.service.request('host', 'PUBLICPLAN')).rejects.toThrow(
      'already hosting',
    );
  });
  it('cancels only plans owned by the acting user', async () => {
    const f = fixture();
    await f.service.cancel('host', 'PUBLICPLAN');
    expect(f.prisma.plan.updateMany).toHaveBeenCalledWith({
      where: { ownerId: 'host', publicShortId: 'PUBLICPLAN', cancelled: false },
      data: { cancelled: true },
    });
  });
  it('browses using fixed radii, fuzzed points and the shared block exclusion set', async () => {
    const f = fixture();
    f.blocks.blockedIdsFor.mockResolvedValue(new Set(['blocked-host']));
    const response = await f.service.browse(
      'guest',
      Object.assign(new BrowsePlansDto(), { radiusMeters: 3000 }),
    );
    const sql = f.prisma.$queryRaw.mock.calls[0][0];
    expect(sql.strings.join('')).toContain('geog_fuzzed');
    expect(sql.values).toContain(3000);
    expect(sql.values).toContain('blocked-host');
    expect(JSON.stringify(response)).not.toContain('internal-plan');
    expect(JSON.stringify(response)).not.toContain('ownerId');
  });
  it('does not disclose other guests or blocked participants', async () => {
    const f = fixture();
    (f.plan.requests as unknown[]).push(
      {
        userId: 'blocked',
        state: 'PENDING',
        user: { publicShortId: 'BLOCKED', profile: { displayName: 'Hidden' } },
      },
      {
        userId: 'guest',
        state: 'PENDING',
        user: { publicShortId: 'GUEST', profile: { displayName: 'Guest' } },
      },
    );
    f.blocks.blockedIdsFor.mockResolvedValue(new Set(['blocked']));
    const guest = await f.service.browse('guest', new BrowsePlansDto());
    expect(guest.results[0].requests).toEqual([]);
    const host = await f.service.browse('host', new BrowsePlansDto());
    expect(host.results[0].requests).toHaveLength(1);
    expect(host.results[0].requests[0].publicShortId).toBe('GUEST');
  });
  it('rejects a free-form radius and invalid dates at the DTO boundary', async () => {
    expect(
      await validate(plainToInstance(BrowsePlansDto, { radiusMeters: 1501 })),
    ).not.toHaveLength(0);
    expect(
      await validate(
        plainToInstance(CreatePlanDto, {
          title: 'Coffee',
          place: 'Cafe',
          startsAt: 'not a date',
        }),
      ),
    ).not.toHaveLength(0);
  });
});

import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { BlocksService } from '../../common/blocks/blocks.service';
import { generatePublicShortId } from '../../common/ids/public-short-id';
import { BrowsePlansDto, CreatePlanDto } from './dto/plan.dto';
const include = {
  owner: {
    select: {
      id: true,
      publicShortId: true,
      username: true,
      profile: { select: { displayName: true } },
    },
  },
  requests: {
    select: {
      userId: true,
      state: true,
      user: {
        select: {
          publicShortId: true,
          profile: { select: { displayName: true } },
        },
      },
    },
  },
} satisfies Prisma.PlanInclude;
type LoadedPlan = Prisma.PlanGetPayload<{ include: typeof include }>;
@Injectable()
export class PlansService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly blocks: BlocksService,
  ) {}
  async create(userId: string, dto: CreatePlanDto) {
    const startsAt = new Date(dto.startsAt);
    if (
      startsAt.getTime() <= Date.now() ||
      startsAt.getTime() > Date.now() + 180 * 86400000
    )
      throw new BadRequestException(
        'Choose a future time within the next 180 days',
      );
    const active = await this.prisma.plan.count({
      where: {
        ownerId: userId,
        cancelled: false,
        startsAt: { gt: new Date() },
      },
    });
    if (active >= 20)
      throw new BadRequestException('You can host up to 20 upcoming plans');
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const plan = await this.prisma.plan.create({
          data: {
            ownerId: userId,
            publicShortId: generatePublicShortId(),
            title: dto.title,
            description: dto.description ?? '',
            place: dto.place,
            startsAt,
          },
          include,
        });
        return this.present(plan, userId, new Set());
      } catch (error) {
        if ((error as { code?: string }).code !== 'P2002' || attempt === 2)
          throw error;
      }
    }
  }
  async browse(userId: string, query: BrowsePlansDto) {
    const blocked = await this.blocks.blockedIdsFor(userId);
    const exclusions = blocked.size
      ? Prisma.sql`AND p.owner_id NOT IN (${Prisma.join([...blocked])})`
      : Prisma.empty;
    // Same fixed radii and fuzzed target points as Grid. No coordinates or distances leave SQL.
    const scope =
      query.mine === 'true'
        ? Prisma.sql`(p.owner_id=${userId} OR EXISTS(SELECT 1 FROM plan_requests r WHERE r.plan_id=p.id AND r.user_id=${userId}))`
        : query.radiusMeters === undefined
          ? Prisma.sql`(p.owner_id=${userId} OR COALESCE(s.discoverable,true))`
          : Prisma.sql`(p.owner_id=${userId} OR (COALESCE(s.discoverable,true) AND ST_DWithin(l.geog_fuzzed,(SELECT geog FROM user_locations WHERE user_id=${userId}),${query.radiusMeters}::double precision)))`;
    const cursor = query.cursor
      ? Prisma.sql`AND p.public_short_id > ${query.cursor}`
      : Prisma.empty;
    const rows = await this.prisma.$queryRaw<{ id: string }[]>(Prisma.sql`
      SELECT p.id FROM plans p LEFT JOIN user_locations l ON l.user_id=p.owner_id
      LEFT JOIN user_settings s ON s.user_id=p.owner_id
      WHERE p.cancelled=false AND p.starts_at>now() AND ${scope} ${exclusions} ${cursor}
      ORDER BY p.public_short_id ASC LIMIT 31::int`);
    const page = rows.slice(0, 30);
    const plans = await this.prisma.plan.findMany({
      where: { id: { in: page.map((p) => p.id) } },
      include,
    });
    const byId = new Map(plans.map((p) => [p.id, p]));
    return {
      results: page.map((p) => this.present(byId.get(p.id)!, userId, blocked)),
      nextCursor:
        rows.length > 30
          ? byId.get(page[page.length - 1].id)!.publicShortId
          : null,
    };
  }
  async request(userId: string, shortId: string) {
    const plan = await this.available(userId, shortId);
    if (plan.ownerId === userId)
      throw new BadRequestException('You are already hosting this plan');
    const request = await this.prisma.planRequest.upsert({
      where: { planId_userId: { planId: plan.id, userId } },
      create: { planId: plan.id, userId },
      update: {},
      select: { state: true },
    });
    return request;
  }
  async withdraw(userId: string, shortId: string) {
    const plan = await this.available(userId, shortId);
    await this.prisma.planRequest.deleteMany({
      where: { planId: plan.id, userId },
    });
    return { withdrawn: true };
  }
  async decide(
    userId: string,
    shortId: string,
    requesterShortId: string,
    state: 'ACCEPTED' | 'REJECTED',
  ) {
    const plan = await this.available(userId, shortId);
    if (plan.ownerId !== userId) throw new NotFoundException('Plan not found');
    const user = await this.prisma.user.findUnique({
      where: { publicShortId: requesterShortId },
      select: { id: true },
    });
    if (!user || (await this.blocks.isBlockedEitherWay(userId, user.id)))
      throw new NotFoundException('Request not found');
    const result = await this.prisma.planRequest.updateMany({
      where: { planId: plan.id, userId: user.id, state: 'PENDING' },
      data: { state },
    });
    if (!result.count) throw new NotFoundException('Pending request not found');
    return { state };
  }
  async cancel(userId: string, shortId: string) {
    const result = await this.prisma.plan.updateMany({
      where: { ownerId: userId, publicShortId: shortId, cancelled: false },
      data: { cancelled: true },
    });
    if (!result.count) throw new NotFoundException('Plan not found');
    return { cancelled: true };
  }
  private async available(userId: string, shortId: string) {
    const plan = await this.prisma.plan.findUnique({
      where: { publicShortId: shortId },
    });
    if (
      !plan ||
      plan.cancelled ||
      plan.startsAt <= new Date() ||
      (await this.blocks.isBlockedEitherWay(userId, plan.ownerId))
    )
      throw new NotFoundException('Plan not found');
    return plan;
  }
  private present(plan: LoadedPlan, userId: string, blocked: Set<string>) {
    const visible = plan.requests.filter((r) => !blocked.has(r.userId));
    return {
      publicShortId: plan.publicShortId,
      title: plan.title,
      description: plan.description,
      place: plan.place,
      startsAt: plan.startsAt,
      owner: {
        publicShortId: plan.owner.publicShortId,
        username: plan.owner.username,
        displayName: plan.owner.profile?.displayName ?? null,
      },
      isOwner: plan.ownerId === userId,
      myRequest: visible.find((r) => r.userId === userId)?.state ?? null,
      acceptedCount: visible.filter((r) => r.state === 'ACCEPTED').length,
      requests:
        plan.ownerId === userId
          ? visible.map((r) => ({
              publicShortId: r.user.publicShortId,
              displayName: r.user.profile?.displayName ?? null,
              state: r.state,
            }))
          : [],
    };
  }
}

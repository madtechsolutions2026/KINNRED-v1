import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Blocking.
 *
 * Split out of PingsService because a block is not a ping concept: you must be
 * able to block someone you have never interacted with, and downstream surfaces
 * that know nothing about pings (Grid, circles, notifications) still have to
 * honour it.
 *
 * Moved out of `modules/pings/` into `common/` in S6 (DECISIONS.md D-050) once
 * `VisibilityService` needed it: `common/` must not depend on a domain module.
 * The controller (`BlocksController`) stayed in pings — that is a REST surface,
 * and this is a rule.
 *
 * ── ENFORCEMENT IS SYMMETRIC ────────────────────────────────────────────────
 * The row records who blocked whom, because "who initiated this" is not
 * recoverable from a symmetric row and abuse review needs it. But every read
 * checks BOTH directions. A block that only hid the blocker from the blocked
 * user would leave the blocked user's content visible to the person who wanted
 * to stop seeing them — the exact opposite of what was asked for.
 * ────────────────────────────────────────────────────────────────────────────
 */
@Injectable()
export class BlocksService {
  private readonly logger = new Logger(BlocksService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Blocks a user, addressed by PUBLIC SHORT ID.
   *
   * Short id rather than internal id, consistently with every other
   * user-addressing endpoint (S3): clients are never given another user's
   * primary key, so accepting one here would be the only place that leaked it.
   */
  async block(blockerId: string, targetShortId: string) {
    const target = await this.prisma.user.findUnique({
      where: { publicShortId: targetShortId },
      select: { id: true },
    });

    if (!target) throw new NotFoundException('User not found');

    if (target.id === blockerId) {
      throw new BadRequestException('You cannot block yourself');
    }

    // Idempotent: blocking twice is not an error. A client retrying after a
    // dropped response must not get a 409 for an action that already succeeded
    // — and for a safety action, "it failed" is a worse lie than "it was
    // already done".
    await this.prisma.block.upsert({
      where: {
        blockerId_blockedId: { blockerId, blockedId: target.id },
      },
      create: { blockerId, blockedId: target.id },
      update: {},
    });

    this.logger.log(`User ${blockerId} blocked ${target.id}`);

    return { blocked: true, publicShortId: targetShortId };
  }

  /**
   * Removes a block.
   *
   * Note what this deliberately does NOT do: it does not restore a rejected or
   * deleted ping. Unblocking returns the pair to "strangers", not to whatever
   * relationship existed beforehand.
   */
  async unblock(blockerId: string, targetShortId: string) {
    const target = await this.prisma.user.findUnique({
      where: { publicShortId: targetShortId },
      select: { id: true },
    });

    if (!target) throw new NotFoundException('User not found');

    await this.prisma.block.deleteMany({
      where: { blockerId, blockedId: target.id },
    });

    this.logger.log(`User ${blockerId} unblocked ${target.id}`);

    return { blocked: false, publicShortId: targetShortId };
  }

  /** The caller's own block list. Only ever blocks they made. */
  async listBlocked(blockerId: string) {
    const blocks = await this.prisma.block.findMany({
      where: { blockerId },
      orderBy: { createdAt: 'desc' },
      select: {
        createdAt: true,
        blocked: {
          select: {
            publicShortId: true,
            profile: { select: { displayName: true } },
          },
        },
      },
    });

    return blocks.map((b) => ({
      publicShortId: b.blocked.publicShortId,
      displayName: b.blocked.profile?.displayName ?? null,
      blockedAt: b.createdAt,
    }));
  }

  /**
   * Is there a block between these two, in EITHER direction?
   *
   * The single-pair check. Prefer `blockedIdsAmong` when checking more than
   * one — this is an N+1 in a loop.
   */
  async isBlockedEitherWay(a: string, b: string): Promise<boolean> {
    const found = await this.prisma.block.findFirst({
      where: {
        OR: [
          { blockerId: a, blockedId: b },
          { blockerId: b, blockedId: a },
        ],
      },
      select: { id: true },
    });

    return found !== null;
  }

  /**
   * Batch form: of `candidateIds`, which are blocked relative to `userId` in
   * either direction?
   *
   * Exists because every list endpoint on this surface — and later the Grid,
   * which pages ~50 users at a time — needs to exclude blocked pairs. Doing
   * that with per-row checks is an N+1 that would push someone toward caching
   * block state, and a stale block cache means a blocked user reappears.
   *
   * @returns the subset of `candidateIds` that must be hidden.
   */
  async blockedIdsAmong(
    userId: string,
    candidateIds: readonly string[],
  ): Promise<Set<string>> {
    if (candidateIds.length === 0) return new Set();

    const ids = [...new Set(candidateIds)];

    const rows = await this.prisma.block.findMany({
      where: {
        OR: [
          { blockerId: userId, blockedId: { in: ids } },
          { blockedId: userId, blockerId: { in: ids } },
        ],
      },
      select: { blockerId: true, blockedId: true },
    });

    // Collect the OTHER party from each row, whichever side it fell on.
    const blocked = new Set<string>();
    for (const row of rows) {
      blocked.add(row.blockerId === userId ? row.blockedId : row.blockerId);
    }

    return blocked;
  }

  /**
   * EVERY user id blocked relative to `userId`, in either direction — with no
   * candidate list to intersect against.
   *
   * Exists for the Grid (S7), which cannot use `blockedIdsAmong`: its candidates
   * are produced by a spatial query, so there is no id list until after the
   * query has already run. Filtering afterwards would silently shrink the page
   * ("give me 25" returning 22) and corrupt cursor pagination, and pushing an
   * `EXISTS (SELECT … FROM blocks …)` into that query would re-derive the
   * symmetric-block rule inside a module — exactly what CLAUDE.md §2.5 forbids,
   * and how the rule ends up with two subtly different implementations.
   *
   * So the rule stays here and the Grid receives a plain exclusion list. The
   * SQL never expresses what "blocked" means; it only excludes ids this service
   * decided on (DECISIONS.md D-053).
   *
   * Unbounded by design — a block list is small (tens, not thousands) because
   * blocking is a deliberate per-person act. If that ever stops being true, the
   * fix is a semi-join against a temp table, not a per-row check.
   */
  async blockedIdsFor(userId: string): Promise<Set<string>> {
    const rows = await this.prisma.block.findMany({
      where: {
        OR: [{ blockerId: userId }, { blockedId: userId }],
      },
      select: { blockerId: true, blockedId: true },
    });

    const blocked = new Set<string>();
    for (const row of rows) {
      blocked.add(row.blockerId === userId ? row.blockedId : row.blockerId);
    }

    return blocked;
  }
}

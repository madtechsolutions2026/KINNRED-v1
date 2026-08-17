import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { BlocksService } from '../blocks/blocks.service';
import { PingState } from '../../generated/prisma/enums';

/** What a given viewer is allowed to see of a given user's photos. */
export const PhotoAccess = {
  /** No photo at all — not even a blurred placeholder. */
  LOCKED: 'LOCKED',
  /** The pre-generated blurred derivative only (S2, D-029). */
  BLURRED: 'BLURRED',
  /** The real photo. */
  UNLOCKED: 'UNLOCKED',
} as const;

export type PhotoAccess = (typeof PhotoAccess)[keyof typeof PhotoAccess];

export interface VisibilityDecision {
  targetUserId: string;
  access: PhotoAccess;
  /** Why. Kept for audit and debugging — never returned to a client. */
  reason: string;
}

/**
 * The one ping row that can exist between a viewer and a target (D-042).
 * Deliberately the narrowest shape the rule needs: no `isVerified`, no
 * `gender`, nothing a future edit could reach for by accident.
 */
interface PairPing {
  fromId: string;
  toId: string;
  state: PingState;
}

/**
 * THE photo-visibility resolver (CLAUDE.md §2.1).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  THIS FILE IS THE ONLY PLACE THE PHOTO-LOCK RULE MAY EXIST.
 *
 *  Every photo-bearing read path — Grid results, profile fetch, ping and chat
 *  participants, circle member lists — must route through here. Do not
 *  re-implement the rule at a call site, and do not "inline it just this
 *  once". A rule enforced in six places is a rule with six subtly different
 *  behaviours, and the one that is wrong will not be the one anyone reads.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * S6 status: complete. The S3 stub (D-032) had no unlock path because ping
 * history did not exist yet; S5 shipped it, and `decide()` now evaluates the
 * real rule (D-049). The stub's structural properties — fail closed by
 * construction, batch-first, decision separate from rendering — are unchanged
 * and still test-guarded.
 *
 * THE COMPLETE RULE. A locked profile unlocks iff:
 *   1. the owner pinged the viewer (the request is live or was accepted), or
 *   2. the owner accepted the viewer's ping.
 * Both are actions the OWNER took. A block re-locks either one.
 *
 * ⚠ NO VIEWER ATTRIBUTE UNLOCKS ANYTHING. Not `gender`, not `isVerified`, not
 * anything added later. The "verified female viewer" unlock was removed
 * entirely (D-036): nothing can attest gender — it is self-declared, and
 * liveness proves a live human matching the profile photos, not a gender — so
 * the rule reduced to "declare FEMALE, pass liveness, read every locked
 * profile". Adding any viewer-attribute unlock is a change to CLAUDE.md §2.1
 * and needs explicit sign-off, not a pull request.
 */
@Injectable()
export class VisibilityService {
  private readonly logger = new Logger(VisibilityService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly blocks: BlocksService,
  ) {}

  /**
   * The unordered-pair key, computed exactly as `PingsService.pairKeyFor`
   * does. Duplicated as a private static rather than imported from
   * `modules/pings` because `common/` must not depend on a domain module —
   * and a cross-check test asserts the two agree, so a change to one that is
   * not mirrored fails immediately rather than silently resolving every pair
   * to "no relationship" (which fails closed, and so would never be noticed
   * as a bug — only as photos quietly staying blurred).
   */
  private static pairKeyFor(a: string, b: string): string {
    return a < b ? `${a}:${b}` : `${b}:${a}`;
  }

  /**
   * Batch resolution. This is the primary entry point.
   *
   * Batch-first by design: the Grid resolves a page of ~50 profiles at once,
   * and a per-user query there is an N+1 that pushes people toward caching the
   * result. A cached stale unlock is a safety failure, so the fix must be
   * batching rather than caching.
   *
   * Three queries regardless of page size: the targets, the ping rows for the
   * pairs, the blocks. The ping lookup is a single `IN` over `pairKey`, which
   * is unique-indexed — one row per pair (D-042) is what makes this a lookup
   * rather than a two-directional scan.
   *
   * @returns a Map keyed by target user id. Ids that do not resolve are
   *          present and LOCKED — never absent, so a caller cannot mistake a
   *          missing entry for permission.
   */
  async resolveMany(
    viewerId: string,
    targetUserIds: readonly string[],
  ): Promise<Map<string, VisibilityDecision>> {
    const result = new Map<string, VisibilityDecision>();
    if (targetUserIds.length === 0) return result;

    const unique = [...new Set(targetUserIds)];

    // Pre-seed every requested id as LOCKED. Anything the queries below do not
    // account for therefore fails closed by construction rather than by
    // remembering to handle it.
    for (const id of unique) {
      result.set(id, {
        targetUserId: id,
        access: PhotoAccess.LOCKED,
        reason: 'unknown-user',
      });
    }

    const targets = await this.prisma.user.findMany({
      where: { id: { in: unique } },
      select: { id: true, photosLocked: true },
    });

    const others = targets.filter((t) => t.id !== viewerId).map((t) => t.id);

    // Relationship data is fetched for EVERY other target, including ones whose
    // photos are not locked. Skipping the unlocked ones would be a real saving
    // on a Grid page, but it would make the queries depend on the branch order
    // inside `decide()` — and blocks apply to unlocked profiles too.
    const [pairs, blocked] = await Promise.all([
      this.loadPairs(viewerId, others),
      this.blocks.blockedIdsAmong(viewerId, others),
    ]);

    for (const target of targets) {
      result.set(
        target.id,
        VisibilityService.decide(
          viewerId,
          target,
          pairs.get(target.id),
          blocked.has(target.id),
        ),
      );
    }

    return result;
  }

  /** Single-target convenience. Prefer resolveMany wherever more than one. */
  async resolveOne(
    viewerId: string,
    targetUserId: string,
  ): Promise<VisibilityDecision> {
    const map = await this.resolveMany(viewerId, [targetUserId]);
    return (
      map.get(targetUserId) ?? {
        targetUserId,
        access: PhotoAccess.LOCKED,
        reason: 'unknown-user',
      }
    );
  }

  /**
   * The ping row, if any, between the viewer and each target — keyed by the
   * TARGET's id for the benefit of the caller.
   */
  private async loadPairs(
    viewerId: string,
    targetIds: readonly string[],
  ): Promise<Map<string, PairPing>> {
    const byTarget = new Map<string, PairPing>();
    if (targetIds.length === 0) return byTarget;

    const keyToTarget = new Map<string, string>();
    for (const targetId of targetIds) {
      keyToTarget.set(
        VisibilityService.pairKeyFor(viewerId, targetId),
        targetId,
      );
    }

    const pings = await this.prisma.ping.findMany({
      where: { pairKey: { in: [...keyToTarget.keys()] } },
      select: { pairKey: true, fromId: true, toId: true, state: true },
    });

    for (const ping of pings) {
      const targetId = keyToTarget.get(ping.pairKey);
      if (targetId === undefined) continue;
      byTarget.set(targetId, {
        fromId: ping.fromId,
        toId: ping.toId,
        state: ping.state,
      });
    }

    return byTarget;
  }

  /**
   * The decision itself: pure, synchronous, and static, so the whole rule can
   * be exercised as a table without a database in the way. Every input it is
   * allowed to consider is a parameter — there is nothing here to reach for.
   *
   * @param pair    the one ping row between the two, if it exists (D-042).
   * @param blocked is there a block in EITHER direction (CLAUDE.md §2.5).
   */
  private static decide(
    viewerId: string,
    target: { id: string; photosLocked: boolean },
    pair: PairPing | undefined,
    blocked: boolean,
  ): VisibilityDecision {
    // You can always see your own photos.
    if (viewerId === target.id) {
      return {
        targetUserId: target.id,
        access: PhotoAccess.UNLOCKED,
        reason: 'self',
      };
    }

    // Blocks come before everything else, including `photosLocked`. A blocked
    // pair is mutually invisible (§2.5), so this hides an unlocked profile too
    // — and, more importantly, it revokes an unlock that an earlier ping had
    // granted. A pair can become blocked long after it was accepted, and a
    // rule that only ran at ping time would leave that unlock standing
    // forever. LOCKED rather than BLURRED: a blur still confirms a person.
    if (blocked) {
      return {
        targetUserId: target.id,
        access: PhotoAccess.LOCKED,
        reason: 'blocked',
      };
    }

    // The owner has chosen to be publicly visible. Not a security decision —
    // an explicit choice recorded in the column. Read `photosLocked`, NEVER
    // `gender` (D-017): gender is a Grid filter, not an authorisation input.
    if (!target.photosLocked) {
      return {
        targetUserId: target.id,
        access: PhotoAccess.UNLOCKED,
        reason: 'owner-not-locked',
      };
    }

    const unlock = VisibilityService.ownerActionUnlocking(pair, target.id);
    if (unlock !== null) {
      return {
        targetUserId: target.id,
        access: PhotoAccess.UNLOCKED,
        reason: unlock,
      };
    }

    // Locked, and the owner has taken no action towards this viewer. Blurred
    // rather than fully locked so the product still shows something — the
    // derivative exists precisely for this state.
    return {
      targetUserId: target.id,
      access: PhotoAccess.BLURRED,
      reason: 'locked-no-owner-action',
    };
  }

  /**
   * Did the OWNER take an action that unlocks their photos to this viewer?
   *
   * Returns the audit reason, or null. This is the entire rule; everything
   * else in this file is plumbing around it.
   *
   * ┌──────────────────────────┬───────────┬────────┐
   * │ row direction            │ state     │ unlock │
   * ├──────────────────────────┼───────────┼────────┤
   * │ owner → viewer           │ PENDING   │  yes   │  owner reached out
   * │ owner → viewer           │ ACCEPTED  │  yes   │  and the viewer agreed
   * │ viewer → owner           │ ACCEPTED  │  yes   │  owner accepted (rule 2)
   * │ viewer → owner           │ PENDING   │  no    │  owner has done nothing
   * │ either                   │ REJECTED  │  no    │  terminal
   * │ no row                   │ —         │  no    │  strangers
   * └──────────────────────────┴───────────┴────────┘
   *
   * Two cases resolve themselves and need no code:
   * - **Withdrawal revokes.** Withdrawing deletes the row (D-043), so the
   *   unlock disappears with it. There is no separate revoke path to maintain.
   * - **A ping back is an acceptance** (D-043), which mutates the existing row
   *   to ACCEPTED rather than inserting a second one. It therefore lands on
   *   row 3 above and unlocks correctly with no special case.
   *
   * REJECTED does not unlock in EITHER direction, including when the owner was
   * the sender. The literal text of §2.1 rule 1 ("the owner has pinged the
   * requesting user") would say yes there, but rejection is terminal by
   * database constraint (D-042): the owner cannot withdraw a rejected row, so
   * she would be permanently visible to someone who declined her, with no
   * revoke path at all. A decline is the clearest possible signal that the
   * relationship the unlock was predicated on does not exist.
   */
  private static ownerActionUnlocking(
    pair: PairPing | undefined,
    ownerId: string,
  ): string | null {
    if (pair === undefined) return null;

    const ownerSent = pair.fromId === ownerId;

    switch (pair.state) {
      case PingState.ACCEPTED:
        return ownerSent
          ? 'owner-pinged-viewer-accepted'
          : 'owner-accepted-viewer-ping';
      case PingState.PENDING:
        return ownerSent ? 'owner-pinged-viewer-pending' : null;
      case PingState.REJECTED:
        return null;
      default: {
        // Exhaustiveness guard. A new PingState must be classified explicitly;
        // until it is, it does not unlock.
        const unhandled: never = pair.state;
        return unhandled;
      }
    }
  }
}

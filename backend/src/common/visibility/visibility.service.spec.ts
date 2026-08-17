import { PhotoAccess, VisibilityService } from './visibility.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { BlocksService } from '../blocks/blocks.service';
import { PingsService } from '../../modules/pings/pings.service';
import { PingState } from '../../generated/prisma/enums';

const VIEWER = 'user-viewer';
const OWNER = 'user-owner';

type TargetRow = { id: string; photosLocked: boolean };
type PingRow = {
  pairKey: string;
  fromId: string;
  toId: string;
  state: PingState;
};

interface UserFindManyArgs {
  where: { id: { in: string[] } };
  select: Record<string, boolean>;
}

interface PingFindManyArgs {
  where: { pairKey: { in: string[] } };
}

function pairKey(a: string, b: string): string {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}

/**
 * Returns the mock functions themselves rather than the Prisma stand-in, so
 * tests never reach through the object to assert on it - which trips
 * `no-unsafe-member-access` and `unbound-method`.
 */
function serviceWith(opts: {
  targets: TargetRow[];
  pings?: PingRow[];
  blocked?: string[];
}) {
  const userFindMany = jest.fn<Promise<TargetRow[]>, [UserFindManyArgs]>(() =>
    Promise.resolve(opts.targets),
  );
  const pingFindMany = jest.fn<Promise<PingRow[]>, [PingFindManyArgs]>(() =>
    Promise.resolve(opts.pings ?? []),
  );
  const blockedIdsAmong = jest.fn<Promise<Set<string>>, [string, string[]]>(
    () => Promise.resolve(new Set(opts.blocked ?? [])),
  );

  const prisma = {
    user: { findMany: userFindMany },
    ping: { findMany: pingFindMany },
  } as unknown as PrismaService;

  const blocks = { blockedIdsAmong } as unknown as BlocksService;

  return {
    service: new VisibilityService(prisma, blocks),
    userFindMany,
    pingFindMany,
    blockedIdsAmong,
  };
}

/** A locked owner, with one ping row in the given direction and state. */
function lockedOwnerWith(from: string, to: string, state: PingState) {
  return serviceWith({
    targets: [{ id: OWNER, photosLocked: true }],
    pings: [{ pairKey: pairKey(from, to), fromId: from, toId: to, state }],
  });
}

/**
 * Contract tests for the photo-visibility resolver (CLAUDE.md 2.1).
 *
 * This is the test suite that matters most in the project. It pins two
 * different kinds of thing, and both must hold:
 *
 *  1. THE RULE - the matrix of ping direction x state x photosLocked x block.
 *  2. THE STRUCTURE - fail-closed-by-construction, batch-first, and decision
 *     separated from rendering. Those are not implementation details; they are
 *     the reason a single resolver exists at all (D-032, carried into S6).
 */
describe('VisibilityService', () => {
  // -------------------------------------------------------------------------
  // The rule
  // -------------------------------------------------------------------------
  describe('the unlock matrix', () => {
    /**
     * Every cell of the rule, in one table. Read it as: given a locked owner,
     * what does this viewer see?
     *
     * The matrix is small precisely because NO VIEWER ATTRIBUTE PARTICIPATES
     * (D-036). If it ever needs a "verified" or "gender" column again,
     * something has gone badly wrong upstream in CLAUDE.md 2.1.
     */
    const cases: Array<{
      name: string;
      from: string;
      to: string;
      state: PingState;
      expected: PhotoAccess;
    }> = [
      {
        name: 'owner pinged the viewer, still pending -> UNLOCKED (rule 1)',
        from: OWNER,
        to: VIEWER,
        state: PingState.PENDING,
        expected: PhotoAccess.UNLOCKED,
      },
      {
        name: 'owner pinged the viewer and it was accepted -> UNLOCKED',
        from: OWNER,
        to: VIEWER,
        state: PingState.ACCEPTED,
        expected: PhotoAccess.UNLOCKED,
      },
      {
        name: 'owner accepted the viewer ping -> UNLOCKED (rule 2)',
        from: VIEWER,
        to: OWNER,
        state: PingState.ACCEPTED,
        expected: PhotoAccess.UNLOCKED,
      },
      {
        name: 'viewer pinged the owner, still pending -> BLURRED',
        from: VIEWER,
        to: OWNER,
        state: PingState.PENDING,
        expected: PhotoAccess.BLURRED,
      },
      {
        name: 'viewer rejected the owner ping -> BLURRED',
        from: OWNER,
        to: VIEWER,
        state: PingState.REJECTED,
        expected: PhotoAccess.BLURRED,
      },
      {
        name: 'owner rejected the viewer ping -> BLURRED',
        from: VIEWER,
        to: OWNER,
        state: PingState.REJECTED,
        expected: PhotoAccess.BLURRED,
      },
    ];

    for (const c of cases) {
      it(c.name, async () => {
        const { service } = lockedOwnerWith(c.from, c.to, c.state);

        const decision = await service.resolveOne(VIEWER, OWNER);

        expect(decision.access).toBe(c.expected);
      });
    }

    it('blurs a locked owner the viewer has no relationship with', async () => {
      const { service } = serviceWith({
        targets: [{ id: OWNER, photosLocked: true }],
      });

      const decision = await service.resolveOne(VIEWER, OWNER);

      expect(decision.access).toBe(PhotoAccess.BLURRED);
      expect(decision.reason).toBe('locked-no-owner-action');
    });

    /**
     * Withdrawal deletes the ping row entirely (D-043), so the unlock it
     * granted disappears with it. There is no separate revoke path - which is
     * the point, because a separate one could be forgotten.
     */
    it('re-locks once a withdrawn ping leaves no row behind', async () => {
      const { service } = serviceWith({
        targets: [{ id: OWNER, photosLocked: true }],
        pings: [],
      });

      const decision = await service.resolveOne(VIEWER, OWNER);

      expect(decision.access).toBe(PhotoAccess.BLURRED);
    });

    it('always unlocks your own photos, even when locked', async () => {
      const { service } = serviceWith({
        targets: [{ id: OWNER, photosLocked: true }],
      });

      const decision = await service.resolveOne(OWNER, OWNER);

      expect(decision.access).toBe(PhotoAccess.UNLOCKED);
      expect(decision.reason).toBe('self');
    });

    it('unlocks when the owner has not locked their photos', async () => {
      const { service } = serviceWith({
        targets: [{ id: OWNER, photosLocked: false }],
      });

      const decision = await service.resolveOne(VIEWER, OWNER);

      expect(decision.access).toBe(PhotoAccess.UNLOCKED);
      expect(decision.reason).toBe('owner-not-locked');
    });
  });

  // -------------------------------------------------------------------------
  // Blocks
  // -------------------------------------------------------------------------
  describe('blocks', () => {
    /**
     * The case the write-time check cannot catch: a pair that was accepted
     * FIRST and blocked afterwards. If the unlock were decided once at ping
     * time it would stand forever (CLAUDE.md 2.5).
     */
    it('re-locks a pair that blocked each other after accepting', async () => {
      const { service } = serviceWith({
        targets: [{ id: OWNER, photosLocked: true }],
        pings: [
          {
            pairKey: pairKey(VIEWER, OWNER),
            fromId: VIEWER,
            toId: OWNER,
            state: PingState.ACCEPTED,
          },
        ],
        blocked: [OWNER],
      });

      const decision = await service.resolveOne(VIEWER, OWNER);

      expect(decision.access).toBe(PhotoAccess.LOCKED);
      expect(decision.reason).toBe('blocked');
    });

    it('hides an UNLOCKED profile from a blocked viewer too', async () => {
      // photosLocked is false here: the block, not the lock, is doing the work.
      const { service } = serviceWith({
        targets: [{ id: OWNER, photosLocked: false }],
        blocked: [OWNER],
      });

      const decision = await service.resolveOne(VIEWER, OWNER);

      expect(decision.access).toBe(PhotoAccess.LOCKED);
    });

    it('returns LOCKED rather than BLURRED on a block', async () => {
      // A blurred photo still confirms a person and shows their outline. For a
      // pair that asked not to see each other, nothing is the correct amount.
      const { service } = serviceWith({
        targets: [{ id: OWNER, photosLocked: true }],
        blocked: [OWNER],
      });

      const decision = await service.resolveOne(VIEWER, OWNER);

      expect(decision.access).not.toBe(PhotoAccess.BLURRED);
      expect(decision.access).toBe(PhotoAccess.LOCKED);
    });
  });

  // -------------------------------------------------------------------------
  // Structure - properties that must survive any future edit
  // -------------------------------------------------------------------------
  describe('fail-closed guarantees', () => {
    it('returns LOCKED for a user that does not exist', async () => {
      const { service } = serviceWith({ targets: [] });

      const decision = await service.resolveOne(VIEWER, 'ghost');

      expect(decision.access).toBe(PhotoAccess.LOCKED);
    });

    it('includes every requested id in the result, never omitting one', async () => {
      // A missing key would be indistinguishable from "no restriction" at a
      // careless call site. Every id must come back with an explicit decision.
      const { service } = serviceWith({
        targets: [{ id: 'a', photosLocked: false }],
      });

      const map = await service.resolveMany(VIEWER, ['a', 'b', 'c']);

      expect(map.size).toBe(3);
      expect(map.get('b')?.access).toBe(PhotoAccess.LOCKED);
      expect(map.get('c')?.access).toBe(PhotoAccess.LOCKED);
    });

    it('returns an empty map for an empty request without querying', async () => {
      const { service, userFindMany } = serviceWith({ targets: [] });

      const map = await service.resolveMany(VIEWER, []);

      expect(map.size).toBe(0);
      expect(userFindMany).not.toHaveBeenCalled();
    });
  });

  describe('no viewer attribute participates (D-036)', () => {
    /**
     * The strongest guard available against rule 3 coming back: the resolver
     * must not even SELECT the columns an attribute-based unlock would need.
     * Data that is never loaded cannot be reached for by a later edit.
     */
    it('selects only id and photosLocked from the target', async () => {
      const { service, userFindMany } = serviceWith({
        targets: [{ id: OWNER, photosLocked: true }],
      });

      await service.resolveOne(VIEWER, OWNER);

      expect(Object.keys(userFindMany.mock.calls[0][0].select).sort()).toEqual([
        'id',
        'photosLocked',
      ]);
    });

    it('never loads the viewer, only the pair relationship', async () => {
      // The viewer's row is never fetched at all - there is nothing about the
      // viewer that the rule is allowed to consider.
      const { service, userFindMany } = serviceWith({
        targets: [{ id: OWNER, photosLocked: true }],
      });

      await service.resolveOne(VIEWER, OWNER);

      expect(userFindMany).toHaveBeenCalledTimes(1);
      expect(userFindMany.mock.calls[0][0].where.id.in).toEqual([OWNER]);
    });
  });

  describe('batching', () => {
    it('resolves many targets in one query per concern', async () => {
      // Not a performance nicety. Per-user resolution on a Grid page is an
      // N+1 that pushes toward caching the result, and a cached stale unlock
      // is a safety failure.
      const { service, userFindMany, pingFindMany, blockedIdsAmong } =
        serviceWith({
          targets: [
            { id: 'a', photosLocked: false },
            { id: 'b', photosLocked: true },
          ],
        });

      await service.resolveMany(VIEWER, ['a', 'b']);

      expect(userFindMany).toHaveBeenCalledTimes(1);
      expect(pingFindMany).toHaveBeenCalledTimes(1);
      expect(blockedIdsAmong).toHaveBeenCalledTimes(1);
    });

    it('deduplicates repeated ids before querying', async () => {
      const { service, userFindMany } = serviceWith({
        targets: [{ id: 'a', photosLocked: false }],
      });

      await service.resolveMany(VIEWER, ['a', 'a', 'a']);

      expect(userFindMany.mock.calls[0][0].where.id.in).toEqual(['a']);
    });

    it('looks pings up by unique pairKey, not by a two-directional scan', async () => {
      const { service, pingFindMany } = serviceWith({
        targets: [
          { id: 'a', photosLocked: true },
          { id: 'b', photosLocked: true },
        ],
      });

      await service.resolveMany(VIEWER, ['a', 'b']);

      expect(pingFindMany.mock.calls[0][0].where.pairKey.in.sort()).toEqual(
        [pairKey(VIEWER, 'a'), pairKey(VIEWER, 'b')].sort(),
      );
    });

    it('does not query relationships when the only target is the viewer', async () => {
      const { service, pingFindMany } = serviceWith({
        targets: [{ id: VIEWER, photosLocked: true }],
      });

      await service.resolveMany(VIEWER, [VIEWER]);

      expect(pingFindMany).not.toHaveBeenCalled();
    });
  });

  describe('pair key agreement with PingsService', () => {
    /**
     * The resolver computes the pair key itself, because `common/` must not
     * depend on a domain module. That duplication is only safe while the two
     * agree exactly.
     *
     * A divergence would fail SILENTLY and in the safe direction - every pair
     * would resolve to "no relationship" and photos would simply stay blurred
     * forever. Nobody files a bug for photos being too private, so this test
     * is the only thing that would catch it.
     */
    it('computes the same key as PingsService.pairKeyFor', () => {
      // The resolver's copy is private; reach it through a structural cast
      // rather than widening the API just to test it.
      const resolver = VisibilityService as unknown as {
        pairKeyFor(a: string, b: string): string;
      };

      for (const [a, b] of [
        [VIEWER, OWNER],
        [OWNER, VIEWER],
        ['a', 'b'],
        ['b', 'a'],
      ]) {
        expect(resolver.pairKeyFor(a, b)).toBe(PingsService.pairKeyFor(a, b));
      }
    });
  });
});

import { NotFoundException } from '@nestjs/common';
import { GridService } from './grid.service';
import { LocationFuzzService } from './location-fuzz.service';
import { PhotoAccess } from '../../common/visibility/visibility.service';
import type { VisibilityService } from '../../common/visibility/visibility.service';
import type { BlocksService } from '../../common/blocks/blocks.service';
import type { MediaService } from '../media/media.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { AppConfig } from '../../config/env.schema';
import { NearbyQueryDto } from './dto/nearby-query.dto';

const CONFIG = {
  GRID_LOCATION_SALT: 'test-salt-that-is-at-least-32-characters-long',
  GRID_FUZZ_MIN_METERS: 100,
  GRID_FUZZ_MAX_METERS: 300,
  GRID_DEBOUNCE_METERS: 100,
  GRID_DEBOUNCE_SECONDS: 60,
  GRID_ONLINE_WINDOW_SECONDS: 300,
} as AppConfig;

/** A row as the proximity query returns it. */
const row = (over: Partial<Record<string, unknown>> = {}) => ({
  id: 'internal-cuid-1',
  publicShortId: 'shortid1',
  gender: 'FEMALE',
  dateOfBirth: new Date('1998-04-23'),
  isVerified: false,
  displayName: 'Ana',
  interests: ['climbing'],
  lookingFor: ['FRIENDSHIP'],
  distanceMeters: 1234.56789,
  locationUpdatedAt: new Date(),
  ...over,
});

describe('GridService', () => {
  let prisma: {
    $queryRaw: jest.Mock;
    $executeRaw: jest.Mock;
    userLocation: { findUnique: jest.Mock; deleteMany: jest.Mock };
  };
  let visibility: { resolveMany: jest.Mock };
  let blocks: { blockedIdsFor: jest.Mock };
  let media: { listViewablePhotos: jest.Mock };
  let service: GridService;

  beforeEach(() => {
    prisma = {
      $queryRaw: jest.fn(),
      $executeRaw: jest.fn().mockResolvedValue(1),
      userLocation: {
        findUnique: jest.fn().mockResolvedValue({ userId: 'viewer' }),
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    visibility = { resolveMany: jest.fn().mockResolvedValue(new Map()) };
    blocks = { blockedIdsFor: jest.fn().mockResolvedValue(new Set<string>()) };
    media = { listViewablePhotos: jest.fn().mockResolvedValue([]) };

    service = new GridService(
      prisma as unknown as PrismaService,
      visibility as unknown as VisibilityService,
      blocks as unknown as BlocksService,
      media as unknown as MediaService,
      new LocationFuzzService(CONFIG),
      CONFIG,
    );
  });

  /**
   * The Prisma.Sql passed to the nth call of a mocked raw method.
   *
   * `mock.calls` is typed `any[][]`, so it is narrowed once here rather than at
   * seven call sites — which also keeps the assertions below readable.
   */
  const sqlOf = (
    mock: jest.Mock,
    call = 0,
  ): { strings: string[]; values: unknown[] } => {
    const calls = mock.mock.calls as unknown as Array<
      [{ strings?: string[]; values?: unknown[] }]
    >;
    const arg = calls[call][0];
    return { strings: arg.strings ?? [], values: arg.values ?? [] };
  };

  /** The SQL text of the nth $queryRaw call, for asserting on query shape. */
  const queryText = (call = 0): string =>
    sqlOf(prisma.$queryRaw, call).strings.join(' ');

  const executeText = (call = 0): string =>
    sqlOf(prisma.$executeRaw, call).strings.join(' ');

  // ---------------------------------------------------------------------------
  // Write path — the debounce (CLAUDE.md §4)
  // ---------------------------------------------------------------------------

  describe('updateLocation — debounce', () => {
    it('persists the first report, when there is no previous row', async () => {
      prisma.$queryRaw.mockResolvedValueOnce([]);

      const result = await service.updateLocation('viewer', 12.97, 77.59);

      expect(result).toEqual({ persisted: true, reason: 'stored' });
      expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
    });

    it('skips the write when the user has barely moved and it has barely been any time', async () => {
      prisma.$queryRaw.mockResolvedValueOnce([
        { moved_meters: 40, age_seconds: 12 },
      ]);

      const result = await service.updateLocation('viewer', 12.97, 77.59);

      // 40m is invisible through a 100–300m offset, so persisting it would buy
      // the product nothing and cost a row version, GIST churn and WAL.
      expect(result.persisted).toBe(false);
      expect(prisma.$executeRaw).not.toHaveBeenCalled();
    });

    it('persists when the user has moved far enough, however recently', async () => {
      prisma.$queryRaw.mockResolvedValueOnce([
        { moved_meters: 150, age_seconds: 1 },
      ]);

      await service.updateLocation('viewer', 12.97, 77.59);

      expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
    });

    it('persists when enough time has passed, however little they moved', async () => {
      prisma.$queryRaw.mockResolvedValueOnce([
        { moved_meters: 0, age_seconds: 61 },
      ]);

      await service.updateLocation('viewer', 12.97, 77.59);

      // This branch is what makes updated_at a usable liveness signal (D-052):
      // a stationary but active client still rewrites the row every minute.
      expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
    });

    it('treats the thresholds as inclusive boundaries', async () => {
      prisma.$queryRaw.mockResolvedValueOnce([
        { moved_meters: 100, age_seconds: 60 },
      ]);

      const result = await service.updateLocation('viewer', 12.97, 77.59);

      expect(result.persisted).toBe(false);
    });
  });

  describe('updateLocation — what gets written', () => {
    beforeEach(() => {
      prisma.$queryRaw.mockResolvedValue([]);
    });

    it('writes both points in a single statement', async () => {
      await service.updateLocation('viewer', 12.97, 77.59);

      const sql = executeText();

      // One statement is what makes it impossible for the exact and fuzzed
      // positions to drift apart or be updated independently.
      expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
      expect(sql).toContain('geog');
      expect(sql).toContain('geog_fuzzed');
      expect(sql).toContain('ST_Project');
    });

    it('passes longitude before latitude to ST_MakePoint', async () => {
      await service.updateLocation('viewer', 12.97, 77.59);

      const { values } = sqlOf(prisma.$executeRaw);

      // ⚠ The single most common PostGIS bug, and it fails quietly: swapped
      // coordinates are usually still a valid point somewhere on Earth, so the
      // query returns results — just the wrong ones. lng must precede lat.
      expect(values.indexOf(77.59)).toBeLessThan(values.indexOf(12.97));
    });

    it('derives the same offset for the same user on every write', async () => {
      await service.updateLocation('viewer', 12.97, 77.59);
      await service.updateLocation('viewer', 40.0, -74.0);

      const offsetOf = (call: number): unknown[] =>
        // The two doubles that are not coordinates: distance and bearing.
        sqlOf(prisma.$executeRaw, call).values.filter(
          (v) => v !== 12.97 && v !== 77.59 && v !== 40.0 && v !== -74.0,
        );

      // Moving across the world must not re-roll the offset. If it did, an
      // observer could average two positions of the same person and recover
      // precision that the fuzzing is supposed to have destroyed.
      expect(offsetOf(1)).toEqual(offsetOf(0));
    });
  });

  describe('deleteLocation', () => {
    it('is idempotent — deleting a position you do not have is a success', async () => {
      prisma.userLocation.deleteMany.mockResolvedValueOnce({ count: 0 });

      await expect(service.deleteLocation('viewer')).resolves.toEqual({
        deleted: true,
      });
    });
  });

  // ---------------------------------------------------------------------------
  // Read path
  // ---------------------------------------------------------------------------

  describe('nearby — preconditions', () => {
    it('refuses to search when the viewer has no stored position', async () => {
      prisma.userLocation.findUnique.mockResolvedValueOnce(null);

      await expect(
        service.nearby('viewer', new NearbyQueryDto()),
      ).rejects.toThrow(NotFoundException);

      // Must not fall through to the query: a missing origin would make every
      // spatial predicate NULL and return "nobody is near you", which reads as
      // an empty neighbourhood rather than as missing input.
      expect(prisma.$queryRaw).not.toHaveBeenCalled();
    });
  });

  describe('nearby — what the payload may contain', () => {
    beforeEach(() => {
      prisma.$queryRaw.mockResolvedValue([row()]);
    });

    it('returns a coarse bucket and never an exact distance', async () => {
      const { results } = await service.nearby('viewer', new NearbyQueryDto());

      expect(results[0].distance).toBe('1-3 km');

      // An exact distance alongside a fuzzed point hands the true position
      // back: three such circles intersect at a point (CLAUDE.md §2.2).
      const body = JSON.stringify(results);
      expect(body).not.toContain('1234');
      expect(body).not.toContain('distanceMeters');
    });

    it('returns no coordinates of any kind', async () => {
      const { results } = await service.nearby('viewer', new NearbyQueryDto());

      for (const key of Object.keys(results[0])) {
        expect(key).not.toMatch(/lat|lng|lon|geog|coord|point/i);
      }
    });

    it('returns no internal user id', async () => {
      const { results } = await service.nearby('viewer', new NearbyQueryDto());

      expect(results[0]).not.toHaveProperty('id');
      expect(JSON.stringify(results)).not.toContain('internal-cuid-1');
      expect(results[0].publicShortId).toBe('shortid1');
    });

    it('returns age, never the date of birth', async () => {
      const { results } = await service.nearby('viewer', new NearbyQueryDto());

      expect(results[0]).not.toHaveProperty('dateOfBirth');
      expect(typeof results[0].age).toBe('number');
    });
  });

  describe('nearby — safety rules are delegated, not restated', () => {
    beforeEach(() => {
      prisma.$queryRaw.mockResolvedValue([
        row({ id: 'a', publicShortId: 'aaa' }),
        row({ id: 'b', publicShortId: 'bbb' }),
        row({ id: 'c', publicShortId: 'ccc' }),
      ]);
    });

    it('resolves photo access in exactly one batch call', async () => {
      await service.nearby('viewer', new NearbyQueryDto());

      // A per-row call here is the N+1 that pushes people toward caching
      // visibility decisions, and a stale cached unlock is a safety failure.
      expect(visibility.resolveMany).toHaveBeenCalledTimes(1);
      expect(visibility.resolveMany).toHaveBeenCalledWith('viewer', [
        'a',
        'b',
        'c',
      ]);
    });

    it('defaults to LOCKED for anyone the resolver did not answer for', async () => {
      visibility.resolveMany.mockResolvedValueOnce(new Map());

      await service.nearby('viewer', new NearbyQueryDto());

      // Fail closed. A missing decision must never be read as permission.
      const renderCalls = media.listViewablePhotos.mock
        .calls as unknown as Array<[string, string]>;
      expect(renderCalls).toHaveLength(3);
      for (const [, access] of renderCalls) {
        expect(access).toBe(PhotoAccess.LOCKED);
      }
    });

    it('renders each row with the access the resolver returned', async () => {
      visibility.resolveMany.mockResolvedValueOnce(
        new Map([
          [
            'a',
            { targetUserId: 'a', access: PhotoAccess.UNLOCKED, reason: 'x' },
          ],
          [
            'b',
            { targetUserId: 'b', access: PhotoAccess.BLURRED, reason: 'y' },
          ],
        ]),
      );

      const { results } = await service.nearby('viewer', new NearbyQueryDto());

      expect(media.listViewablePhotos).toHaveBeenCalledWith(
        'a',
        PhotoAccess.UNLOCKED,
      );
      expect(results[0].photosBlurred).toBe(false);
      expect(results[1].photosBlurred).toBe(true);
      expect(results[2].photosBlurred).toBe(false); // LOCKED, not blurred
    });

    it('asks BlocksService for the exclusion list rather than deriving it in SQL', async () => {
      await service.nearby('viewer', new NearbyQueryDto());

      expect(blocks.blockedIdsFor).toHaveBeenCalledWith('viewer');

      // CLAUDE.md §2.5: one implementation of the symmetric-block rule. The
      // query may exclude ids, but it must not know what "blocked" means.
      const sql = queryText();
      expect(sql).not.toMatch(/blocks/i);
      expect(sql).not.toMatch(/blocker_id|blocked_id/i);
    });

    it('excludes blocked ids from the query', async () => {
      blocks.blockedIdsFor.mockResolvedValueOnce(new Set(['blocked-1']));

      await service.nearby('viewer', new NearbyQueryDto());

      const call = sqlOf(prisma.$queryRaw);
      expect(call.strings.join(' ')).toContain('NOT IN');
      expect(call.values).toContain('blocked-1');
    });

    it('honours the discoverable opt-out without excluding users who have no settings row', async () => {
      await service.nearby('viewer', new NearbyQueryDto());

      const sql = queryText();

      // Settings rows are created lazily on first Myspace access (S3). An
      // inner join here would silently hide every user who signed up and went
      // straight to the Grid, even though the column default is `true`.
      expect(sql).toContain('LEFT JOIN user_settings');
      expect(sql).toContain('COALESCE(s.discoverable, true)');
    });
  });

  describe('nearby — the query only ever reads the fuzzed column', () => {
    beforeEach(() => {
      prisma.$queryRaw.mockResolvedValue([row()]);
    });

    it('never references another user’s exact point', async () => {
      const query = new NearbyQueryDto();
      query.onlineOnly = true;
      query.minAge = 21;
      query.maxAge = 40;

      await service.nearby('viewer', query);

      const sql = queryText();

      // Every client-observable spatial expression must read geog_fuzzed. The
      // only permitted mention of the exact column is the viewer's own origin
      // subquery, which selects it by primary key.
      expect(sql).toContain('ST_DWithin(l.geog_fuzzed');
      expect(sql).toContain('ST_Distance(l.geog_fuzzed');
      expect(sql).not.toMatch(/ST_(Distance|DWithin)\(l\.geog[^_]/);
    });

    it('orders by the same expression it reports', async () => {
      await service.nearby('viewer', new NearbyQueryDto());

      const sql = queryText();

      // Three hand-written copies of the distance expression is how the
      // ordering silently stops matching the reported bucket.
      expect(sql).toContain('ORDER BY "distanceMeters" ASC, u.id ASC');
    });
  });

  describe('nearby — pagination', () => {
    it('emits a cursor only when the page was full', async () => {
      const query = new NearbyQueryDto();
      query.limit = 2;
      prisma.$queryRaw.mockResolvedValue([
        row({ id: 'a', publicShortId: 'aaa' }),
        row({ id: 'b', publicShortId: 'bbb' }),
      ]);

      const { nextCursor } = await service.nearby('viewer', query);

      expect(nextCursor).toBe('bbb');
    });

    it('emits no cursor on a partial page', async () => {
      const query = new NearbyQueryDto();
      query.limit = 25;
      prisma.$queryRaw.mockResolvedValue([row()]);

      const { nextCursor } = await service.nearby('viewer', query);

      expect(nextCursor).toBeNull();
    });

    it('carries a public short id, never an encoded distance', async () => {
      const query = new NearbyQueryDto();
      query.limit = 1;
      prisma.$queryRaw.mockResolvedValue([row({ publicShortId: 'zzz' })]);

      const { nextCursor } = await service.nearby('viewer', query);

      // The natural cursor for a distance-ordered set is (distance, id), but a
      // base64 cursor is readable and distance here is exact by construction.
      expect(nextCursor).toBe('zzz');
      expect(nextCursor).not.toContain('1234');
    });

    it('re-derives the boundary distance server-side from the cursor', async () => {
      const query = new NearbyQueryDto();
      query.cursor = 'zzz';

      prisma.$queryRaw
        .mockResolvedValueOnce([
          { user_id: 'cursor-user', distance_meters: 800.5 },
        ])
        .mockResolvedValueOnce([row()]);

      await service.nearby('viewer', query);

      const page = sqlOf(prisma.$queryRaw, 1);
      expect(page.values).toContain(800.5);
      expect(page.values).toContain('cursor-user');

      // Both halves of the sort key. Distance alone skips or duplicates
      // everyone sharing a boundary distance — two users at one address
      // produce identical distances, which is not the rare case it sounds.
      expect(page.strings.join(' ')).toContain('u.id >');
    });

    it('rejects a cursor whose user is gone', async () => {
      const query = new NearbyQueryDto();
      query.cursor = 'vanished';
      prisma.$queryRaw.mockResolvedValueOnce([]);

      await expect(service.nearby('viewer', query)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('nearby — online derivation (D-052)', () => {
    it('marks a freshly written location as online', async () => {
      prisma.$queryRaw.mockResolvedValue([
        row({ locationUpdatedAt: new Date(Date.now() - 30_000) }),
      ]);

      const { results } = await service.nearby('viewer', new NearbyQueryDto());

      expect(results[0].online).toBe(true);
    });

    it('marks a stale location as offline', async () => {
      prisma.$queryRaw.mockResolvedValue([
        row({ locationUpdatedAt: new Date(Date.now() - 600_000) }),
      ]);

      const { results } = await service.nearby('viewer', new NearbyQueryDto());

      expect(results[0].online).toBe(false);
    });
  });
});

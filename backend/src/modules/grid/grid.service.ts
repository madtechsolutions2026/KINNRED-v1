import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { Prisma } from '../../generated/prisma/client';
import type { Gender, LookingFor } from '../../generated/prisma/enums';
import { BlocksService } from '../../common/blocks/blocks.service';
import {
  PhotoAccess,
  VisibilityService,
} from '../../common/visibility/visibility.service';
import { MediaService } from '../media/media.service';
import { APP_CONFIG } from '../../config/config.module';
import type { AppConfig } from '../../config/env.schema';
import { LocationFuzzService } from './location-fuzz.service';
import { GRID_DEFAULT_RADIUS_METERS, distanceBucket } from './distance-buckets';
import { NearbyQueryDto } from './dto/nearby-query.dto';

/**
 * Raw row shape from the proximity query.
 *
 * `distanceMeters` is the distance to the target's FUZZED point. It is exact
 * arithmetic on a fuzzed input, and it stays inside this service: it drives
 * ordering and the cursor boundary, and is converted to a coarse bucket before
 * anything is returned (CLAUDE.md §2.2).
 */
interface NearbyRow {
  id: string;
  publicShortId: string;
  gender: Gender;
  dateOfBirth: Date;
  isVerified: boolean;
  displayName: string | null;
  interests: string[];
  lookingFor: LookingFor[];
  distanceMeters: number;
  locationUpdatedAt: Date;
}

@Injectable()
export class GridService {
  // No logger, deliberately. Every interesting event on this surface is a
  // position or a distance, and a log line is the one place §2.2's "exact
  // coordinates never leave the service layer" is easiest to violate by
  // accident — logs get shipped, indexed and retained far longer than a row in
  // an UNLOGGED table.
  constructor(
    private readonly prisma: PrismaService,
    private readonly visibility: VisibilityService,
    private readonly blocks: BlocksService,
    private readonly media: MediaService,
    private readonly fuzz: LocationFuzzService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  // -------------------------------------------------------------------------
  // The write path
  // -------------------------------------------------------------------------

  /**
   * Records where the caller is.
   *
   * ── DEBOUNCE (CLAUDE.md §4) ────────────────────────────────────────────────
   * Writes, not reads, are what breaks Postgres on a location-heavy app: every
   * UPDATE writes a new row version, churns the GIST index, amplifies WAL and
   * feeds autovacuum, which is what actually falls over first. So a report is
   * persisted only if the user has MOVED far enough or ENOUGH TIME has passed.
   *
   * The movement threshold sits below the fuzz radius on purpose — a 40m walk
   * is not observable through a 100–300m offset, so persisting it buys the
   * product nothing and costs a row version. This is the cheapest protection
   * available and it is why step 3 of §4 (buffering writes through Redis) is
   * deliberately NOT built: below ~100k DAU this alone is sufficient, and a
   * Redis write buffer introduces a second source of truth for position.
   * ───────────────────────────────────────────────────────────────────────────
   *
   * Both points are written by ONE statement, so the exact and fuzzed positions
   * can never drift apart or be updated independently.
   */
  async updateLocation(
    userId: string,
    lat: number,
    lng: number,
  ): Promise<{ persisted: boolean; reason: string }> {
    const point = GridService.pointFor(lat, lng);

    // What changed since the last persisted write? Both values are computed in
    // Postgres rather than in JS: the distance needs the same geodesic that the
    // search uses, and the elapsed time needs the database's clock, not the
    // API process's.
    const [previous] = await this.prisma.$queryRaw<
      Array<{ moved_meters: number; age_seconds: number }>
    >(Prisma.sql`
      SELECT
        ST_Distance(geog, ${point}) AS moved_meters,
        -- Cast is not cosmetic: EXTRACT returns numeric, which the pg driver
        -- hands back as a STRING to preserve arbitrary precision. Comparing
        -- that against a number below would work by coercion and then fail in
        -- some future refactor that stops coercing.
        EXTRACT(EPOCH FROM (now() - updated_at))::double precision AS age_seconds
      FROM user_locations
      WHERE user_id = ${userId}
    `);

    if (
      previous !== undefined &&
      previous.moved_meters <= this.config.GRID_DEBOUNCE_METERS &&
      previous.age_seconds <= this.config.GRID_DEBOUNCE_SECONDS
    ) {
      return {
        persisted: false,
        reason: 'debounced-no-significant-change',
      };
    }

    const offset = this.fuzz.offsetFor(userId);

    await this.prisma.$executeRaw(Prisma.sql`
      INSERT INTO user_locations (user_id, geog, geog_fuzzed, updated_at)
      VALUES (
        ${userId},
        ${point},
        ST_Project(
          ${point},
          ${offset.distanceMeters}::double precision,
          ${offset.bearingRadians}::double precision
        ),
        now()
      )
      ON CONFLICT (user_id) DO UPDATE SET
        geog = EXCLUDED.geog,
        geog_fuzzed = EXCLUDED.geog_fuzzed,
        updated_at = now()
    `);

    return { persisted: true, reason: 'stored' };
  }

  /**
   * Removes the caller's position entirely.
   *
   * Distinct from `discoverable = false`, which hides you from results while
   * the row stays. This deletes it. Both exist because they answer different
   * questions — "stop showing me to people" versus "stop holding where I am" —
   * and only the second one is answerable by deleting data.
   *
   * Idempotent: deleting a position you do not have is a success, not a 404.
   */
  async deleteLocation(userId: string): Promise<{ deleted: true }> {
    await this.prisma.userLocation.deleteMany({ where: { userId } });
    return { deleted: true };
  }

  // -------------------------------------------------------------------------
  // The read path
  // -------------------------------------------------------------------------

  /**
   * Proximity search.
   *
   * ── WHAT TOUCHES WHICH POINT ───────────────────────────────────────────────
   * The searcher's own EXACT position is the origin — they already know where
   * they are, and using their fuzzed point would add the searcher's error on
   * top of everyone else's.
   *
   * Every OTHER user is represented solely by `geog_fuzzed`. ST_DWithin,
   * ST_Distance and the ordering all read that column; the exact column of
   * anyone but the caller is never referenced in this query. That is the
   * structural form of "apply fuzzing before computing anything a client can
   * observe" (CLAUDE.md §2.2) — there is nothing to remember, because the
   * precise value is not in scope.
   * ───────────────────────────────────────────────────────────────────────────
   *
   * Filters are AND clauses inside the one query rather than a second in-memory
   * pass: filtering afterwards would shrink pages below the requested size and
   * break cursor pagination. Blocks are the sole exception, and even they enter
   * as a plain id list that BlocksService produced (D-053) — the SQL never
   * expresses what "blocked" means.
   *
   * Photo access is resolved afterwards, in ONE batch call to VisibilityService
   * (§2.1). It is not, and must never be, a join.
   */
  async nearby(viewerId: string, query: NearbyQueryDto) {
    const radius = query.radiusMeters ?? GRID_DEFAULT_RADIUS_METERS;
    const limit = query.limit ?? 25;

    const origin = await this.requireOrigin(viewerId);

    // Everyone this viewer must not see, decided by the shared rule and handed
    // to the query as an exclusion list.
    const blockedIds = await this.blocks.blockedIdsFor(viewerId);

    // The page boundary. Resolved to a distance HERE, in the service, so the
    // exact number never round-trips through a client-held cursor.
    const after = query.cursor
      ? await this.resolveCursor(query.cursor, origin)
      : null;

    const rows = await this.prisma.$queryRaw<NearbyRow[]>(
      this.nearbyQuery({
        viewerId,
        origin,
        radius,
        limit,
        blockedIds,
        after,
        query,
      }),
    );

    // One call, whatever the page size. A per-row resolution here is the N+1
    // that pushes people toward caching visibility decisions, and a stale
    // cached unlock is a safety failure rather than a performance one.
    const decisions = await this.visibility.resolveMany(
      viewerId,
      rows.map((r) => r.id),
    );

    const results = await Promise.all(
      rows.map(async (row) => {
        const access = decisions.get(row.id)?.access ?? PhotoAccess.LOCKED;
        const photos = await this.media.listViewablePhotos(row.id, access);

        return {
          // No `id`, and no coordinates of any kind. The public short id is the
          // only user handle that crosses this boundary (S3), and `distance` is
          // a label rather than a number so nothing downstream can do
          // arithmetic on it.
          publicShortId: row.publicShortId,
          displayName: row.displayName,
          gender: row.gender,
          age: GridService.ageFrom(row.dateOfBirth),
          isVerified: row.isVerified,
          interests: row.interests,
          lookingFor: row.lookingFor,
          distance: distanceBucket(row.distanceMeters),
          online: this.isOnline(row.locationUpdatedAt),
          photo: photos[0] ?? null,
          photosBlurred: access === PhotoAccess.BLURRED,
        };
      }),
    );

    return {
      results,
      // The last row's short id, nothing more. See NearbyQueryDto.cursor for
      // why this is not an encoded distance.
      nextCursor:
        rows.length === limit
          ? results[results.length - 1].publicShortId
          : null,
    };
  }

  // -------------------------------------------------------------------------
  // Query construction
  // -------------------------------------------------------------------------

  /**
   * The proximity query.
   *
   * Assembled from `Prisma.sql` fragments and interpolated values only —
   * never string concatenation, even for values that "cannot" be
   * attacker-controlled (CLAUDE.md §3). This is the one place in the codebase
   * where raw SQL is unavoidable, so it is treated as the injection hotspot it
   * is: every dynamic part below is either a bound parameter or a fragment
   * built the same way.
   */
  private nearbyQuery(args: {
    viewerId: string;
    origin: Prisma.Sql;
    radius: number;
    limit: number;
    blockedIds: Set<string>;
    after: { distanceMeters: number; userId: string } | null;
    query: NearbyQueryDto;
  }): Prisma.Sql {
    const { viewerId, origin, radius, limit, blockedIds, after, query } = args;

    // Named once and reused, so the distance in SELECT, ORDER BY and the cursor
    // boundary are provably the same expression. Three hand-written copies is
    // how the ordering silently stops matching the reported bucket.
    const distance = Prisma.sql`ST_Distance(l.geog_fuzzed, ${origin})`;

    const filters: Prisma.Sql[] = [
      // Yourself. You are not a discovery result.
      Prisma.sql`u.id <> ${viewerId}`,

      // The spatial predicate, on the fuzzed column so the GIST index applies
      // and so the filter and the reported bucket are computed from the same
      // geometry. ST_DWithin on `geography` takes METERS directly — no unit
      // conversion, unlike `geometry`.
      Prisma.sql`ST_DWithin(l.geog_fuzzed, ${origin}, ${radius}::double precision)`,

      // Discovery opt-out. LEFT JOIN + COALESCE, not an inner join: settings
      // rows are created lazily on first Myspace access (S3), so a user who has
      // never opened it has no row — and the column default is `true`, meaning
      // they SHOULD appear. An inner join would silently hide every user who
      // signed up and went straight to the Grid.
      Prisma.sql`COALESCE(s.discoverable, true) = true`,
    ];

    if (blockedIds.size > 0) {
      // A plain exclusion list. The rule that produced it lives in
      // BlocksService and is not restated here (D-053).
      filters.push(Prisma.sql`u.id NOT IN (${Prisma.join([...blockedIds])})`);
    }

    if (query.minAge !== undefined) {
      // Born on or before the date that makes you exactly minAge today.
      filters.push(
        Prisma.sql`u.date_of_birth <= (CURRENT_DATE - make_interval(years => ${query.minAge}::int))`,
      );
    }

    if (query.maxAge !== undefined) {
      // Strictly after the date that makes you maxAge + 1, i.e. you have not
      // yet had that birthday. Written this way rather than as a second `<=`
      // so the boundary year is inclusive at both ends.
      filters.push(
        Prisma.sql`u.date_of_birth > (CURRENT_DATE - make_interval(years => ${query.maxAge + 1}::int))`,
      );
    }

    if (query.genders !== undefined && query.genders.length > 0) {
      // Cast to text on both sides. Comparing against the `gender` enum type
      // would need the parameter cast to that type explicitly, and an enum cast
      // of an unrecognised label is a runtime error rather than an empty
      // result — the DTO has already constrained these to real members.
      filters.push(
        Prisma.sql`u.gender::text IN (${Prisma.join(query.genders)})`,
      );
    }

    if (query.lookingFor !== undefined && query.lookingFor.length > 0) {
      // Array overlap: "wants at least one of the things I selected".
      filters.push(
        Prisma.sql`p.looking_for::text[] && ARRAY[${Prisma.join(query.lookingFor)}]::text[]`,
      );
    }

    if (query.onlineOnly === true) {
      filters.push(
        Prisma.sql`l.updated_at > now() - make_interval(secs => ${this.config.GRID_ONLINE_WINDOW_SECONDS}::double precision)`,
      );
    }

    if (after !== null) {
      // Keyset pagination on the full sort key. Both halves are needed: the
      // distance alone skips or duplicates everyone sharing a boundary
      // distance, which is not the rare case it sounds like — two users at the
      // same address produce identical distances.
      filters.push(
        Prisma.sql`(${distance} > ${after.distanceMeters}::double precision OR (${distance} = ${after.distanceMeters}::double precision AND u.id > ${after.userId}))`,
      );
    }

    return Prisma.sql`
      SELECT
        u.id                  AS "id",
        u.public_short_id     AS "publicShortId",
        -- Enum columns are cast to text, and the array one to text[]. The pg
        -- driver has no parser for a user-defined enum OID, so an uncast
        -- looking_for[] arrives as the raw literal string '{DATING,...}'
        -- rather than as an array. The labels are identical either way, which
        -- is why NearbyRow can still type these as the enums.
        u.gender::text        AS "gender",
        u.date_of_birth       AS "dateOfBirth",
        u.is_verified         AS "isVerified",
        p.display_name        AS "displayName",
        COALESCE(p.interests, ARRAY[]::text[])        AS "interests",
        COALESCE(p.looking_for::text[], ARRAY[]::text[]) AS "lookingFor",
        ${distance}           AS "distanceMeters",
        l.updated_at          AS "locationUpdatedAt"
      FROM user_locations l
      JOIN users u          ON u.id = l.user_id
      LEFT JOIN profiles p  ON p.user_id = u.id
      LEFT JOIN user_settings s ON s.user_id = u.id
      WHERE ${Prisma.join(filters, ' AND ')}
      ORDER BY "distanceMeters" ASC, u.id ASC
      LIMIT ${limit}::int
    `;
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  /**
   * A `geography(Point, 4326)` literal for the given coordinates.
   *
   * ⚠ `ST_MakePoint` takes (LONGITUDE, LATITUDE) — x then y. Reversing them is
   * the single most common PostGIS bug and it fails quietly: swapped
   * coordinates are usually still a valid point somewhere on Earth, so the
   * query returns results, just the wrong ones. Every construction of a point
   * in this module goes through here so there is exactly one call site to get
   * right.
   *
   * `ST_SetSRID(..., 4326)` before the cast rather than relying on the implicit
   * geometry→geography conversion: the implicit path assumes 4326 silently, and
   * being explicit means a future change of projection is a visible edit.
   */
  private static pointFor(lat: number, lng: number): Prisma.Sql {
    return Prisma.sql`ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography`;
  }

  /**
   * The searcher's own exact position, as a SQL fragment.
   *
   * Read from the database rather than accepted in the request, deliberately.
   * A client-supplied origin would let anyone search from any coordinates
   * without ever moving, which turns the Grid into a free trilateration tool.
   * Making it the stored position means the attack costs a location write, is
   * rate-limited alongside everything else, and still only ever converges on
   * the target's FUZZED point.
   *
   * Returned as an uncorrelated subquery rather than as numbers: the exact
   * coordinates are therefore never materialised in this process at all, not
   * even briefly in a local variable (§2.2 permits it inside the service layer;
   * not having them there at all is simply stronger). Postgres evaluates an
   * uncorrelated subquery once as an InitPlan, so the value is still a constant
   * by the time ST_DWithin runs and the GIST index is still usable.
   *
   * Existence is checked separately because the subquery form cannot fail —
   * a missing row would silently make the origin NULL, and every spatial
   * predicate against NULL is false, producing "nobody is near you" instead of
   * "you have not shared your location".
   */
  private async requireOrigin(viewerId: string): Promise<Prisma.Sql> {
    const existing = await this.prisma.userLocation.findUnique({
      where: { userId: viewerId },
      select: { userId: true },
    });

    if (existing === null) {
      throw new NotFoundException(
        'Share your location before searching the Grid',
      );
    }

    return Prisma.sql`(SELECT geog FROM user_locations WHERE user_id = ${viewerId})`;
  }

  /**
   * Turns a cursor (a public short id) back into a page boundary.
   *
   * The cursor user's distance is RE-COMPUTED from the current origin rather
   * than carried in the cursor, for two reasons: the exact distance must not
   * leave the service layer (§2.2), and the searcher may have moved between
   * pages, in which case a stale boundary would page against an ordering that
   * no longer exists.
   *
   * The searcher moving mid-page can still skip or repeat a few results. That
   * is inherent to paging a set sorted by a distance the searcher is one end
   * of, and the alternative — pinning the origin inside the cursor — would put
   * their exact coordinates on the wire.
   */
  private async resolveCursor(
    cursor: string,
    origin: Prisma.Sql,
  ): Promise<{ distanceMeters: number; userId: string }> {
    const [row] = await this.prisma.$queryRaw<
      Array<{ user_id: string; distance_meters: number }>
    >(Prisma.sql`
      SELECT l.user_id, ST_Distance(l.geog_fuzzed, ${origin}) AS distance_meters
      FROM user_locations l
      JOIN users u ON u.id = l.user_id
      WHERE u.public_short_id = ${cursor}
    `);

    if (row === undefined) {
      // The cursor user deleted their location, their account, or the cursor
      // was never valid. All three are the same situation from here: there is
      // no boundary to page from.
      throw new NotFoundException('That page is no longer available');
    }

    return { distanceMeters: row.distance_meters, userId: row.user_id };
  }

  /**
   * Liveness, derived from when the position was last persisted (D-052).
   *
   * The write debounce guarantees an actively-posting client rewrites the row
   * at least every GRID_DEBOUNCE_SECONDS, so freshness here is bounded without
   * a separate presence store — and without two sources of truth that can
   * disagree about whether someone is around.
   */
  private isOnline(locationUpdatedAt: Date): boolean {
    const ageSeconds = (Date.now() - locationUpdatedAt.getTime()) / 1000;
    return ageSeconds <= this.config.GRID_ONLINE_WINDOW_SECONDS;
  }

  /** Age in whole years. Only ever this — never the raw date of birth. */
  private static ageFrom(dob: Date): number {
    const now = new Date();
    let age = now.getFullYear() - dob.getFullYear();
    const monthDelta = now.getMonth() - dob.getMonth();
    if (monthDelta < 0 || (monthDelta === 0 && now.getDate() < dob.getDate())) {
      age -= 1;
    }
    return age;
  }
}

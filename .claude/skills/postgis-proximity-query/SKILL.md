---
name: postgis-proximity-query
description: Write or modify a geo-proximity query against the PostGIS location columns — the Grid's nearby-people search and distance filters. Use for any Grid/discovery feature involving distance, "nearby," or geo filtering.
---

# PostGIS proximity queries

The Grid's core query is "users within N meters of point P, matching filters X." Prisma has no
geography type, so these go through `$queryRaw` with `Prisma.sql` tagged templates.

**Read `src/modules/grid/grid.service.ts` before writing a new one.** The shipped query already
resolves every rule below; a second query that re-derives them is how they drift apart.

## The two columns, and which one you may touch

`user_locations` holds **`geog`** (exact, system-internal) and **`geog_fuzzed`** (the §2.2-displaced
point). They are written by one statement so they cannot drift, and the GIST index is on
`geog_fuzzed` **only**.

- **Every client-observable expression reads `geog_fuzzed`** — `ST_DWithin`, `ST_Distance`, the
  ordering, the cursor boundary. All of it.
- **`geog` is read for exactly one row per request:** the searcher's own origin, selected by primary
  key. Nothing else.
- `geog` is deliberately **unindexed**. A proximity query against it cannot perform, so a mistake
  shows up as a sequential scan rather than as quietly-leaked precision. If you find yourself wanting
  an index on `geog`, you are about to leak exact position — stop.

## Core pattern

```ts
import { Prisma } from '../../generated/prisma/client';

// The origin is a SUBQUERY, not numbers. Postgres evaluates an uncorrelated
// subquery once as an InitPlan, so the GIST index is still usable and the exact
// coordinates never materialise in the API process at all.
const origin = Prisma.sql`(SELECT geog FROM user_locations WHERE user_id = ${viewerId})`;

// Name the distance once and reuse the fragment. Three hand-written copies is
// how the ordering silently stops matching the reported bucket.
const distance = Prisma.sql`ST_Distance(l.geog_fuzzed, ${origin})`;

const rows = await this.prisma.$queryRaw<Row[]>(Prisma.sql`
  SELECT u.public_short_id, ${distance} AS "distanceMeters"
  FROM user_locations l
  JOIN users u ON u.id = l.user_id
  WHERE ${Prisma.join(filters, ' AND ')}
  ORDER BY "distanceMeters" ASC, u.id ASC
  LIMIT ${limit}::int
`);
```

## Rules

- **Always `Prisma.sql` tagged templates**, never string interpolation or concatenation, even for
  values that "cannot" be attacker-controlled. This is the one place raw SQL is unavoidable — treat
  it as the injection hotspot it is.
- **`ST_MakePoint` takes `(lng, lat)`, not `(lat, lng)`.** The most common PostGIS bug, and it fails
  *quietly*: swapped coordinates are usually a valid point somewhere on Earth, so the query returns
  results — just the wrong ones. Construct points through one helper (`GridService.pointFor`) so
  there is a single call site to get right, and `ST_SetSRID(..., 4326)` explicitly rather than
  relying on the implicit geometry→geography cast.
- **`ST_DWithin` on `geography` takes meters directly** — no unit conversion, unlike `geometry`.
- **Cast your parameters.** Prisma sends bind parameters untyped, so `make_interval(secs => $1)`,
  `LIMIT $1` and `ST_Project(g, $1, $2)` can fail type inference. Add `::int` / `::double precision`.
  Also cast enum columns to `text` in the SELECT: the pg driver has no parser for a user-defined enum
  OID, so an uncast `looking_for[]` arrives as the literal string `'{DATING,...}'`.
- **`EXTRACT` returns `numeric`, which arrives as a STRING.** Cast it to `double precision` or your
  numeric comparison works only by coercion.
- **Combine non-geo filters (age, gender, online, looking-for) as `AND` clauses in the same query.**
  A second in-memory filter pass shrinks pages below the requested size and corrupts cursor
  pagination.
- **Blocks are the one exception, and they enter as a LIST** (D-053). Call
  `BlocksService.blockedIdsFor(userId)` and pass the ids to a `NOT IN`. Do **not** write
  `EXISTS (SELECT 1 FROM blocks …)` — CLAUDE.md §2.5 requires exactly one implementation of the
  symmetric-block rule, and the query must never express what "blocked" means.
- **Photo visibility is resolved AFTER the query, in one batch call** to `VisibilityService`
  (§2.1). Never a join, and never per-row.
- **LEFT JOIN `user_settings`, with `COALESCE(s.discoverable, true)`.** Settings rows are created
  lazily on first Myspace access, so an inner join silently hides everyone who signed up and went
  straight to the Grid — even though the column default says they should appear.
- **Keyset pagination on the full sort key** — `(distance > d0 OR (distance = d0 AND id > id0))`.
  Distance alone skips and duplicates everyone sharing a boundary distance, which is not rare: two
  users at the same address produce identical distances.
- **Never return an exact distance or a coordinate.** Route every distance through
  `distanceBucket()`, and remember that a *filter* observing distance leaks it just as effectively
  as a field does (D-054).

## Checking the plan

```sql
EXPLAIN (COSTS OFF) SELECT ... ;
-- want: Index Scan using user_locations_geog_fuzzed_idx
-- a Seq Scan on a populated table means the index is missing or the column
-- type does not match. On a near-empty dev table the planner prefers a seq
-- scan regardless — SET enable_seqscan = off to confirm the index is usable.
```

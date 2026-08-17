-- S7 — Grid. The location table, tuned for the write pattern rather than the
-- read pattern (CLAUDE.md §4).
--
-- Reads are not the bottleneck here: ST_DWithin over a GIST-indexed geography
-- column is single-digit milliseconds across millions of rows. WRITES are.
-- Every location update writes a new row version (MVCC), churns the GIST index
-- and amplifies WAL, and it is autovacuum that falls over first. Three of the
-- four hand-edits below exist for that reason; the fourth is the storage
-- parameter Prisma has no way to express.
--
-- Hand-edited after `prisma migrate dev --create-only`. Prisma generated the
-- table, both indexes (including the GIST one — declared in the schema so it
-- stays under migration control, per D-037) and the foreign key. Everything
-- below marked HAND-EDIT is not expressible in schema.prisma.

-- CreateTable
--
-- HAND-EDIT: UNLOGGED. This table is ephemeral and fully rebuildable — clients
-- re-post their position within seconds — so exempting it from WAL removes the
-- largest single source of write amplification in the system. The cost is that
-- Postgres truncates it on crash recovery, which costs one re-post per client.
--
-- ⚠ UNLOGGED tables are NOT streamed to physical replicas. CLAUDE.md §4 also
-- says read load scales out with a replica; the two collide, and this migration
-- follows the §4 instruction to mark the table UNLOGGED. Adding a read replica
-- therefore requires `ALTER TABLE user_locations SET LOGGED` first — safe and
-- cheap precisely because the data is rebuildable (DECISIONS.md D-051).
CREATE UNLOGGED TABLE "user_locations" (
    "user_id" TEXT NOT NULL,
    "geog" geography(Point, 4326) NOT NULL,
    "geog_fuzzed" geography(Point, 4326) NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_locations_pkey" PRIMARY KEY ("user_id")
);

-- HAND-EDIT: storage + autovacuum tuning, this table only.
--
-- fillfactor 70 leaves free space in each page so an UPDATE can place the new
-- row version alongside the old one (a HOT update) instead of on a fresh page.
-- HOT updates skip index maintenance entirely — which matters enormously here,
-- because the alternative is re-inserting into a GIST index on every heartbeat.
-- Note the caveat: a HOT update requires that no INDEXED column changed, so
-- only the `updated_at`-only writes benefit. That is still most of them for a
-- stationary user, which is most users most of the time.
--
-- The autovacuum thresholds are far below the defaults (0.2 = 20% of the table)
-- because dead tuples accumulate here at a rate no other table approaches: one
-- per user per minute for every active client. At the default threshold the
-- table bloats for a long time before vacuum is even considered.
ALTER TABLE "user_locations" SET (
    fillfactor = 70,
    autovacuum_vacuum_scale_factor = 0.02,
    autovacuum_analyze_scale_factor = 0.02,
    autovacuum_vacuum_cost_delay = 2
);

-- CreateIndex
--
-- On the FUZZED column, and only that one. Every client-observable spatial
-- query — ST_DWithin, ST_Distance, distance ordering — runs against this
-- column (CLAUDE.md §2.2). `geog` is deliberately left unindexed: an exact
-- column with no index cannot support a proximity search at all, so a query
-- that reaches for it by mistake surfaces as a sequential scan rather than as
-- quietly-leaked precision.
CREATE INDEX "user_locations_geog_fuzzed_idx" ON "user_locations" USING GIST ("geog_fuzzed" gist_geography_ops);

-- CreateIndex
-- Drives the `online` filter (updated_at within the online window) and the
-- staleness sweep.
CREATE INDEX "user_locations_updated_at_idx" ON "user_locations"("updated_at");

-- AddForeignKey
--
-- An UNLOGGED table may reference a permanent one; the reverse is what
-- Postgres forbids. ON DELETE CASCADE means deleting an account takes its
-- position with it, with no sweep to remember.
ALTER TABLE "user_locations" ADD CONSTRAINT "user_locations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

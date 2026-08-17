---
name: prisma-schema-change
description: Add or modify a Prisma model, field, relation, or migration in the Kinnred backend's PostgreSQL+PostGIS schema. Use for any task that needs a new table, column, or relation — especially geo/location fields, which Prisma doesn't model natively.
---

# Prisma schema change

`backend/prisma/schema.prisma` is the source of truth — **not** under `src/` (that holds
`PrismaService` and the gitignored generated client). Follow these conventions and the
PostGIS-specific pattern below.

## Naming

- Model names: PascalCase, singular (`User`, `Circle`, `CircleMembership`).
- Field names: camelCase in the schema; map the underlying table/column to snake_case with
  `@@map("...")` / `@map("...")` so the DB stays conventional SQL style.

## Workflow

1. Edit `schema.prisma`.
2. `npx prisma migrate dev --name <short_description> --create-only` — generates the SQL without
   applying it yet.
3. Review the generated SQL in `prisma/migrations/<timestamp>_<name>/migration.sql`. For anything
   PostGIS-related, hand-edit this file (see below) before applying — Prisma won't generate correct
   geography SQL on its own.
4. `npx prisma migrate dev` to apply.
5. Never edit a migration file that has already been applied to a shared/dev database — create a
   new migration instead.

## PostGIS geography columns

Prisma has no native geography type. Model it as `Unsupported("geography(Point, 4326)")`, on the
narrow `user_locations` table — **never on the wide `users` row** (CLAUDE.md §4: location is the
hottest write in the system and must not drag the auth path's row versions with it):

```prisma
model UserLocation {
  userId String @id @map("user_id")
  user   User   @relation(fields: [userId], references: [id], onDelete: Cascade)

  geog       Unsupported("geography(Point, 4326)")
  geogFuzzed Unsupported("geography(Point, 4326)") @map("geog_fuzzed")

  updatedAt DateTime @default(now()) @map("updated_at")

  // Declare the GIST index HERE, not by hand in the migration. Prisma emits it
  // correctly and it stays under migration control — a hand-written index is
  // invisible to Prisma, so every later `migrate diff` emits a DROP for it
  // (D-037). Note it is on the FUZZED column only (D-051).
  @@index([geogFuzzed(ops: raw("gist_geography_ops"))], type: Gist)
  @@map("user_locations")
}
```

A model with **required** `Unsupported` fields is not creatable through the generated client. That is
the desired property here, not a limitation: raw SQL becomes the only write path, so the fuzzed
column cannot be set independently of the exact one. Reads and deletes still work normally.

`@updatedAt` does **not** apply — it is a Prisma Client feature, and every write to this table is raw
SQL. Use `@default(now())` and set `now()` explicitly in the statement.

What Prisma still cannot express, and must be hand-edited into the migration after
`--create-only` (see `20260817203050_s7_grid_locations`):

```sql
CREATE UNLOGGED TABLE ...        -- ephemeral + rebuildable; see the D-051 replica caveat
ALTER TABLE "user_locations" SET (
    fillfactor = 70,             -- leave page space for HOT updates, which skip index maintenance
    autovacuum_vacuum_scale_factor = 0.02,   -- default 0.2 lets this table bloat badly
    autovacuum_analyze_scale_factor = 0.02,
    autovacuum_vacuum_cost_delay = 2
);
```

The `postgis` extension is already enabled by the Day 1 migration and declared under
`datasource db { extensions = [...] }`, so new spatial migrations need no `CREATE EXTENSION`.

## Relations for Circles

Circle membership is its own join model (not an implicit many-to-many) because it carries state:
role (`admin`/`member`), the privacy-tier-specific join status (`pending`/`approved` for
invite-only, `invited`/`accepted` for incognito), and timestamps. Model it explicitly:

```prisma
model CircleMembership {
  id       String   @id @default(cuid())
  circleId String
  userId   String
  role     String   // "admin" | "member"
  status   String   // "pending" | "approved" | "invited" | "accepted"
  circle   Circle   @relation(fields: [circleId], references: [id])
  user     User     @relation(fields: [userId], references: [id])

  @@unique([circleId, userId])
}
```


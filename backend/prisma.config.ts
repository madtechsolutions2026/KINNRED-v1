// Prisma 7 CLI configuration.
//
// The connection URL lives here rather than in schema.prisma — Prisma 7 removed
// `url` from the datasource block (DECISIONS.md D-008). `dotenv/config` is
// required: the Prisma CLI does not read .env on its own.
//
// NOTE: this file is excluded from tsconfig.build.json. Including it moves the
// inferred rootDir and breaks `node dist/main` in production only (D-011).
import 'dotenv/config';
import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: process.env['DATABASE_URL'],

    // Shadow database, used by `migrate dev` and required by `migrate diff
    // --from-migrations`. Prisma replays the migration history into it to
    // work out what changed, so it must be a SEPARATE, DISPOSABLE database —
    // it gets dropped and recreated, and pointing it at a real one would
    // destroy that data.
    shadowDatabaseUrl: process.env['SHADOW_DATABASE_URL'],
  },
});

# syntax=docker/dockerfile:1
# ---------------------------------------------------------------------------
# Kinnred API / worker image.
#
# One image runs BOTH processes (D-002) — `node dist/main` for the API,
# `node dist/worker` for the queue worker. The compose file picks the command.
#
# Multi-stage: a fat build stage compiles TypeScript and generates the Prisma
# client; the runtime stage carries only what `node dist/*` needs.
# ---------------------------------------------------------------------------

# bookworm-slim, not alpine: Prisma 7 uses the pure-JS pg driver adapter so it
# needs no native query engine, but glibc still avoids a class of musl edge
# cases for very little size cost.
FROM node:22-bookworm-slim AS base
WORKDIR /app
ENV NODE_ENV=production

# --- deps: install once, cached on the lockfile -----------------------------
FROM base AS deps
COPY package.json package-lock.json ./
# All deps, including devDependencies — the build needs the compiler and the
# `prisma` CLI (the CLI is also how migrations are applied at deploy time).
RUN npm ci --include=dev

# --- build: compile + generate the Prisma client ---------------------------
FROM deps AS build
COPY . .
# Emits src/generated/prisma (gitignored), then compiles to dist/.
RUN npm run db:generate && npm run build

# --- runtime: the shipped image ------------------------------------------
FROM base AS runtime

# Run as a non-root user. A compromised process should not own the filesystem.
RUN groupadd --system --gid 1001 nodejs \
  && useradd  --system --uid 1001 --gid nodejs nodejs

# node_modules carries devDeps too, deliberately: `prisma migrate deploy` at
# release time needs the CLI, and it is small next to the app. Prune later if
# image size becomes a concern.
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/package.json ./package.json
# Prisma needs the schema, the migration history, and the v7 CLI config at
# runtime for `migrate deploy`.
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/prisma.config.ts ./prisma.config.ts
COPY --from=build /app/scripts/start-railway.cjs ./scripts/start-railway.cjs

USER nodejs
EXPOSE 3000

# Compose overrides this for the worker and the one-shot migrate step.
CMD ["node", "scripts/start-railway.cjs"]

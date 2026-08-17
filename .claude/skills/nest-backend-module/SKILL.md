---
name: nest-backend-module
description: Scaffold or extend a NestJS domain module in the Kinnred backend (auth, users/myspace, grid, pings, circles, verification, media, notifications). Use whenever a task adds a new module or a new resource/endpoint within an existing one, so structure and conventions stay consistent across the 10-day backend build.
---

# Nest backend module

Kinnred's backend (`backend/src/modules/`) is organized as one NestJS module per domain area:
`auth`, `users` (Myspace/profile), `grid`, `pings`, `circles`, `verification`, `media`,
`notifications`. Follow this shape for any new module or resource.

## File layout

```
modules/<name>/
  <name>.module.ts
  <name>.controller.ts
  <name>.service.ts
  dto/
    create-<resource>.dto.ts
    update-<resource>.dto.ts
  <name>.controller.spec.ts   # or .service.spec.ts — whichever has the real logic
```

## Rules

- **Controller stays thin.** It validates input via DTOs, calls one service method, returns the
  result. No business logic, no direct Prisma calls in a controller.
- **Service is the only thing that talks to Prisma.** Inject `PrismaService` into the service, not
  the controller.
- **DTOs use `class-validator`/`class-transformer`** decorators for every field the client
  supplies. Never trust unvalidated input, especially on write endpoints (posts, pings, circle
  membership).
- **Never trust a client-supplied user ID.** Derive the acting user from the verified JWT via the
  shared `@CurrentUser()` decorator + `JwtAuthGuard`, not from a request body/param.
- **Visibility/permission checks belong in the service**, evaluated on every read — this matters
  most for `grid` (women's-safety photo lock) and `circles` (incognito membership visibility).
  Don't rely on the client to hide data it was never supposed to receive.
- Add Swagger decorators (`@ApiTags`, `@ApiOperation`, etc.) as you go — Day 10 assumes docs are
  already in place, not written retroactively.
- Register the new module in `app.module.ts`.

## When a module needs a new Prisma model/column

Use the `prisma-schema-change` skill first — don't hand-edit `schema.prisma` without it, especially
for anything geo-related.

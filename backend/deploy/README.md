# Deploy

Single-host production topology. TLS is terminated by Caddy; the API never
speaks TLS itself.

```
        :443 (TLS, HTTP/3)
Internet ──────────────► caddy ──cleartext──► api:3000 ──┐
                          │                              ├─► managed Postgres
                          │  auto Let's Encrypt cert     ├─► managed Redis
                          ▼                              └─► R2 / S3
                     caddy-data volume            worker (dist/worker) ──┘
```

## Files

| File | Role |
|---|---|
| `../Dockerfile` | One image for both `dist/main` (API) and `dist/worker`. |
| `Caddyfile` | TLS termination + reverse proxy → `api:3000`. Auto HTTPS. |
| `docker-compose.prod.yml` | `caddy` + one-shot `migrate` + `api` + `worker`. |

Postgres, Redis and object storage are **not** in the compose file — in
production they are managed services. Encryption at rest is a checkbox on those
(RDS/Cloud SQL, ElastiCache/Upstash, R2), not something this stack provides.

## First deploy

```sh
cd backend

# 1. Build the prod env file from the dev template, then edit it:
cp .env.example .env.prod
#    - NODE_ENV=production
#    - TRUST_PROXY=1                         (one hop: Caddy)
#    - DATABASE_URL / REDIS_* / STORAGE_*    → your managed endpoints
#    - JWT_SECRET, KYC_WEBHOOK_SECRET, GRID_LOCATION_SALT  → real 32+ char secrets
#    - CORS_ORIGINS=                         (empty = mobile-only, fail-closed)

# 2. Add the two Caddy vars to .env.prod:
echo 'API_DOMAIN=api.example.com' >> .env.prod
echo 'ACME_EMAIL=ops@example.com'  >> .env.prod

# 3. Point api.example.com's DNS A/AAAA record at this host.

# 4. Up:
docker compose -f deploy/docker-compose.prod.yml --env-file .env.prod up -d --build
```

`migrate` runs `prisma migrate deploy` to completion first; `api` and `worker`
wait for it (`service_completed_successfully`). Caddy gets its certificate on
first request to the domain.

## Redeploy

```sh
git pull
docker compose -f deploy/docker-compose.prod.yml --env-file .env.prod up -d --build
```

New migrations apply automatically via the `migrate` step. Roll back a bad
migration by shipping a new one — never edit an applied migration.

## Notes

- **`caddy-data` must persist** — it holds the certificate and the ACME account
  key. Losing it means re-issuing on next boot (and hitting Let's Encrypt rate
  limits if that happens often).
- `api` is `expose`d, never `ports:` — it is unreachable from the host, only
  from Caddy on the compose network.
- The image ships with devDependencies (the `prisma` CLI needs them for
  `migrate deploy`). Prune later if image size matters.
- The `x-admin-token` on `POST /verification/:id/decide` is still a shared
  secret with no admin identity (CLAUDE.md §6) — close that before real users.

# Railway staging and Android preview

This deployment is for synthetic test accounts only. It is not the real-user production release.

- Project: https://railway.com/project/28f4e1b8-7c12-4f1c-a10c-73eeb64848a5
- API: https://api-production-ffe7.up.railway.app
- Health: /health
- Storage: https://storage-production-882b.up.railway.app
- Expo preview project: https://expo.dev/accounts/madtech2026/projects/kinnred-preview

## Authentication

APP_STAGE=staging requires an explicit STAGING_TEST_PHONES allowlist. The preview
accepts +919900001000 and +919900001001. Its six-digit development OTP is 000000.
Only synthetic sample data belongs in these shared test accounts. All other phone
numbers are rejected before OTP creation, verification or registration. Production
still rejects fixed OTPs and refuses to construct mock SMS/KYC providers.

## Services

API and worker use backend/Dockerfile. APP_PROCESS selects the process. The startup
script applies checked-in Prisma migrations and refuses to start after a migration
failure. PostGIS, Redis and object storage have persistent Railway volumes. Database
and Redis connections use private networking. Do not expose database or Redis ports.

Storage is derived from the official RustFS image. The entrypoint fixes ownership of
a new volume and then runs as UID 10001. Two distinct application credentials have
list/location permissions on their own bucket and get/put/delete permissions on its
objects. They have no access to the other bucket. Administrator credentials stay out
of the app and Git. Buckets are private; clients receive short-lived signed URLs.

## Mobile build

The preview EAS profile sets APP_VARIANT=preview and EXPO_PUBLIC_API_URL to the HTTPS
API above. app.config.js gives preview builds their own package and Expo project.
The original release identifiers in app.json remain unchanged. EAS uploads exclude
local native projects, dependencies, generated output and environment secrets.

## Before a real-user release

Implement and configure a real SMS provider and identity-verification provider;
replace shared-token administrator access; complete the production security and
operations work listed in DEPLOYMENT.md (including backups, retention and logging).
Use NODE_ENV=production and APP_STAGE=production, and remove DEV_FIXED_OTP. Configure
the authorized release Expo project and production API URL before building a release.
Migrate railway.json configuration before Railway's stated 2026-12-01 cutoff.

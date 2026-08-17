import { VERSION_NEUTRAL } from '@nestjs/common';
import { PATH_METADATA, VERSION_METADATA } from '@nestjs/common/constants';
import { HealthController } from './health.controller';
import { IS_PUBLIC_KEY } from '../common/decorators/public.decorator';

/**
 * Regression guard for the health endpoints.
 *
 * All three properties below have already broken once during this build, and
 * each failure is the kind that looks like an outage rather than a bug:
 *
 *   - Missing @Public()      -> 401. JwtAuthGuard is global (D-021), so every
 *                               load-balancer probe fails and the platform
 *                               concludes the service is down, restarting a
 *                               perfectly healthy process.
 *   - Missing VERSION_NEUTRAL -> the route moves to /api/v1/health and the
 *                               configured probe URL 404s (D-015).
 *   - Changed path            -> same outcome.
 *
 * These assert decorator metadata rather than HTTP behaviour so they run in
 * milliseconds with no database, Redis or network.
 */
describe('HealthController (contract)', () => {
  it('is @Public() — probes must not require a bearer token', () => {
    const isPublic = Reflect.getMetadata(
      IS_PUBLIC_KEY,
      HealthController,
    ) as boolean;

    expect(isPublic).toBe(true);
  });

  it('is VERSION_NEUTRAL — the probe URL must not move when the API version changes', () => {
    const version = Reflect.getMetadata(
      VERSION_METADATA,
      HealthController,
    ) as symbol;

    expect(version).toBe(VERSION_NEUTRAL);
  });

  it('is mounted at "health"', () => {
    const path = Reflect.getMetadata(PATH_METADATA, HealthController) as string;

    expect(path).toBe('health');
  });
});

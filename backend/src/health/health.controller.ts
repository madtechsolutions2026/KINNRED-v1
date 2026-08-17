import { Controller, Get, VERSION_NEUTRAL } from '@nestjs/common';
import { HealthCheck, HealthCheckService } from '@nestjs/terminus';
import { DatabaseHealthIndicator } from './indicators/database.health';
import { RedisHealthIndicator } from './indicators/redis.health';
import { Public } from '../common/decorators/public.decorator';

/**
 * Health endpoints.
 *
 * Served at bare /health, deliberately outside the /api/v1 surface
 * (DECISIONS.md D-007) so infrastructure probes are never coupled to an API
 * version — a probe URL that changes when the API version changes is a probe
 * that silently starts 404ing after a deploy.
 *
 * That requires opting out of BOTH mechanisms independently:
 *   - the global prefix, via `exclude` in main.ts, and
 *   - URI versioning, via VERSION_NEUTRAL here.
 * Doing only one leaves the route at /api/v1/health. (Learned the hard way:
 * the first attempt set the prefix exclusion alone and health 404'd.)
 *
 * @Public() is likewise mandatory: JwtAuthGuard is global (D-021), so without
 * it health returns 401 and every load-balancer probe fails — which reads as
 * "the service is down" and triggers exactly the restart loop a health check
 * is supposed to prevent. This regressed once when the global guard landed in
 * S1; the 401 is why it was caught immediately.
 */
@Public()
@Controller({ path: 'health', version: VERSION_NEUTRAL })
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly database: DatabaseHealthIndicator,
    private readonly redis: RedisHealthIndicator,
  ) {}

  /**
   * Public readiness check.
   *
   * Returns status ONLY — no versions, no hostnames, no error strings.
   * Terminus' default response echoes indicator detail, which on an
   * unauthenticated endpoint is free reconnaissance (DECISIONS.md D-005).
   *
   * Still returns 503 when a dependency is down, so it remains useful to a
   * load balancer without telling a stranger what broke.
   */
  @Get()
  @HealthCheck()
  async check() {
    const result = await this.health.check([
      () => this.database.isHealthy(),
      () => this.redis.isHealthy(),
    ]);

    return { status: result.status };
  }

  /**
   * Full diagnostic output, including dependency versions and failure reasons.
   *
   * NOT for public exposure. Before deploy this must be bound to an internal
   * interface or placed behind auth — tracked in BACKEND_PLAN.md S11.
   */
  @Get('detail')
  @HealthCheck()
  checkDetailed() {
    return this.health.check([
      () => this.database.isHealthy(),
      () => this.redis.isHealthy(),
    ]);
  }
}

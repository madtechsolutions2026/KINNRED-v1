import { Inject, Injectable } from '@nestjs/common';
import { HealthIndicatorService } from '@nestjs/terminus';
import { Redis } from 'ioredis';
import { REDIS_CLIENT } from '../../redis/redis.module';

/**
 * Redis health.
 *
 * Redis is not optional infrastructure here — it backs BullMQ, presence, the
 * Socket.io adapter, and rate limiting. A degraded Redis means silently
 * dropped jobs and undelivered messages, so it belongs in readiness, not in a
 * "nice to know" panel.
 */
@Injectable()
export class RedisHealthIndicator {
  constructor(
    private readonly health: HealthIndicatorService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  async isHealthy(key = 'redis') {
    const indicator = this.health.check(key);

    try {
      // Bound the wait. Without a timeout a hung Redis makes the health check
      // itself hang, which turns a degraded dependency into an unresponsive
      // probe — and a load balancer cannot tell those apart.
      const pong = await Promise.race([
        this.redis.ping(),
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error('ping timed out after 2000ms')),
            2000,
          ),
        ),
      ]);

      if (pong !== 'PONG') {
        return indicator.down({
          reason: 'unexpected-reply',
          message: String(pong),
        });
      }

      // Reported because local dev runs Memurai rather than Redis (D-001);
      // seeing which one answered has already been worth knowing.
      const info = await this.redis.info('server');
      const version =
        /redis_version:([^\r\n]+)/.exec(info)?.[1]?.trim() ?? 'unknown';

      return indicator.up({ version });
    } catch (error) {
      return indicator.down({
        reason: 'unreachable',
        message: error instanceof Error ? error.message : 'unknown error',
      });
    }
  }
}

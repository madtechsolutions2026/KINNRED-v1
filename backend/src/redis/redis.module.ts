import { Global, Module, OnApplicationShutdown, Inject } from '@nestjs/common';
import { Redis } from 'ioredis';
import { APP_CONFIG } from '../config/config.module';
import type { AppConfig } from '../config/env.schema';

/** General-purpose Redis client: presence, pub/sub, rate-limit counters. */
export const REDIS_CLIENT = Symbol('REDIS_CLIENT');

/**
 * Builds connection options shared by this client and BullMQ.
 *
 * Local dev talks to Memurai rather than Redis (DECISIONS.md D-001); the wire
 * protocol is compatible, so nothing here is Memurai-specific.
 */
export function buildRedisOptions(config: AppConfig) {
  return {
    host: config.REDIS_HOST,
    port: config.REDIS_PORT,
    // Only send AUTH when a password is actually configured. Memurai locally
    // has none, and sending an empty password is an error rather than a no-op.
    ...(config.REDIS_PASSWORD ? { password: config.REDIS_PASSWORD } : {}),
  };
}

@Global()
@Module({
  providers: [
    {
      provide: REDIS_CLIENT,
      useFactory: (config: AppConfig) =>
        new Redis({
          ...buildRedisOptions(config),
          // Fail fast on a dead Redis instead of queueing commands forever.
          maxRetriesPerRequest: 3,
          // Do not connect during construction; let the health check and first
          // use drive it, so a Redis outage does not block boot.
          lazyConnect: false,
        }),
      inject: [APP_CONFIG],
    },
  ],
  exports: [REDIS_CLIENT],
})
export class RedisModule implements OnApplicationShutdown {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async onApplicationShutdown(): Promise<void> {
    // quit() drains in-flight commands; disconnect() would drop them.
    await this.redis.quit();
  }
}

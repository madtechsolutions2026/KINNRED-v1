import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { LoggerModule } from 'nestjs-pino';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AppConfigModule, APP_CONFIG } from './config/config.module';
import { PrismaModule } from './prisma/prisma.module';
import { RedisModule } from './redis/redis.module';
import { QueueModule } from './queue/queue.module';
import { HealthModule } from './health/health.module';
import { AuthModule } from './modules/auth/auth.module';
import { MediaModule } from './modules/media/media.module';
import { UsersModule } from './modules/users/users.module';
import { VerificationModule } from './modules/verification/verification.module';
import { PingsModule } from './modules/pings/pings.module';
import { GridModule } from './modules/grid/grid.module';
import { VisibilityModule } from './common/visibility/visibility.module';
import { BlocksModule } from './common/blocks/blocks.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { buildLoggerOptions } from './common/logging/logger.options';
import type { AppConfig } from './config/env.schema';

/**
 * Root module, shared by both entrypoints.
 *
 * The API process (main.ts) and the worker process (worker.ts) both build from
 * this graph (DECISIONS.md D-002), so infrastructure — config, logging,
 * database, Redis, queues — is wired identically in both. Only the HTTP layer
 * differs, and the worker simply never starts one.
 *
 * Queue CONSUMERS live in WorkerModule, never here (D-030).
 */
@Module({
  imports: [
    // Must be first: everything below reads validated config, and a bad
    // environment should fail here rather than three modules later.
    AppConfigModule,

    LoggerModule.forRootAsync({
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => buildLoggerOptions(config),
    }),

    PrismaModule,
    RedisModule,
    QueueModule,

    // Per-IP request throttling. NOTE: the default storage is in-memory, so
    // limits are per-instance. That is fine for a single dev/prod process but
    // must move to Redis-backed storage before scaling horizontally, or the
    // effective limit silently becomes (limit x instance count). The per-phone
    // OTP cap that actually guards SMS spend already lives in Redis
    // (AuthService), so it is correct across instances today.
    ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 60 }]),

    // Global, and before VisibilityModule because the photo-lock resolver
    // depends on it: a block re-locks a pair that a ping had already unlocked
    // (CLAUDE.md 2.5, D-049).
    BlocksModule,

    // Global. Must be available before any module that reads photos —
    // CLAUDE.md 2.1 is enforced here and nowhere else.
    VisibilityModule,

    HealthModule,
    AuthModule,
    MediaModule,
    UsersModule,
    VerificationModule,
    PingsModule,
    GridModule,
  ],
  providers: [
    {
      // Registered as a provider rather than via app.useGlobalFilters() so it
      // participates in DI and can inject the Pino logger.
      provide: APP_FILTER,
      useClass: AllExceptionsFilter,
    },
    {
      // GLOBAL auth: every route requires a valid bearer token unless it is
      // explicitly marked @Public(). Fail-closed by default — a new endpoint
      // added without thinking about auth is protected, not exposed.
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}

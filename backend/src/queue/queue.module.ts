import { Global, Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { APP_CONFIG } from '../config/config.module';
import { buildRedisOptions } from '../redis/redis.module';
import { DEFAULT_JOB_OPTIONS, QUEUES } from './queue.constants';
import type { AppConfig } from '../config/env.schema';

/**
 * BullMQ wiring, shared by both entrypoints.
 *
 * The API process (main.ts) registers these queues as *producers*; the worker
 * process (worker.ts) attaches consumers to them (DECISIONS.md D-002). Both
 * import this module so the queue names and job options cannot diverge.
 */
@Global()
@Module({
  imports: [
    BullModule.forRootAsync({
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => ({
        connection: {
          ...buildRedisOptions(config),
          // BullMQ requires this to be null. Its blocking commands (BRPOPLPUSH
          // and friends) are long-lived by design, and ioredis' retry limit
          // would tear them down mid-wait.
          maxRetriesPerRequest: null,
        },
        // Namespaces every key, so a shared or multi-project Redis cannot
        // collide. Memurai locally is shared with whatever else is running.
        prefix: `{${config.QUEUE_PREFIX}}`,
        defaultJobOptions: DEFAULT_JOB_OPTIONS,
      }),
    }),

    // Registered up front so /health can report queue reachability before any
    // service that uses them exists.
    ...Object.values(QUEUES).map((name) => BullModule.registerQueue({ name })),
  ],
  exports: [BullModule],
})
export class QueueModule {}

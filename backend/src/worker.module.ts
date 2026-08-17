import { Module } from '@nestjs/common';
import { AppModule } from './app.module';
import { MediaWorkerModule } from './modules/media/media-worker.module';
import { VerificationWorkerModule } from './modules/verification/verification-worker.module';

/**
 * Root module for the queue worker process.
 *
 * Deliberately separate from AppModule: it inherits all shared infrastructure
 * (config, logging, Prisma, Redis, queues) by importing it, then adds the
 * queue CONSUMERS on top.
 *
 * The API bootstraps AppModule and therefore has no consumers; the worker
 * bootstraps this and gets them. That asymmetry is the whole mechanism behind
 * D-002 — it is not a naming convention, it is what stops CPU-bound image
 * processing from competing with request handling.
 *
 * Register every new @Processor here.
 */
@Module({
  imports: [AppModule, MediaWorkerModule, VerificationWorkerModule],
})
export class WorkerModule {}

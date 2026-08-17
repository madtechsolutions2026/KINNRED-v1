import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { WorkerModule } from './worker.module';

/**
 * Queue worker entrypoint (DECISIONS.md D-002).
 *
 * Runs the same module graph as the API but with no HTTP server. BullMQ
 * consumers registered by domain modules attach here and keep the process
 * alive.
 *
 * Kept separate from the API so that CPU-bound work — image derivative
 * generation in S2 especially — cannot starve the event loop serving user
 * requests, and so workers scale independently of the API.
 *
 * Consumers live in WorkerModule, never in AppModule — that separation is
 * what keeps CPU-bound work (sharp image decoding) off the API's event loop.
 */
async function bootstrapWorker(): Promise<void> {
  // createApplicationContext, not create(): no HTTP listener, no routes.
  const app = await NestFactory.createApplicationContext(WorkerModule, {
    bufferLogs: true,
  });

  app.useLogger(app.get(Logger));
  app.enableShutdownHooks();

  const logger = app.get(Logger);
  logger.log('Queue worker started — media + verification processors active');

  // Surface async failures instead of dying silently with a zero exit code,
  // which in a container reads as a clean shutdown and suppresses the restart.
  process.on('unhandledRejection', (reason) => {
    logger.error({ err: reason }, 'Unhandled rejection in worker');
  });
}

// Same reasoning as main.ts: a worker that dies silently on boot is worse than
// one that crashes loudly, because nothing is consuming the queue and no
// error was ever printed to say so.
bootstrapWorker().catch((error: unknown) => {
  console.error('FATAL: queue worker failed to start.');
  console.error(
    error instanceof Error ? (error.stack ?? error.message) : error,
  );
  process.exit(1);
});

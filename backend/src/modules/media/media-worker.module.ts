import { Module, OnModuleInit, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { MediaModule } from './media.module';
import { MediaProcessor } from './processors/media.processor';
import { MEDIA_SWEEP_JOB } from './media.service';
import { QUEUES } from '../../queue/queue.constants';

/**
 * Consumer-side counterpart to MediaModule.
 *
 * Imported ONLY by worker.module.ts. Keeping the @Processor out of the API's
 * module graph is what actually enforces D-002 — if this were declared in
 * MediaModule, the API process would spin up its own consumer as a side effect
 * of serving the controller, and CPU-bound sharp work would land on the same
 * event loop handling user requests.
 *
 * The split is easy to undo by accident. Do not merge these modules.
 */
@Module({
  imports: [MediaModule],
  providers: [MediaProcessor],
})
export class MediaWorkerModule implements OnModuleInit {
  private readonly logger = new Logger(MediaWorkerModule.name);

  constructor(@InjectQueue(QUEUES.MEDIA) private readonly queue: Queue) {}

  /**
   * Schedules the reconciliation sweep.
   *
   * Uses a BullMQ *job scheduler* rather than an in-process timer, so that
   * with several workers running only one sweep fires per interval — Redis
   * holds the schedule, not the process. Registering it here (worker-only)
   * also keeps the API from ever scheduling it.
   *
   * `upsertJobScheduler` is the BullMQ 6 API. Passing `repeat` to `queue.add`
   * was the v4 way and no longer type-checks. Upsert semantics also make
   * restarts idempotent: re-declaring the same scheduler id updates it in
   * place instead of stacking duplicates.
   */
  async onModuleInit(): Promise<void> {
    await this.queue.upsertJobScheduler(
      'media-sweep',
      { every: 5 * 60 * 1000 },
      {
        name: MEDIA_SWEEP_JOB,
        data: {},
        opts: { removeOnComplete: { count: 10 } },
      },
    );
    this.logger.log('Media sweep scheduled (every 5m)');
  }
}

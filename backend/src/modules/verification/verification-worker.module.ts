import { Logger, Module, OnModuleInit } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { VerificationModule } from './verification.module';
import { VerificationProcessor } from './processors/verification.processor';
import { VERIFICATION_SWEEP_JOB } from './verification.service';
import { QUEUES } from '../../queue/queue.constants';

/**
 * Consumer-side counterpart to VerificationModule.
 *
 * Imported ONLY by worker.module.ts, for the same reason MediaWorkerModule is
 * (D-002): declaring the @Processor here rather than in VerificationModule is
 * what stops the API process from also becoming a consumer.
 */
@Module({
  imports: [VerificationModule],
  providers: [VerificationProcessor],
})
export class VerificationWorkerModule implements OnModuleInit {
  private readonly logger = new Logger(VerificationWorkerModule.name);

  constructor(
    @InjectQueue(QUEUES.VERIFICATION) private readonly queue: Queue,
  ) {}

  /**
   * Schedules the expiry sweep.
   *
   * Hourly rather than every few minutes: the TTL it enforces is measured in
   * hours (KYC_REQUEST_TTL_HOURS), so a tighter interval would only add
   * `updateMany` calls that match nothing. A request may therefore sit expired
   * for up to an hour before the row says so, which is harmless — nothing
   * reads EXPIRED as an authorisation signal.
   *
   * A BullMQ job scheduler, not an in-process timer, so that N workers still
   * produce one sweep per interval. Upsert makes restarts idempotent.
   */
  async onModuleInit(): Promise<void> {
    await this.queue.upsertJobScheduler(
      'verification-sweep',
      { every: 60 * 60 * 1000 },
      {
        name: VERIFICATION_SWEEP_JOB,
        data: {},
        opts: { removeOnComplete: { count: 10 } },
      },
    );
    this.logger.log('Verification expiry sweep scheduled (hourly)');
  }
}

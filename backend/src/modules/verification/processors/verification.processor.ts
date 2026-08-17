import { Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import {
  VerificationService,
  VERIFICATION_SWEEP_JOB,
} from '../verification.service';
import { QUEUES } from '../../../queue/queue.constants';

/**
 * Verification maintenance. Runs ONLY in the worker process (D-002).
 *
 * Currently a single scheduled job: expiring PENDING requests whose decision
 * never arrived. That is not housekeeping — `submit()` allows one live attempt
 * per user, so a webhook that is dropped, misrouted, or never sent by the
 * vendor leaves that user permanently unable to re-submit, with no action they
 * can take to clear it. Without this sweep the failure mode of a vendor outage
 * is a cohort of accounts that can never become verified.
 *
 * Expiry only ever moves PENDING -> EXPIRED, so it can never revoke a decision
 * that was legitimately made.
 */
@Processor(QUEUES.VERIFICATION)
export class VerificationProcessor extends WorkerHost {
  private readonly logger = new Logger(VerificationProcessor.name);

  constructor(private readonly verification: VerificationService) {
    super();
  }

  async process(job: Job): Promise<void> {
    if (job.name !== VERIFICATION_SWEEP_JOB) {
      this.logger.warn(`Ignoring unknown job "${job.name}"`);
      return;
    }

    await this.verification.sweepExpired();
  }
}

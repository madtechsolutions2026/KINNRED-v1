import { Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import {
  CirclesService,
  PUBLISH_POST_JOB,
  POST_REMINDER_JOB,
  type ScheduledPostJob,
} from '../circles.service';
import { QUEUES } from '../../../queue/queue.constants';

/**
 * Consumes the SCHEDULING queue (S9). Runs ONLY in the worker process (D-002).
 *
 * Two one-shot delayed job types, both enqueued by the API when a post is
 * created with a future `scheduledFor` or a `reminderAt`:
 *
 *  - publish-post  — the post's publish time arrived; fan out CIRCLE_POST_NEW.
 *  - post-reminder — the reminder time arrived; fan out CIRCLE_POST_REMINDER.
 *
 * Neither job is load-bearing for visibility: a scheduled post becomes readable
 * purely from the `scheduledFor <= now` filter, so a job that never runs costs
 * a missed push, not a stuck post. Both handlers re-read the post and no-op if
 * it was deleted (D-066).
 *
 * There is no repeatable/cron job here — unlike the media and verification
 * sweeps — so this module has no onModuleInit scheduler.
 */
@Processor(QUEUES.SCHEDULING)
export class SchedulingProcessor extends WorkerHost {
  private readonly logger = new Logger(SchedulingProcessor.name);

  constructor(private readonly circles: CirclesService) {
    super();
  }

  async process(job: Job<ScheduledPostJob>): Promise<void> {
    const { postId } = job.data;

    switch (job.name) {
      case PUBLISH_POST_JOB:
        await this.circles.publishScheduledPost(postId);
        return;
      case POST_REMINDER_JOB:
        await this.circles.firePostReminder(postId);
        return;
      default:
        this.logger.warn(`Ignoring unknown job "${job.name}"`);
    }
  }
}

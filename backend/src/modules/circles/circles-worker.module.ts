import { Module } from '@nestjs/common';
import { CirclesModule } from './circles.module';
import { SchedulingProcessor } from './processors/scheduling.processor';

/**
 * Consumer-side counterpart to CirclesModule.
 *
 * Imported ONLY by worker.module.ts. Keeping the @Processor out of the API's
 * module graph is what enforces D-002: the API enqueues delayed jobs, the
 * worker runs them. Circle-post fan-out is light, but the rule is the rule —
 * consumers never live in a domain module.
 */
@Module({
  imports: [CirclesModule],
  providers: [SchedulingProcessor],
})
export class CirclesWorkerModule {}

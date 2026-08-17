import { Module } from '@nestjs/common';
import { MediaController } from './media.controller';
import { MediaService } from './media.service';
import { StorageService } from './storage/storage.service';
import { ImageProcessorService } from './processing/image-processor.service';

/**
 * Media module — the API-side half.
 *
 * This registers the controller and the queue PRODUCER. The consumer
 * (MediaProcessor) lives in MediaWorkerModule and is loaded only by the worker
 * entrypoint, so image processing can never run inside the API process
 * (DECISIONS.md D-002). Sharp decoding is CPU-bound and would block the event
 * loop serving requests.
 *
 * The queues themselves are registered globally by QueueModule.
 */
@Module({
  controllers: [MediaController],
  providers: [MediaService, StorageService, ImageProcessorService],
  exports: [MediaService, StorageService, ImageProcessorService],
})
export class MediaModule {}

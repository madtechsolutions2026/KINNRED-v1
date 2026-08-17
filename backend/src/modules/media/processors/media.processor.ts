import { Inject, Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { PrismaService } from '../../../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import {
  ImageProcessorService,
  MediaRejectedError,
} from '../processing/image-processor.service';
import {
  MediaService,
  MediaProcessJob,
  MEDIA_PROCESS_JOB,
  MEDIA_SWEEP_JOB,
} from '../media.service';
import { QUEUES } from '../../../queue/queue.constants';
import { APP_CONFIG } from '../../../config/config.module';
import { MediaKind, MediaStatus } from '../../../generated/prisma/enums';
import type { AppConfig } from '../../../config/env.schema';

/**
 * Post-upload processing. Runs ONLY in the worker process (D-002).
 *
 * This is the single point at which uploaded bytes are ever inspected. With
 * presigned direct-to-storage upload the API never touches them, so every
 * validation the system performs happens here — if it is not checked in this
 * file, it is not checked at all.
 *
 * Responsibilities, in order:
 *   1. Confirm the object actually exists and is within the size limit.
 *   2. Decode it to prove it is genuinely an image of an allowed format.
 *   3. Strip EXIF (critically, GPS) and re-encode.
 *   4. Generate the blurred derivative for profile photos.
 *   5. Mark READY — the only status that is ever servable.
 */
@Processor(QUEUES.MEDIA)
export class MediaProcessor extends WorkerHost {
  private readonly logger = new Logger(MediaProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly images: ImageProcessorService,
    private readonly media: MediaService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {
    super();
  }

  async process(job: Job<MediaProcessJob>): Promise<void> {
    if (job.name === MEDIA_SWEEP_JOB) {
      await this.media.sweepStale();
      return;
    }

    if (job.name !== MEDIA_PROCESS_JOB) {
      this.logger.warn(`Ignoring unknown job "${job.name}"`);
      return;
    }

    const { assetId } = job.data;
    const asset = await this.prisma.mediaAsset.findUnique({
      where: { id: assetId },
    });

    if (!asset) {
      // Owner deleted it mid-flight. Not an error — nothing to do.
      this.logger.warn(`Asset ${assetId} no longer exists; skipping`);
      return;
    }

    if (asset.status === MediaStatus.READY) {
      // Duplicate delivery. BullMQ guarantees at-least-once, so this is
      // expected rather than exceptional.
      this.logger.log(`Asset ${assetId} already processed; skipping`);
      return;
    }

    try {
      await this.processAsset(asset.id, asset.kind, asset.storageKey);
    } catch (error) {
      if (error instanceof MediaRejectedError) {
        // A bad upload is the client's problem, not a system failure — record
        // it and stop. Retrying would just fail identically three more times.
        await this.reject(
          asset.id,
          asset.kind,
          asset.storageKey,
          error.message,
        );
        return;
      }
      // Anything else (storage blip, transient failure) rethrows so BullMQ
      // retries with backoff.
      throw error;
    }
  }

  private async processAsset(
    assetId: string,
    kind: MediaKind,
    storageKey: string,
  ): Promise<void> {
    // HEAD before GET: check the size without pulling a huge object into
    // memory first. Downloading to discover it is too big defeats the limit.
    const head = await this.storage.head(kind, storageKey);

    if (!head) {
      throw new MediaRejectedError('No file was uploaded');
    }

    if (head.bytes > this.config.MEDIA_MAX_UPLOAD_BYTES) {
      throw new MediaRejectedError(
        `File is too large (${Math.round(head.bytes / 1024)} KB, limit ${Math.round(
          this.config.MEDIA_MAX_UPLOAD_BYTES / 1024,
        )} KB)`,
      );
    }

    if (head.bytes === 0) {
      throw new MediaRejectedError('Uploaded file is empty');
    }

    const raw = await this.storage.getBuffer(kind, storageKey);

    // Decodes, validates format, applies EXIF orientation, then STRIPS all
    // metadata. GPS coordinates in a phone photo would otherwise leak the
    // user's exact position and defeat the location fuzzing in CLAUDE.md §2.2.
    const sanitized = await this.images.sanitize(raw);

    // Overwrite the original in place. From here the EXIF-bearing bytes are
    // gone from storage entirely, not merely unreferenced.
    await this.storage.putBuffer(
      kind,
      storageKey,
      sanitized.buffer,
      sanitized.contentType,
    );

    // KYC documents get no blurred derivative — they are never displayed to
    // anyone, so generating one would create an extra copy of biometric data
    // for no purpose.
    let blurredKey: string | null = null;
    if (kind === MediaKind.PROFILE_PHOTO) {
      blurredKey = MediaService.blurredKeyFor(storageKey);
      const blurred = await this.images.generateBlurred(sanitized.buffer);
      await this.storage.putBuffer(kind, blurredKey, blurred, 'image/jpeg');
    }

    await this.prisma.mediaAsset.update({
      where: { id: assetId },
      data: {
        status: MediaStatus.READY,
        blurredKey,
        contentType: sanitized.contentType,
        bytes: sanitized.buffer.length,
        width: sanitized.width,
        height: sanitized.height,
        processedAt: new Date(),
        rejectionReason: null,
      },
    });

    this.logger.log(
      `Asset ${assetId} ready (${sanitized.width}x${sanitized.height}, ${sanitized.buffer.length} bytes)`,
    );
  }

  /**
   * Records a rejection and removes the offending object.
   *
   * Deleting matters: a rejected upload is unvalidated content we have chosen
   * not to serve, and there is no reason to keep paying to store it.
   */
  private async reject(
    assetId: string,
    kind: MediaKind,
    storageKey: string,
    reason: string,
  ): Promise<void> {
    await this.storage.delete(kind, storageKey).catch(() => {
      this.logger.warn(`Could not delete rejected object ${storageKey}`);
    });

    await this.prisma.mediaAsset.update({
      where: { id: assetId },
      data: {
        status: MediaStatus.REJECTED,
        rejectionReason: reason,
        processedAt: new Date(),
      },
    });

    this.logger.warn(`Asset ${assetId} rejected: ${reason}`);
  }
}

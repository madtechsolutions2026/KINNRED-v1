import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from './storage/storage.service';
import { QUEUES } from '../../queue/queue.constants';
import { APP_CONFIG } from '../../config/config.module';
import { MediaKind, MediaStatus } from '../../generated/prisma/enums';
import { PhotoAccess } from '../../common/visibility/visibility.service';
import type { AppConfig } from '../../config/env.schema';

/** Job payload for the media processing queue. */
export interface MediaProcessJob {
  assetId: string;
}

export const MEDIA_PROCESS_JOB = 'process-upload';
export const MEDIA_SWEEP_JOB = 'sweep-stale';

/**
 * How long an asset may sit in PROCESSING before the sweep gives up on it.
 *
 * Generous relative to actual processing (sub-second), because this only fires
 * when something is genuinely wrong: the worker died mid-job, or BullMQ
 * exhausted its retries and moved the job to the failed set.
 */
const PROCESSING_TIMEOUT_MS = 15 * 60 * 1000;

/**
 * Content types a client may declare when requesting an upload URL.
 *
 * This is a convenience filter that rejects obvious nonsense early — it is
 * NOT the security control. The declared type is unverified; the worker
 * determines the real format by decoding the bytes.
 */
const DECLARABLE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

/** Cap on how many profile photos one user may hold. */
const MAX_PROFILE_PHOTOS = 9;

@Injectable()
export class MediaService {
  private readonly logger = new Logger(MediaService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    @InjectQueue(QUEUES.MEDIA) private readonly queue: Queue,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /**
   * Step 1 — reserve an asset row and hand back a presigned PUT.
   *
   * The storage key is derived SERVER-SIDE from the owner and a generated id.
   * A client-supplied key would be a path-traversal and overwrite primitive:
   * it would let a caller write over another user's photo, or place an object
   * outside its own prefix.
   */
  async requestUpload(
    ownerId: string,
    kind: MediaKind,
    declaredContentType: string,
  ): Promise<{
    assetId: string;
    uploadUrl: string;
    expiresInSeconds: number;
    maxBytes: number;
  }> {
    if (!DECLARABLE_TYPES.has(declaredContentType)) {
      throw new BadRequestException(
        'contentType must be image/jpeg, image/png or image/webp',
      );
    }

    if (kind === MediaKind.PROFILE_PHOTO) {
      const existing = await this.prisma.mediaAsset.count({
        where: {
          ownerId,
          kind,
          status: { in: [MediaStatus.READY, MediaStatus.PROCESSING] },
        },
      });
      if (existing >= MAX_PROFILE_PHOTOS) {
        throw new BadRequestException(
          `You can have at most ${MAX_PROFILE_PHOTOS} photos. Delete one first.`,
        );
      }
    }

    const asset = await this.prisma.mediaAsset.create({
      data: {
        ownerId,
        kind,
        status: MediaStatus.PENDING,
        // Placeholder; replaced immediately below once the id exists.
        storageKey: '',
      },
    });

    const storageKey = this.buildStorageKey(kind, ownerId, asset.id);

    await this.prisma.mediaAsset.update({
      where: { id: asset.id },
      data: { storageKey },
    });

    const uploadUrl = await this.storage.presignUpload(
      kind,
      storageKey,
      declaredContentType,
    );

    return {
      assetId: asset.id,
      uploadUrl,
      expiresInSeconds: this.config.STORAGE_UPLOAD_TTL_SECONDS,
      maxBytes: this.config.MEDIA_MAX_UPLOAD_BYTES,
    };
  }

  /**
   * Step 2 — the client reports the upload finished; we enqueue processing.
   *
   * R2 has no S3-style bucket event notifications without coupling us to
   * Cloudflare Queues, so the client triggers this (DECISIONS.md D-026).
   *
   * The client is trusted ONLY to say "I am done" — never about content. The
   * worker independently fetches the object and validates it, so a caller that
   * lies, uploads nothing, or uploads something else gains nothing. A caller
   * that never confirms leaves an asset that stays unreadable and is swept.
   */
  async confirmUpload(
    ownerId: string,
    assetId: string,
  ): Promise<{ status: MediaStatus }> {
    const asset = await this.requireOwnedAsset(ownerId, assetId);

    if (asset.status !== MediaStatus.PENDING) {
      throw new BadRequestException(
        `Asset is already ${asset.status.toLowerCase()}`,
      );
    }

    // ENQUEUE FIRST, then update status. The order matters.
    //
    // The other way round strands the asset: if the enqueue throws after the
    // row is already PROCESSING, nothing is queued and nothing will ever move
    // it again. (Observed exactly this during S2 testing, from a BullMQ
    // rejection — the row sat in PROCESSING permanently.)
    //
    // This order fails safe. A failed enqueue leaves the asset PENDING and the
    // client can simply retry confirm. And if the enqueue succeeds but the
    // status update fails, the job still runs — the processor accepts any
    // non-READY status, so it does not depend on this write landing.
    await this.queue.add(
      MEDIA_PROCESS_JOB,
      { assetId: asset.id } satisfies MediaProcessJob,
      // Deduplicate on the asset id so a client that double-taps confirm
      // cannot enqueue the same work twice.
      //
      // Hyphen, not colon: BullMQ rejects a custom job id containing ":"
      // ("Custom Id cannot contain :") because it uses colons as key
      // separators in Redis.
      { jobId: `media-${asset.id}` },
    );

    await this.prisma.mediaAsset.update({
      where: { id: asset.id },
      data: { status: MediaStatus.PROCESSING },
    });

    return { status: MediaStatus.PROCESSING };
  }

  /**
   * Photos of `ownerId`, rendered according to a visibility decision that has
   * ALREADY been made by VisibilityService.
   *
   * This method deliberately does not decide anything — it takes `access` as
   * an argument rather than computing it. Keeping the decision in one service
   * (CLAUDE.md §2.1) and the rendering in another is what stops the photo-lock
   * rule from quietly acquiring a second implementation here.
   *
   * LOCKED   → nothing at all
   * BLURRED  → the pre-generated derivative only; the real key is never signed
   * UNLOCKED → the real photo
   */
  async listViewablePhotos(
    ownerId: string,
    access: PhotoAccess,
  ): Promise<Array<{ id: string; url: string; blurred: boolean }>> {
    if (access === PhotoAccess.LOCKED) return [];

    const assets = await this.prisma.mediaAsset.findMany({
      where: {
        ownerId,
        kind: MediaKind.PROFILE_PHOTO,
        status: MediaStatus.READY,
      },
      orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
      select: { id: true, storageKey: true, blurredKey: true },
    });

    const wantBlur = access === PhotoAccess.BLURRED;

    const photos = await Promise.all(
      assets.map(async (asset) => {
        // Fail closed: if a blurred derivative is somehow missing, skip the
        // photo entirely rather than falling back to the real one. The
        // fallback would silently defeat the lock.
        const key = wantBlur ? asset.blurredKey : asset.storageKey;
        if (!key) return null;

        return {
          id: asset.id,
          url: await this.storage.presignRead(MediaKind.PROFILE_PHOTO, key),
          blurred: wantBlur,
        };
      }),
    );

    return photos.filter((p): p is NonNullable<typeof p> => p !== null);
  }

  /**
   * The owner's own gallery, including PENDING and REJECTED assets — the owner
   * needs to see an upload that failed validation. Other viewers never come
   * through here; they come through `listViewablePhotos`, which serves READY
   * assets only and takes a VisibilityService decision as an argument.
   */
  async listOwn(ownerId: string, kind: MediaKind) {
    const assets = await this.prisma.mediaAsset.findMany({
      where: { ownerId, kind },
      orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
      select: {
        id: true,
        kind: true,
        status: true,
        width: true,
        height: true,
        bytes: true,
        position: true,
        rejectionReason: true,
        createdAt: true,
      },
    });
    return assets;
  }

  /**
   * A short-lived read URL for the owner's OWN asset.
   *
   * Only READY assets are servable: anything else has not been through
   * validation, and the object at that key may still be the raw upload with
   * its EXIF intact.
   *
   * This method deliberately serves the OWNER only, and stayed that way
   * through S6. Cross-user reads go through `listViewablePhotos` with a
   * VisibilityService decision; nothing may reuse this path to reach another
   * user's asset, because there is no viewer identity here to decide against.
   */
  async getOwnReadUrl(
    ownerId: string,
    assetId: string,
  ): Promise<{ url: string; expiresInSeconds: number }> {
    const asset = await this.requireOwnedAsset(ownerId, assetId);

    if (asset.status !== MediaStatus.READY) {
      throw new BadRequestException(
        `Asset is ${asset.status.toLowerCase()} and cannot be served yet`,
      );
    }

    const url = await this.storage.presignRead(asset.kind, asset.storageKey);
    return { url, expiresInSeconds: this.config.STORAGE_READ_TTL_SECONDS };
  }

  async deleteAsset(
    ownerId: string,
    assetId: string,
  ): Promise<{ deleted: true }> {
    const asset = await this.requireOwnedAsset(ownerId, assetId);

    // Storage first: if the row disappeared first and the delete then failed,
    // the object would be orphaned with nothing left pointing at it. A failed
    // storage delete leaves the row, which the sweep can retry.
    await Promise.allSettled([
      this.storage.delete(asset.kind, asset.storageKey),
      asset.blurredKey
        ? this.storage.delete(asset.kind, asset.blurredKey)
        : Promise.resolve(),
    ]);

    await this.prisma.mediaAsset.delete({ where: { id: asset.id } });
    return { deleted: true };
  }

  /**
   * Reconciliation sweep. Runs periodically in the worker.
   *
   * Two ways an asset gets stranded, neither of which any request path will
   * ever revisit:
   *
   *   PENDING    — a presigned URL was issued and the client never uploaded,
   *                or never called confirm. Once the URL expires the object
   *                can never arrive, so the row is dead weight.
   *   PROCESSING — the worker crashed mid-job, or BullMQ exhausted its retries
   *                and moved the job to the failed set. Nothing will pick it
   *                up again.
   *
   * Without this, both accumulate forever: rows that count against the user's
   * photo limit and objects that cost money to store. The PROCESSING case is
   * not hypothetical — a BullMQ rejection produced exactly one during S2
   * testing.
   */
  async sweepStale(): Promise<{ pending: number; processing: number }> {
    const now = Date.now();

    // ×2 the upload TTL: past that the presigned URL is long dead, so no
    // upload can still be in flight and we cannot race a legitimate client.
    const pendingCutoff = new Date(
      now - this.config.STORAGE_UPLOAD_TTL_SECONDS * 2 * 1000,
    );
    const processingCutoff = new Date(now - PROCESSING_TIMEOUT_MS);

    const stale = await this.prisma.mediaAsset.findMany({
      where: {
        OR: [
          { status: MediaStatus.PENDING, createdAt: { lt: pendingCutoff } },
          {
            status: MediaStatus.PROCESSING,
            updatedAt: { lt: processingCutoff },
          },
        ],
      },
      select: { id: true, kind: true, status: true, storageKey: true },
    });

    if (stale.length === 0) return { pending: 0, processing: 0 };

    let pending = 0;
    let processing = 0;

    for (const asset of stale) {
      if (asset.status === MediaStatus.PENDING) pending += 1;
      else processing += 1;

      // Best-effort: the object may never have existed (abandoned PENDING).
      await this.storage
        .delete(asset.kind, asset.storageKey)
        .catch(() => undefined);

      await this.prisma.mediaAsset.update({
        where: { id: asset.id },
        data: {
          status: MediaStatus.REJECTED,
          rejectionReason:
            asset.status === MediaStatus.PENDING
              ? 'Upload was never completed'
              : 'Processing did not finish — please upload again',
          processedAt: new Date(),
        },
      });
    }

    this.logger.warn(
      `Swept ${pending} abandoned and ${processing} stuck media assets`,
    );
    return { pending, processing };
  }

  /**
   * Loads an asset and proves the caller owns it.
   *
   * Returns 404 rather than 403 for someone else's asset — a 403 confirms the
   * id exists, which is a membership oracle over the whole media table.
   */
  private async requireOwnedAsset(ownerId: string, assetId: string) {
    const asset = await this.prisma.mediaAsset.findUnique({
      where: { id: assetId },
    });

    if (!asset || asset.ownerId !== ownerId) {
      throw new NotFoundException('Media asset not found');
    }
    return asset;
  }

  /**
   * Server-derived storage key. Never accepts client input.
   *
   * The kind prefix keeps KYC documents in their own namespace on top of
   * already living in a separate bucket.
   */
  private buildStorageKey(
    kind: MediaKind,
    ownerId: string,
    assetId: string,
  ): string {
    const prefix = kind === MediaKind.KYC_DOCUMENT ? 'kyc' : 'photos';
    return `${prefix}/${ownerId}/${assetId}.jpg`;
  }

  /** Derived, not stored separately, so the two keys cannot drift apart. */
  static blurredKeyFor(storageKey: string): string {
    return storageKey.replace(/\.jpg$/, '-blur.jpg');
  }
}

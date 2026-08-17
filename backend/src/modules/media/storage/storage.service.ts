import {
  Inject,
  Injectable,
  Logger,
  OnApplicationShutdown,
} from '@nestjs/common';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { APP_CONFIG } from '../../../config/config.module';
import { MediaKind } from '../../../generated/prisma/enums';
import type { AppConfig } from '../../../config/env.schema';

export interface ObjectHead {
  bytes: number;
  contentType?: string;
}

/**
 * S3-compatible object storage.
 *
 * Cloudflare R2 in production, MinIO locally — same API, different endpoint
 * and credentials (DECISIONS.md D-026). Nothing in this file is vendor
 * specific; keep it that way.
 *
 * TWO SEPARATE CLIENTS with TWO SEPARATE CREDENTIAL SETS, one per bucket
 * (CLAUDE.md §2.4). Profile photos and biometric ID documents must not be
 * reachable with the same key. Resist any refactor that "simplifies" these
 * into one shared client — the duplication IS the security control.
 */
@Injectable()
export class StorageService implements OnApplicationShutdown {
  private readonly logger = new Logger(StorageService.name);
  private readonly clients: Record<MediaKind, S3Client>;
  private readonly buckets: Record<MediaKind, string>;

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {
    const shared = {
      endpoint: config.STORAGE_ENDPOINT,
      region: config.STORAGE_REGION,
      // Required by MinIO, harmless on R2. Without it the SDK builds
      // virtual-host-style URLs (bucket.host/key) that MinIO does not serve.
      forcePathStyle: true,
    };

    this.clients = {
      [MediaKind.PROFILE_PHOTO]: new S3Client({
        ...shared,
        credentials: {
          accessKeyId: config.STORAGE_MEDIA_ACCESS_KEY_ID,
          secretAccessKey: config.STORAGE_MEDIA_SECRET_ACCESS_KEY,
        },
      }),
      [MediaKind.KYC_DOCUMENT]: new S3Client({
        ...shared,
        credentials: {
          accessKeyId: config.STORAGE_KYC_ACCESS_KEY_ID,
          secretAccessKey: config.STORAGE_KYC_SECRET_ACCESS_KEY,
        },
      }),
    };

    this.buckets = {
      [MediaKind.PROFILE_PHOTO]: config.STORAGE_MEDIA_BUCKET,
      [MediaKind.KYC_DOCUMENT]: config.STORAGE_KYC_BUCKET,
    };
  }

  /**
   * Presigned PUT for direct browser/app upload — the API never handles bytes.
   *
   * NOTE ON SIZE ENFORCEMENT: a presigned PUT cannot reliably cap upload size.
   * Signing ContentLength requires the client to send exactly that many bytes,
   * which breaks legitimate uploads. Size is therefore enforced authoritatively
   * by the worker, which re-reads the actual object. Treat any limit implied
   * here as advisory only.
   */
  presignUpload(
    kind: MediaKind,
    key: string,
    contentType: string,
  ): Promise<string> {
    const command = new PutObjectCommand({
      Bucket: this.buckets[kind],
      Key: key,
      ContentType: contentType,
    });

    return getSignedUrl(this.clients[kind], command, {
      expiresIn: this.config.STORAGE_UPLOAD_TTL_SECONDS,
    });
  }

  /**
   * Presigned GET, minted per request and never stored.
   *
   * Capped at 5 minutes (CLAUDE.md §2.1). A presigned URL is a bearer
   * capability: once issued it keeps working until it expires, even if the
   * owner blocks the viewer or re-locks their photos in the meantime. Short
   * TTL is the only thing bounding that window.
   */
  presignRead(kind: MediaKind, key: string): Promise<string> {
    const command = new GetObjectCommand({
      Bucket: this.buckets[kind],
      Key: key,
    });

    return getSignedUrl(this.clients[kind], command, {
      expiresIn: this.config.STORAGE_READ_TTL_SECONDS,
    });
  }

  /** Metadata only — used to check size before downloading a large object. */
  async head(kind: MediaKind, key: string): Promise<ObjectHead | null> {
    try {
      const res = await this.clients[kind].send(
        new HeadObjectCommand({ Bucket: this.buckets[kind], Key: key }),
      );
      return {
        bytes: res.ContentLength ?? 0,
        contentType: res.ContentType,
      };
    } catch (error: unknown) {
      const status = (error as { $metadata?: { httpStatusCode?: number } })
        ?.$metadata?.httpStatusCode;
      if (status === 404) return null;
      throw error;
    }
  }

  /** Downloads an object in full. Only called by the worker. */
  async getBuffer(kind: MediaKind, key: string): Promise<Buffer> {
    const res = await this.clients[kind].send(
      new GetObjectCommand({ Bucket: this.buckets[kind], Key: key }),
    );

    if (!res.Body) {
      throw new Error(`Object ${key} has no body`);
    }

    const bytes = await res.Body.transformToByteArray();
    return Buffer.from(bytes);
  }

  async putBuffer(
    kind: MediaKind,
    key: string,
    body: Buffer,
    contentType: string,
  ): Promise<void> {
    await this.clients[kind].send(
      new PutObjectCommand({
        Bucket: this.buckets[kind],
        Key: key,
        Body: body,
        ContentType: contentType,
      }),
    );
  }

  async delete(kind: MediaKind, key: string): Promise<void> {
    await this.clients[kind].send(
      new DeleteObjectCommand({ Bucket: this.buckets[kind], Key: key }),
    );
  }

  onApplicationShutdown(): void {
    Object.values(this.clients).forEach((client) => client.destroy());
    this.logger.log('Storage clients closed');
  }
}

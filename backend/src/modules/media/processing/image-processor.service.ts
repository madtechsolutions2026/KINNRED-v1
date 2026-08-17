import { Injectable, Logger } from '@nestjs/common';
import sharp from 'sharp';

/** Thrown when an upload fails validation. Message is shown to the owner. */
export class MediaRejectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MediaRejectedError';
  }
}

export interface SanitizedImage {
  buffer: Buffer;
  contentType: string;
  width: number;
  height: number;
}

/**
 * Formats we accept. Deliberately narrow.
 *
 * SVG is excluded on purpose — it is a document format that can carry scripts
 * and external entity references, not an image in the sense we mean. GIF and
 * animated formats are excluded because a profile photo has no need of them
 * and animation multiplies the decode cost.
 */
const ALLOWED_FORMATS = new Set(['jpeg', 'png', 'webp']);

/**
 * Ceiling on decoded pixels (~50 MP), independent of file size.
 *
 * This is the decompression-bomb guard: a ~1 KB PNG can declare dimensions
 * that decode to gigabytes of RAM. A byte-size limit alone does NOT catch
 * this, which is why both limits exist.
 */
const MAX_INPUT_PIXELS = 50_000_000;

/** Longest edge of the stored original. Larger serves no purpose on a phone. */
const MAX_DIMENSION = 2048;

@Injectable()
export class ImageProcessorService {
  private readonly logger = new Logger(ImageProcessorService.name);

  /**
   * Validates the actual bytes and returns a sanitised image.
   *
   * The client's declared content type is ignored entirely — it is an
   * assertion, not evidence. Format is determined by decoding the image, which
   * is strictly stronger than checking magic bytes: it proves the file really
   * is a decodable image of the claimed type, not merely that it starts with
   * the right signature.
   */
  async sanitize(input: Buffer): Promise<SanitizedImage> {
    let image: sharp.Sharp;
    let metadata: sharp.Metadata;

    // The sharp() CONSTRUCTOR throws on some inputs (an empty buffer raises
    // "Input Buffer is empty") before metadata() is ever reached — so both
    // calls must be inside the guard. With only metadata() wrapped, an empty
    // upload escapes as a generic Error, which the worker treats as a system
    // fault and retries three times instead of rejecting it once.
    try {
      image = sharp(input, {
        limitInputPixels: MAX_INPUT_PIXELS,
        // Reject multi-frame input rather than silently using the first frame.
        animated: false,
      });
      metadata = await image.metadata();
    } catch {
      throw new MediaRejectedError('File is not a readable image');
    }

    if (!metadata.format || !ALLOWED_FORMATS.has(metadata.format)) {
      throw new MediaRejectedError(
        `Unsupported image format${metadata.format ? ` (${metadata.format})` : ''}. Use JPEG, PNG or WebP.`,
      );
    }

    if (!metadata.width || !metadata.height) {
      throw new MediaRejectedError('Image has no readable dimensions');
    }

    // .rotate() with no argument applies the EXIF orientation tag and then
    // discards it. Without this, stripping metadata would leave portrait
    // photos displayed sideways — the orientation must be baked into the
    // pixels before the tag that described it is thrown away.
    image = image.rotate();

    if (metadata.width > MAX_DIMENSION || metadata.height > MAX_DIMENSION) {
      image = image.resize(MAX_DIMENSION, MAX_DIMENSION, {
        fit: 'inside',
        withoutEnlargement: true,
      });
    }

    // Re-encoding to JPEG is what actually removes EXIF. sharp drops metadata
    // on output unless withMetadata() is called — so NEVER call it here.
    //
    // This is not cosmetic. Phone photos routinely carry GPS coordinates in
    // EXIF, and serving those would hand out the user's exact location,
    // defeating the entire coordinate-fuzzing rule in CLAUDE.md §2.2. The
    // Grid could be perfectly implemented and the photo would give it away.
    const buffer = await image.jpeg({ quality: 85, mozjpeg: true }).toBuffer();

    const result = await sharp(buffer).metadata();

    return {
      buffer,
      contentType: 'image/jpeg',
      width: result.width ?? 0,
      height: result.height ?? 0,
    };
  }

  /**
   * Builds the blurred placeholder shown when a viewer is not permitted to see
   * the real photo (CLAUDE.md §2.1).
   *
   * Generated once, at upload time — never per request.
   *
   * It DOWNSCALES HARD before blurring, and that order matters. Blurring a
   * full-resolution image is a reversible-ish operation: deconvolution can
   * recover a surprising amount of detail. Discarding the pixels first makes
   * the lost information genuinely unrecoverable, because it is no longer
   * present in the file at all.
   */
  async generateBlurred(sanitized: Buffer): Promise<Buffer> {
    return (
      sharp(sanitized)
        .resize(64, 64, { fit: 'inside' })
        .blur(8)
        // Scaled back up so clients get sensible display dimensions. The detail
        // is already gone; this only stretches what remains.
        .resize(512, 512, { fit: 'inside', withoutEnlargement: false })
        .jpeg({ quality: 50 })
        .toBuffer()
    );
  }

  /** Confirms sharp's native binary is usable. Surfaced via the worker log. */
  version(): string {
    return sharp.versions.vips;
  }
}

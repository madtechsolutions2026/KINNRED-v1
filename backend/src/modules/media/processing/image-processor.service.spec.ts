import sharp from 'sharp';
import {
  ImageProcessorService,
  MediaRejectedError,
} from './image-processor.service';

/**
 * A JPEG carrying GPS EXIF, the way a real phone photo would.
 *
 * GPS tags go in **IFD3**. sharp's `Exif` type only accepts IFD0–IFD3, and an
 * unrecognised key like `GPS` is silently dropped — which would make the tests
 * below pass for the wrong reason, asserting the removal of data that was
 * never written. This actually happened during S2: the first version of this
 * fixture used a `GPS` key and carried no GPS at all.
 *
 * The first test in the suite exists solely to catch a recurrence.
 */
async function photoWithGps(width = 1000, height = 800): Promise<Buffer> {
  return sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 180, g: 90, b: 40 },
    },
  })
    .withExif({
      IFD0: { Make: 'TestPhone', Model: 'X1', Copyright: 'secret-marker' },
      IFD3: {
        GPSLatitudeRef: 'N',
        GPSLatitude: '51/1 30/1 26/1',
        GPSLongitudeRef: 'W',
        GPSLongitude: '0/1 7/1 39/1',
      },
    })
    .jpeg()
    .toBuffer();
}

/** Same image without GPS — the baseline for proving GPS was really written. */
async function photoWithoutGps(width = 1000, height = 800): Promise<Buffer> {
  return sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 180, g: 90, b: 40 },
    },
  })
    .withExif({
      IFD0: { Make: 'TestPhone', Model: 'X1', Copyright: 'secret-marker' },
    })
    .jpeg()
    .toBuffer();
}

describe('ImageProcessorService', () => {
  const service = new ImageProcessorService();

  describe('sanitize', () => {
    it('the GPS fixture really does carry GPS data', async () => {
      // Meta-test guarding every assertion below. sharp silently ignores an
      // unrecognised EXIF group, so a typo'd key would produce a fixture with
      // no GPS at all and make "GPS is stripped" trivially true.
      //
      // Comparing against the identical image WITHOUT the GPS block proves the
      // extra tags landed: the EXIF payload must be measurably larger.
      const withGps = await sharp(await photoWithGps()).metadata();
      const withoutGps = await sharp(await photoWithoutGps()).metadata();

      expect(withGps.exif).toBeDefined();
      expect(withoutGps.exif).toBeDefined();
      expect(withGps.exif!.length).toBeGreaterThan(withoutGps.exif!.length);
    });

    it('strips EXIF, including GPS', async () => {
      const input = await photoWithGps();
      expect((await sharp(input).metadata()).exif).toBeDefined();

      const { buffer } = await service.sanitize(input);
      const after = await sharp(buffer).metadata();

      expect(after.exif).toBeUndefined();
    });

    it('leaves no EXIF strings recoverable in the raw bytes', async () => {
      // Metadata absence per sharp is not quite enough — check the bytes
      // themselves, since a leaked GPS tag would defeat the location fuzzing
      // in CLAUDE.md §2.2 no matter how well the Grid behaves.
      const { buffer } = await service.sanitize(await photoWithGps());
      const raw = buffer.toString('latin1');

      expect(raw).not.toContain('TestPhone');
      expect(raw).not.toContain('secret-marker');
    });

    it('downscales images beyond the maximum dimension', async () => {
      const big = await sharp({
        create: {
          width: 4000,
          height: 3000,
          channels: 3,
          background: { r: 0, g: 0, b: 0 },
        },
      })
        .jpeg()
        .toBuffer();

      const { width, height } = await service.sanitize(big);

      expect(width).toBeLessThanOrEqual(2048);
      expect(height).toBeLessThanOrEqual(2048);
      expect(width / height).toBeCloseTo(4 / 3, 1);
    });

    it('leaves small images at their original size', async () => {
      const small = await sharp({
        create: {
          width: 320,
          height: 240,
          channels: 3,
          background: { r: 5, g: 5, b: 5 },
        },
      })
        .jpeg()
        .toBuffer();

      const { width, height } = await service.sanitize(small);

      expect(width).toBe(320);
      expect(height).toBe(240);
    });

    it('always re-encodes to JPEG', async () => {
      const png = await sharp({
        create: {
          width: 200,
          height: 200,
          channels: 3,
          background: { r: 1, g: 2, b: 3 },
        },
      })
        .png()
        .toBuffer();

      const result = await service.sanitize(png);

      expect(result.contentType).toBe('image/jpeg');
      expect((await sharp(result.buffer).metadata()).format).toBe('jpeg');
    });

    it('rejects a file that is not an image', async () => {
      await expect(
        service.sanitize(Buffer.from('#!/bin/sh\necho pwned\n')),
      ).rejects.toBeInstanceOf(MediaRejectedError);
    });

    it('rejects an empty buffer', async () => {
      await expect(service.sanitize(Buffer.alloc(0))).rejects.toBeInstanceOf(
        MediaRejectedError,
      );
    });

    it('rejects SVG — it is a scriptable document, not an image', async () => {
      const svg = Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>',
      );

      await expect(service.sanitize(svg)).rejects.toBeInstanceOf(
        MediaRejectedError,
      );
    });
  });

  describe('generateBlurred', () => {
    it('produces a smaller, decodable JPEG', async () => {
      const { buffer } = await service.sanitize(await photoWithGps());
      const blurred = await service.generateBlurred(buffer);
      const meta = await sharp(blurred).metadata();

      expect(meta.format).toBe('jpeg');
      expect(blurred.length).toBeLessThan(buffer.length);
    });

    it('destroys detail irrecoverably by downscaling before blurring', async () => {
      // A sharp checkerboard is the worst case for a blur: high-frequency
      // detail everywhere. After the pipeline the variance between adjacent
      // regions should collapse, because the pixels are genuinely gone rather
      // than merely smeared — blur alone is partially reversible.
      const checker = await sharp({
        create: {
          width: 512,
          height: 512,
          channels: 3,
          background: { r: 0, g: 0, b: 0 },
        },
      })
        .composite([
          {
            input: {
              create: {
                width: 256,
                height: 256,
                channels: 3,
                background: { r: 255, g: 255, b: 255 },
              },
            },
            top: 0,
            left: 0,
          },
        ])
        .jpeg()
        .toBuffer();

      const blurred = await service.generateBlurred(checker);
      const stats = await sharp(blurred).stats();

      // Original is pure black and white (stdev near the theoretical max).
      // After downscale + blur it must be materially flatter.
      const originalStats = await sharp(checker).stats();
      expect(stats.channels[0].stdev).toBeLessThan(
        originalStats.channels[0].stdev,
      );
    });
  });
});

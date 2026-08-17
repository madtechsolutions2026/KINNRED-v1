/**
 * Creates the media and KYC buckets if they do not exist.
 *
 * Idempotent, and works against ANY S3-compatible endpoint — MinIO locally,
 * Cloudflare R2 in production. That portability is the point: the same script
 * bootstraps both, which is a small but real proof that the storage layer is
 * genuinely vendor-neutral (DECISIONS.md D-026).
 *
 *   node scripts/ensure-buckets.js
 *
 * Reads the same STORAGE_* variables the application uses, so if this script
 * works, the app's credentials work.
 */
require('dotenv').config();
const {
  S3Client,
  CreateBucketCommand,
  HeadBucketCommand,
} = require('@aws-sdk/client-s3');

const endpoint = process.env.STORAGE_ENDPOINT;
const region = process.env.STORAGE_REGION || 'auto';

if (!endpoint) {
  console.error('STORAGE_ENDPOINT is not set. Fill in backend/.env first.');
  process.exit(1);
}

/**
 * Each bucket gets its OWN credentials — that separation is a safety control
 * (CLAUDE.md §2.4), not a convention. A media token must not be able to touch
 * biometric ID documents.
 */
const targets = [
  {
    label: 'media',
    bucket: process.env.STORAGE_MEDIA_BUCKET,
    accessKeyId: process.env.STORAGE_MEDIA_ACCESS_KEY_ID,
    secretAccessKey: process.env.STORAGE_MEDIA_SECRET_ACCESS_KEY,
  },
  {
    label: 'kyc',
    bucket: process.env.STORAGE_KYC_BUCKET,
    accessKeyId: process.env.STORAGE_KYC_ACCESS_KEY_ID,
    secretAccessKey: process.env.STORAGE_KYC_SECRET_ACCESS_KEY,
  },
];

(async () => {
  let failed = false;

  for (const t of targets) {
    if (!t.bucket || !t.accessKeyId || !t.secretAccessKey) {
      console.error(`  ${t.label}: SKIPPED — credentials or bucket name missing`);
      failed = true;
      continue;
    }

    const client = new S3Client({
      endpoint,
      region,
      // Required for MinIO and harmless for R2: without it the SDK builds
      // virtual-host-style URLs (bucket.host) that MinIO does not serve.
      forcePathStyle: true,
      credentials: {
        accessKeyId: t.accessKeyId,
        secretAccessKey: t.secretAccessKey,
      },
    });

    try {
      await client.send(new HeadBucketCommand({ Bucket: t.bucket }));
      console.log(`  ${t.label}: "${t.bucket}" already exists`);
    } catch (err) {
      const status = err?.$metadata?.httpStatusCode;
      if (status !== 404 && err?.name !== 'NotFound') {
        console.error(`  ${t.label}: cannot reach "${t.bucket}" — ${err.name}: ${err.message}`);
        failed = true;
        continue;
      }
      try {
        await client.send(new CreateBucketCommand({ Bucket: t.bucket }));
        console.log(`  ${t.label}: created "${t.bucket}"`);
      } catch (createErr) {
        console.error(`  ${t.label}: create failed — ${createErr.name}: ${createErr.message}`);
        failed = true;
      }
    } finally {
      client.destroy();
    }
  }

  process.exit(failed ? 1 : 0);
})();

/**
 * Sets a permissive CORS policy on the MEDIA bucket so the browser (Expo web /
 * a future web client) can PUT uploads and GET presigned photo URLs directly.
 *
 *   node scripts/set-media-cors.js
 *
 * Dev convenience. In production the allowed origins should be the real web
 * app's domain(s), not "*". The KYC bucket is deliberately NOT touched — its
 * objects are never fetched by a browser.
 */
require('dotenv').config();
const {
  S3Client,
  PutBucketCorsCommand,
  GetBucketCorsCommand,
} = require('@aws-sdk/client-s3');

const bucket = process.env.STORAGE_MEDIA_BUCKET;
const client = new S3Client({
  endpoint: process.env.STORAGE_ENDPOINT,
  region: process.env.STORAGE_REGION || 'auto',
  forcePathStyle: true,
  credentials: {
    accessKeyId: process.env.STORAGE_MEDIA_ACCESS_KEY_ID,
    secretAccessKey: process.env.STORAGE_MEDIA_SECRET_ACCESS_KEY,
  },
});

const ALLOWED_ORIGINS =
  process.env.NODE_ENV === 'production'
    ? (process.env.CORS_ORIGINS || '').split(',').filter(Boolean)
    : ['*'];

(async () => {
  if (!bucket) {
    console.error('STORAGE_MEDIA_BUCKET not set.');
    process.exit(1);
  }

  await client.send(
    new PutBucketCorsCommand({
      Bucket: bucket,
      CORSConfiguration: {
        CORSRules: [
          {
            AllowedOrigins: ALLOWED_ORIGINS,
            AllowedMethods: ['GET', 'PUT', 'HEAD'],
            AllowedHeaders: ['*'],
            ExposeHeaders: ['ETag'],
            MaxAgeSeconds: 3600,
          },
        ],
      },
    }),
  );

  const check = await client.send(new GetBucketCorsCommand({ Bucket: bucket }));
  console.log(`CORS set on "${bucket}":`);
  console.log(JSON.stringify(check.CORSRules, null, 2));
  client.destroy();
})().catch((e) => {
  console.error(e.name + ': ' + e.message);
  process.exit(1);
});

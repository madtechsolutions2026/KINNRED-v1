/**
 * Dev-only Grid seed.
 *
 * Creates fake users with COMPLETE profiles — real portrait photos (from
 * randomuser.me), display name, bio, interests, looking-for — and places them
 * at real coordinates within a radius of an origin, so the Grid shows a
 * realistic result set during development.
 *
 *   # seed around a real user's CURRENT location (recommended) and anchor them
 *   node scripts/seed-grid.js --around +917032786479 --count 20
 *
 *   # or an explicit origin
 *   node scripts/seed-grid.js --origin 17.5562,78.4413 --count 20
 *
 *   # remove every seed user + their storage objects
 *   node scripts/seed-grid.js --clean
 *
 * Options:
 *   --around <phone>   use that user's stored location as the origin, and set
 *                      their location too (so their own Grid is populated)
 *   --origin lat,lng   explicit origin (default: central Bengaluru)
 *   --anchor <phone>   drop this user exactly at the origin
 *   --count N          how many to create (default 20)
 *   --radius M         max distance from origin in metres (default 9000)
 *
 * Seed users are identified by SEED_PHONE_PREFIX. Refuses to run in production.
 */
require('dotenv').config();
const crypto = require('node:crypto');
const sharp = require('sharp');
const { PrismaPg } = require('@prisma/adapter-pg');
// Prisma 7 emits TypeScript into src/generated; use the compiled copy under
// dist/ so this plain-JS script can require it. Run `npm run build` if stale.
const { PrismaClient } = require('../dist/generated/prisma/client');
const {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
} = require('@aws-sdk/client-s3');

if (process.env.NODE_ENV === 'production') {
  console.error('seed-grid.js must never run in production.');
  process.exit(1);
}

const SEED_PHONE_PREFIX = '+9199000010'; // + 2 digits

// ---------------------------------------------------------------------------
// args
// ---------------------------------------------------------------------------
const args = process.argv.slice(2);
const getArg = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const CLEAN = args.includes('--clean');
const COUNT = parseInt(getArg('--count') || '20', 10);
const RADIUS = parseInt(getArg('--radius') || '9000', 10);
const AROUND = getArg('--around');
let ANCHOR = getArg('--anchor') || AROUND;
let ORIGIN_LAT;
let ORIGIN_LNG;
if (getArg('--origin')) {
  [ORIGIN_LAT, ORIGIN_LNG] = getArg('--origin').split(',').map(Number);
}

// ---------------------------------------------------------------------------
// clients
// ---------------------------------------------------------------------------
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

const s3 = new S3Client({
  endpoint: process.env.STORAGE_ENDPOINT,
  region: process.env.STORAGE_REGION || 'auto',
  forcePathStyle: true,
  credentials: {
    accessKeyId: process.env.STORAGE_MEDIA_ACCESS_KEY_ID,
    secretAccessKey: process.env.STORAGE_MEDIA_SECRET_ACCESS_KEY,
  },
});
const BUCKET = process.env.STORAGE_MEDIA_BUCKET;

// ---------------------------------------------------------------------------
// content pools
// ---------------------------------------------------------------------------
const SHORT_ID_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const shortId = () =>
  Array.from(
    { length: 10 },
    () => SHORT_ID_ALPHABET[crypto.randomInt(0, SHORT_ID_ALPHABET.length)],
  ).join('');

const BIOS = [
  'Weekend climber, weekday designer. Here to meet people who make things.',
  'Chasing good coffee and better conversation. Show me your favourite bookshop.',
  'Runner, amateur potter, incurable planner. Say hi if you like farmers markets.',
  'New to the city. Looking for a badminton partner and someone to try the ramen places with.',
  'Photographer by hobby, engineer by day. I will absolutely make you look at my film shots.',
  'Into long walks, board games, and pretending I will learn the guitar this year.',
  'Product person. Trying to touch grass more. Great at trivia, bad at parking.',
  'Music, hikes, and cooking for too many people. Introvert with loud opinions on pasta.',
  'Just moved back after a few years abroad. Rebuilding my circle one coffee at a time.',
  'Cyclist, plant hoarder, weekend baker. Looking for people who reply to texts.',
  'Yoga in the morning, live gigs at night. Ask me about my sourdough starter.',
  'Design student. I sketch strangers on the metro. Let me sketch you.',
  'Half-marathoner in training and full-time dog aunt. Trail recommendations welcome.',
  'Film nerd, tea over coffee, always down for a spontaneous road trip.',
  'Climbing gym regular, occasional open-mic poet, permanent snack enthusiast.',
  'Building something small. Weekends are for bouldering and long brunches.',
];

const INTEREST_POOL = [
  'climbing', 'coffee', 'film photography', 'running', 'pottery', 'live music',
  'board games', 'hiking', 'cooking', 'cycling', 'yoga', 'reading', 'design',
  'travel', 'baking', 'trivia', 'plants', 'street food', 'jazz', 'gaming',
  'tennis', 'swimming', 'painting', 'startups', 'dogs', 'badminton', 'cricket',
];

const LOOKING_FOR = [
  'DATING', 'FRIENDSHIP', 'NETWORKING', 'ACTIVITY_PARTNERS', 'JUST_EXPLORING',
];

const pick = (arr) => arr[crypto.randomInt(0, arr.length)];
const sample = (arr, n) => {
  const copy = [...arr];
  const out = [];
  for (let i = 0; i < n && copy.length; i += 1) {
    out.push(copy.splice(crypto.randomInt(0, copy.length), 1)[0]);
  }
  return out;
};

// ---------------------------------------------------------------------------
// people (randomuser.me — real portraits + gendered names, royalty-free)
// ---------------------------------------------------------------------------
async function fetchPeople(n) {
  const url =
    `https://randomuser.me/api/?results=${n * 4}` +
    `&inc=name,picture,dob,gender,nat&nat=in,us,gb,ca,au&noinfo`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`randomuser.me ${res.status}`);
  const { results } = await res.json();
  return results
    .filter((p) => p.dob.age >= 20 && p.dob.age <= 46)
    .slice(0, n);
}

async function downloadPortrait(person) {
  // randomuser portraits are 128px; upscale for the profile hero.
  const url = person.picture.large;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`portrait ${res.status}`);
  const raw = Buffer.from(await res.arrayBuffer());
  const normal = await sharp(raw)
    .resize(640, 640, { fit: 'cover', kernel: 'lanczos3' })
    .jpeg({ quality: 86 })
    .toBuffer({ resolveWithObject: true });
  const blurred = await sharp(normal.data)
    .resize(500)
    .blur(14)
    .jpeg({ quality: 70 })
    .toBuffer();
  return { normal, blurred };
}

// ---------------------------------------------------------------------------
// geo helpers
// ---------------------------------------------------------------------------
async function resolveOrigin() {
  if (ORIGIN_LAT != null && ORIGIN_LNG != null) return;
  if (AROUND) {
    const [row] = await prisma.$queryRawUnsafe(
      `SELECT ST_Y(l.geog::geometry) AS lat, ST_X(l.geog::geometry) AS lng
       FROM user_locations l JOIN users u ON u.id = l.user_id
       WHERE u.phone = $1`,
      AROUND,
    );
    if (!row) {
      throw new Error(
        `--around ${AROUND}: that user has no stored location. Open the app as them and let the Grid read your position first.`,
      );
    }
    ORIGIN_LAT = row.lat;
    ORIGIN_LNG = row.lng;
    return;
  }
  ORIGIN_LAT = 12.9716;
  ORIGIN_LNG = 77.5946;
}

async function placeLocation(userId, offlineChance) {
  const dist = 150 + crypto.randomInt(0, Math.max(1, RADIUS - 150));
  const bearing = Math.random() * 2 * Math.PI;
  const fuzzDist = 100 + crypto.randomInt(0, 200);
  const fuzzBearing = Math.random() * 2 * Math.PI;
  const stale = Math.random() < offlineChance;

  await prisma.$executeRawUnsafe(
    `
    INSERT INTO user_locations (user_id, geog, geog_fuzzed, updated_at)
    VALUES (
      $1,
      ST_Project(ST_SetSRID(ST_MakePoint($3::double precision,$2::double precision),4326)::geography, $4::double precision, $5::double precision),
      ST_Project(
        ST_Project(ST_SetSRID(ST_MakePoint($3::double precision,$2::double precision),4326)::geography, $4::double precision, $5::double precision),
        $6::double precision, $7::double precision
      ),
      now() - ($8 || ' seconds')::interval
    )
    ON CONFLICT (user_id) DO UPDATE SET
      geog = EXCLUDED.geog, geog_fuzzed = EXCLUDED.geog_fuzzed, updated_at = EXCLUDED.updated_at
    `,
    userId,
    ORIGIN_LAT,
    ORIGIN_LNG,
    dist,
    bearing,
    fuzzDist,
    fuzzBearing,
    String(stale ? 3 * 3600 : crypto.randomInt(0, 120)),
  );
}

async function putObject(key, body) {
  await s3.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: body,
      ContentType: 'image/jpeg',
    }),
  );
}

// ---------------------------------------------------------------------------
// clean
// ---------------------------------------------------------------------------
async function clean() {
  const users = await prisma.user.findMany({
    where: { phone: { startsWith: SEED_PHONE_PREFIX } },
    select: {
      id: true,
      mediaAssets: { select: { storageKey: true, blurredKey: true } },
    },
  });
  console.log(`Removing ${users.length} seed users…`);
  for (const u of users) {
    for (const a of u.mediaAssets) {
      for (const key of [a.storageKey, a.blurredKey].filter(Boolean)) {
        await s3
          .send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }))
          .catch(() => {});
      }
    }
  }
  const { count } = await prisma.user.deleteMany({
    where: { phone: { startsWith: SEED_PHONE_PREFIX } },
  });
  console.log(`Deleted ${count} users (profiles, media, locations cascade).`);
}

// ---------------------------------------------------------------------------
// seed
// ---------------------------------------------------------------------------
function genderFor(randomuserGender) {
  // ~12% of accounts pick a non-binary / unspecified identity; keep the photo.
  const r = Math.random();
  if (r < 0.06) return 'NON_BINARY';
  if (r < 0.12) return 'PREFER_NOT_TO_SAY';
  return randomuserGender === 'female' ? 'FEMALE' : 'MALE';
}

async function seed() {
  console.log(
    `Seeding ${COUNT} users within ${RADIUS} m of ${ORIGIN_LAT.toFixed(
      5,
    )},${ORIGIN_LNG.toFixed(5)} …`,
  );

  const people = await fetchPeople(COUNT);
  if (people.length === 0) throw new Error('randomuser.me returned nothing');

  for (let i = 0; i < people.length; i += 1) {
    const person = people[i];
    const displayName = `${person.name.first} ${person.name.last[0]}.`;
    const gender = genderFor(person.gender);
    const dob = new Date(person.dob.date);

    // Roughly realistic: most women/non-binary keep the lock, most others open
    // up — but leave a minority on each side so the Grid shows both states.
    const lockedByDefault = gender === 'FEMALE' || gender === 'NON_BINARY';
    const photosLocked = lockedByDefault
      ? Math.random() < 0.7
      : Math.random() < 0.15;

    const phone = `${SEED_PHONE_PREFIX}${String(i).padStart(2, '0')}`;

    let user;
    for (let attempt = 0; ; attempt += 1) {
      try {
        user = await prisma.user.create({
          data: {
            phone,
            publicShortId: shortId(),
            gender,
            dateOfBirth: dob,
            photosLocked,
            profile: {
              create: {
                displayName,
                bio: BIOS[i % BIOS.length],
                interests: sample(INTEREST_POOL, 3 + crypto.randomInt(0, 3)),
                lookingFor: sample(LOOKING_FOR, 1 + crypto.randomInt(0, 2)),
              },
            },
          },
        });
        break;
      } catch (e) {
        if (
          e.code === 'P2002' &&
          e.meta?.target?.includes('public_short_id') &&
          attempt < 5
        ) {
          continue;
        }
        if (e.code === 'P2002' && String(e.meta?.target).includes('phone')) {
          console.log(`  ${phone} exists — skipping`);
          user = null;
          break;
        }
        throw e;
      }
    }
    if (!user) continue;

    // one real portrait per user (kept simple; the detail view has a thumb strip
    // only when there are >1, which seed users don't need)
    let photoNote = 'no-photo';
    try {
      const { normal, blurred } = await downloadPortrait(person);
      const asset = await prisma.mediaAsset.create({
        data: {
          ownerId: user.id,
          kind: 'PROFILE_PHOTO',
          status: 'PENDING',
          storageKey: '',
          position: 0,
        },
      });
      const storageKey = `photos/${user.id}/${asset.id}.jpg`;
      const blurredKey = `photos/${user.id}/${asset.id}-blur.jpg`;
      await putObject(storageKey, normal.data);
      await putObject(blurredKey, blurred);
      await prisma.mediaAsset.update({
        where: { id: asset.id },
        data: {
          status: 'READY',
          storageKey,
          blurredKey,
          contentType: 'image/jpeg',
          bytes: normal.info.size,
          width: normal.info.width,
          height: normal.info.height,
          processedAt: new Date(),
        },
      });
      photoNote = '1 photo';
    } catch (e) {
      console.log(`    (portrait failed: ${e.message})`);
    }

    await placeLocation(user.id, 0.3);
    console.log(
      `  + ${displayName.padEnd(16)} ${gender.padEnd(18)} ${
        person.dob.age
      }  ${photosLocked ? 'locked' : 'open'}  ${photoNote}  @${user.publicShortId}`,
    );
  }
}

async function setAnchor() {
  const anchor = await prisma.user.findUnique({ where: { phone: ANCHOR } });
  if (!anchor) {
    console.log(`Anchor ${ANCHOR} not found — skipping.`);
    return;
  }
  await prisma.$executeRawUnsafe(
    `
    INSERT INTO user_locations (user_id, geog, geog_fuzzed, updated_at)
    VALUES (
      $1,
      ST_SetSRID(ST_MakePoint($3::double precision,$2::double precision),4326)::geography,
      ST_Project(ST_SetSRID(ST_MakePoint($3::double precision,$2::double precision),4326)::geography, 180::double precision, 1.2::double precision),
      now()
    )
    ON CONFLICT (user_id) DO UPDATE SET
      geog = EXCLUDED.geog, geog_fuzzed = EXCLUDED.geog_fuzzed, updated_at = now()
    `,
    anchor.id,
    ORIGIN_LAT,
    ORIGIN_LNG,
  );
  console.log(`Anchored ${ANCHOR} (@${anchor.publicShortId}) at the origin.`);
}

(async () => {
  try {
    if (CLEAN) {
      await clean();
    } else {
      await resolveOrigin();
      await seed();
      if (ANCHOR) await setAnchor();
    }
  } catch (e) {
    console.error(e);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
    s3.destroy();
  }
})();

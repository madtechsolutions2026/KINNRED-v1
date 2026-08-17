/**
 * Coarse distance reporting (CLAUDE.md §2.2).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  EXACT DISTANCE NEVER LEAVES THE SERVICE LAYER.
 *
 *  An exact distance alongside a fuzzed point hands the true position straight
 *  back: the offset is a constant vector, so `exactDistance` from a known
 *  origin is a circle whose radius has none of the fuzz in it. Two or three
 *  such circles intersect at a point. Bucketing is not cosmetic — it is what
 *  stops the fuzzing from being trivially undone.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * The radius FILTER is quantised to the same edges, and that is the part which
 * is easy to get wrong. If a client could pass an arbitrary radius, presence at
 * 1000m and absence at 900m brackets the true distance to 100m and the buckets
 * become decoration — a binary search over ~14 requests recovers the distance
 * to within a meter. So the only accepted radii are bucket edges, and the DTO
 * enforces it with `@IsIn(GRID_RADIUS_METERS)`.
 */

/**
 * Upper edges of each bucket, in meters. These are BOTH the reporting
 * boundaries and the complete set of permitted search radii — one array, so
 * the two cannot drift apart. Adding a radius here without adding the matching
 * bucket below would reopen the bracketing attack at the new edge.
 */
export const GRID_RADIUS_METERS = [1000, 3000, 10000, 50000] as const;

export type GridRadiusMeters = (typeof GRID_RADIUS_METERS)[number];

export const GRID_DEFAULT_RADIUS_METERS: GridRadiusMeters = 10000;

/**
 * Human-readable label per bucket. ASCII hyphens, not en dashes — this string
 * crosses a JSON boundary and gets rendered by clients we do not control.
 */
const BUCKET_LABELS: ReadonlyArray<{ below: number; label: string }> = [
  { below: 1000, label: '<1 km' },
  { below: 3000, label: '1-3 km' },
  { below: 10000, label: '3-10 km' },
  { below: 50000, label: '10-50 km' },
];

const BEYOND_LAST_BUCKET = '50+ km';

/**
 * The ONLY function permitted to turn a distance into something a client sees.
 *
 * Takes meters computed from the FUZZED point (that is the caller's
 * responsibility — there is no way to assert it here) and returns a label.
 * Note the return type: `string`, never a number. A caller cannot accidentally
 * do arithmetic on the result and reconstruct precision.
 */
export function distanceBucket(meters: number): string {
  for (const bucket of BUCKET_LABELS) {
    if (meters < bucket.below) return bucket.label;
  }
  return BEYOND_LAST_BUCKET;
}

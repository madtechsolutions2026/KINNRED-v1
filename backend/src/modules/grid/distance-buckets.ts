/**
 * Distance reporting for the Grid (CLAUDE.md §2.2, DECISIONS.md D-054 / D-062).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  EXACT DISTANCE NEVER LEAVES THE SERVICE LAYER.
 *
 *  The distance computed in `grid.service.ts` is the distance to the target's
 *  *fuzzed* point — already displaced 100–300 m by a deterministic, per-user
 *  offset. Even so, handing back that number verbatim lets an attacker who
 *  spoofs several search origins trilaterate the fuzzed point to the metre.
 *  So the number is rounded before it is returned, and it is returned as a
 *  STRING so nothing downstream can do arithmetic on it.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `distanceLabel` rounds to the nearest kilometre, floored at 1 km:
 *
 *   - **Sub-kilometre distances are never distinguished.** 120 m and 900 m
 *     both read "1 km". The position of someone within walking distance — the
 *     highest-stakes case — cannot be read off the label at all.
 *   - Beyond that, 1 km granularity sits at the 100–300 m fuzz's noise floor:
 *     the label moves in steps several times larger than the displacement it
 *     would need to resolve, so boundary-finding recovers the fuzzed point to
 *     ~1 km at best, never the exact point (the deterministic offset stays).
 *
 * The search RADIUS is still constrained to the four values below, and that
 * constraint is still load-bearing (D-054): a free-form radius lets a caller
 * compare presence at 1000 m vs 900 m and binary-search the true distance in
 * ~14 requests, which would defeat the rounding entirely. `@IsIn(GRID_RADIUS_METERS)`
 * on the DTO is what closes that.
 */

/**
 * The complete set of permitted search radii, in metres. A radius that is not
 * in this list is rejected by the DTO — see the header comment for why an
 * arbitrary radius reopens the bracketing attack.
 */
export const GRID_RADIUS_METERS = [1000, 3000, 10000, 50000] as const;

export type GridRadiusMeters = (typeof GRID_RADIUS_METERS)[number];

export const GRID_DEFAULT_RADIUS_METERS: GridRadiusMeters = 10000;

/**
 * The ONLY function permitted to turn a distance into something a client sees.
 *
 * Takes metres computed from the FUZZED point (the caller's responsibility —
 * there is no way to assert it here) and returns a rounded label like `"2 km"`
 * or `"21 km"`. Never a number: a caller cannot accidentally do arithmetic on
 * the result and reconstruct precision the rounding removed.
 */
export function distanceLabel(meters: number): string {
  const km = Math.max(1, Math.round(meters / 1000));
  return `${km} km`;
}

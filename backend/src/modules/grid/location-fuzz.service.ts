import { Inject, Injectable } from '@nestjs/common';
import { createHmac } from 'node:crypto';
import { APP_CONFIG } from '../../config/config.module';
import type { AppConfig } from '../../config/env.schema';

/** A displacement, in the form `ST_Project` takes it. */
export interface FuzzOffset {
  /** How far to move the point, in meters. */
  distanceMeters: number;
  /** Which way, in RADIANS clockwise from north — PostGIS's convention. */
  bearingRadians: number;
}

/**
 * The per-user location offset (CLAUDE.md §2.2).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  THE OFFSET IS DETERMINISTIC AND MUST STAY THAT WAY.
 *
 *  Random per-request jitter is WEAKER than no jitter at all. An attacker who
 *  polls one profile N times and averages the samples sees the error collapse
 *  by √N — 200m of noise over 100 polls recovers the true position to about
 *  20m, and polling a discovery feed costs nothing. A fixed offset cannot be
 *  averaged away: every sample is the same number, so N polls yield exactly as
 *  much information as one.
 *
 *  There is therefore no source of randomness in this file. Do not add one,
 *  and do not "add a little jitter on top" — that reintroduces the whole
 *  attack at whatever magnitude the jitter has.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * The offset is applied ONCE, at write time, into `user_locations.geog_fuzzed`
 * (see GridService.updateLocation). Nothing recomputes it on read. That is
 * deliberate: a stored fuzzed point is the only form that can carry the GIST
 * index the proximity search needs, and it makes "fuzz before computing
 * anything observable" a property of the schema rather than a rule every future
 * query has to remember.
 *
 * What this does NOT protect against, stated plainly: an attacker who spoofs
 * their own position, searches from many origins and trilaterates a target
 * recovers the FUZZED point — bounded to within a bucket edge. They never
 * recover the exact one, because the exact one is not an input to any query
 * they can observe. That is the whole design.
 */
@Injectable()
export class LocationFuzzService {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  /**
   * The displacement for one user. Same input, same output, forever — or until
   * `GRID_LOCATION_SALT` is rotated, which re-fuzzes each user on their next
   * location write rather than retroactively.
   *
   * HMAC rather than a plain hash because the salt is a SECRET, not a
   * namespace: `sha256(salt || userId)` is length-extendable and, more to the
   * point, an attacker who ever learns the salt can recompute every user's
   * offset and subtract it. HMAC does not fix that second problem — nothing
   * does — but it is the correct primitive for keyed derivation and costs
   * nothing over the alternative.
   *
   * The two 32-bit words are read from disjoint slices of one digest, so
   * distance and bearing are independent. Distance is uniform over
   * [min, max] in RADIUS, which slightly over-weights the inner ring by area;
   * that is irrelevant to the security property (which is determinism and
   * magnitude, not distributional shape) and keeps the bound easy to state.
   */
  offsetFor(userId: string): FuzzOffset {
    const digest = createHmac('sha256', this.config.GRID_LOCATION_SALT)
      .update(userId)
      .digest();

    // Divide by 2^32 rather than 2^32-1: yields [0, 1), so the max bound is
    // approached but the bearing never wraps to a duplicate of 0.
    const distanceFraction = digest.readUInt32BE(0) / 2 ** 32;
    const bearingFraction = digest.readUInt32BE(4) / 2 ** 32;

    const min = this.config.GRID_FUZZ_MIN_METERS;
    const max = this.config.GRID_FUZZ_MAX_METERS;

    return {
      distanceMeters: min + distanceFraction * (max - min),
      bearingRadians: bearingFraction * 2 * Math.PI,
    };
  }
}

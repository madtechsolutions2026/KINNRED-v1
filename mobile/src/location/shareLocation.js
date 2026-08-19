import * as Location from 'expo-location';
import { grid } from '../api/endpoints';

/**
 * Acquires the device position and reports it to the Grid.
 *
 * One place owns the permission prompt and the coordinate handoff, so no
 * screen ever touches `expo-location` directly. Every caller gets the same
 * outcome vocabulary below, which is what lets the UI say something specific
 * instead of "couldn't load".
 *
 * WHAT THIS DELIBERATELY DOES NOT DO:
 *
 * - No background tracking, no `watchPositionAsync`. The app reports where you
 *   are when you look at the Grid, and at no other time. Continuous tracking
 *   would be a materially different privacy posture and needs its own
 *   decision, not a quiet import.
 * - No local caching or client-side debounce. The server already drops writes
 *   under ~100m / ~60s (CLAUDE.md §4) and answers `persisted: false`. A second
 *   debounce here would only add a way for the two to disagree.
 * - No storing of coordinates anywhere on the device. They go straight to the
 *   API and are dropped.
 *
 * Accuracy is `Balanced`, not `Highest`: it is materially faster and cheaper on
 * battery, and the Grid cannot use the extra precision anyway — positions are
 * fuzzed by 100-300m server-side and distances are returned as coarse buckets
 * (CLAUDE.md §2.2). Asking the GPS for meters to then discard them is waste.
 */

/** @typedef {'shared'|'denied'|'unavailable'|'failed'} ShareOutcome */

export const OUTCOME = {
  /** Position acquired and accepted by the API. */
  SHARED: 'shared',
  /** The user said no. Recoverable only from OS settings. */
  DENIED: 'denied',
  /** No location hardware/service, or the browser refuses to provide it. */
  UNAVAILABLE: 'unavailable',
  /** Acquired, but the report failed — network, auth, validation. */
  FAILED: 'failed',
};

/** Human-readable copy per outcome, so screens don't each invent their own. */
export const OUTCOME_MESSAGE = {
  [OUTCOME.DENIED]:
    'Kinnred needs your location to show who is nearby. Enable location access in your settings, then try again.',
  [OUTCOME.UNAVAILABLE]:
    "This device can't provide a location. The Grid needs one to find people near you.",
  [OUTCOME.FAILED]: "Couldn't share your location. Check your connection and try again.",
};

/**
 * @returns {Promise<{ outcome: ShareOutcome, error?: Error, persisted?: boolean }>}
 *
 * Never throws. The caller's job is to render an outcome, and an exception
 * would make the "denied" path — an ordinary user choice, not an error —
 * indistinguishable from a real failure.
 */
export async function shareCurrentLocation() {
  let permission;
  try {
    permission = await Location.requestForegroundPermissionsAsync();
  } catch (error) {
    // Throwing here means the platform cannot even ask: no geolocation in
    // this browser, or an insecure origin. Browsers gate the API on HTTPS,
    // with localhost as the exemption — so a phone pointed at a LAN IP over
    // plain http gets nothing, which is easy to mistake for a denied prompt.
    return { outcome: OUTCOME.UNAVAILABLE, error };
  }

  if (!permission.granted) {
    return { outcome: OUTCOME.DENIED };
  }

  let position;
  try {
    position = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Balanced,
    });
  } catch (error) {
    return { outcome: OUTCOME.UNAVAILABLE, error };
  }

  try {
    const result = await grid.updateLocation(
      position.coords.latitude,
      position.coords.longitude,
    );
    // `persisted: false` is the debounce, and still a success — see
    // grid.updateLocation. Do not branch on it.
    return { outcome: OUTCOME.SHARED, persisted: result?.persisted ?? true };
  } catch (error) {
    return { outcome: OUTCOME.FAILED, error };
  }
}

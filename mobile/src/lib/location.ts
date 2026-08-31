import * as Location from 'expo-location';

export type LocationOutcome =
  | { ok: true; lat: number; lng: number }
  | { ok: false; reason: 'denied' | 'unavailable' | 'error'; message: string };

/**
 * Ask for foreground location permission and read a single coarse fix.
 *
 * `Accuracy.Low` on purpose: the Grid only needs neighbourhood-level position,
 * the server fuzzes it further, and low accuracy is faster and less of a
 * battery / privacy cost.
 */
export async function getCurrentLocation(): Promise<LocationOutcome> {
  try {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') {
      return {
        ok: false,
        reason: 'denied',
        message:
          'Location permission is off. Enable it in Settings to see people near you.',
      };
    }

    const services = await Location.hasServicesEnabledAsync();
    if (!services) {
      return {
        ok: false,
        reason: 'unavailable',
        message: 'Location services are turned off on this device.',
      };
    }

    const pos = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Low,
    });
    return { ok: true, lat: pos.coords.latitude, lng: pos.coords.longitude };
  } catch (e) {
    return {
      ok: false,
      reason: 'error',
      message: e instanceof Error ? e.message : 'Couldn’t get your location.',
    };
  }
}

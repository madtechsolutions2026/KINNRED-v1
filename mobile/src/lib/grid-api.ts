import { authedFetch } from './api';
import type { Gender } from './auth-api';
import type { LookingFor, Photo } from './users-api';

/**
 * Search radii. These are the ONLY accepted values — the backend rejects
 * anything else, because a free-form radius would let a caller binary-search a
 * user's true distance (CLAUDE.md §2.2, distance-buckets.ts).
 */
export const GRID_RADII = [1000, 3000, 10000, 50000] as const;
export type GridRadius = (typeof GRID_RADII)[number];
export const DEFAULT_RADIUS: GridRadius = 10000;

export const RADIUS_LABELS: Record<GridRadius, string> = {
  1000: 'Within 1 km',
  3000: 'Within 3 km',
  10000: 'Within 10 km',
  50000: 'Within 50 km',
};

export interface NearbyPerson {
  publicShortId: string;
  displayName: string | null;
  gender: Gender;
  age: number;
  isVerified: boolean;
  interests: string[];
  lookingFor: LookingFor[];
  /** Rounded km label from the server, e.g. "2 km", "21 km". Never exact. */
  distance: string;
  online: boolean;
  photo: Photo | null;
  photosBlurred: boolean;
}

export interface NearbyResult {
  results: NearbyPerson[];
  nextCursor: string | null;
}

export interface NearbyFilters {
  radiusMeters?: GridRadius;
  minAge?: number;
  maxAge?: number;
  genders?: Gender[];
  lookingFor?: LookingFor[];
  onlineOnly?: boolean;
}

export function updateLocation(lat: number, lng: number) {
  return authedFetch<{ persisted: boolean; reason: string }>('/grid/location', {
    method: 'PUT',
    body: { lat, lng },
  });
}

export function deleteLocation() {
  return authedFetch<{ deleted: true }>('/grid/location', { method: 'DELETE' });
}

export function getNearby(
  filters: NearbyFilters,
  opts: { cursor?: string; limit?: number } = {},
): Promise<NearbyResult> {
  const qs = new URLSearchParams();
  if (filters.radiusMeters) qs.set('radiusMeters', String(filters.radiusMeters));
  if (filters.minAge != null) qs.set('minAge', String(filters.minAge));
  if (filters.maxAge != null) qs.set('maxAge', String(filters.maxAge));
  for (const g of filters.genders ?? []) qs.append('genders', g);
  for (const l of filters.lookingFor ?? []) qs.append('lookingFor', l);
  if (filters.onlineOnly) qs.set('onlineOnly', 'true');
  if (opts.cursor) qs.set('cursor', opts.cursor);
  if (opts.limit) qs.set('limit', String(opts.limit));

  const q = qs.toString();
  return authedFetch<NearbyResult>(`/grid/nearby${q ? `?${q}` : ''}`);
}

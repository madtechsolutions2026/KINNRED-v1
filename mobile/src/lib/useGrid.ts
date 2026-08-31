import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from './api';
import { getCurrentLocation } from './location';
import {
  getNearby,
  updateLocation,
  DEFAULT_RADIUS,
  type NearbyFilters,
  type NearbyPerson,
} from './grid-api';

/**
 * Dev-only fallback location for testing on web / simulator where real
 * geolocation isn't available. Point this at wherever `seed-grid.js` was last
 * run (`--around <you>` uses your own device location, so on a real device you
 * won't need this button at all).
 */
export const DEMO_LOCATION = { lat: 17.5562, lng: 78.4413, label: 'Hyderabad' };

type Phase = 'locating' | 'need-location' | 'ready' | 'error';

const PAGE_SIZE = 24;

export interface GridState {
  phase: Phase;
  message: string | null;
  people: NearbyPerson[];
  filters: NearbyFilters;
  refreshing: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  activeFilterCount: number;
}

export function useGrid() {
  const [phase, setPhase] = useState<Phase>('locating');
  const [message, setMessage] = useState<string | null>(null);
  const [people, setPeople] = useState<NearbyPerson[]>([]);
  const [filters, setFiltersState] = useState<NearbyFilters>({
    radiusMeters: DEFAULT_RADIUS,
  });
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const cursorRef = useRef<string | null>(null);
  const [hasMore, setHasMore] = useState(false);

  const fetchFirstPage = useCallback(async (f: NearbyFilters) => {
    try {
      const res = await getNearby(f, { limit: PAGE_SIZE });
      setPeople(res.results);
      cursorRef.current = res.nextCursor;
      setHasMore(!!res.nextCursor);
      setPhase('ready');
      setMessage(null);
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) {
        setPhase('need-location');
        setMessage('Share your location to see people near you.');
      } else {
        setPhase('error');
        setMessage(
          e instanceof ApiError ? e.message : 'Couldn’t load the Grid.',
        );
      }
    }
  }, []);

  /** Push a position to the server, then load page one. */
  const syncAndLoad = useCallback(
    async (lat: number, lng: number, f: NearbyFilters) => {
      try {
        await updateLocation(lat, lng);
      } catch (e) {
        setPhase('error');
        setMessage(
          e instanceof ApiError ? e.message : 'Couldn’t update your location.',
        );
        return;
      }
      await fetchFirstPage(f);
    },
    [fetchFirstPage],
  );

  const locateAndLoad = useCallback(
    async (f: NearbyFilters) => {
      setPhase('locating');
      const loc = await getCurrentLocation();
      if (!loc.ok) {
        setPhase('need-location');
        setMessage(loc.message);
        return;
      }
      await syncAndLoad(loc.lat, loc.lng, f);
    },
    [syncAndLoad],
  );

  useEffect(() => {
    void locateAndLoad(filters);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setFilters = useCallback(
    (next: NearbyFilters) => {
      setFiltersState(next);
      setPhase('locating');
      void fetchFirstPage(next);
    },
    [fetchFirstPage],
  );

  const refresh = useCallback(async () => {
    setRefreshing(true);
    await locateAndLoad(filters);
    setRefreshing(false);
  }, [filters, locateAndLoad]);

  const loadMore = useCallback(async () => {
    if (loadingMore || !cursorRef.current) return;
    setLoadingMore(true);
    try {
      const res = await getNearby(filters, {
        cursor: cursorRef.current,
        limit: PAGE_SIZE,
      });
      setPeople((cur) => {
        const seen = new Set(cur.map((p) => p.publicShortId));
        return [...cur, ...res.results.filter((p) => !seen.has(p.publicShortId))];
      });
      cursorRef.current = res.nextCursor;
      setHasMore(!!res.nextCursor);
    } catch {
      setHasMore(false);
    } finally {
      setLoadingMore(false);
    }
  }, [filters, loadingMore]);

  const useDemoLocation = useCallback(() => {
    setPhase('locating');
    void syncAndLoad(DEMO_LOCATION.lat, DEMO_LOCATION.lng, filters);
  }, [filters, syncAndLoad]);

  const retry = useCallback(() => {
    void locateAndLoad(filters);
  }, [filters, locateAndLoad]);

  const activeFilterCount =
    (filters.minAge != null || filters.maxAge != null ? 1 : 0) +
    (filters.genders?.length ? 1 : 0) +
    (filters.lookingFor?.length ? 1 : 0) +
    (filters.onlineOnly ? 1 : 0) +
    (filters.radiusMeters && filters.radiusMeters !== DEFAULT_RADIUS ? 1 : 0);

  return {
    phase,
    message,
    people,
    filters,
    refreshing,
    loadingMore,
    hasMore,
    activeFilterCount,
    setFilters,
    refresh,
    loadMore,
    useDemoLocation,
    retry,
  };
}

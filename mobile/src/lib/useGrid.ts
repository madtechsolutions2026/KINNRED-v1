import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError } from "./api";
import { getCurrentLocation } from "./location";
import {
  getNearby,
  updateLocation,
  type NearbyFilters,
  type NearbyPerson,
} from "./grid-api";

/**
 * Dev-only fallback location for testing on web / simulator where real
 * geolocation isn't available. Point this at wherever `seed-grid.js` was last
 * run (`--around <you>` uses your own device location, so on a real device you
 * won't need this button at all).
 */
export const DEMO_LOCATION = { lat: 17.5562, lng: 78.4413, label: "Hyderabad" };

type Phase = "locating" | "need-location" | "ready" | "error";

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
  const [phase, setPhase] = useState<Phase>("locating");
  const [message, setMessage] = useState<string | null>(null);
  const [people, setPeople] = useState<NearbyPerson[]>([]);
  const [filters, setFiltersState] = useState<NearbyFilters>({});
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const cursorRef = useRef<string | null>(null);
  const requestIdRef = useRef(0);
  const [hasMore, setHasMore] = useState(false);

  const fetchFirstPage = useCallback(
    async (f: NearbyFilters, requestId = requestIdRef.current) => {
      try {
        const res = await getNearby(f, { limit: PAGE_SIZE });
        if (requestId !== requestIdRef.current) return;
        setPeople(res.results);
        cursorRef.current = res.nextCursor;
        setHasMore(!!res.nextCursor);
        setPhase("ready");
        setMessage(null);
      } catch (e) {
        if (requestId !== requestIdRef.current) return;
        if (e instanceof ApiError && e.status === 404) {
          setPhase("need-location");
          setMessage("Share your location to see people near you.");
        } else {
          setPhase("error");
          setMessage(
            e instanceof ApiError ? e.message : "Couldn’t load the Grid.",
          );
        }
      }
    },
    [],
  );

  /** Push a position to the server, then load page one. */
  const syncAndLoad = useCallback(
    async (
      lat: number,
      lng: number,
      f: NearbyFilters,
      requestId = requestIdRef.current,
      keepResults = false,
    ) => {
      try {
        await updateLocation(lat, lng);
      } catch (e) {
        if (requestId !== requestIdRef.current || keepResults) return;
        setPhase("error");
        setMessage(
          e instanceof ApiError ? e.message : "Couldn’t update your location.",
        );
        return;
      }
      if (requestId === requestIdRef.current && !keepResults)
        await fetchFirstPage(f, requestId);
    },
    [fetchFirstPage],
  );

  const locateAndLoad = useCallback(
    async (f: NearbyFilters) => {
      const requestId = ++requestIdRef.current;
      setPhase("locating");
      if (f.radiusMeters === undefined) await fetchFirstPage(f, requestId);
      const loc = await getCurrentLocation();
      if (requestId !== requestIdRef.current) return;
      if (!loc.ok) {
        if (f.radiusMeters === undefined) return;
        setPhase("need-location");
        setMessage(loc.message);
        return;
      }
      await syncAndLoad(loc.lat, loc.lng, f, requestId, f.radiusMeters === undefined);
    },
    [syncAndLoad, fetchFirstPage],
  );

  useEffect(() => {
    void locateAndLoad(filters);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setFilters = useCallback(
    (next: NearbyFilters) => {
      const requestId = ++requestIdRef.current;
      cursorRef.current = null;
      setHasMore(false);
      setFiltersState(next);
      setPhase("locating");
      void fetchFirstPage(next, requestId);
    },
    [fetchFirstPage],
  );

  const refresh = useCallback(async () => {
    setRefreshing(true);
    await locateAndLoad(filters);
    setRefreshing(false);
  }, [filters, locateAndLoad]);

  const loadMore = useCallback(async () => {
    if (phase !== "ready" || loadingMore || !cursorRef.current) return;
    const requestId = requestIdRef.current;
    setLoadingMore(true);
    try {
      const res = await getNearby(filters, {
        cursor: cursorRef.current,
        limit: PAGE_SIZE,
      });
      if (requestId !== requestIdRef.current) return;
      setPeople((cur) => {
        const seen = new Set(cur.map((p) => p.publicShortId));
        return [
          ...cur,
          ...res.results.filter((p) => !seen.has(p.publicShortId)),
        ];
      });
      cursorRef.current = res.nextCursor;
      setHasMore(!!res.nextCursor);
    } catch {
      setHasMore(false);
    } finally {
      setLoadingMore(false);
    }
  }, [filters, loadingMore, phase]);

  const useDemoLocation = useCallback(() => {
    setPhase("locating");
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
    (filters.radiusMeters !== undefined ? 1 : 0);

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

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { ApiError } from './api';
import { useAuth } from './auth';
import { onRealtime } from './realtime';
import { listMyCircles, type MyCircle } from './circles-api';

interface CirclesContextValue {
  mine: MyCircle[];
  loading: boolean;
  error: string | null;
  /** circle shortIds with unseen activity since this session started. */
  unread: Set<string>;
  badgeCount: number;
  reload: () => Promise<void>;
  markSeen: (shortId: string) => void;
}

const CirclesContext = createContext<CirclesContextValue | null>(null);

export function CirclesProvider({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  const [mine, setMine] = useState<MyCircle[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [unread, setUnread] = useState<Set<string>>(new Set());
  const inFlight = useRef<Promise<void> | null>(null);

  const reload = useCallback(async () => {
    if (inFlight.current) return inFlight.current;
    const run = (async () => {
      try {
        setMine(await listMyCircles());
        setError(null);
      } catch (e) {
        setError(
          e instanceof ApiError ? e.message : 'Couldn’t load your circles.',
        );
      } finally {
        setLoading(false);
        inFlight.current = null;
      }
    })();
    inFlight.current = run;
    return run;
  }, []);

  useEffect(() => {
    if (status === 'signedIn') {
      setLoading(true);
      void reload();
    } else if (status === 'signedOut') {
      setMine([]);
      setUnread(new Set());
      setLoading(false);
    }
  }, [status, reload]);

  const markUnread = useCallback((shortId: string) => {
    setUnread((cur) => {
      if (cur.has(shortId)) return cur;
      const next = new Set(cur);
      next.add(shortId);
      return next;
    });
  }, []);

  const markSeen = useCallback((shortId: string) => {
    setUnread((cur) => {
      if (!cur.has(shortId)) return cur;
      const next = new Set(cur);
      next.delete(shortId);
      return next;
    });
  }, []);

  useEffect(() => {
    if (status !== 'signedIn') return;
    const offs = [
      onRealtime('circle:post:new', (e) => markUnread(e.circle.publicShortId)),
      onRealtime('circle:post:reminder', (e) =>
        markUnread(e.circle.publicShortId),
      ),
      onRealtime('circle:message:new', (e) =>
        markUnread(e.circle.publicShortId),
      ),
      onRealtime('circle:chat:disabled', () => void reload()),
    ];
    return () => offs.forEach((off) => off());
  }, [status, markUnread, reload]);

  const value = useMemo<CirclesContextValue>(
    () => ({
      mine,
      loading,
      error,
      unread,
      badgeCount: unread.size,
      reload,
      markSeen,
    }),
    [mine, loading, error, unread, reload, markSeen],
  );

  return (
    <CirclesContext.Provider value={value}>{children}</CirclesContext.Provider>
  );
}

export function useCircles(): CirclesContextValue {
  const ctx = useContext(CirclesContext);
  if (!ctx) throw new Error('useCircles must be used within <CirclesProvider>');
  return ctx;
}

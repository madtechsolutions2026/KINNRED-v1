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
import {
  acceptPing,
  listChats,
  listRequests,
  listSent,
  rejectPing,
  withdrawPing,
  type ChatSummary,
  type PingRequest,
  type SentPing,
} from './pings-api';

interface PingsContextValue {
  requests: PingRequest[];
  sent: SentPing[];
  chats: ChatSummary[];
  loading: boolean;
  error: string | null;
  /** Pending inbound requests + chats with an unread inbound message. */
  badgeCount: number;
  reload: () => Promise<void>;
  accept: (pingId: string) => Promise<void>;
  reject: (pingId: string) => Promise<void>;
  withdraw: (pingId: string) => Promise<void>;
  /** Optimistically clear a chat's unread flag (thread screen calls this). */
  markChatRead: (pingId: string) => void;
}

const PingsContext = createContext<PingsContextValue | null>(null);

export function PingsProvider({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  const [requests, setRequests] = useState<PingRequest[]>([]);
  const [sent, setSent] = useState<SentPing[]>([]);
  const [chats, setChats] = useState<ChatSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reloadTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlight = useRef<Promise<void> | null>(null);

  const reload = useCallback(async () => {
    // Dedupe concurrent callers (mount effect + focus effect + socket events).
    if (inFlight.current) return inFlight.current;
    const run = (async () => {
      try {
        const [r, s, c] = await Promise.all([
          listRequests(),
          listSent(),
          listChats(),
        ]);
        setRequests(r);
        setSent(s);
        setChats(c);
        setError(null);
      } catch (e) {
        setError(
          e instanceof ApiError ? e.message : 'Couldn’t load your pings.',
        );
      } finally {
        setLoading(false);
        inFlight.current = null;
      }
    })();
    inFlight.current = run;
    return run;
  }, []);

  /** Coalesce a burst of socket events into one refetch. */
  const scheduleReload = useCallback(() => {
    if (reloadTimer.current) clearTimeout(reloadTimer.current);
    reloadTimer.current = setTimeout(() => void reload(), 250);
  }, [reload]);

  useEffect(() => {
    if (status === 'signedIn') {
      setLoading(true);
      void reload();
    } else if (status === 'signedOut') {
      setRequests([]);
      setSent([]);
      setChats([]);
      setLoading(false);
    }
  }, [status, reload]);

  // Any inbox-relevant realtime event → refetch the folders.
  useEffect(() => {
    if (status !== 'signedIn') return;
    const offs = [
      onRealtime('ping:received', scheduleReload),
      onRealtime('ping:accepted', scheduleReload),
      onRealtime('ping:rejected', scheduleReload),
      onRealtime('ping:withdrawn', scheduleReload),
      onRealtime('message:new', scheduleReload),
      onRealtime('message:read', scheduleReload),
    ];
    return () => offs.forEach((off) => off());
  }, [status, scheduleReload]);

  const accept = useCallback(
    async (pingId: string) => {
      setRequests((cur) => cur.filter((r) => r.pingId !== pingId));
      try {
        await acceptPing(pingId);
      } finally {
        await reload();
      }
    },
    [reload],
  );

  const reject = useCallback(
    async (pingId: string) => {
      setRequests((cur) => cur.filter((r) => r.pingId !== pingId));
      try {
        await rejectPing(pingId);
      } finally {
        await reload();
      }
    },
    [reload],
  );

  const withdraw = useCallback(
    async (pingId: string) => {
      setSent((cur) => cur.filter((s) => s.pingId !== pingId));
      try {
        await withdrawPing(pingId);
      } finally {
        await reload();
      }
    },
    [reload],
  );

  const markChatRead = useCallback((pingId: string) => {
    setChats((cur) =>
      cur.map((c) =>
        c.pingId === pingId && c.lastMessage
          ? { ...c, lastMessage: { ...c.lastMessage, read: true } }
          : c,
      ),
    );
  }, []);

  const badgeCount = useMemo(() => {
    const unreadChats = chats.filter(
      (c) => c.lastMessage && !c.lastMessage.sentByMe && !c.lastMessage.read,
    ).length;
    return requests.length + unreadChats;
  }, [requests, chats]);

  const value = useMemo<PingsContextValue>(
    () => ({
      requests,
      sent,
      chats,
      loading,
      error,
      badgeCount,
      reload,
      accept,
      reject,
      withdraw,
      markChatRead,
    }),
    [requests, sent, chats, loading, error, badgeCount, reload, accept, reject, withdraw, markChatRead],
  );

  return <PingsContext.Provider value={value}>{children}</PingsContext.Provider>;
}

export function usePings(): PingsContextValue {
  const ctx = useContext(PingsContext);
  if (!ctx) throw new Error('usePings must be used within <PingsProvider>');
  return ctx;
}

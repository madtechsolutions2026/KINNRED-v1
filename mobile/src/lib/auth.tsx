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
import { configureAuthClient, setAuthTokens } from './api';
import { connectRealtime, disconnectRealtime } from './realtime';
import {
  clearSession,
  loadSession,
  saveSession,
  type StoredSession,
} from './session';

type AuthStatus = 'loading' | 'signedOut' | 'signedIn';

interface AuthContextValue {
  status: AuthStatus;
  session: StoredSession | null;
  signIn: (session: StoredSession) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [session, setSession] = useState<StoredSession | null>(null);
  const sessionRef = useRef<StoredSession | null>(null);
  sessionRef.current = session;

  const signOut = useCallback(async () => {
    await clearSession();
    setAuthTokens(null);
    disconnectRealtime();
    setSession(null);
    setStatus('signedOut');
  }, []);

  // Keep the API client's token holder in sync, and give it callbacks for
  // rotation (persist the new pair) and unrecoverable failure (sign out).
  useEffect(() => {
    configureAuthClient({
      tokens: session
        ? {
            accessToken: session.accessToken,
            refreshToken: session.refreshToken,
          }
        : null,
      onRefreshed: (t) => {
        const base = sessionRef.current;
        if (!base) return;
        const next: StoredSession = { ...base, ...t };
        setSession(next);
        void saveSession(next);
      },
      onLost: () => {
        void signOut();
      },
    });
  }, [session, signOut]);

  // Realtime connection follows the access token. A refresh rotates the token,
  // which re-runs this and re-handshakes the socket with the fresh one. No
  // cleanup: the socket is a lifetime singleton and only signOut tears it down.
  useEffect(() => {
    if (session?.accessToken) connectRealtime(session.accessToken);
  }, [session?.accessToken]);

  useEffect(() => {
    let active = true;
    void loadSession().then((s) => {
      if (!active) return;
      // Seed the API client's token holder BEFORE flipping status to
      // signedIn, so the first authed request out of any screen has a token.
      if (s) {
        setAuthTokens({
          accessToken: s.accessToken,
          refreshToken: s.refreshToken,
        });
      }
      setSession(s);
      setStatus(s ? 'signedIn' : 'signedOut');
    });
    return () => {
      active = false;
    };
  }, []);

  const signIn = useCallback(async (next: StoredSession) => {
    await saveSession(next);
    setAuthTokens({
      accessToken: next.accessToken,
      refreshToken: next.refreshToken,
    });
    setSession(next);
    setStatus('signedIn');
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ status, session, signIn, signOut }),
    [status, session, signIn, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within <AuthProvider>');
  return ctx;
}

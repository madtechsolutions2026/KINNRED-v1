import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import { auth } from '../api/endpoints';
import { onSessionExpired } from '../api/client';
import { clearTokens, getTokens } from '../api/storage';

const SessionContext = createContext(null);

/**
 * Session state for the whole app.
 *
 * `status` is one of:
 *   'loading'  — restoring tokens on cold start
 *   'signedIn' — a valid access token resolved to a user
 *   'signedOut'— no token, or the refresh chain failed
 *   'demo'     — the API is unreachable; screens render prototype fixtures
 *
 * 'demo' exists so the ported UI stays reviewable when the backend is not
 * running. It is explicitly NOT a logged-in state: it never carries a token,
 * and every screen surfaces a visible "Demo data" banner so the mode can
 * never be mistaken for real data.
 */
export function SessionProvider({ children }) {
  const [status, setStatus] = useState('loading');
  const [user, setUser] = useState(null);
  const [error, setError] = useState(null);

  const bootstrap = useCallback(async () => {
    // `?demo=1` jumps straight into fixture mode. Web-only and read from the
    // URL rather than persisted, so it cannot leak into a real session — it
    // exists so the ported screens can be reviewed without a running API.
    if (typeof window !== 'undefined' && window.location?.search?.includes('demo=1')) {
      setStatus('demo');
      return;
    }

    const { access, refresh } = await getTokens();
    if (!access && !refresh) {
      setStatus('signedOut');
      return;
    }
    try {
      const me = await auth.me();
      setUser(me);
      setStatus('signedIn');
    } catch (e) {
      if (e.isNetwork) {
        // Server down — keep the tokens, drop into demo so the UI is usable.
        setError(e.message);
        setStatus('demo');
      } else {
        await clearTokens();
        setStatus('signedOut');
      }
    }
  }, []);

  useEffect(() => {
    bootstrap();
  }, [bootstrap]);

  // A revoked/expired refresh family forces everyone back to the auth stack.
  useEffect(
    () =>
      onSessionExpired(() => {
        setUser(null);
        setStatus('signedOut');
      }),
    [],
  );

  const signOut = useCallback(async () => {
    const { refresh } = await getTokens();
    await auth.logout(refresh);
    setUser(null);
    setStatus('signedOut');
  }, []);

  const value = useMemo(
    () => ({
      status,
      user,
      error,
      isDemo: status === 'demo',
      signedIn: status === 'signedIn',
      setUser,
      refresh: bootstrap,
      signOut,
      enterDemo: () => setStatus('demo'),
      exitDemo: () => setStatus('signedOut'),
    }),
    [status, user, error, bootstrap, signOut],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession must be used inside <SessionProvider>');
  return ctx;
}

export default SessionContext;

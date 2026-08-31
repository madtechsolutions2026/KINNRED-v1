import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

/**
 * Persisted session. Kept deliberately small — the access token is short-lived
 * (15m, see backend JWT_ACCESS_TTL) and the refresh token is the real
 * credential, so both must survive an app restart.
 */
export interface StoredSession {
  accessToken: string;
  refreshToken: string;
  userId: string;
}

const KEY = 'kinnred.session.v1';

/**
 * SecureStore is native-only. On web it throws, so fall back to localStorage —
 * acceptable for the dev web target we use to iterate on screens; a real web
 * client would need a different strategy.
 */
const webStore = {
  getItem: (k: string) =>
    Promise.resolve(
      typeof localStorage !== 'undefined' ? localStorage.getItem(k) : null,
    ),
  setItem: (k: string, v: string) => {
    if (typeof localStorage !== 'undefined') localStorage.setItem(k, v);
    return Promise.resolve();
  },
  removeItem: (k: string) => {
    if (typeof localStorage !== 'undefined') localStorage.removeItem(k);
    return Promise.resolve();
  },
};

const store =
  Platform.OS === 'web'
    ? webStore
    : {
        getItem: (k: string) => SecureStore.getItemAsync(k),
        setItem: (k: string, v: string) => SecureStore.setItemAsync(k, v),
        removeItem: (k: string) => SecureStore.deleteItemAsync(k),
      };

export async function loadSession(): Promise<StoredSession | null> {
  try {
    const raw = await store.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredSession;
    if (!parsed.accessToken || !parsed.refreshToken) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function saveSession(s: StoredSession): Promise<void> {
  await store.setItem(KEY, JSON.stringify(s));
}

export async function clearSession(): Promise<void> {
  await store.removeItem(KEY);
}

import { Platform } from 'react-native';

/**
 * Token storage that picks the right backing store per platform.
 *
 * Web  -> localStorage. expo-secure-store has no web implementation; calling
 *         it there throws at runtime rather than degrading.
 * Native -> expo-secure-store (Keychain / EncryptedSharedPreferences).
 *
 * The module is imported lazily so a web bundle never pulls the native module
 * in, and every method is async so callers have one shape to code against.
 */

const isWeb = Platform.OS === 'web';

let SecureStore = null;
if (!isWeb) {
  // eslint-disable-next-line global-require
  SecureStore = require('expo-secure-store');
}

/** Only these keys are ever persisted. Nothing else touches the store. */
export const KEYS = {
  access: 'kinnred.accessToken',
  refresh: 'kinnred.refreshToken',
};

function webSafeGet(key) {
  try {
    return globalThis.localStorage?.getItem(key) ?? null;
  } catch {
    // Private-mode Safari and sandboxed iframes throw on access.
    return null;
  }
}

export async function getItem(key) {
  if (isWeb) return webSafeGet(key);
  try {
    return await SecureStore.getItemAsync(key);
  } catch {
    return null;
  }
}

export async function setItem(key, value) {
  if (value == null) return removeItem(key);
  if (isWeb) {
    try {
      globalThis.localStorage?.setItem(key, value);
    } catch {
      /* storage unavailable — session stays in-memory for this tab */
    }
    return undefined;
  }
  return SecureStore.setItemAsync(key, value);
}

export async function removeItem(key) {
  if (isWeb) {
    try {
      globalThis.localStorage?.removeItem(key);
    } catch {
      /* ignore */
    }
    return undefined;
  }
  return SecureStore.deleteItemAsync(key);
}

export async function getTokens() {
  const [access, refresh] = await Promise.all([getItem(KEYS.access), getItem(KEYS.refresh)]);
  return { access, refresh };
}

export async function setTokens({ accessToken, refreshToken }) {
  await Promise.all([setItem(KEYS.access, accessToken), setItem(KEYS.refresh, refreshToken)]);
}

export async function clearTokens() {
  await Promise.all([removeItem(KEYS.access), removeItem(KEYS.refresh)]);
}

export default { getItem, setItem, removeItem, getTokens, setTokens, clearTokens, KEYS };

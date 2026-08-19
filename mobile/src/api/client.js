import axios from 'axios';
import { Platform } from 'react-native';

import { clearTokens, getTokens, setTokens } from './storage';

/**
 * Base URL for the Kinnred API.
 *
 * `localhost` resolves to the device itself on a physical phone and to the
 * emulator sandbox on Android, so only web and iOS simulator can use it
 * literally. `EXPO_PUBLIC_API_URL` overrides it for device testing (e.g.
 * `EXPO_PUBLIC_API_URL=http://192.168.1.20:3000/api/v1 npx expo start`).
 */
const DEFAULT_HOST = Platform.select({
  android: `http://172.29.112.1:3000`, // Android emulator's alias for the host
  default: 'http://localhost:3000',
  
});

export const BASE_URL = process.env.EXPO_PUBLIC_API_URL ?? `${DEFAULT_HOST}/api/v1`;

const api = axios.create({
  baseURL: BASE_URL,
  timeout: 15000,
  headers: { 'Content-Type': 'application/json' },
});

/** Routes that must never carry a bearer token or trigger a refresh. */
const AUTH_FREE = ['/auth/otp/request', '/auth/otp/verify', '/auth/register', '/auth/refresh'];

const isAuthFree = (url = '') => AUTH_FREE.some((p) => url.startsWith(p));

/* ------------------------------------------------------------------ *
 * Request: attach the bearer token.
 * ------------------------------------------------------------------ */
api.interceptors.request.use(async (config) => {
  if (isAuthFree(config.url)) return config;
  const { access } = await getTokens();
  if (access) {
    config.headers = config.headers ?? {};
    config.headers.Authorization = `Bearer ${access}`;
  }
  return config;
});

/* ------------------------------------------------------------------ *
 * Response: single-flight refresh on 401.
 *
 * The backend treats a replayed refresh token as theft and revokes the whole
 * session family, so two concurrent 401s must NOT each post their own refresh.
 * `refreshInFlight` collapses them into one call that every waiter awaits.
 * ------------------------------------------------------------------ */
let refreshInFlight = null;
const sessionListeners = new Set();

/** Subscribe to forced logouts (refresh failed / session revoked). */
export function onSessionExpired(fn) {
  sessionListeners.add(fn);
  return () => sessionListeners.delete(fn);
}

async function endSession() {
  await clearTokens();
  sessionListeners.forEach((fn) => {
    try {
      fn();
    } catch {
      /* a listener must not break the logout path */
    }
  });
}

async function performRefresh() {
  const { refresh } = await getTokens();
  if (!refresh) throw new Error('no refresh token');

  // A bare axios call, not `api` — going through the instance would re-enter
  // these interceptors and could recurse.
  const { data } = await axios.post(
    `${BASE_URL}/auth/refresh`,
    { refreshToken: refresh },
    { timeout: 15000, headers: { 'Content-Type': 'application/json' } },
  );
  await setTokens(data);
  return data.accessToken;
}

api.interceptors.response.use(
  (res) => res,
  async (error) => {
    const { config, response } = error;

    if (!response || response.status !== 401 || !config || config.__retried || isAuthFree(config.url)) {
      return Promise.reject(normalizeError(error));
    }

    config.__retried = true;
    try {
      refreshInFlight = refreshInFlight ?? performRefresh().finally(() => {
        refreshInFlight = null;
      });
      const token = await refreshInFlight;
      config.headers = { ...config.headers, Authorization: `Bearer ${token}` };
      return api(config);
    } catch (refreshError) {
      await endSession();
      return Promise.reject(normalizeError(refreshError));
    }
  },
);

/**
 * Flattens axios/Nest errors into one predictable shape so screens do not each
 * dig through `err.response.data.message` (which is a string OR an array).
 */
export function normalizeError(error) {
  const status = error?.response?.status ?? 0;
  const data = error?.response?.data;
  let message = 'Something went wrong. Please try again.';

  if (Array.isArray(data?.message)) message = data.message[0];
  else if (typeof data?.message === 'string') message = data.message;
  else if (status === 0) message = 'Cannot reach the server. Is the API running?';

  const e = new Error(message);
  e.status = status;
  e.data = data;
  e.isNetwork = status === 0;
  return e;
}

export default api;

import Constants from 'expo-constants';
import { Platform } from 'react-native';

/**
 * Resolve the API base URL.
 *
 * Priority:
 *  1. EXPO_PUBLIC_API_URL (set it for real devices / staging).
 *  2. Dev on web / iOS simulator  -> http://localhost:3000
 *  3. Dev on Android emulator     -> http://10.0.2.2:3000  (host loopback)
 *  4. Dev on a physical device via Expo Go -> the Metro host's LAN IP, :3000
 *
 * The backend serves everything under /api/v1 (see backend/src/main.ts) except
 * bare /health.
 */
function resolveBaseUrl(): string {
  const explicit = process.env.EXPO_PUBLIC_API_URL;
  if (explicit) return explicit.replace(/\/+$/, '');

  const port = 3000;

  if (__DEV__) {
    if (Platform.OS === 'android') return `http://10.0.2.2:${port}`;
    if (Platform.OS === 'web') return `http://localhost:${port}`;

    const hostUri = Constants.expoConfig?.hostUri ?? '';
    const host = hostUri.split(':')[0];
    if (host) return `http://${host}:${port}`;
    return `http://localhost:${port}`;
  }

  throw new Error('EXPO_PUBLIC_API_URL is not set for this build.');
}

/** Scheme + host + port, no path. Used for the socket.io connection. */
export const API_ORIGIN = resolveBaseUrl();
export const API_BASE = `${API_ORIGIN}/api/v1`;

export interface ApiErrorShape {
  statusCode: number;
  message: string | string[];
  error?: string;
}

export class ApiError extends Error {
  readonly status: number;
  readonly payload: ApiErrorShape | undefined;

  constructor(status: number, payload: ApiErrorShape | undefined) {
    const msg = payload
      ? Array.isArray(payload.message)
        ? payload.message.join('\n')
        : payload.message
      : `Request failed (${status})`;
    super(msg);
    this.name = 'ApiError';
    this.status = status;
    this.payload = payload;
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  token?: string;
  signal?: AbortSignal;
}

/** Unauthenticated request. Used by the auth endpoints (which mint the token). */
export async function apiFetch<T>(
  path: string,
  { method = 'GET', body, token, signal }: RequestOptions = {},
): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;

  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });
  } catch (cause) {
    throw new ApiError(0, {
      statusCode: 0,
      message:
        'Can’t reach Kinnred. Check your connection and that the API is running.',
      error: String(cause),
    });
  }

  const text = await res.text();
  const data = text ? (JSON.parse(text) as unknown) : undefined;

  if (!res.ok) throw new ApiError(res.status, data as ApiErrorShape | undefined);
  return data as T;
}

// ---------------------------------------------------------------------------
// Authenticated client
// ---------------------------------------------------------------------------

interface Tokens {
  accessToken: string;
  refreshToken: string;
}

let tokens: Tokens | null = null;
let onRefreshed: ((t: Tokens) => void) | null = null;
let onLost: (() => void) | null = null;
let refreshInFlight: Promise<Tokens> | null = null;

/**
 * Wire the auth client to the AuthProvider. `refreshed` persists a rotated
 * pair; `lost` triggers sign-out when the session can no longer be recovered.
 */
export function configureAuthClient(opts: {
  tokens: Tokens | null;
  onRefreshed: (t: Tokens) => void;
  onLost: () => void;
}) {
  tokens = opts.tokens;
  onRefreshed = opts.onRefreshed;
  onLost = opts.onLost;
}

/** Update just the tokens (e.g. right after sign-in). */
export function setAuthTokens(next: Tokens | null) {
  tokens = next;
}

async function refreshTokens(): Promise<Tokens> {
  if (!tokens) throw new ApiError(401, undefined);
  if (refreshInFlight) return refreshInFlight;

  refreshInFlight = (async () => {
    try {
      const next = await apiFetch<{
        accessToken: string;
        refreshToken: string;
        expiresIn: string;
      }>('/auth/refresh', {
        method: 'POST',
        body: { refreshToken: tokens!.refreshToken },
      });
      const pair: Tokens = {
        accessToken: next.accessToken,
        refreshToken: next.refreshToken,
      };
      tokens = pair;
      onRefreshed?.(pair);
      return pair;
    } finally {
      refreshInFlight = null;
    }
  })();

  return refreshInFlight;
}

/**
 * Authenticated request. Attaches the bearer token, and on a 401 does a
 * single-flight refresh + one retry before giving up and signing the user out.
 */
export async function authedFetch<T>(
  path: string,
  opts: Omit<RequestOptions, 'token'> = {},
): Promise<T> {
  if (!tokens) {
    // No token in hand yet. Do NOT sign the user out here — this also fires in
    // the brief window between a stored session loading and the client being
    // configured. A genuine expiry is caught by the refresh path below.
    throw new ApiError(401, { statusCode: 401, message: 'Not signed in' });
  }

  try {
    return await apiFetch<T>(path, { ...opts, token: tokens.accessToken });
  } catch (e) {
    if (!(e instanceof ApiError) || e.status !== 401) throw e;

    try {
      const fresh = await refreshTokens();
      return await apiFetch<T>(path, { ...opts, token: fresh.accessToken });
    } catch {
      tokens = null;
      onLost?.();
      throw new ApiError(401, {
        statusCode: 401,
        message: 'Your session expired. Please sign in again.',
      });
    }
  }
}

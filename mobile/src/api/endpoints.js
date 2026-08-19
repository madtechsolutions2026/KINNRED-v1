import api from './client';
import { clearTokens, setTokens } from './storage';

/**
 * Thin, typed-by-convention wrappers over the backend routes.
 *
 * Route strings live here only, so a backend rename is a one-file change.
 * Mirrors backend/src/modules/*​/*.controller.ts as of this commit.
 */

/* ------------------------------- auth ------------------------------- */

/**
 * Persists the token pair from a verify/register response.
 *
 * `/auth/otp/verify` and `/auth/register` nest the pair under `session`,
 * because verify has two possible outcomes and needs a discriminator alongside
 * it. `/auth/refresh` returns the pair flat — it has only one outcome. Both
 * shapes are deliberate on the server; this is the one place that knows it.
 *
 * THROWS when the tokens are absent from a response that claimed to
 * authenticate. Silently skipping the write is what made the original bug so
 * confusing: OTP verification succeeded server-side and consumed the code, the
 * client stored nothing, the screen stayed put, and the user's next tap came
 * back 401 "invalid or expired code" — pointing at the code, which was fine.
 * A loud failure here names the real problem.
 */
async function persistSession(session, source) {
  if (!session?.accessToken || !session?.refreshToken) {
    throw new Error(
      `${source} succeeded but returned no session tokens. ` +
        'The client and the API response shape are out of sync.',
    );
  }
  await setTokens(session);
}

export const auth = {
  requestOtp: (phone) => api.post('/auth/otp/request', { phone }).then((r) => r.data),

  /**
   * -> { status:'authenticated', session:{ accessToken, refreshToken, expiresIn }, userId }
   *  | { status:'registration_required', registrationTicket }
   */
  verifyOtp: async (phone, code, deviceLabel) => {
    const { data } = await api.post('/auth/otp/verify', { phone, code, deviceLabel });
    if (data?.status === 'authenticated') await persistSession(data.session, 'OTP verification');
    return data;
  },

  /** -> { session:{ accessToken, refreshToken, expiresIn }, userId, publicShortId } */
  register: async (registrationTicket, gender, dateOfBirth, deviceLabel) => {
    const { data } = await api.post('/auth/register', {
      registrationTicket,
      gender,
      dateOfBirth,
      deviceLabel,
    });
    await persistSession(data?.session, 'Registration');
    return data;
  },

  me: () => api.get('/auth/me').then((r) => r.data),

  logout: async (refreshToken) => {
    try {
      if (refreshToken) await api.post('/auth/logout', { refreshToken });
    } finally {
      // Local session is dropped even if the server call fails — otherwise a
      // network blip would strand the user in a logged-in shell.
      await clearTokens();
    }
  },

  logoutAll: () => api.post('/auth/logout-all').then((r) => r.data),
};

/* ------------------------------- grid ------------------------------- */

/**
 * The only radii the API accepts. Free-form radii are rejected by the server
 * (CLAUDE.md §2.2) because presence/absence at arbitrary distances brackets a
 * user's true position — so the UI must offer exactly these, and no slider.
 */
export const GRID_RADII = [1000, 3000, 10000, 50000];
export const GRID_RADIUS_LABELS = { 1000: '1 km', 3000: '3 km', 10000: '10 km', 50000: '50 km' };

export const grid = {
  /**
   * -> { persisted: boolean, reason: string }
   *
   * The body keys are `lat`/`lng`, matching UpdateLocationDto. They are NOT
   * `latitude`/`longitude` — which is what `Location.getCurrentPositionAsync`
   * hands back, so the rename belongs here rather than at every call site.
   *
   * `persisted: false` with reason `debounced-no-significant-change` is a
   * success: the server drops writes under ~100m / ~60s (CLAUDE.md §4) because
   * location UPDATEs, not reads, are what strain Postgres. Callers must not
   * treat it as a failure — nor add a second debounce on this side.
   */
  updateLocation: (latitude, longitude) =>
    api.put('/grid/location', { lat: latitude, lng: longitude }).then((r) => r.data),

  clearLocation: () => api.delete('/grid/location').then((r) => r.data),

  /** -> { results: GridPerson[], nextCursor: string | null } */
  nearby: (params = {}) => api.get('/grid/nearby', { params }).then((r) => r.data),
};

/* ------------------------------- users ------------------------------ */

export const users = {
  me: () => api.get('/users/me').then((r) => r.data),
  updateMe: (patch) => api.patch('/users/me', patch).then((r) => r.data),
  updateSettings: (patch) => api.patch('/users/me/settings', patch).then((r) => r.data),
  qr: () => api.get('/users/me/qr').then((r) => r.data),
  viewers: () => api.get('/users/me/viewers').then((r) => r.data),
  byShortId: (publicShortId) => api.get(`/users/${publicShortId}`).then((r) => r.data),
};

/* ------------------------------- pings ------------------------------ */

export const pings = {
  send: (targetPublicShortId, message) =>
    api.post('/pings', { targetPublicShortId, message }).then((r) => r.data),

  accept: (pingId) => api.post(`/pings/${pingId}/accept`).then((r) => r.data),
  reject: (pingId) => api.post(`/pings/${pingId}/reject`).then((r) => r.data),
  withdraw: (pingId) => api.delete(`/pings/${pingId}`).then((r) => r.data),

  requests: () => api.get('/pings/requests').then((r) => r.data),
  sent: () => api.get('/pings/sent').then((r) => r.data),
  chats: () => api.get('/pings/chats').then((r) => r.data),

  messages: (pingId, params) => api.get(`/pings/${pingId}/messages`, { params }).then((r) => r.data),
  sendMessage: (pingId, body) => api.post(`/pings/${pingId}/messages`, { body }).then((r) => r.data),
  markRead: (pingId) => api.post(`/pings/${pingId}/read`).then((r) => r.data),
};

export const blocks = {
  list: () => api.get('/blocks').then((r) => r.data),
  add: (publicShortId) => api.post('/blocks', { publicShortId }).then((r) => r.data),
  remove: (publicShortId) => api.delete(`/blocks/${publicShortId}`).then((r) => r.data),
};

/* ------------------------------- media ------------------------------ */

export const media = {
  list: () => api.get('/media').then((r) => r.data),
  uploadUrl: (contentType, kind) =>
    api.post('/media/upload-url', { contentType, kind }).then((r) => r.data),
  confirm: (id) => api.post(`/media/${id}/confirm`).then((r) => r.data),
  url: (id) => api.get(`/media/${id}/url`).then((r) => r.data),
  remove: (id) => api.delete(`/media/${id}`).then((r) => r.data),
};

/* --------------------------- verification --------------------------- */

export const verification = {
  start: (payload) => api.post('/verification', payload).then((r) => r.data),
  status: () => api.get('/verification/status').then((r) => r.data),
};

/**
 * Circles has no backend module yet (backend/src/modules has auth, grid,
 * media, pings, users, verification). The Circles screen therefore renders
 * from the prototype fixture until the module lands — see LAYOUTS.md.
 */
export const circles = {
  implemented: false,
};

export default { auth, grid, users, pings, blocks, media, verification, circles };

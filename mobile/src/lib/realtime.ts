import { io, type Socket } from 'socket.io-client';
import { API_ORIGIN } from './api';

/**
 * Server-to-client realtime events (backend `realtime.interface.ts`). There are
 * deliberately no client-to-server events — sending is a REST call, the socket
 * only delivers.
 */
export interface RealtimeEvents {
  'ping:received': {
    pingId: string;
    from: { publicShortId: string; displayName: string | null };
    openingMessage: string | null;
    createdAt: string;
  };
  'ping:accepted': {
    pingId: string;
    by: { publicShortId: string; displayName: string | null };
    decidedAt: string;
  };
  'ping:rejected': { pingId: string; decidedAt: string };
  'ping:withdrawn': { pingId: string };
  'message:new': {
    pingId: string;
    messageId: string;
    from: { publicShortId: string; displayName: string | null };
    body: string;
    sentAt: string;
  };
  'message:read': { pingId: string; readAt: string; count: number };

  // --- Circles II (S9) ---
  'circle:post:new': {
    circle: { publicShortId: string };
    post: {
      id: string;
      body: string;
      author: { publicShortId: string; displayName: string | null };
      mine: boolean;
      scheduledFor: string | null;
      reminderAt: string | null;
      createdAt: string;
    };
  };
  'circle:post:reminder': {
    circle: { publicShortId: string };
    post: { id: string; body: string; createdAt: string };
  };
  'circle:message:new': {
    circle: { publicShortId: string };
    message: {
      id: string;
      body: string;
      sender: { publicShortId: string; displayName: string | null };
      mine: boolean;
      sentAt: string;
    };
  };
  'circle:chat:disabled': { circle: { publicShortId: string } };
}

type Listener<K extends keyof RealtimeEvents> = (payload: RealtimeEvents[K]) => void;

/**
 * ONE socket instance for the whole app lifetime. Never recreated — that way
 * `onRealtime` listeners survive token changes and network blips (socket.io
 * re-attaches them on reconnect). Auth changes just re-handshake the transport.
 */
let socket: Socket | null = null;
let currentToken: string | null = null;

function ensureSocket(): Socket {
  if (socket) return socket;
  socket = io(`${API_ORIGIN}/realtime`, {
    autoConnect: false,
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 8000,
  });
  if (__DEV__) {
    socket.on('connect', () => console.log('[realtime] connected', socket?.id));
    socket.on('disconnect', (r) => console.log('[realtime] disconnected', r));
    socket.on('connect_error', (e) =>
      console.log('[realtime] connect_error', e.message),
    );
  }
  return socket;
}

/**
 * Point the connection at a session. Re-handshakes if the token changed; a
 * null token tears the connection down.
 */
export function connectRealtime(accessToken: string) {
  const s = ensureSocket();
  if (currentToken === accessToken && s.connected) return;
  currentToken = accessToken;
  s.auth = { token: accessToken };
  if (s.connected) s.disconnect();
  s.connect();
}

export function disconnectRealtime() {
  currentToken = null;
  socket?.disconnect();
}

/** Subscribe to one event. Returns an unsubscribe fn. */
export function onRealtime<K extends keyof RealtimeEvents>(
  event: K,
  listener: Listener<K>,
): () => void {
  const s = ensureSocket();
  s.on(event as string, listener as (...args: unknown[]) => void);
  return () => {
    s.off(event as string, listener as (...args: unknown[]) => void);
  };
}

export function isRealtimeConnected(): boolean {
  return socket?.connected ?? false;
}

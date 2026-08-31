import { authedFetch } from './api';

export type PingState = 'PENDING' | 'ACCEPTED' | 'REJECTED';

export interface Counterpart {
  publicShortId: string;
  displayName: string | null;
}

export interface PingRequest {
  pingId: string;
  from: Counterpart;
  openingMessage: string | null;
  createdAt: string;
}

export interface SentPing {
  pingId: string;
  to: Counterpart;
  createdAt: string;
}

export interface ChatSummary {
  pingId: string;
  with: Counterpart;
  lastMessage: {
    body: string;
    sentByMe: boolean;
    sentAt: string;
    read: boolean;
  } | null;
  lastActivityAt: string;
}

export interface ThreadMessage {
  messageId: string;
  body: string;
  sentByMe: boolean;
  sentAt: string;
  read: boolean;
}

export interface Thread {
  pingId: string;
  messages: ThreadMessage[]; // newest first
  nextCursor: string | null;
}

// --- lifecycle ---

export function sendPing(input: {
  toPublicShortId: string;
  openingMessage?: string;
}) {
  return authedFetch<{
    pingId: string;
    state: PingState;
    to?: { publicShortId: string };
    createdAt?: string;
  }>('/pings', { method: 'POST', body: input });
}

export const acceptPing = (pingId: string) =>
  authedFetch<{ pingId: string; state: PingState; decidedAt: string }>(
    `/pings/${pingId}/accept`,
    { method: 'POST' },
  );

export const rejectPing = (pingId: string) =>
  authedFetch<{ pingId: string; state: PingState }>(`/pings/${pingId}/reject`, {
    method: 'POST',
  });

export const withdrawPing = (pingId: string) =>
  authedFetch<{ pingId: string; withdrawn: true }>(`/pings/${pingId}`, {
    method: 'DELETE',
  });

// --- folders ---

export const listRequests = () =>
  authedFetch<PingRequest[]>('/pings/requests');

export const listSent = () => authedFetch<SentPing[]>('/pings/sent');

export const listChats = () => authedFetch<ChatSummary[]>('/pings/chats');

// --- messaging ---

export function getThread(pingId: string, opts: { cursor?: string; limit?: number } = {}) {
  const qs = new URLSearchParams();
  if (opts.cursor) qs.set('cursor', opts.cursor);
  if (opts.limit) qs.set('limit', String(opts.limit));
  const q = qs.toString();
  return authedFetch<Thread>(`/pings/${pingId}/messages${q ? `?${q}` : ''}`);
}

export const sendMessage = (pingId: string, body: string) =>
  authedFetch<{
    messageId: string;
    pingId: string;
    body: string;
    sentAt: string;
    sentByMe: true;
  }>(`/pings/${pingId}/messages`, { method: 'POST', body: { body } });

export const markThreadRead = (pingId: string) =>
  authedFetch<{ pingId: string; markedRead: number }>(`/pings/${pingId}/read`, {
    method: 'POST',
  });

// --- blocks ---

export const blockUser = (publicShortId: string) =>
  authedFetch<unknown>('/blocks', { method: 'POST', body: { publicShortId } });

export const unblockUser = (publicShortId: string) =>
  authedFetch<unknown>(`/blocks/${publicShortId}`, { method: 'DELETE' });

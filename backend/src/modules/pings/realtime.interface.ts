/**
 * The seam between domain logic and the socket transport.
 *
 * PingsService depends on THIS, never on the gateway class. Two reasons, and
 * the second is the important one:
 *
 *  1. It makes the service unit-testable without standing up a socket server.
 *  2. Realtime delivery is best-effort and the domain write is not. If the
 *     service held a Server instance directly, it would be far too easy to let
 *     a socket failure abort a database transaction — a message that was
 *     persisted but not delivered is a UI refresh away from correct, whereas a
 *     message that failed to persist because a socket was down is data loss.
 */
export const REALTIME = Symbol('REALTIME');

/** Every server-to-client event name, in one place. */
export const RealtimeEvent = {
  /** A new PENDING ping arrived. Sent to the recipient. */
  PING_RECEIVED: 'ping:received',
  /** The recipient accepted. Sent to the original sender. */
  PING_ACCEPTED: 'ping:accepted',
  /** The recipient declined. Sent to the original sender. */
  PING_REJECTED: 'ping:rejected',
  /** The sender withdrew before a decision. Sent to the recipient. */
  PING_WITHDRAWN: 'ping:withdrawn',
  /** A new message in an accepted thread. Sent to the other participant. */
  MESSAGE_NEW: 'message:new',
  /** The other participant read up to a point. Sent to the sender. */
  MESSAGE_READ: 'message:read',
} as const;

export type RealtimeEvent = (typeof RealtimeEvent)[keyof typeof RealtimeEvent];

export interface Realtime {
  /**
   * Delivers an event to every live socket belonging to one user.
   *
   * Fire-and-forget by contract: implementations MUST NOT throw, and callers
   * must not await delivery as though it were part of the write. A user with
   * no connected socket is the normal case, not an error.
   */
  emitToUser(userId: string, event: RealtimeEvent, payload: unknown): void;
}

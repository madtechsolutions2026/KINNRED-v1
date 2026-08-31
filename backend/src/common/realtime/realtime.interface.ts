/**
 * The seam between domain logic and the socket transport.
 *
 * Domain services depend on THIS, never on the gateway class. Two reasons, and
 * the second is the important one:
 *
 *  1. It makes services unit-testable without standing up a socket server.
 *  2. Realtime delivery is best-effort and the domain write is not. If a
 *     service held a Server instance directly, it would be far too easy to let
 *     a socket failure abort a database transaction — a message that was
 *     persisted but not delivered is a UI refresh away from correct, whereas a
 *     message that failed to persist because a socket was down is data loss.
 *
 * Lives in `common/` rather than `modules/pings/` (its original home) because
 * S9's circle chat needs the same delivery path and `common/` must not depend
 * on a domain module — the same move BlocksService made in D-050, for the same
 * reason (DECISIONS.md D-064).
 */
export const REALTIME = Symbol('REALTIME');

/** Every server-to-client event name, in one place. */
export const RealtimeEvent = {
  // --- Pings (S5) ----------------------------------------------------------
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

  // --- Circles II (S9) ---------------------------------------------------
  /** A circle post went live. Fanned out to every ACTIVE member. */
  CIRCLE_POST_NEW: 'circle:post:new',
  /** A scheduled reminder for a circle post fired. Fanned out to members. */
  CIRCLE_POST_REMINDER: 'circle:post:reminder',
  /** A new group-chat message. Fanned out to every ACTIVE member but the sender. */
  CIRCLE_MESSAGE_NEW: 'circle:message:new',
  /** An admin turned the group chat off. Fanned out to members so clients close it. */
  CIRCLE_CHAT_DISABLED: 'circle:chat:disabled',
} as const;

export type RealtimeEvent = (typeof RealtimeEvent)[keyof typeof RealtimeEvent];

export interface Realtime {
  /**
   * Delivers an event to every live socket belonging to one user.
   *
   * Fire-and-forget by contract: implementations MUST NOT throw, and callers
   * must not await delivery as though it were part of the write. A user with
   * no connected socket is the normal case, not an error.
   *
   * Group delivery (a circle post, a chat message) is a LOOP of these over a
   * freshly-resolved member list — deliberately not a persistent `circle:<id>`
   * socket room, because a room join survives a kick until the socket
   * disconnects, whereas a per-message member lookup does not (D-065).
   */
  emitToUser(userId: string, event: RealtimeEvent, payload: unknown): void;
}

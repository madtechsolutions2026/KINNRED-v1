import { Logger } from '@nestjs/common';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { JwtService } from '@nestjs/jwt';
import type { Namespace, Server, Socket } from 'socket.io';
import { Realtime, RealtimeEvent } from './realtime.interface';

interface AccessClaims {
  sub?: string;
  typ?: string;
}

/**
 * `socket.handshake.auth` and `socket.data` are both `any` in socket.io's
 * types. Narrowing them here keeps the unsafe surface to one declaration
 * instead of spreading `any` through the connection handler — which matters
 * because that handler is where identity is established.
 */
interface AuthedSocket extends Socket {
  data: { userId?: string };
  handshake: Socket['handshake'] & { auth: { token?: unknown } };
}

/** One room per user. Every device that user has logged in on joins it. */
export const userRoom = (userId: string): string => `user:${userId}`;

/**
 * Realtime delivery for pings and messages.
 *
 * ── AUTH ────────────────────────────────────────────────────────────────────
 * The handshake is authenticated off the JWT and the acting user is derived
 * from the token, never from a socket payload (CLAUDE.md §2.3). This is worth
 * stating twice for sockets specifically: unlike an HTTP request, a socket is
 * authenticated ONCE and then stays open, so a gateway that trusts a
 * client-sent `userId` on each message hands out impersonation for the life of
 * the connection. The token is read at the handshake and `socket.data.userId`
 * is the only identity used thereafter.
 *
 * Verification runs in CONNECTION MIDDLEWARE, not in handleConnection. That
 * distinction is not cosmetic: `handleConnection` fires *after* the connection
 * is established, so rejecting there means an unauthenticated client has
 * already completed a handshake, been assigned a socket id, and seen its
 * `connect` event fire before being torn down. Middleware refuses the upgrade
 * outright, so no connection exists at any point. Caught by the S5 smoke test,
 * which observed a bogus token successfully connecting.
 *
 * ── SCALING ─────────────────────────────────────────────────────────────────
 * The Redis adapter is wired from the start (see RedisIoAdapter), not deferred
 * to a scaling pass. Without it `emitToUser` reaches only the sockets attached
 * to the instance that happened to handle the write, so the feature works
 * perfectly on one process and silently half-fails the moment a second one
 * exists — behind a load balancer that is not reproducible on demand.
 *
 * ── WRITES DO NOT COME THROUGH HERE ─────────────────────────────────────────
 * There are deliberately no client-to-server message events. Sending a message
 * is a REST call; this gateway only DELIVERS. One write path means one place
 * where validation, block checks, and ping-state authorisation live. A
 * socket-side write would need all three re-implemented, and the copy that
 * drifted would be the one nobody was reading.
 */
@WebSocketGateway({
  namespace: '/realtime',
  // The mobile client is not a browser origin; CORS here would be theatre.
  // Authorisation is the JWT handshake, above.
  cors: { origin: '*' },
})
export class PingsGateway
  implements Realtime, OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  private readonly logger = new Logger(PingsGateway.name);

  @WebSocketServer()
  private server?: Server;

  constructor(private readonly jwt: JwtService) {}

  /**
   * Installs the auth middleware.
   *
   * Runs before a connection is established, so an unauthenticated client is
   * refused at the handshake and never becomes a socket at all.
   */
  afterInit(server: Namespace): void {
    server.use((socket, next) => {
      const authed = socket as AuthedSocket;
      const token = this.extractToken(authed);

      if (!token) return next(this.reject('missing token'));

      let claims: AccessClaims;
      try {
        claims = this.jwt.verify<AccessClaims>(token);
      } catch {
        return next(this.reject('invalid token'));
      }

      // Same token-type check as JwtAuthGuard. Without it a registration
      // ticket — handed to anyone who merely passes OTP, before an account
      // exists — would open a socket.
      if (claims.typ !== 'access' || !claims.sub) {
        return next(this.reject('wrong token type'));
      }

      authed.data.userId = claims.sub;
      next();
    });
  }

  /**
   * Joins the authenticated socket to its user's room.
   *
   * Identity is already established by the middleware above; this only routes.
   * The defensive disconnect covers the case where middleware is somehow
   * bypassed — an anonymous socket must never sit in a room.
   */
  handleConnection(socket: AuthedSocket): void {
    const userId = socket.data.userId;

    if (!userId) {
      this.logger.warn(
        `Socket ${socket.id} reached handleConnection with no identity — auth middleware did not run`,
      );
      socket.disconnect(true);
      return;
    }

    void socket.join(userRoom(userId));
    this.logger.debug(`Socket ${socket.id} connected as ${userId}`);
  }

  handleDisconnect(socket: Socket): void {
    // Rooms are cleaned up by socket.io itself; this is only for observability.
    this.logger.debug(`Socket ${socket.id} disconnected`);
  }

  /**
   * Delivers to every device a user has connected, on any instance.
   *
   * Never throws. Realtime delivery is an optimisation over the client
   * re-fetching, so a socket problem must not be able to fail the HTTP request
   * that already committed the write.
   */
  emitToUser(userId: string, event: RealtimeEvent, payload: unknown): void {
    try {
      // Undefined before the gateway is initialised, and in the worker
      // process, which builds the same module graph but serves no sockets.
      this.server?.to(userRoom(userId)).emit(event, payload);
    } catch (error) {
      this.logger.warn(
        `Realtime emit of ${event} to ${userId} failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  /**
   * Token from either the socket.io `auth` payload (the documented client API)
   * or an Authorization header, so a plain WebSocket client and a socket.io
   * client both work.
   */
  private extractToken(socket: AuthedSocket): string | undefined {
    const fromAuth = socket.handshake.auth?.token;
    if (typeof fromAuth === 'string' && fromAuth.length > 0) return fromAuth;

    const header = socket.handshake.headers.authorization;
    if (!header) return undefined;

    const [scheme, value] = header.split(' ');
    if (scheme?.toLowerCase() !== 'bearer' || !value) return undefined;

    return value;
  }

  /**
   * The error handed to socket.io middleware to refuse a handshake.
   *
   * The real reason is logged, never sent. Distinguishing "expired" from
   * "forged" from "wrong type" over the wire is reconnaissance, exactly as it
   * is on the HTTP side (JwtAuthGuard).
   */
  private reject(reason: string): Error {
    this.logger.debug(`Refusing socket handshake: ${reason}`);
    return new Error('unauthorized');
  }
}

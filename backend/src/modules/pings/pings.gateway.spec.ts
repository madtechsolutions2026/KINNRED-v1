import { PingsGateway, userRoom } from './pings.gateway';
import { RealtimeEvent } from './realtime.interface';
import type { JwtService } from '@nestjs/jwt';
import type { Namespace, Socket } from 'socket.io';

type Middleware = (socket: unknown, next: (err?: Error) => void) => void;

describe('PingsGateway', () => {
  let verify: jest.Mock;
  let gateway: PingsGateway;
  let middleware: Middleware;

  /** Installs the auth middleware the way socket.io would, and captures it. */
  function init(): void {
    const use = jest.fn((fn: Middleware) => {
      middleware = fn;
    });
    gateway.afterInit({ use } as unknown as Namespace);
  }

  function fakeSocket(auth: Record<string, unknown> = {}): {
    id: string;
    data: { userId?: string };
    handshake: {
      auth: Record<string, unknown>;
      headers: Record<string, string>;
    };
    join: jest.Mock;
    disconnect: jest.Mock;
  } {
    return {
      id: 'socket-1',
      data: {},
      handshake: { auth, headers: {} },
      join: jest.fn(),
      disconnect: jest.fn(),
    };
  }

  /** Runs the middleware and returns the error it passed to next(), if any. */
  function handshake(socket: unknown): Error | undefined {
    let error: Error | undefined;
    middleware(socket, (e?: Error) => {
      error = e;
    });
    return error;
  }

  beforeEach(() => {
    verify = jest.fn().mockReturnValue({ sub: 'user-1', typ: 'access' });
    gateway = new PingsGateway({ verify } as unknown as JwtService);
    init();
  });

  describe('handshake authentication', () => {
    it('accepts a valid access token from the auth payload', () => {
      const socket = fakeSocket({ token: 'good' });

      expect(handshake(socket)).toBeUndefined();
      expect(socket.data.userId).toBe('user-1');
    });

    it('accepts a bearer token from the Authorization header', () => {
      const socket = fakeSocket();
      socket.handshake.headers.authorization = 'Bearer good';

      expect(handshake(socket)).toBeUndefined();
      expect(socket.data.userId).toBe('user-1');
    });

    /**
     * REGRESSION GUARD. This check originally lived in `handleConnection`,
     * which socket.io calls only AFTER the connection is established — so a
     * bogus token completed a handshake, got a socket id, and fired the
     * client's `connect` event before being torn down. The S5 smoke test
     * caught it. Rejecting from middleware means no connection ever exists.
     *
     * If this ever moves back into handleConnection, this test fails.
     */
    it.each([
      ['no token at all', {}],
      ['an empty token', { token: '' }],
      ['a non-string token', { token: 12345 }],
    ])('refuses the handshake with %s', (_label, auth) => {
      const socket = fakeSocket(auth);

      expect(handshake(socket)).toBeInstanceOf(Error);
      expect(socket.data.userId).toBeUndefined();
    });

    it('refuses a token that does not verify', () => {
      verify.mockImplementation(() => {
        throw new Error('bad signature');
      });

      expect(handshake(fakeSocket({ token: 'forged' }))).toBeInstanceOf(Error);
    });

    /**
     * A registration ticket is handed to anyone who merely passes OTP, before
     * an account exists. Accepting one here would open a socket for a
     * half-authenticated caller.
     */
    it('refuses a non-access token type', () => {
      verify.mockReturnValue({ sub: 'user-1', typ: 'registration' });

      const socket = fakeSocket({ token: 'ticket' });
      expect(handshake(socket)).toBeInstanceOf(Error);
      expect(socket.data.userId).toBeUndefined();
    });

    it('refuses a verified token with no subject', () => {
      verify.mockReturnValue({ typ: 'access' });

      expect(handshake(fakeSocket({ token: 'odd' }))).toBeInstanceOf(Error);
    });

    /** The reason is logged, never sent — "expired" vs "forged" is recon. */
    it('gives the same opaque message whatever the cause', () => {
      const noToken = handshake(fakeSocket());
      verify.mockImplementation(() => {
        throw new Error('jwt expired');
      });
      const badToken = handshake(fakeSocket({ token: 'x' }));

      expect(noToken?.message).toBe('unauthorized');
      expect(badToken?.message).toBe('unauthorized');
    });
  });

  describe('handleConnection', () => {
    it('joins the socket to its own user room', () => {
      const socket = fakeSocket({ token: 'good' });
      handshake(socket);

      gateway.handleConnection(
        socket as unknown as Socket & { data: { userId?: string } },
      );

      expect(socket.join).toHaveBeenCalledWith(userRoom('user-1'));
    });

    /** Defence in depth: an identity-less socket must never sit in a room. */
    it('disconnects a socket that arrived without an identity', () => {
      const socket = fakeSocket();

      gateway.handleConnection(
        socket as unknown as Socket & { data: { userId?: string } },
      );

      expect(socket.join).not.toHaveBeenCalled();
      expect(socket.disconnect).toHaveBeenCalledWith(true);
    });
  });

  describe('emitToUser', () => {
    /**
     * Realtime delivery is an optimisation over the client re-fetching. It
     * must never be able to fail an HTTP request that already committed its
     * write — which is also why the worker process, where no server exists,
     * can call this harmlessly.
     */
    it('does not throw when no server is attached', () => {
      expect(() =>
        gateway.emitToUser('user-1', RealtimeEvent.MESSAGE_NEW, {}),
      ).not.toThrow();
    });

    it('does not throw when the underlying emit fails', () => {
      const emit = jest.fn(() => {
        throw new Error('adapter down');
      });
      (gateway as unknown as { server: unknown }).server = {
        to: () => ({ emit }),
      };

      expect(() =>
        gateway.emitToUser('user-1', RealtimeEvent.MESSAGE_NEW, {}),
      ).not.toThrow();
    });

    it("emits to the target user's room only", () => {
      const emit = jest.fn();
      const to = jest.fn(() => ({ emit }));
      (gateway as unknown as { server: unknown }).server = { to };

      gateway.emitToUser('user-2', RealtimeEvent.PING_RECEIVED, { a: 1 });

      expect(to).toHaveBeenCalledWith(userRoom('user-2'));
      expect(emit).toHaveBeenCalledWith(RealtimeEvent.PING_RECEIVED, { a: 1 });
    });
  });
});

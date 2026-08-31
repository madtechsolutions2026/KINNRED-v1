import { Global, Module } from '@nestjs/common';
import { AuthModule } from '../../modules/auth/auth.module';
import { RealtimeGateway } from './realtime.gateway';
import { RealtimeEmitter } from './realtime.emitter';
import { REALTIME } from './realtime.interface';

/**
 * The app-wide realtime transport (D-064).
 *
 * `@Global` because both S5 (pings) and S9 (circles) deliver through it and a
 * future surface will too — the alternative is every module importing it
 * explicitly and one of them forgetting, then failing only in production where
 * a second instance exists.
 *
 * `AuthModule` is imported for `JwtModule`: the socket handshake verifies its
 * own token because a WebSocket upgrade never passes through the HTTP guard
 * chain.
 *
 * The `REALTIME` seam is bound to the gateway here — one place decides what
 * "realtime" means for this process. The worker builds the same module graph
 * but serves no sockets, so `emitToUser` there is a harmless no-op.
 */
@Global()
@Module({
  imports: [AuthModule],
  providers: [
    RealtimeEmitter,
    RealtimeGateway,
    {
      provide: REALTIME,
      useExisting: RealtimeGateway,
    },
  ],
  exports: [REALTIME, RealtimeGateway],
})
export class RealtimeModule {}

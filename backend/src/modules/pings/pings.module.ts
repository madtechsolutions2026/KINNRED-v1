import { Module } from '@nestjs/common';
import { PingsController, BlocksController } from './pings.controller';
import { PingsService } from './pings.service';
import { PingsGateway } from './pings.gateway';
import { REALTIME } from './realtime.interface';
import { AuthModule } from '../auth/auth.module';
import { BlocksModule } from '../../common/blocks/blocks.module';

/**
 * S5 — the 1:1 surface.
 *
 * `AuthModule` is imported for JwtModule: the socket handshake verifies its
 * own token, because a WebSocket upgrade never passes through the HTTP guard
 * chain. That is easy to forget and would leave the gateway unauthenticated
 * while every REST route looked fine.
 *
 * `BlocksService` used to be provided here and exported. It moved to
 * `common/blocks` in S6 (D-050) because blocking is not a pings concept —
 * visibility, S7 (Grid) and S8 (circles) all have to honour it, and each
 * re-deriving "is this pair blocked" is how one of them ends up not.
 * `BlocksController` stays: the REST surface for blocking is part of the 1:1
 * surface even though the rule is not.
 */
@Module({
  imports: [AuthModule, BlocksModule],
  controllers: [PingsController, BlocksController],
  providers: [
    PingsService,
    PingsGateway,
    {
      // The service depends on the REALTIME seam, not on the gateway class.
      // Bound here so there is exactly one place that decides what "realtime"
      // means for this process.
      provide: REALTIME,
      useExisting: PingsGateway,
    },
  ],
  exports: [PingsService],
})
export class PingsModule {}

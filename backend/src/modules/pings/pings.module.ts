import { Module } from '@nestjs/common';
import { PingsController, BlocksController } from './pings.controller';
import { PingsService } from './pings.service';
import { AuthModule } from '../auth/auth.module';
import { BlocksModule } from '../../common/blocks/blocks.module';

/**
 * S5 — the 1:1 surface.
 *
 * `AuthModule` is still imported for `JwtModule` (the block/ping REST routes
 * do not need it directly, but keeping the import is harmless and explicit).
 *
 * The realtime gateway used to live here. It moved to `common/realtime` in
 * D-064 when S9's circle chat needed the same transport — `common/` must not
 * depend on a domain module, the same reasoning that moved `BlocksService` out
 * in D-050. `RealtimeModule` is `@Global`, so `PingsService` gets the
 * `REALTIME` seam without an explicit import here.
 *
 * `BlocksController` stays: the REST surface for blocking is part of the 1:1
 * surface even though the rule itself lives in `common/blocks`.
 */
@Module({
  imports: [AuthModule, BlocksModule],
  controllers: [PingsController, BlocksController],
  providers: [PingsService],
  exports: [PingsService],
})
export class PingsModule {}

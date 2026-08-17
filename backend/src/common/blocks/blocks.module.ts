import { Global, Module } from '@nestjs/common';
import { BlocksService } from './blocks.service';

/**
 * Global, and deliberately in `common/` rather than inside `modules/pings/`.
 *
 * CLAUDE.md §2.5 requires EVERY surface to honour blocks — Grid results,
 * circle member lists, notifications, search — and `VisibilityService` now
 * needs it too, because a pair can become blocked after a ping was already
 * accepted. A resolver in `common/` reaching into a domain module for that is
 * an inverted dependency and a cycle waiting to happen the moment pings need
 * visibility back.
 *
 * Global for the same reason `VisibilityModule` is: the failure mode for both
 * is a module deciding the import was friction and re-deriving the rule
 * locally, and the one that gets it wrong is not the one anyone reads.
 */
@Global()
@Module({
  providers: [BlocksService],
  exports: [BlocksService],
})
export class BlocksModule {}

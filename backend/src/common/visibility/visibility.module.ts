import { Global, Module } from '@nestjs/common';
import { VisibilityService } from './visibility.service';
import { BlocksModule } from '../blocks/blocks.module';

/**
 * Global so every module resolves photo visibility through the same instance,
 * and nobody is tempted to hand-roll the rule because importing it felt like
 * friction.
 *
 * `BlocksModule` is imported explicitly even though it is itself global: the
 * dependency is load-bearing (a block re-locks a pair a ping had unlocked), and
 * an explicit edge is what makes that survive someone reordering AppModule.
 *
 * See visibility.service.ts — this is the single source of truth for
 * CLAUDE.md §2.1.
 */
@Global()
@Module({
  imports: [BlocksModule],
  providers: [VisibilityService],
  exports: [VisibilityService],
})
export class VisibilityModule {}

import { Module } from '@nestjs/common';
import { CirclesController } from './circles.controller';
import { CirclesService } from './circles.service';
import { BlocksModule } from '../../common/blocks/blocks.module';

/**
 * S8 — Circles: structure and membership.
 *
 * `BlocksModule` is imported because every circle read path has to honour
 * blocks (CLAUDE.md §2.5) and the rule lives in exactly one place — this module
 * consumes `BlocksService`, it does not re-derive "is this pair blocked".
 *
 * There is no worker module and no queue: async LLM categorization was dropped
 * (DECISIONS.md D-058), so `category` is set synchronously from the request.
 */
@Module({
  imports: [BlocksModule],
  controllers: [CirclesController],
  providers: [CirclesService],
  exports: [CirclesService],
})
export class CirclesModule {}

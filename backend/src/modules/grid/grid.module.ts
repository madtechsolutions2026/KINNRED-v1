import { Module } from '@nestjs/common';
import { GridController } from './grid.controller';
import { GridService } from './grid.service';
import { LocationFuzzService } from './location-fuzz.service';
import { MediaModule } from '../media/media.module';

/**
 * Grid — proximity discovery.
 *
 * Imports MediaModule for photo rendering. VisibilityService and BlocksService
 * arrive via their global modules: the Grid is the single largest consumer of
 * both (a page of results is a batch photo-lock resolution and a batch block
 * exclusion), and neither rule is restated here.
 *
 * LocationFuzzService is provided but NOT exported. Nothing outside this module
 * has any business computing a location offset — the fuzzed point is written
 * once, at the same moment as the exact one, and everything else reads the
 * stored column.
 */
@Module({
  imports: [MediaModule],
  controllers: [GridController],
  providers: [GridService, LocationFuzzService],
  exports: [GridService],
})
export class GridModule {}

import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Put,
  Query,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { GridService } from './grid.service';
import { UpdateLocationDto } from './dto/update-location.dto';
import { NearbyQueryDto } from './dto/nearby-query.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

/**
 * Thin by construction. The interesting decisions — which point is public,
 * which distance is reportable, who is excluded — are all in the service,
 * because this controller's two endpoints are the highest-value polling target
 * in the product.
 */
@ApiTags('grid')
@ApiBearerAuth()
@Controller('grid')
export class GridController {
  constructor(private readonly grid: GridService) {}

  @Put('location')
  @HttpCode(HttpStatus.OK)
  // Well above what a real client needs: the service-side debounce already
  // discards reports that have not moved, so a chatty client costs a cheap
  // SELECT rather than a write. The cap is here to bound the cost of a client
  // in a tight loop, not to shape normal behaviour.
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Report your current position',
    description:
      'Always written for the authenticated caller. Persisted only if you have moved far enough or enough time has passed — the response says which.',
  })
  updateLocation(
    @CurrentUser('userId') userId: string,
    @Body() dto: UpdateLocationDto,
  ) {
    return this.grid.updateLocation(userId, dto.lat, dto.lng);
  }

  @Delete('location')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Forget your position',
    description:
      'Deletes the stored coordinates outright. Different from turning off discoverability, which hides you while the position is retained.',
  })
  deleteLocation(@CurrentUser('userId') userId: string) {
    return this.grid.deleteLocation(userId);
  }

  @Get('nearby')
  // Tighter than the global default, deliberately. Polling is the attack on
  // this endpoint: it is how an observer accumulates samples of someone else's
  // position over time. The fuzzing is designed so that extra samples reveal
  // nothing new, but there is no reason to make collecting them free.
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({
    summary: 'People near you',
    description:
      'Ordered by distance. Distances are coarse buckets and no coordinates are returned — see CLAUDE.md §2.2. Requires that you have shared your own location.',
  })
  nearby(
    @CurrentUser('userId') userId: string,
    @Query() query: NearbyQueryDto,
  ) {
    return this.grid.nearby(userId, query);
  }
}

import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { PlansService } from './plans.service';
import {
  BrowsePlansDto,
  CreatePlanDto,
  DecidePlanRequestDto,
} from './dto/plan.dto';
@ApiTags('plans')
@ApiBearerAuth()
@Controller('plans')
export class PlansController {
  constructor(private readonly plans: PlansService) {}
  @Get()
  @ApiOperation({
    summary: 'Upcoming nearby plans or your hosted/joined plans',
  })
  browse(
    @CurrentUser('userId') userId: string,
    @Query() query: BrowsePlansDto,
  ) {
    return this.plans.browse(userId, query);
  }
  @Post()
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @ApiOperation({ summary: 'Host a plan' })
  create(@CurrentUser('userId') userId: string, @Body() dto: CreatePlanDto) {
    return this.plans.create(userId, dto);
  }
  @Post(':shortId/requests')
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  @ApiOperation({ summary: 'Request to join a plan' })
  request(@CurrentUser('userId') userId: string, @Param('shortId') id: string) {
    return this.plans.request(userId, id);
  }
  @Delete(':shortId/requests/me')
  @ApiOperation({ summary: 'Withdraw your request or leave a plan' })
  withdraw(
    @CurrentUser('userId') userId: string,
    @Param('shortId') id: string,
  ) {
    return this.plans.withdraw(userId, id);
  }
  @Patch(':shortId/requests/:requester')
  @ApiOperation({ summary: 'Host accepts or rejects a pending request' })
  decide(
    @CurrentUser('userId') userId: string,
    @Param('shortId') id: string,
    @Param('requester') requester: string,
    @Body() dto: DecidePlanRequestDto,
  ) {
    return this.plans.decide(userId, id, requester, dto.state);
  }
  @Delete(':shortId')
  @ApiOperation({ summary: 'Host cancels a plan' })
  cancel(@CurrentUser('userId') userId: string, @Param('shortId') id: string) {
    return this.plans.cancel(userId, id);
  }
}

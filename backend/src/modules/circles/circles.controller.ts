import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { CirclesService } from './circles.service';
import { CreateCircleDto } from './dto/create-circle.dto';
import { UpdateCircleDto } from './dto/update-circle.dto';
import { BrowseCirclesDto } from './dto/browse-circles.dto';
import { InviteMemberDto } from './dto/invite-member.dto';
import { CreatePostDto } from './dto/create-post.dto';
import { SendCircleMessageDto } from './dto/send-circle-message.dto';
import { CircleFeedQueryDto } from './dto/circle-feed-query.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

/**
 * Thin by construction. Every rule — the verified gate, admin authority,
 * INCOGNITO invisibility, blocks — is in the service, because these routes are
 * reachable with any short id a client cares to try.
 *
 * Static paths (`/mine`) are declared before `/:shortId` so Nest does not
 * match "mine" as a short id.
 */
@ApiTags('circles')
@ApiBearerAuth()
@Controller('circles')
export class CirclesController {
  constructor(private readonly circles: CirclesService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Create a circle',
    description:
      'Requires a verified account. The creator becomes the first ADMIN member.',
  })
  create(@CurrentUser('userId') userId: string, @Body() dto: CreateCircleDto) {
    return this.circles.create(userId, dto);
  }

  @Get()
  @ApiOperation({
    summary: 'Browse / search circles',
    description:
      'Incognito circles are never listed. Cursor-paginated by publicShortId.',
  })
  browse(
    @CurrentUser('userId') userId: string,
    @Query() query: BrowseCirclesDto,
  ) {
    return this.circles.browse(userId, query);
  }

  @Get('mine')
  @ApiOperation({ summary: 'Circles you are in, invited to, or awaiting on' })
  mine(@CurrentUser('userId') userId: string) {
    return this.circles.listMine(userId);
  }

  @Get(':shortId')
  @ApiOperation({
    summary: 'Get a circle by public short id',
    description:
      'An incognito circle 404s for anyone who is not a member or invitee.',
  })
  get(
    @CurrentUser('userId') userId: string,
    @Param('shortId') shortId: string,
  ) {
    return this.circles.getByShortId(userId, shortId);
  }

  @Patch(':shortId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Edit a circle (admin only)' })
  update(
    @CurrentUser('userId') userId: string,
    @Param('shortId') shortId: string,
    @Body() dto: UpdateCircleDto,
  ) {
    return this.circles.update(userId, shortId, dto);
  }

  @Get(':shortId/members')
  @ApiOperation({ summary: 'Active members (blocked pairs filtered out)' })
  members(
    @CurrentUser('userId') userId: string,
    @Param('shortId') shortId: string,
  ) {
    return this.circles.listMembers(userId, shortId);
  }

  @Get(':shortId/requests')
  @ApiOperation({ summary: 'Pending join requests (admin only)' })
  requests(
    @CurrentUser('userId') userId: string,
    @Param('shortId') shortId: string,
  ) {
    return this.circles.listJoinRequests(userId, shortId);
  }

  @Post(':shortId/join')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Join an open circle' })
  join(
    @CurrentUser('userId') userId: string,
    @Param('shortId') shortId: string,
  ) {
    return this.circles.join(userId, shortId);
  }

  @Post(':shortId/request')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Request to join an invite-only circle' })
  request(
    @CurrentUser('userId') userId: string,
    @Param('shortId') shortId: string,
  ) {
    return this.circles.requestToJoin(userId, shortId);
  }

  @Post(':shortId/requests/:userShortId/approve')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Approve a join request (admin only)' })
  approve(
    @CurrentUser('userId') userId: string,
    @Param('shortId') shortId: string,
    @Param('userShortId') userShortId: string,
  ) {
    return this.circles.decideRequest(userId, shortId, userShortId, true);
  }

  @Post(':shortId/requests/:userShortId/reject')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reject a join request (admin only)' })
  reject(
    @CurrentUser('userId') userId: string,
    @Param('shortId') shortId: string,
    @Param('userShortId') userShortId: string,
  ) {
    return this.circles.decideRequest(userId, shortId, userShortId, false);
  }

  @Post(':shortId/invite')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Invite a user (admin only)',
    description: 'The only way into an incognito circle.',
  })
  invite(
    @CurrentUser('userId') userId: string,
    @Param('shortId') shortId: string,
    @Body() dto: InviteMemberDto,
  ) {
    return this.circles.invite(userId, shortId, dto.publicShortId);
  }

  @Post(':shortId/accept-invite')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Accept an invite' })
  acceptInvite(
    @CurrentUser('userId') userId: string,
    @Param('shortId') shortId: string,
  ) {
    return this.circles.acceptInvite(userId, shortId);
  }

  @Post(':shortId/leave')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Leave a circle (or decline an invite / withdraw a request)',
  })
  leave(
    @CurrentUser('userId') userId: string,
    @Param('shortId') shortId: string,
  ) {
    return this.circles.leave(userId, shortId);
  }

  @Delete(':shortId/members/:userShortId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Remove a member (admin only)' })
  kick(
    @CurrentUser('userId') userId: string,
    @Param('shortId') shortId: string,
    @Param('userShortId') userShortId: string,
  ) {
    return this.circles.kick(userId, shortId, userShortId);
  }

  // --- S9: posts ---------------------------------------------------------

  @Post(':shortId/posts')
  @HttpCode(HttpStatus.CREATED)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Create a post (admin only)',
    description:
      'Optionally scheduled and/or with a member reminder. A future scheduledFor hides the post until then.',
  })
  createPost(
    @CurrentUser('userId') userId: string,
    @Param('shortId') shortId: string,
    @Body() dto: CreatePostDto,
  ) {
    return this.circles.createPost(userId, shortId, dto);
  }

  @Get(':shortId/posts')
  @ApiOperation({
    summary: 'The circle feed (members only)',
    description:
      'Newest first, cursor-paginated. Scheduled posts are shown only to an admin until they publish.',
  })
  listPosts(
    @CurrentUser('userId') userId: string,
    @Param('shortId') shortId: string,
    @Query() query: CircleFeedQueryDto,
  ) {
    return this.circles.listPosts(userId, shortId, query);
  }

  @Delete(':shortId/posts/:postId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete a post (author or admin)' })
  deletePost(
    @CurrentUser('userId') userId: string,
    @Param('shortId') shortId: string,
    @Param('postId') postId: string,
  ) {
    return this.circles.deletePost(userId, shortId, postId);
  }

  // --- S9: group chat --------------------------------------------------

  @Get(':shortId/messages')
  @ApiOperation({
    summary: 'Group chat history (members only, chat must be enabled)',
    description: 'Newest first, cursor-paginated.',
  })
  listMessages(
    @CurrentUser('userId') userId: string,
    @Param('shortId') shortId: string,
    @Query() query: CircleFeedQueryDto,
  ) {
    return this.circles.listMessages(userId, shortId, query);
  }

  @Post(':shortId/messages')
  @HttpCode(HttpStatus.CREATED)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Send a group-chat message (members only, chat must be enabled)',
    description:
      'Delivered over the socket to every other active member; membership and chat state are re-checked on every message.',
  })
  sendMessage(
    @CurrentUser('userId') userId: string,
    @Param('shortId') shortId: string,
    @Body() dto: SendCircleMessageDto,
  ) {
    return this.circles.sendMessage(userId, shortId, dto.body);
  }
}

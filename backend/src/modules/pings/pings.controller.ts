import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PingsService } from './pings.service';
import { BlocksService } from '../../common/blocks/blocks.service';
import { SendPingDto } from './dto/send-ping.dto';
import { SendMessageDto } from './dto/send-message.dto';
import { ThreadQueryDto } from './dto/thread-query.dto';
import { BlockUserDto } from './dto/block-user.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

/**
 * Thin by construction. Every authorisation decision — participation, ping
 * state, blocks — lives in the service, because these endpoints are reachable
 * with any ping id a client cares to try.
 */
@ApiTags('pings')
@ApiBearerAuth()
@Controller('pings')
export class PingsController {
  constructor(
    private readonly pings: PingsService,
    private readonly blocks: BlocksService,
  ) {}

  // --- Lifecycle -----------------------------------------------------------

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Send a ping',
    description:
      'Addressed by public short id. If the target has already pinged you and is waiting, this accepts their request instead of creating a second one.',
  })
  send(@CurrentUser('userId') userId: string, @Body() dto: SendPingDto) {
    return this.pings.send(userId, dto.toPublicShortId, dto.openingMessage);
  }

  @Post(':pingId/accept')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Accept an inbound ping',
    description:
      "Recipient only. Opens messaging and — per CLAUDE.md §2.1 — unlocks the accepter's photos to the sender.",
  })
  accept(
    @CurrentUser('userId') userId: string,
    @Param('pingId') pingId: string,
  ) {
    return this.pings.accept(userId, pingId);
  }

  @Post(':pingId/reject')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Decline an inbound ping',
    description:
      'Recipient only. Terminal for the pair — neither side can re-ping.',
  })
  reject(
    @CurrentUser('userId') userId: string,
    @Param('pingId') pingId: string,
  ) {
    return this.pings.reject(userId, pingId);
  }

  @Delete(':pingId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Withdraw your own undecided ping',
    description:
      'Sender only. Deletes the request so it leaves no trace for the recipient and frees the pair for a future attempt.',
  })
  withdraw(
    @CurrentUser('userId') userId: string,
    @Param('pingId') pingId: string,
  ) {
    return this.pings.withdraw(userId, pingId);
  }

  // --- Folders -------------------------------------------------------------

  @Get('requests')
  @ApiOperation({ summary: 'Requests folder — inbound and undecided' })
  requests(@CurrentUser('userId') userId: string) {
    return this.pings.listRequests(userId);
  }

  @Get('sent')
  @ApiOperation({ summary: 'Your outbound pings still awaiting a decision' })
  sent(@CurrentUser('userId') userId: string) {
    return this.pings.listSent(userId);
  }

  @Get('chats')
  @ApiOperation({ summary: 'Chats folder — accepted connections' })
  chats(@CurrentUser('userId') userId: string) {
    return this.pings.listChats(userId);
  }

  // --- Messaging -----------------------------------------------------------

  @Get(':pingId/messages')
  @ApiOperation({
    summary: 'Message history, newest first',
    description: "Cursor-paginated. Pass the previous page's nextCursor.",
  })
  thread(
    @CurrentUser('userId') userId: string,
    @Param('pingId') pingId: string,
    @Query() query: ThreadQueryDto,
  ) {
    return this.pings.getThread(userId, pingId, query.cursor, query.limit);
  }

  @Post(':pingId/messages')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Send a message',
    description:
      'REST rather than a socket event, deliberately: one write path means validation, block checks and ping-state authorisation exist in exactly one place. The socket delivers.',
  })
  message(
    @CurrentUser('userId') userId: string,
    @Param('pingId') pingId: string,
    @Body() dto: SendMessageDto,
  ) {
    return this.pings.sendMessage(userId, pingId, dto.body);
  }

  @Post(':pingId/read')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Mark the other participant's messages as read" })
  read(@CurrentUser('userId') userId: string, @Param('pingId') pingId: string) {
    return this.pings.markRead(userId, pingId);
  }
}

/**
 * Blocking lives on its own path, not under /pings/:id.
 *
 * Blocking someone you have never pinged must work, so it cannot be addressed
 * through a ping.
 */
@ApiTags('blocks')
@ApiBearerAuth()
@Controller('blocks')
export class BlocksController {
  constructor(private readonly blocks: BlocksService) {}

  @Get()
  @ApiOperation({ summary: 'Users you have blocked' })
  list(@CurrentUser('userId') userId: string) {
    return this.blocks.listBlocked(userId);
  }

  @Post()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Block a user',
    description:
      'Idempotent. Enforced symmetrically: the pair becomes mutually invisible regardless of who blocked whom.',
  })
  block(@CurrentUser('userId') userId: string, @Body() dto: BlockUserDto) {
    return this.blocks.block(userId, dto.publicShortId);
  }

  @Delete(':publicShortId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Unblock a user',
    description:
      'Returns the pair to strangers. Does NOT restore a rejected or withdrawn ping.',
  })
  unblock(
    @CurrentUser('userId') userId: string,
    @Param('publicShortId') publicShortId: string,
  ) {
    return this.blocks.unblock(userId, publicShortId);
  }
}

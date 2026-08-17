import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { IsEnum } from 'class-validator';
import { MediaService } from './media.service';
import { RequestUploadDto } from './dto/request-upload.dto';
import { Body } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { MediaKind } from '../../generated/prisma/enums';

class ListQueryDto {
  @IsEnum(MediaKind)
  kind!: MediaKind;
}

/**
 * Media endpoints.
 *
 * Every route here is authenticated — there is no @Public() in this file, and
 * there should never be one. The acting user always comes from the verified
 * token via @CurrentUser(); no endpoint accepts an owner id.
 */
@ApiTags('media')
@ApiBearerAuth()
@Controller('media')
export class MediaController {
  constructor(private readonly media: MediaService) {}

  @Post('upload-url')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Reserve an upload',
    description:
      'Creates a PENDING asset and returns a presigned PUT URL. Upload the bytes directly to that URL, then call /media/{id}/confirm.',
  })
  requestUpload(
    @CurrentUser('userId') userId: string,
    @Body() dto: RequestUploadDto,
  ) {
    return this.media.requestUpload(userId, dto.kind, dto.contentType);
  }

  @Post(':id/confirm')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Confirm an upload finished',
    description:
      'Queues validation. The worker independently fetches and inspects the object — this call is trusted only as a signal that the upload completed, never about its contents.',
  })
  confirm(@CurrentUser('userId') userId: string, @Param('id') id: string) {
    return this.media.confirmUpload(userId, id);
  }

  @Get()
  @ApiQuery({ name: 'kind', enum: MediaKind })
  @ApiOperation({ summary: "List the acting user's own media" })
  list(@CurrentUser('userId') userId: string, @Query() query: ListQueryDto) {
    return this.media.listOwn(userId, query.kind);
  }

  @Get(':id/url')
  @ApiOperation({
    summary: 'Short-lived read URL for your own asset',
    description:
      'Only READY assets are servable. Cross-user access is never available here — another user’s photos are served through their profile, resolved by VisibilityService.',
  })
  readUrl(@CurrentUser('userId') userId: string, @Param('id') id: string) {
    return this.media.getOwnReadUrl(userId, id);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete your own asset' })
  remove(@CurrentUser('userId') userId: string, @Param('id') id: string) {
    return this.media.deleteAsset(userId, id);
  }
}

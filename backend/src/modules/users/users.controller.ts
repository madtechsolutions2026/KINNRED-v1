import { Body, Controller, Get, Param, Patch } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UsersService } from './users.service';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { UpdateSettingsDto } from './dto/update-settings.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

/**
 * Myspace — profile, settings, QR, and viewing other people.
 *
 * Every route is authenticated; there is no @Public() here. Even a "public"
 * profile read requires a token, because the viewer's identity is what the
 * photo-visibility decision is made against.
 */
@ApiTags('users')
@ApiBearerAuth()
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get('me')
  @ApiOperation({ summary: 'Your own Myspace' })
  me(@CurrentUser('userId') userId: string) {
    return this.users.getMyProfile(userId);
  }

  @Patch('me')
  @ApiOperation({ summary: 'Update your profile' })
  updateMe(
    @CurrentUser('userId') userId: string,
    @Body() dto: UpdateProfileDto,
  ) {
    return this.users.updateMyProfile(userId, dto);
  }

  @Patch('me/settings')
  @ApiOperation({
    summary: 'Update your privacy settings',
    description:
      'Covers photo locking and the stay-locked-regardless override. Identity fields (gender, verification status, phone) are not settable here by design.',
  })
  updateSettings(
    @CurrentUser('userId') userId: string,
    @Body() dto: UpdateSettingsDto,
  ) {
    return this.users.updateMySettings(userId, dto);
  }

  @Get('me/qr')
  @ApiOperation({
    summary: 'Your shareable QR code',
    description:
      'Returns the deep link plus an SVG. Encodes only your public short id — never your phone number or internal id.',
  })
  qr(@CurrentUser('userId') userId: string) {
    return this.users.getMyQr(userId);
  }

  @Get('me/viewers')
  @ApiOperation({
    summary: 'Who viewed your profile',
    description:
      'Unavailable if you have turned off profile-view recording — browsing invisibly and still seeing your own viewers would be a one-way mirror.',
  })
  viewers(@CurrentUser('userId') userId: string) {
    return this.users.getMyViewers(userId);
  }

  /**
   * Declared last: a literal path like `me` must be registered before this
   * parameterised route, or `/users/me` would match here with
   * publicShortId="me".
   */
  @Get(':publicShortId')
  @ApiOperation({
    summary: "Another user's profile, by public short id",
    description:
      'Photos are resolved through VisibilityService — locked profiles return blurred derivatives, and the real image key is never signed.',
  })
  publicProfile(
    @CurrentUser('userId') viewerId: string,
    @Param('publicShortId') publicShortId: string,
  ) {
    return this.users.getPublicProfile(viewerId, publicShortId);
  }
}

import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { RequestOtpDto } from './dto/request-otp.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import { RegisterDto } from './dto/register.dto';
import { RefreshDto } from './dto/refresh.dto';
import { Public } from '../../common/decorators/public.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

/**
 * Auth endpoints.
 *
 * Controllers stay thin (CLAUDE.md §3): validate via DTO, call one service
 * method, return. No business logic and no Prisma here.
 *
 * Every @Public() below is a deliberate hole in the auth surface — these are
 * the only routes that can be reached without a bearer token, because they are
 * how a token is obtained in the first place.
 */
@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('otp/request')
  @HttpCode(HttpStatus.OK)
  // Per-IP throttle. This is the OUTER layer only — the service additionally
  // enforces a per-phone hourly cap in Redis, which is what actually stops SMS
  // cost abuse from an attacker rotating IP addresses.
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Request an OTP',
    description:
      'Returns an identical response whether or not the number has an account, so this endpoint cannot be used to discover who is registered.',
  })
  @ApiResponse({
    status: 429,
    description: 'Rate limit exceeded (per IP or per phone).',
  })
  requestOtp(@Body() dto: RequestOtpDto) {
    return this.auth.requestOtp(dto.phone);
  }

  @Public()
  @Post('otp/verify')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Verify an OTP',
    description:
      'On success returns either a session, or `registration_required` with a short-lived ticket when the number has no account yet.',
  })
  @ApiResponse({ status: 401, description: 'Invalid or expired code.' })
  verifyOtp(@Body() dto: VerifyOtpDto) {
    return this.auth.verifyOtp(dto.phone, dto.code, dto.deviceLabel);
  }

  @Public()
  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Complete signup',
    description:
      'Exchanges a registration ticket for an account. The phone number is taken from the signed ticket, never from the request body.',
  })
  register(@Body() dto: RegisterDto) {
    return this.auth.register(
      dto.registrationTicket,
      dto.gender,
      dto.dateOfBirth,
      dto.deviceLabel,
    );
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Rotate tokens',
    description:
      'Exchanges a refresh token for a new pair. Presenting an already-used token is treated as theft and revokes the entire session family.',
  })
  refresh(@Body() dto: RefreshDto) {
    return this.auth.refresh(dto.refreshToken);
  }

  // Public because the refresh token itself is the credential here, and a
  // caller with an expired access token must still be able to log out.
  @Public()
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Log out this device' })
  logout(@Body() dto: RefreshDto) {
    return this.auth.logout(dto.refreshToken);
  }

  @Post('logout-all')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Log out everywhere',
    description: 'Revokes every active session for the acting user.',
  })
  logoutAll(@CurrentUser('userId') userId: string) {
    return this.auth.logoutAll(userId);
  }

  @Get('me')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'The acting user' })
  me(@CurrentUser('userId') userId: string) {
    return this.auth.getMe(userId);
  }
}

import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiExcludeEndpoint,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { VerificationService } from './verification.service';
import { SubmitVerificationDto } from './dto/submit-verification.dto';
import { AdminDecisionDto } from './dto/admin-decision.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';

@ApiTags('verification')
@Controller('verification')
export class VerificationController {
  constructor(private readonly verification: VerificationService) {}

  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Submit for verification',
    description:
      'Takes ids of already-uploaded KYC media, never raw bytes — so KYC images follow the same validated pipeline as everything else and land in the separate KYC bucket.',
  })
  submit(
    @CurrentUser('userId') userId: string,
    @Body() dto: SubmitVerificationDto,
  ) {
    return this.verification.submit(
      userId,
      dto.selfieAssetId,
      dto.documentAssetId,
    );
  }

  @Get('status')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Your verification status' })
  status(@CurrentUser('userId') userId: string) {
    return this.verification.getStatus(userId);
  }

  /**
   * Provider callback.
   *
   * @Public() because the caller is the KYC vendor, which has no Kinnred token.
   * Its authentication is the HMAC signature over the raw body — one of the
   * five deliberate holes in the auth surface (D-021), and the only one whose
   * credential is not a JWT.
   *
   * Needs `rawBody`: signatures are computed over exact bytes, and
   * re-serialising parsed JSON will not reproduce them.
   */
  @Public()
  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  @ApiExcludeEndpoint()
  webhook(
    @Req() req: RawBodyRequest<Request>,
    @Headers('x-kyc-signature') signature: string | undefined,
    @Body() payload: unknown,
  ) {
    // Fail closed if the raw body is unavailable — verifying a signature
    // against a re-serialised body would silently always fail, or worse,
    // tempt someone into skipping verification entirely.
    const raw = req.rawBody ?? Buffer.alloc(0);
    return this.verification.handleWebhook(raw, signature, payload);
  }

  /**
   * Manual decision, for when no vendor is wired or a case needs review.
   *
   * @Public() at the guard level because an operator is not a Kinnred user,
   * but it is NOT unauthenticated — it requires the admin token. Marked
   * excluded from Swagger so the public schema does not advertise it.
   */
  @Public()
  @Post(':requestId/decide')
  @HttpCode(HttpStatus.OK)
  @ApiExcludeEndpoint()
  decide(
    @Param('requestId') requestId: string,
    @Headers('x-admin-token') adminToken: string | undefined,
    @Body() dto: AdminDecisionDto,
  ) {
    this.verification.assertAdmin(adminToken);
    return this.verification.adminDecide(
      requestId,
      dto.outcome,
      dto.reason,
      dto.actor ?? 'unknown',
    );
  }
}

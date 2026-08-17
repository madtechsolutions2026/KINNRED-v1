import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsString, Matches } from 'class-validator';
import { normalizeToE164 } from '../../../common/phone/phone.util';

export class RequestOtpDto {
  @ApiProperty({
    example: '+919876543210',
    description:
      'Phone number in E.164 format, including country code. Normalised server-side before storage.',
  })
  @Transform(({ value }): string => {
    if (typeof value !== 'string') return '';
    // Normalise at the edge so the service and database only ever see
    // canonical E.164 — see phone.util for why this matters for uniqueness.
    return normalizeToE164(value) ?? '';
  })
  @IsString()
  @Matches(/^\+[1-9]\d{7,14}$/, {
    message:
      'phone must be a valid phone number in E.164 format, e.g. +919876543210',
  })
  phone!: string;
}

import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsOptional, IsString, Length, Matches } from 'class-validator';
import { normalizeToE164 } from '../../../common/phone/phone.util';

export class VerifyOtpDto {
  @ApiProperty({ example: '+919876543210' })
  @Transform(({ value }): string => {
    if (typeof value !== 'string') return '';
    return normalizeToE164(value) ?? '';
  })
  @IsString()
  @Matches(/^\+[1-9]\d{7,14}$/, {
    message: 'phone must be a valid phone number in E.164 format',
  })
  phone!: string;

  @ApiProperty({
    example: '482913',
    description: 'The 6-digit code sent by SMS.',
  })
  @IsString()
  @Matches(/^\d{6}$/, { message: 'code must be exactly 6 digits' })
  code!: string;

  @ApiProperty({
    required: false,
    description:
      'Optional client-supplied device label, shown on a future "active sessions" screen. ' +
      'Never used for any authorisation decision — it is untrusted input.',
    example: 'Pixel 8 / Chrome',
  })
  @IsOptional()
  @IsString()
  @Length(1, 100)
  deviceLabel?: string;
}

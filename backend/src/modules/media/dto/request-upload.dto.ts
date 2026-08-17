import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsIn, IsString } from 'class-validator';
import { MediaKind } from '../../../generated/prisma/enums';

export class RequestUploadDto {
  @ApiProperty({
    enum: MediaKind,
    description:
      'Which pipeline this upload belongs to. Determines the storage bucket — profile photos and KYC documents are stored separately with separate credentials.',
  })
  @IsEnum(MediaKind, {
    message: `kind must be one of: ${Object.values(MediaKind).join(', ')}`,
  })
  kind!: MediaKind;

  @ApiProperty({
    example: 'image/jpeg',
    description:
      'Declared content type. Used only to sign the upload URL — the real format is determined by the worker decoding the bytes, so this is never trusted.',
  })
  @IsString()
  @IsIn(['image/jpeg', 'image/png', 'image/webp'], {
    message: 'contentType must be image/jpeg, image/png or image/webp',
  })
  contentType!: string;
}

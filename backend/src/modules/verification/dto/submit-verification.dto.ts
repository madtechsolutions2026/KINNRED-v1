import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, Length } from 'class-validator';

export class SubmitVerificationDto {
  @ApiProperty({
    description:
      'Id of a READY MediaAsset with kind=KYC_DOCUMENT — upload it through /media first. Ownership, kind and status are all re-checked server-side.',
  })
  @IsString()
  @Length(1, 64)
  selfieAssetId!: string;

  @ApiPropertyOptional({
    description: 'Optional government ID document, same upload path.',
  })
  @IsOptional()
  @IsString()
  @Length(1, 64)
  documentAssetId?: string;
}

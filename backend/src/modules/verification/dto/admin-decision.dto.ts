import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, Length } from 'class-validator';

export class AdminDecisionDto {
  @ApiProperty({ enum: ['APPROVED', 'REJECTED'] })
  @IsIn(['APPROVED', 'REJECTED'])
  outcome!: 'APPROVED' | 'REJECTED';

  @ApiPropertyOptional({
    description:
      'Shown to the user on rejection, so a failed attempt is actionable rather than mysterious.',
  })
  @IsOptional()
  @IsString()
  @Length(1, 300)
  reason?: string;

  @ApiPropertyOptional({
    description:
      'Who is deciding. Recorded on the request for audit. A stopgap until there is a real admin identity model.',
  })
  @IsOptional()
  @IsString()
  @Length(1, 60)
  actor?: string;
}

import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';

export class RefreshDto {
  @ApiProperty({
    description:
      'The opaque refresh token issued alongside the last access token. Rotated on every use.',
  })
  @IsString()
  @MinLength(20)
  refreshToken!: string;
}

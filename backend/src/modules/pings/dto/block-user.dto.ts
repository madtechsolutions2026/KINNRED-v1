import { IsString, Length } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class BlockUserDto {
  @ApiProperty({ description: "The target's public short id" })
  @IsString()
  @Length(1, 64)
  publicShortId!: string;
}

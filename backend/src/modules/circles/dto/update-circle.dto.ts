import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsEnum,
  IsOptional,
  IsString,
  Length,
  MaxLength,
} from 'class-validator';
import { CircleCategory } from '../../../generated/prisma/enums';

/**
 * Fields an admin may change after creation.
 *
 * `tier` is deliberately absent: flipping an INCOGNITO or INVITE_ONLY circle to
 * OPEN would retroactively expose members who joined under a privacy
 * expectation, and the reverse would strand people mid-join. A tier change is a
 * new circle, not an edit.
 */
export class UpdateCircleDto {
  @ApiPropertyOptional({ minLength: 3, maxLength: 60 })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @Length(3, 60)
  name?: string;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiPropertyOptional({ enum: CircleCategory })
  @IsOptional()
  @IsEnum(CircleCategory)
  category?: CircleCategory;
}

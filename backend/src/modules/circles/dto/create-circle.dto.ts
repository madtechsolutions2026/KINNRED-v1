import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsEnum,
  IsOptional,
  IsString,
  Length,
  MaxLength,
} from 'class-validator';
import { CircleCategory, CircleTier } from '../../../generated/prisma/enums';

/**
 * Everything a client supplies to create a circle.
 *
 * Note what is NOT here: no `createdById` (the acting user is taken from the
 * JWT, CLAUDE.md §2.3) and no membership seed (the creator is made an ADMIN
 * member by the service, not by the request).
 *
 * `category` is a plain enum field the creator picks — there is no async LLM
 * categorization (DECISIONS.md D-058). Omitted ⇒ `OTHER`. `@IsEnum` rejects
 * anything outside the fixed set before it can reach the database, and the
 * service re-checks it.
 */
export class CreateCircleDto {
  @ApiProperty({ example: 'Sunday Trail Runners', minLength: 3, maxLength: 60 })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @Length(3, 60)
  name!: string;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiProperty({ enum: CircleTier })
  @IsEnum(CircleTier)
  tier!: CircleTier;

  @ApiPropertyOptional({ enum: CircleCategory, default: CircleCategory.OTHER })
  @IsOptional()
  @IsEnum(CircleCategory)
  category?: CircleCategory;
}

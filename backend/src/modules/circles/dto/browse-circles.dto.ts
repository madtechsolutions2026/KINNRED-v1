import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { CircleCategory } from '../../../generated/prisma/enums';

/**
 * Query for browse/search.
 *
 * INCOGNITO circles are never returned here regardless of the filters — that
 * exclusion lives in the service, not in an optional param a client could flip.
 * The cursor is a circle `publicShortId`, never an encoded rank or offset.
 */
export class BrowseCirclesDto {
  @ApiPropertyOptional({
    description: 'Free-text match on name',
    maxLength: 60,
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MaxLength(60)
  q?: string;

  @ApiPropertyOptional({ enum: CircleCategory })
  @IsOptional()
  @IsEnum(CircleCategory)
  category?: CircleCategory;

  @ApiPropertyOptional({ description: 'publicShortId from the previous page' })
  @IsOptional()
  @IsString()
  cursor?: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 50, default: 25 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;
}

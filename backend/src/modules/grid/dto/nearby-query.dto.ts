import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import { Gender, LookingFor } from '../../../generated/prisma/enums';
import {
  GRID_DEFAULT_RADIUS_METERS,
  GRID_RADIUS_METERS,
} from '../distance-buckets';

/**
 * Repeated query parameters arrive as a string when there is one value and an
 * array when there are several (`?genders=FEMALE` vs `?genders=FEMALE&genders=MALE`).
 * Normalising to an array here means the service never has to care, and an
 * empty string becomes "no filter" rather than a filter matching nothing.
 */
const toArray = ({ value }: { value: unknown }): unknown => {
  if (value === undefined || value === null || value === '') return undefined;
  return Array.isArray(value) ? value : [value];
};

export class NearbyQueryDto {
  /**
   * ⚠ Constrained to the bucket edges, and that constraint is load-bearing.
   *
   * A free-form radius defeats the distance buckets outright: present at 1000m
   * and absent at 900m brackets the true distance to 100m, and a binary search
   * over ~14 requests recovers it to the meter. `@IsIn` against the same array
   * the buckets are built from is what closes it (see distance-buckets.ts).
   */
  @ApiPropertyOptional({
    enum: GRID_RADIUS_METERS,
    default: GRID_DEFAULT_RADIUS_METERS,
    description:
      'Search radius. Only these exact values are accepted — an arbitrary radius would let a caller binary-search the true distance.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsIn(GRID_RADIUS_METERS as readonly number[])
  radiusMeters?: number;

  @ApiPropertyOptional({ minimum: 18, maximum: 120, example: 21 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(18)
  @Max(120)
  minAge?: number;

  @ApiPropertyOptional({ minimum: 18, maximum: 120, example: 35 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(18)
  @Max(120)
  maxAge?: number;

  /**
   * A DISPLAY filter and nothing else. Gender carries no permission weight
   * anywhere in this system (CLAUDE.md §2.1, D-017/D-036) — filtering a result
   * set by it reveals nothing that the profile itself does not already show.
   */
  @ApiPropertyOptional({ enum: Gender, isArray: true })
  @IsOptional()
  @Transform(toArray)
  @IsArray()
  @IsEnum(Gender, { each: true })
  genders?: Gender[];

  @ApiPropertyOptional({ enum: LookingFor, isArray: true })
  @IsOptional()
  @Transform(toArray)
  @IsArray()
  @IsEnum(LookingFor, { each: true })
  lookingFor?: LookingFor[];

  @ApiPropertyOptional({
    description:
      'Only people whose location was written within the online window.',
  })
  @IsOptional()
  @Transform(
    ({ value }: { value: unknown }) => value === true || value === 'true',
  )
  @IsBoolean()
  onlineOnly?: boolean;

  /**
   * Opaque to the client — and deliberately NOT an encoded distance.
   *
   * The natural cursor for a distance-ordered set is `(distance, id)`, but
   * distance here is exact by construction and a base64 cursor is readable,
   * which would hand back the precise number the buckets exist to hide. This
   * carries the last row's public short id instead; the server re-derives that
   * user's distance to form the page boundary, and the exact value never
   * leaves the service layer.
   */
  @ApiPropertyOptional({ description: 'nextCursor from the previous page' })
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

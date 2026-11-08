import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsIn,
  IsOptional,
  IsString,
  Length,
  MaxLength,
} from 'class-validator';
import { PlanRequestState } from '../../../generated/prisma/enums';
import {
  GRID_DEFAULT_RADIUS_METERS,
  GRID_RADIUS_METERS,
} from '../../grid/distance-buckets';
export class CreatePlanDto {
  @ApiProperty()
  @IsString()
  @Length(3, 80)
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  title!: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  description?: string;
  @ApiProperty({
    description: 'Public venue or area; never a private home address.',
  })
  @IsString()
  @Length(3, 120)
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  place!: string;
  @ApiProperty() @IsDateString({ strict: true }) startsAt!: string;
}
export class BrowsePlansDto {
  @ApiPropertyOptional({ enum: GRID_RADIUS_METERS })
  @IsOptional()
  @Type(() => Number)
  @IsIn(GRID_RADIUS_METERS)
  radiusMeters: number = GRID_DEFAULT_RADIUS_METERS;
  @ApiPropertyOptional() @IsOptional() @IsIn(['true', 'false']) mine?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(10, 10)
  cursor?: string;
}
export class DecidePlanRequestDto {
  @ApiProperty({ enum: ['ACCEPTED', 'REJECTED'] })
  @IsEnum(PlanRequestState)
  @IsIn(['ACCEPTED', 'REJECTED'])
  state!: 'ACCEPTED' | 'REJECTED';
}

import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsOptional,
  IsString,
  Length,
  MaxLength,
  Matches,
} from 'class-validator';
import { Gender, LookingFor } from '../../../generated/prisma/enums';

/**
 * Every field is optional — this is a partial update.
 *
 * Note what is absent and cannot be added by a client: `isVerified`,
 * `phone`, `publicShortId`, `photosLocked`. The global ValidationPipe runs with
 * `forbidNonWhitelisted`, so sending any of them is a 400 rather than a
 * silently-ignored field.
 */
export class UpdateProfileDto {
  @ApiPropertyOptional({
    description:
      'Unique public username, 3–20 lowercase letters, digits or underscores. Starts with a letter.',
  })
  @IsOptional()
  @IsString()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @Matches(/^[a-z][a-z0-9_]{2,19}$/, {
    message:
      'Username must start with a letter and contain 3–20 letters, digits or underscores',
  })
  username?: string;

  @ApiPropertyOptional({ enum: Gender })
  @IsOptional()
  @IsEnum(Gender)
  gender?: Gender;

  @ApiPropertyOptional({
    maxLength: 40,
    description:
      'Shown instead of a legal name. Never required to be real, and never validated against identity.',
  })
  @IsOptional()
  @IsString()
  @Length(1, 40)
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  displayName?: string;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  bio?: string;

  @ApiPropertyOptional({
    type: [String],
    maxItems: 15,
    description: 'Free-form interest tags, used by the wavelength feed.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(15)
  @IsString({ each: true })
  @Length(1, 30, { each: true })
  @Transform(({ value }: { value: unknown }): unknown => {
    if (!Array.isArray(value)) return value;

    // Normalise before storage: trim, lowercase, drop blanks, dedupe.
    // Without this "Coffee", "coffee " and "coffee" are three distinct tags
    // and interest matching quietly stops working.
    return [
      ...new Set(
        (value as unknown[])
          .filter((v): v is string => typeof v === 'string')
          .map((v) => v.trim().toLowerCase())
          .filter((v) => v.length > 0),
      ),
    ];
  })
  interests?: string[];

  @ApiPropertyOptional({ enum: LookingFor, isArray: true })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5)
  @IsEnum(LookingFor, { each: true })
  lookingFor?: LookingFor[];
}

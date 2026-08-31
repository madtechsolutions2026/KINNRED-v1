import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsISO8601, IsOptional, IsString, Length } from 'class-validator';

/**
 * What an admin supplies to post in a circle.
 *
 * No `authorId` and no `circleId` in the body — the author is the JWT subject
 * (CLAUDE.md §2.3) and the circle is the path param.
 *
 * `scheduledFor` / `reminderAt` are ISO-8601 instants. Bounds ("in the future",
 * "within CIRCLE_SCHEDULE_MAX_DAYS") are enforced in the service, not here — a
 * DTO cannot see config and a past timestamp is a semantic error, not a
 * malformed one.
 */
export class CreatePostDto {
  @ApiProperty({ minLength: 1, maxLength: 2000 })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @Length(1, 2000)
  body!: string;

  @ApiPropertyOptional({
    description:
      'ISO-8601 instant. If in the future, the post is hidden until then.',
    example: '2026-09-15T18:00:00.000Z',
  })
  @IsOptional()
  @IsISO8601()
  scheduledFor?: string;

  @ApiPropertyOptional({
    description: 'ISO-8601 instant. Members are nudged at this time.',
    example: '2026-09-15T17:00:00.000Z',
  })
  @IsOptional()
  @IsISO8601()
  reminderAt?: string;
}

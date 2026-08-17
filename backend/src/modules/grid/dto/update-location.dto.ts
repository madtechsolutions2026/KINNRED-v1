import { ApiProperty } from '@nestjs/swagger';
import { IsNumber, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';

/**
 * A location report from the client.
 *
 * Note what is NOT here: no `userId`. The position is always written for the
 * authenticated caller (CLAUDE.md §2.3) — accepting a user id would let anyone
 * place anyone else anywhere on Earth, which on a proximity app is not a
 * spoofing bug but a physical-safety one.
 *
 * The coordinates themselves ARE client-supplied and cannot be otherwise; a
 * phone is the only thing that knows where it is. Everything downstream is
 * built on the assumption that a caller can lie about their own position —
 * which is why a searcher's origin buys them no precision about anyone else
 * beyond the fuzzed point (see LocationFuzzService).
 *
 * Bounds are explicit `@Min`/`@Max` rather than `@IsLatitude`/`@IsLongitude`:
 * those validators stringify the value and run a lat/long *pair* regex, which
 * is a surprising amount of machinery to sit between a client and a
 * `geography(Point, 4326)` column. Out-of-range values must be rejected here —
 * PostGIS will happily store a latitude of 200 and then compute nonsense
 * distances from it.
 */
export class UpdateLocationDto {
  @ApiProperty({ example: 12.9716, minimum: -90, maximum: 90 })
  @Type(() => Number)
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(-90)
  @Max(90)
  lat!: number;

  @ApiProperty({ example: 77.5946, minimum: -180, maximum: 180 })
  @Type(() => Number)
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(-180)
  @Max(180)
  lng!: number;
}

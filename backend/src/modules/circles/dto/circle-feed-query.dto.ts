import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

/**
 * Cursor query shared by the post feed and the chat history.
 *
 * The cursor is a row id from the previous page — never an encoded offset or
 * timestamp — for the same reason the Grid cursor carries a public short id
 * (D-054): a distance/time-bearing cursor is an information leak and offset
 * paging over a set that grows from the end repeats and drops rows.
 */
export class CircleFeedQueryDto {
  @ApiPropertyOptional({ description: 'Row id from the previous page' })
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

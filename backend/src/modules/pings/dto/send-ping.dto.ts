import { IsOptional, IsString, Length, MaxLength } from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class SendPingDto {
  /**
   * The target's PUBLIC short id — never an internal user id.
   *
   * Clients are never given another user's primary key (S3), so accepting one
   * here would be the only endpoint that leaked it into the client's model of
   * the world.
   */
  @ApiProperty({ description: "The target's public short id" })
  @IsString()
  @Length(1, 64)
  toPublicShortId!: string;

  /**
   * Optional note delivered with the request.
   *
   * Length-capped because this is text pushed at someone who has not consented
   * to contact — the harassment surface on this endpoint. The cap is not about
   * storage.
   */
  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @MaxLength(500)
  openingMessage?: string;
}

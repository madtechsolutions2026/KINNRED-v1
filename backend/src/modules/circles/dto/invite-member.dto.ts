import { IsString, Length } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

/**
 * Names the user to invite by PUBLIC SHORT ID — the same addressing every other
 * user-facing endpoint uses. A client never sees another user's internal id, so
 * accepting one here would be the only place that leaked it.
 */
export class InviteMemberDto {
  @ApiProperty({ description: "The invitee's public short id" })
  @IsString()
  @Length(1, 64)
  publicShortId!: string;
}

import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional } from 'class-validator';

export class UpdateSettingsDto {
  @ApiPropertyOptional({
    description:
      'Lock your photos. Locked photos are shown blurred to viewers who have not earned access. Defaults to on for FEMALE and NON_BINARY at signup, and is yours to change at any time.',
  })
  @IsOptional()
  @IsBoolean()
  photosLocked?: boolean;

  // REMOVED (D-036): `stayLockedRegardless` let an owner opt out of the
  // verified-female unlock. That rule no longer exists — locked photos now
  // open only through a ping the owner sent or accepted — so the setting had
  // nothing left to control. It is deliberately NOT accepted here: with
  // forbidNonWhitelisted, a client still sending it gets a 400 rather than
  // silently believing a privacy toggle was applied.

  @ApiPropertyOptional({
    description:
      'Appear in nearby discovery. Turning this off hides you from the Grid without deleting your account.',
  })
  @IsOptional()
  @IsBoolean()
  discoverable?: boolean;

  @ApiPropertyOptional({
    description:
      'Record your visits in other people\'s "who viewed me" lists. Turning it off means you browse without a trace — and, by the same token, your own viewer list becomes unavailable.',
  })
  @IsOptional()
  @IsBoolean()
  recordProfileViews?: boolean;
}

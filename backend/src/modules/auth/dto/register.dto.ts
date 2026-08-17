import { ApiProperty } from '@nestjs/swagger';
import {
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
  Length,
} from 'class-validator';
import { Gender } from '../../../generated/prisma/enums';

/**
 * Completes signup for a phone number that verified successfully but has no
 * account yet.
 *
 * Note what is NOT here: no `phone`, and no `isVerified`. The phone comes from
 * the signed registration ticket, and KYC status is set only by the
 * verification flow (S4). Accepting either from the client would let a caller
 * register someone else's number, or self-grant the verified status that gates
 * circle creation — which is all it gates. `isVerified` grants no photo access
 * whatsoever (D-036).
 */
export class RegisterDto {
  @ApiProperty({
    description:
      'Short-lived ticket returned by /auth/otp/verify when the phone has no account yet.',
  })
  @IsString()
  registrationTicket!: string;

  @ApiProperty({
    enum: Gender,
    description:
      'Also determines the default photo-lock setting at signup (locked by default for FEMALE and NON_BINARY), which the user owns from then on. Ordinary editable profile data — gender carries no permission weight anywhere in the system (D-017, D-036).',
  })
  @IsEnum(Gender, {
    message: `gender must be one of: ${Object.values(Gender).join(', ')}`,
  })
  gender!: Gender;

  @ApiProperty({
    example: '1998-04-23',
    description: 'Date of birth, YYYY-MM-DD. Used for age filters on the Grid.',
  })
  @IsDateString(
    { strict: true },
    { message: 'dateOfBirth must be an ISO date, e.g. 1998-04-23' },
  )
  dateOfBirth!: string;

  @ApiProperty({ required: false, example: 'Pixel 8 / Chrome' })
  @IsOptional()
  @IsString()
  @Length(1, 100)
  deviceLabel?: string;
}

import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsString, Length } from 'class-validator';

/**
 * One line in a circle's group chat. Delivery, block-filtering and the
 * membership + `chatEnabled` re-check all happen in the service — this only
 * bounds the text.
 */
export class SendCircleMessageDto {
  @ApiProperty({ minLength: 1, maxLength: 2000 })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @Length(1, 2000)
  body!: string;
}

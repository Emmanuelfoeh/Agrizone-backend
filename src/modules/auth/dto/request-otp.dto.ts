import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches } from 'class-validator';

export class RequestOtpDto {
  @ApiProperty({ example: '+233245550142' })
  @IsString()
  @Matches(/^\+?\d{8,15}$/, { message: 'phone must be a valid E.164-ish number' })
  phone!: string;
}

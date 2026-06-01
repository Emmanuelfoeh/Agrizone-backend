import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches } from 'class-validator';

export class VerifyOtpDto {
  @ApiProperty({ example: '+233245550142' })
  @IsString()
  @Matches(/^\+?\d{8,15}$/)
  phone!: string;

  @ApiProperty({ example: '123456' })
  @IsString()
  @Matches(/^\d{4,8}$/)
  code!: string;
}

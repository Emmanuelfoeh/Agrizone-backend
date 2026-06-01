import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsIn, IsOptional, IsString, MinLength } from 'class-validator';

export class UpdateProfileDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(2) displayName?: string;
  @ApiPropertyOptional() @IsOptional() @IsEmail() email?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() orgName?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() defaultRegionCode?: string;
  @ApiPropertyOptional({ enum: ['EN', 'TW', 'EE', 'DA'] }) @IsOptional() @IsIn(['EN', 'TW', 'EE', 'DA']) preferredLocale?: 'EN' | 'TW' | 'EE' | 'DA';
}

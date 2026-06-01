import { ApiProperty } from '@nestjs/swagger';
import { IsIn } from 'class-validator';
import { Role } from '@prisma/client';

const ROLES = [
  'FARMER',
  'BUYER',
  'AGGREGATOR',
  'INPUT_SUPPLIER',
  'INVESTOR',
  'FIELD_AGENT',
  'REGIONAL_SUPERVISOR',
  'AGRONOMIST',
  'TREASURY_OFFICER',
  'COMPLIANCE_OFFICER',
  'TRUST_REVIEWER',
  'ADMIN',
] as const;

export class GrantRoleDto {
  @ApiProperty({ enum: ROLES })
  @IsIn(ROLES)
  role!: Role;
}

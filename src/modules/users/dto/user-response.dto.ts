import { ApiProperty } from '@nestjs/swagger';
import { Role, User, UserStatus, VerificationTier } from '@prisma/client';

export class UserResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() phone!: string;
  @ApiProperty({ nullable: true }) email!: string | null;
  @ApiProperty() displayName!: string;
  @ApiProperty({ nullable: true }) orgName!: string | null;
  @ApiProperty() preferredLocale!: string;
  @ApiProperty({ nullable: true }) defaultRegionCode!: string | null;
  @ApiProperty({ enum: ['T0', 'T1', 'T2', 'T3', 'T4'] })
  verificationTier!: VerificationTier;
  @ApiProperty() status!: UserStatus;
  @ApiProperty({ isArray: true }) roles!: Role[];
  @ApiProperty() createdAt!: string;

  static from(user: User & { roles: { role: Role }[] }): UserResponseDto {
    return {
      id: user.id,
      phone: user.phone,
      email: user.email,
      displayName: user.displayName,
      orgName: user.orgName,
      preferredLocale: user.preferredLocale,
      defaultRegionCode: user.defaultRegionCode,
      verificationTier: user.verificationTier,
      status: user.status,
      roles: user.roles.map((r) => r.role),
      createdAt: user.createdAt.toISOString(),
    };
  }
}

import { Injectable } from '@nestjs/common';
import { Role } from '@prisma/client';
import { UsersRepository } from './users.repository';
import { UserResponseDto } from './dto/user-response.dto';
import { AppException, ErrorCode } from '../../common/errors/error-codes';

@Injectable()
export class UsersService {
  constructor(private readonly repo: UsersRepository) {}

  async getById(id: string): Promise<UserResponseDto> {
    const user = await this.repo.findById(id);
    if (!user) throw new AppException(ErrorCode.USER_NOT_FOUND, 'User not found', 404);
    return UserResponseDto.from(user);
  }

  async updateProfile(
    id: string,
    data: { displayName?: string; email?: string; orgName?: string; defaultRegionCode?: string; preferredLocale?: 'EN' | 'TW' | 'EE' | 'DA' },
  ): Promise<UserResponseDto> {
    const user = await this.repo.update(id, data);
    return UserResponseDto.from(user);
  }

  async list(take = 50, skip = 0): Promise<UserResponseDto[]> {
    const users = await this.repo.list(take, skip);
    return users.map(UserResponseDto.from);
  }

  async grantRole(userId: string, role: Role): Promise<UserResponseDto> {
    await this.repo.addRole(userId, role);
    return this.getById(userId);
  }

  async revokeRole(userId: string, role: Role): Promise<UserResponseDto> {
    await this.repo.removeRole(userId, role);
    return this.getById(userId);
  }
}

import { Injectable } from '@nestjs/common';
import { Prisma, Role, User, VerificationTier } from '@prisma/client';
import { PrismaService } from '../../common/services/prisma.service';

@Injectable()
export class UsersRepository {
  constructor(private readonly prisma: PrismaService) {}

  findByPhone(phone: string): Promise<(User & { roles: { role: Role }[] }) | null> {
    return this.prisma.db.user.findFirst({ where: { phone }, include: { roles: true } });
  }

  findById(id: string): Promise<(User & { roles: { role: Role }[] }) | null> {
    return this.prisma.db.user.findFirst({ where: { id }, include: { roles: true } });
  }

  create(data: Prisma.UserCreateInput): Promise<User & { roles: { role: Role }[] }> {
    return this.prisma.user.create({ data, include: { roles: true } });
  }

  update(id: string, data: Prisma.UserUpdateInput): Promise<User & { roles: { role: Role }[] }> {
    return this.prisma.user.update({ where: { id }, data, include: { roles: true } });
  }

  setTier(id: string, tier: VerificationTier): Promise<User> {
    return this.prisma.user.update({ where: { id }, data: { verificationTier: tier } });
  }

  addRole(userId: string, role: Role) {
    return this.prisma.userRole.upsert({
      where: { userId_role: { userId, role } },
      create: { userId, role },
      update: {},
    });
  }

  removeRole(userId: string, role: Role) {
    return this.prisma.userRole.deleteMany({ where: { userId, role } });
  }

  list(take: number, skip: number) {
    return this.prisma.db.user.findMany({ take, skip, orderBy: { createdAt: 'desc' }, include: { roles: true } });
  }
}

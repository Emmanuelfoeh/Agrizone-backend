import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from '@prisma/client';
import { ROLES_KEY } from '../decorators/require-role.decorator';
import { AppException, ErrorCode } from '../errors/error-codes';
import { AuthenticatedUser } from '../types/authenticated-user';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Role[] | undefined>(
      ROLES_KEY,
      [ctx.getHandler(), ctx.getClass()],
    );
    if (!required || required.length === 0) return true;
    const user = ctx
      .switchToHttp()
      .getRequest<{ user?: AuthenticatedUser }>().user;
    if (user && required.some((r) => user.roles.includes(r))) return true;
    throw new AppException(ErrorCode.FORBIDDEN, 'Insufficient role', 403);
  }
}

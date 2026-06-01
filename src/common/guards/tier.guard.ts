import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { VerificationTier } from '@prisma/client';
import { MIN_TIER_KEY } from '../decorators/require-tier.decorator';
import { AppException, ErrorCode } from '../errors/error-codes';
import { meetsTier } from '../auth/tier';
import { AuthenticatedUser } from '../types/authenticated-user';

@Injectable()
export class TierGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<
      VerificationTier | undefined
    >(MIN_TIER_KEY, [ctx.getHandler(), ctx.getClass()]);
    if (!required) return true;
    const user = ctx
      .switchToHttp()
      .getRequest<{ user?: AuthenticatedUser }>().user;
    if (user && meetsTier(user.verificationTier, required)) return true;
    throw new AppException(
      ErrorCode.TIER_TOO_LOW,
      `Requires verification tier ${required}`,
      403,
    );
  }
}

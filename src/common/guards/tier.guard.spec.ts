import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { VerificationTier } from '@prisma/client';
import { TierGuard } from './tier.guard';

function ctxWith(user: unknown): ExecutionContext {
  return {
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as unknown as ExecutionContext;
}

describe('TierGuard', () => {
  it('allows when no tier required', () => {
    const reflector = { getAllAndOverride: () => undefined } as unknown as Reflector;
    expect(new TierGuard(reflector).canActivate(ctxWith({ verificationTier: 'T0' }))).toBe(true);
  });
  it('allows when tier is sufficient', () => {
    const reflector = { getAllAndOverride: () => VerificationTier.T1 } as unknown as Reflector;
    expect(new TierGuard(reflector).canActivate(ctxWith({ verificationTier: 'T2' }))).toBe(true);
  });
  it('denies (TIER_TOO_LOW) when tier is insufficient', () => {
    const reflector = { getAllAndOverride: () => VerificationTier.T2 } as unknown as Reflector;
    expect(() => new TierGuard(reflector).canActivate(ctxWith({ verificationTier: 'T1' }))).toThrow();
  });
});

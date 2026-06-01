import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from '@prisma/client';
import { RolesGuard } from './roles.guard';

function ctxWith(user: unknown): ExecutionContext {
  return {
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as unknown as ExecutionContext;
}

describe('RolesGuard', () => {
  it('allows when no roles are required', () => {
    const reflector = { getAllAndOverride: () => undefined } as unknown as Reflector;
    expect(new RolesGuard(reflector).canActivate(ctxWith({ roles: [] }))).toBe(true);
  });
  it('allows when the user has one of the required roles', () => {
    const reflector = { getAllAndOverride: () => [Role.ADMIN] } as unknown as Reflector;
    expect(new RolesGuard(reflector).canActivate(ctxWith({ roles: [Role.ADMIN] }))).toBe(true);
  });
  it('denies when the user lacks the required role', () => {
    const reflector = { getAllAndOverride: () => [Role.ADMIN] } as unknown as Reflector;
    expect(() => new RolesGuard(reflector).canActivate(ctxWith({ roles: [Role.FARMER] }))).toThrow();
  });
});

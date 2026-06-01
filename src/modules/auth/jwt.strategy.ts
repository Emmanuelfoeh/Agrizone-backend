import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';
import { UsersRepository } from '../users/users.repository';
import { AuthenticatedUser } from '../../common/types/authenticated-user';
import { AccessClaims } from './token.service';

function fromCookie(req: Request): string | null {
  const cookies = (req as Request & { cookies?: Record<string, string> })
    .cookies;
  return cookies?.az_access ?? null;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    config: ConfigService,
    private readonly users: UsersRepository,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([
        fromCookie,
        ExtractJwt.fromAuthHeaderAsBearerToken(),
      ]),
      secretOrKey: config.get<string>('JWT_SECRET')!,
      ignoreExpiration: false,
    });
  }

  async validate(payload: AccessClaims): Promise<AuthenticatedUser> {
    const user = await this.users.findById(payload.sub);
    if (!user || user.status !== 'ACTIVE') throw new UnauthorizedException();
    return {
      id: user.id,
      phone: user.phone,
      roles: user.roles.map((r) => r.role),
      verificationTier: user.verificationTier,
    };
  }
}

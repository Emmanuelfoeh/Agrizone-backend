import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { randomBytes, randomUUID } from 'node:crypto';
import { Role, VerificationTier } from '@prisma/client';
import { RedisService } from '../../common/redis/redis.service';
import { hmac } from '../../common/crypto/hmac';
import { AppException, ErrorCode } from '../../common/errors/error-codes';

export interface AccessClaims {
  sub: string;
  phone: string;
  roles: Role[];
  tier: VerificationTier;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

@Injectable()
export class TokenService {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly redis: RedisService,
  ) {}

  /** Sign just an access JWT from claims. */
  async signAccess(claims: AccessClaims): Promise<string> {
    return this.jwt.signAsync(claims, {
      secret: this.config.get<string>('JWT_SECRET'),
      // config returns string; cast to satisfy ms.StringValue branded type
      expiresIn: this.config.get<string>('JWT_ACCESS_TTL') as unknown as number,
    });
  }

  async issue(claims: AccessClaims): Promise<TokenPair> {
    const accessToken = await this.signAccess(claims);
    const refreshToken = await this.newRefreshToken(claims.sub);
    return { accessToken, refreshToken };
  }

  // Refresh token format: `${userId}:${jti}.${secret}` — self-contained so refresh
  // needs no separate userId. Only hmac(secret) is stored in Redis.
  private async newRefreshToken(userId: string): Promise<string> {
    const jti = randomUUID();
    const secret = randomBytes(32).toString('hex');
    const ttl = this.config.get<number>('REFRESH_TTL_SECONDS')!;
    await this.redis.client.set(
      `refresh:${userId}:${jti}`,
      hmac(secret, this.config.get<string>('JWT_SECRET')!),
      'EX',
      ttl,
    );
    return `${userId}:${jti}.${secret}`;
  }

  /** Validate + rotate a refresh token; returns the userId and a fresh refresh token. */
  async rotate(refreshToken: string): Promise<{ userId: string; refreshToken: string }> {
    const sep = refreshToken.indexOf(':');
    const dot = refreshToken.indexOf('.');
    if (sep < 0 || dot < 0 || dot < sep) {
      throw new AppException(ErrorCode.REFRESH_INVALID, 'Malformed refresh token', 401);
    }
    const userId = refreshToken.slice(0, sep);
    const jti = refreshToken.slice(sep + 1, dot);
    const secret = refreshToken.slice(dot + 1);
    const key = `refresh:${userId}:${jti}`;
    const stored = await this.redis.client.get(key);
    if (!stored || stored !== hmac(secret, this.config.get<string>('JWT_SECRET')!)) {
      throw new AppException(ErrorCode.REFRESH_INVALID, 'Invalid refresh token', 401);
    }
    await this.redis.client.del(key); // rotate: invalidate old
    const next = await this.newRefreshToken(userId);
    return { userId, refreshToken: next };
  }

  async revokeAll(userId: string): Promise<void> {
    const keys = await this.redis.client.keys(`refresh:${userId}:*`);
    if (keys.length) await this.redis.client.del(...keys);
  }
}

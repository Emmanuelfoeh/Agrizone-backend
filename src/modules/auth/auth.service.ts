import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { VerificationTier } from '@prisma/client';
import { UsersRepository } from '../users/users.repository';
import { OtpService } from './otp.service';
import { TokenService, TokenPair } from './token.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AuditService } from '../audit/audit.service';
import { TierChangedEvent } from './events/tier-changed.event';
import { AppException, ErrorCode } from '../../common/errors/error-codes';

export interface RequestOtpResult {
  sent: boolean;
  debugCode?: string;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly users: UsersRepository,
    private readonly otp: OtpService,
    private readonly tokens: TokenService,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditService,
    private readonly events: EventEmitter2,
    private readonly config: ConfigService,
  ) {}

  async requestOtp(phone: string): Promise<RequestOtpResult> {
    let user = await this.users.findByPhone(phone);
    if (!user) {
      user = await this.users.create({ phone, displayName: phone });
    }
    const code = await this.otp.generate(phone);
    await this.notifications.sendSms({
      to: phone,
      body: `Your AgriZone code is ${code}. It expires in 5 minutes.`,
      reference: `otp-${user.id}`,
    });
    const isProd = this.config.get<string>('NODE_ENV') === 'production';
    return { sent: true, ...(isProd ? {} : { debugCode: code }) };
  }

  async verifyOtp(phone: string, code: string): Promise<TokenPair & { tier: VerificationTier }> {
    await this.otp.verify(phone, code);
    let user = await this.users.findByPhone(phone);
    if (!user) {
      user = await this.users.create({ phone, displayName: phone });
    }
    if (user.verificationTier === VerificationTier.T0) {
      await this.users.setTier(user.id, VerificationTier.T1);
      user.verificationTier = VerificationTier.T1;
      await this.audit.record({
        actorUserId: user.id,
        action: 'verification.tier-changed',
        entityType: 'User',
        entityId: user.id,
        after: { tier: 'T1', method: 'PHONE_OTP' },
      });
      this.events.emit('verification.tier-changed', new TierChangedEvent(user.id, VerificationTier.T0, VerificationTier.T1, 'PHONE_OTP'));
    }
    const pair = await this.tokens.issue({
      sub: user.id,
      phone: user.phone,
      roles: user.roles.map((r) => r.role),
      tier: user.verificationTier,
    });
    return { ...pair, tier: user.verificationTier };
  }

  async refresh(refreshToken: string): Promise<{ accessToken: string; refreshToken: string }> {
    const { userId, refreshToken: next } = await this.tokens.rotate(refreshToken);
    const user = await this.users.findById(userId);
    if (!user) throw new AppException(ErrorCode.REFRESH_INVALID, 'Unknown user', 401);
    const accessToken = await this.tokens.signAccess({
      sub: user.id,
      phone: user.phone,
      roles: user.roles.map((r) => r.role),
      tier: user.verificationTier,
    });
    return { accessToken, refreshToken: next };
  }

  async logout(userId: string): Promise<void> {
    await this.tokens.revokeAll(userId);
  }
}

import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomInt } from 'node:crypto';
import { RedisService } from '../../common/redis/redis.service';
import { hmac } from '../../common/crypto/hmac';
import { AppException, ErrorCode } from '../../common/errors/error-codes';

@Injectable()
export class OtpService {
  constructor(
    private readonly redis: RedisService,
    private readonly config: ConfigService,
  ) {}

  /** Generate, hash, and store a code; returns the plaintext for the caller to send via SMS. */
  async generate(phone: string): Promise<string> {
    const throttleKey = `otp:throttle:${phone}`;
    if (await this.redis.client.get(throttleKey)) {
      throw new AppException(ErrorCode.OTP_THROTTLED, 'Please wait before requesting another code', 429);
    }
    const len = this.config.get<number>('OTP_LENGTH')!;
    const ttl = this.config.get<number>('OTP_TTL_SECONDS')!;
    const secret = this.config.get<string>('JWT_SECRET')!;
    const max = 10 ** len;
    const code = randomInt(0, max).toString().padStart(len, '0');

    await this.redis.client.set(`otp:${phone}`, hmac(code, secret), 'EX', ttl);
    await this.redis.client.del(`otp:attempts:${phone}`);
    await this.redis.client.set(throttleKey, '1', 'EX', 30);
    return code;
  }

  /** Verify a code; throws OTP_EXPIRED / OTP_INVALID / OTP_THROTTLED. Deletes the code on success. */
  async verify(phone: string, code: string): Promise<void> {
    const key = `otp:${phone}`;
    const stored = await this.redis.client.get(key);
    if (!stored) throw new AppException(ErrorCode.OTP_EXPIRED, 'Code expired or not requested', 400);

    const max = this.config.get<number>('OTP_MAX_ATTEMPTS')!;
    const attempts = await this.redis.client.incr(`otp:attempts:${phone}`);
    if (attempts > max) {
      await this.redis.client.del(key);
      throw new AppException(ErrorCode.OTP_THROTTLED, 'Too many attempts', 429);
    }
    const secret = this.config.get<string>('JWT_SECRET')!;
    if (hmac(code, secret) !== stored) {
      throw new AppException(ErrorCode.OTP_INVALID, 'Incorrect code', 400);
    }
    await this.redis.client.del(key, `otp:attempts:${phone}`);
  }
}

import { ConfigService } from '@nestjs/config';
import { Redis } from 'ioredis';
import { OtpService } from './otp.service';
import { AppException } from '../../common/errors/error-codes';

const config = {
  get: (k: string) =>
    ({ JWT_SECRET: 'test-secret-1234567890', OTP_TTL_SECONDS: 300, OTP_LENGTH: 6, OTP_MAX_ATTEMPTS: 5 } as Record<string, unknown>)[k],
} as unknown as ConfigService;

describe('OtpService', () => {
  const client = new Redis('redis://localhost:6379', { maxRetriesPerRequest: null });
  const redis = { client } as { client: Redis };
  const svc = new OtpService(redis as never, config);
  const phone = `+233000${Date.now() % 1000000}`;

  afterAll(async () => {
    await client.del(`otp:${phone}`, `otp:attempts:${phone}`, `otp:throttle:${phone}`);
    client.disconnect();
  });

  it('generates a numeric code of OTP_LENGTH and verifies it', async () => {
    const code = await svc.generate(phone);
    expect(code).toMatch(/^\d{6}$/);
    await expect(svc.verify(phone, code)).resolves.toBeUndefined();
  });

  it('throws OTP_EXPIRED when no code exists', async () => {
    await expect(svc.verify(`+2330000000`, '000000')).rejects.toBeInstanceOf(AppException);
  });

  it('throws OTP_INVALID on wrong code', async () => {
    const p2 = `+2331${Date.now() % 100000}`;
    await svc.generate(p2);
    await expect(svc.verify(p2, '999999')).rejects.toBeInstanceOf(AppException);
    await client.del(`otp:${p2}`, `otp:attempts:${p2}`, `otp:throttle:${p2}`);
  });
});

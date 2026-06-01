import { createHmac } from 'node:crypto';

/** HMAC-SHA256 hex digest. Used to hash OTP codes and refresh tokens before storing in Redis. */
export function hmac(value: string, key: string): string {
  return createHmac('sha256', key).update(value).digest('hex');
}

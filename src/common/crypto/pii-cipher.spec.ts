import { PiiCipher } from './pii-cipher';
import { randomBytes } from 'node:crypto';

describe('PiiCipher', () => {
  const key = randomBytes(32).toString('base64');
  const cipher = new PiiCipher(key);

  it('round-trips plaintext', () => {
    const enc = cipher.encrypt('GHA-123456789-0');
    expect(enc).not.toContain('GHA-123456789-0');
    expect(cipher.decrypt(enc)).toBe('GHA-123456789-0');
  });

  it('produces different ciphertext each call (random iv)', () => {
    expect(cipher.encrypt('same')).not.toBe(cipher.encrypt('same'));
  });

  it('rejects a key that is not 32 bytes', () => {
    expect(() => new PiiCipher(Buffer.from('short').toString('base64'))).toThrow();
  });
});

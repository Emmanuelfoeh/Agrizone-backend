import { hmac } from './hmac';

describe('hmac', () => {
  it('is deterministic for the same input and key', () => {
    expect(hmac('123456', 'secret')).toBe(hmac('123456', 'secret'));
  });
  it('differs for different inputs', () => {
    expect(hmac('123456', 'secret')).not.toBe(hmac('123457', 'secret'));
  });
  it('returns hex', () => {
    expect(hmac('x', 'secret')).toMatch(/^[0-9a-f]{64}$/);
  });
});

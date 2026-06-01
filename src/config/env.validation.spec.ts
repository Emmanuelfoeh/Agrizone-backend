import { validateEnv } from './env.validation';

describe('validateEnv', () => {
  const base = {
    NODE_ENV: 'test',
    PORT: '3001',
    DATABASE_URL: 'postgresql://agrizone:agrizone@localhost:5432/agrizone',
    REDIS_URL: 'redis://localhost:6379',
    JWT_SECRET: 'test-secret-at-least-16-chars-long',
    PII_ENCRYPTION_KEY: 'test-pii-key',
  };

  it('passes with valid env and coerces PORT to a number', () => {
    const parsed = validateEnv(base);
    expect(parsed.PORT).toBe(3001);
    expect(parsed.NODE_ENV).toBe('test');
  });

  it('throws when a required var is missing', () => {
    const { DATABASE_URL: _omit, ...rest } = base;
    expect(() => validateEnv(rest)).toThrow(/DATABASE_URL/);
  });
});

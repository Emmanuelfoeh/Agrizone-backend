import { VerificationTier } from '@prisma/client';
import { tierRank, meetsTier } from './tier';

describe('tier ordinal', () => {
  it('ranks T0<T1<T2<T3<T4', () => {
    expect(tierRank(VerificationTier.T0)).toBeLessThan(tierRank(VerificationTier.T4));
  });
  it('meetsTier is true when actual >= required', () => {
    expect(meetsTier(VerificationTier.T2, VerificationTier.T1)).toBe(true);
    expect(meetsTier(VerificationTier.T1, VerificationTier.T2)).toBe(false);
    expect(meetsTier(VerificationTier.T2, VerificationTier.T2)).toBe(true);
  });
});

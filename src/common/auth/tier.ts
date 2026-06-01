import { VerificationTier } from '@prisma/client';

const ORDER: Record<VerificationTier, number> = { T0: 0, T1: 1, T2: 2, T3: 3, T4: 4 };

export function tierRank(tier: VerificationTier): number {
  return ORDER[tier];
}

export function meetsTier(actual: VerificationTier, required: VerificationTier): boolean {
  return tierRank(actual) >= tierRank(required);
}

import { SetMetadata } from '@nestjs/common';
import { VerificationTier } from '@prisma/client';

export const MIN_TIER_KEY = 'minTier';
export const RequireTier = (tier: VerificationTier) => SetMetadata(MIN_TIER_KEY, tier);

import { VerificationTier } from '@prisma/client';

export class TierChangedEvent {
  constructor(
    public readonly userId: string,
    public readonly fromTier: VerificationTier,
    public readonly toTier: VerificationTier,
    public readonly method: string,
  ) {}
}

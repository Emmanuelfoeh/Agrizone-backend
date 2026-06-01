import { Role, VerificationTier } from '@prisma/client';

export interface AuthenticatedUser {
  id: string;
  phone: string;
  roles: Role[];
  verificationTier: VerificationTier;
}

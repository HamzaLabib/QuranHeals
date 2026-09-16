import type { AuthProvider } from '../types/accountDomain';
import type { UserDto } from '../types/accountDto';

export type VerifiedProviderIdentity = {
  provider: AuthProvider;
  providerSubject: string;
  email?: string;
  emailVerified?: boolean;
};

export interface UserRepository {
  /**
   * The only way a UserDto is ever created or looked up: always keyed by a
   * (provider, providerSubject) pair that has already been verified by
   * googleTokenVerifier/appleTokenVerifier. Never accepts a client-supplied
   * userId — see backend/src/auth/session.ts and Part B §7.
   */
  findOrCreateByProviderIdentity(identity: VerifiedProviderIdentity): Promise<UserDto>;
  findById(userId: string): Promise<UserDto | null>;
}

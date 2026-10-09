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
  /**
   * Same lookup (and the same email refresh) as findOrCreateByProviderIdentity,
   * but never creates an account: returns null when none exists. Used for
   * sign-ins that carry no valid account-age declaration.
   */
  findExistingByProviderIdentity(identity: VerifiedProviderIdentity): Promise<UserDto | null>;
  findById(userId: string): Promise<UserDto | null>;
  /** The verified provider identity that owns this account — server-side only, never sent to clients. */
  findProviderIdentity(userId: string): Promise<{ provider: AuthProvider; providerSubject: string } | null>;
}

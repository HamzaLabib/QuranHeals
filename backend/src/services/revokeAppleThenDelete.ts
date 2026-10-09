import type { AppleRevocationClient } from '../auth/appleRevocationClient';
import { AppError } from '../errors/AppError';
import type { AccountDeletionService } from './AccountDeletionService';

export const DELETION_FAILED_MESSAGE = 'Account deletion could not be completed. Please try again.';

/**
 * The one ordering rule every account deletion follows — the in-app route
 * (controllers/accountController.ts) and the development-only admin tool
 * (scripts/adminDeleteAccount.ts) both call this, never their own copy:
 *
 *  1. If an Apple refresh token is given, revoke it FIRST. Any failure
 *     throws AppError(502) and nothing is deleted, so the account stays
 *     intact and the deletion is safely retryable (an already-revoked
 *     token is success — see auth/appleRevocationClient.ts).
 *  2. Only then delete every document the account owns, in the single
 *     transaction of AccountDeletionService (idempotent).
 *
 * `appleRefreshToken` is null for a Google account, and for an Apple
 * account whose token is unavailable when the caller has explicitly
 * decided to proceed without revocation (only the admin tool can).
 */
export async function revokeAppleThenDelete(
  deps: { appleRevocationClient: AppleRevocationClient; accountDeletionService: AccountDeletionService },
  userId: string,
  appleRefreshToken: string | null,
): Promise<void> {
  if (appleRefreshToken !== null) {
    try {
      await deps.appleRevocationClient.revokeRefreshToken(appleRefreshToken);
    } catch {
      throw new AppError(DELETION_FAILED_MESSAGE, 502);
    }
  }

  await deps.accountDeletionService.deleteAccount(userId);
}

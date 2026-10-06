import type { Request, Response } from 'express';

import type { AppleRevocationClient } from '../auth/appleRevocationClient';
import type { AppleTokenVerifier } from '../auth/appleTokenVerifier';
import { verifyFreshProviderReauthentication } from '../auth/providerReauthentication';
import type { GoogleTokenVerifier } from '../auth/googleTokenVerifier';
import { AppError } from '../errors/AppError';
import type { AuthenticatedRequest } from '../middleware/requireAuth';
import type { AccountDeletionService } from '../services/AccountDeletionService';
import type { AppleCredentialRepository } from '../services/AppleCredentialRepository';
import type { UserRepository } from '../services/UserRepository';
import { appleReauthForDeletionSchema } from '../validators/accountValidators';

type AccountControllerDeps = {
  accountDeletionService: AccountDeletionService;
  userRepository: UserRepository;
  appleCredentialRepository: AppleCredentialRepository;
  appleRevocationClient: AppleRevocationClient;
  googleVerifier: GoogleTokenVerifier;
  appleVerifier: AppleTokenVerifier;
};

const APPLE_REAUTH_REQUIRED_MESSAGE = 'Apple re-authentication is required to delete this account.';
const DELETION_FAILED_MESSAGE = 'Account deletion could not be completed. Please try again.';

export function createAccountController({
  accountDeletionService,
  userRepository,
  appleCredentialRepository,
  appleRevocationClient,
  googleVerifier,
  appleVerifier,
}: AccountControllerDeps) {
  return {
    /**
     * The account to delete is always the currently-authenticated user
     * (req.auth.userId, set by requireAuth from a verified access token) —
     * never a client-supplied id in the URL or body. See Part B §7 and the
     * account-deletion phase's "never accept DELETE /users/:userId."
     *
     * For an Apple-authenticated account (Phase B4), Apple's authorization
     * must be revoked BEFORE any Quran Heals data is deleted — never after
     * — so a failure here always leaves the account fully intact and
     * safely retryable, rather than risking a QH account that's gone while
     * Apple still authorizes the app for that person with no credential
     * left to retry revocation from (an external API call cannot be part
     * of the Mongo deletion transaction; see
     * services/AccountDeletionService.ts and Part B4 §7):
     *
     *  1. A stored (encrypted) Apple refresh token already exists → revoke
     *     it directly, no extra step for the person.
     *  2. None exists yet (an existing pre-B4 Apple user, or sign-in's own
     *     best-effort capture failed) → the request must include a fresh
     *     Apple identity token + authorization code; verified the same way
     *     as any other destructive re-authentication
     *     (verifyFreshProviderReauthentication). Missing/invalid →
     *     AppError(428), telling the client to prompt for one and retry.
     *     The exchanged refresh token is stored immediately (before
     *     revoking), so a later failure never needs to ask the person to
     *     sign in with Apple again.
     *  3. Revocation itself fails (network, Apple outage, already-invalid
     *     client secret) → AppError(502); nothing is deleted, nothing
     *     local changes. Revoking an ALREADY-revoked token is treated as
     *     success by appleRevocationClient, so a retry here is always
     *     safe.
     *  4. Only once Apple's authorization is confirmed revoked (or never
     *     existed, e.g. a Google account) does Quran Heals data actually
     *     get deleted.
     *
     * Every failure path returns a generic message — never Apple's raw
     * response, never which internal check failed (Part B4 §8/§10).
     */
    deleteAccount: async (req: Request, res: Response) => {
      const { userId } = (req as AuthenticatedRequest).auth;
      const identity = await userRepository.findProviderIdentity(userId);

      if (identity?.provider === 'apple') {
        let refreshToken = await appleCredentialRepository.get(userId);

        if (!refreshToken) {
          const parsed = appleReauthForDeletionSchema.safeParse(req.body);
          if (!parsed.success) {
            throw new AppError(APPLE_REAUTH_REQUIRED_MESSAGE, 428);
          }

          // Never trusts the client's claimed identity — the same check
          // every other destructive action uses: the token must verify
          // with Apple AND match this account's own stored providerSubject.
          await verifyFreshProviderReauthentication(
            { userRepository, googleVerifier, appleVerifier },
            userId,
            { provider: 'apple', idToken: parsed.data.idToken },
          );

          let exchanged: { refreshToken: string };
          try {
            exchanged = await appleRevocationClient.exchangeAuthorizationCode(parsed.data.authorizationCode);
          } catch {
            throw new AppError(DELETION_FAILED_MESSAGE, 502);
          }
          await appleCredentialRepository.save(userId, exchanged.refreshToken);
          refreshToken = exchanged.refreshToken;
        }

        try {
          await appleRevocationClient.revokeRefreshToken(refreshToken);
        } catch {
          throw new AppError(DELETION_FAILED_MESSAGE, 502);
        }
      }

      await accountDeletionService.deleteAccount(userId);
      res.json({ success: true, data: null });
    },
  };
}

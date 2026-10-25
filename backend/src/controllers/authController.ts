import type { Request, Response } from 'express';

import type { AppleRevocationClient } from '../auth/appleRevocationClient';
import type { AppleTokenVerifier } from '../auth/appleTokenVerifier';
import type { GoogleTokenVerifier } from '../auth/googleTokenVerifier';
import { signAccessToken } from '../auth/session';
import { bindSignIn, issueSignInChallenge, type SignInBinding } from '../auth/signInChallenge';
import { env } from '../config/env';
import { AppError } from '../errors/AppError';
import type { AuthenticatedRequest } from '../middleware/requireAuth';
import type { AppleCredentialRepository } from '../services/AppleCredentialRepository';
import type { AuthChallengeRepository } from '../services/AuthChallengeRepository';
import type { SessionRepository } from '../services/SessionRepository';
import type { UserRepository, VerifiedProviderIdentity } from '../services/UserRepository';
import type { UserDto } from '../types/accountDto';
import {
  appleSignInSchema,
  googleSignInSchema,
  hasCurrentAgeDeclaration,
  logoutSchema,
  refreshSessionSchema,
} from '../validators/authValidators';

/**
 * Sign-in's optional Apple credential capture gets a short budget: it must
 * never push sign-in past the mobile client's 8s request timeout (an
 * uncached Apple JWKS fetch can take up to 5s). Deletion re-captures with
 * the full timeout if this one is skipped.
 */
export const APPLE_SIGN_IN_CAPTURE_TIMEOUT_MS = 2_500;

/**
 * One line per sign-in, provider and binding only (no identifier, token, nonce or address): the server-side evidence for
 * the device check that each native flow carries the challenge, and in which form (auth/signInChallenge.ts).
 */
function logBinding(provider: 'apple' | 'google', binding: SignInBinding) {
  if (env.NODE_ENV === 'test') return;
  console.log(`auth: ${provider} sign-in ${binding.bound ? `bound to a challenge (nonce ${binding.form})` : 'not bound to a challenge'}`);
}

/**
 * Returned when a verified identity has no account yet and the request
 * carries no current account-age declaration — typically an app build
 * from before the 16+ confirmation. Nothing is created and no session is
 * issued. Older builds show this message as-is, so it tells them what to do.
 */
export const ACCOUNT_AGE_CONFIRMATION_REQUIRED_MESSAGE =
  'To create a Quran Heals account, please update the app to the latest version and confirm that you meet the minimum age requirement.';

type AuthControllerDeps = {
  userRepository: UserRepository;
  sessionRepository: SessionRepository;
  googleVerifier: GoogleTokenVerifier;
  appleVerifier: AppleTokenVerifier;
  appleRevocationClient: AppleRevocationClient;
  appleCredentialRepository: AppleCredentialRepository;
  authChallengeRepository: AuthChallengeRepository;
  /** Refuse tokens not bound to a server challenge; defaults to AUTH_NONCE_REQUIRED (auth/signInChallenge.ts). */
  nonceRequired?: boolean;
};

export function createAuthController({
  userRepository,
  sessionRepository,
  googleVerifier,
  appleVerifier,
  appleRevocationClient,
  appleCredentialRepository,
  authChallengeRepository,
  nonceRequired = env.AUTH_NONCE_REQUIRED === 'on',
}: AuthControllerDeps) {
  // A fresh, independent session per sign-in — never overwrites or revokes
  // any session already issued to this user on another device (Part 1 of
  // the multi-device auth phase).
  async function respondWithNewSession(res: Response, user: UserDto) {
    const { sessionId, refreshToken } = await sessionRepository.createSession(user.id);
    res.json({ success: true, data: { token: signAccessToken(user.id, sessionId), refreshToken, user } });
  }

  /**
   * New accounts require a current account-age self-declaration; existing
   * accounts never do (so older builds and already-confirmed devices keep
   * working). Without one, this only ever looks up — it never inserts — and
   * a missing account is refused before any session or Apple credential
   * is created. The declaration itself is not stored.
   */
  async function resolveAccount(identity: VerifiedProviderIdentity, declaration: { policyVersion: number } | undefined) {
    if (hasCurrentAgeDeclaration(declaration)) {
      return userRepository.findOrCreateByProviderIdentity(identity);
    }
    const existing = await userRepository.findExistingByProviderIdentity(identity);
    if (!existing) {
      throw new AppError(ACCOUNT_AGE_CONFIRMATION_REQUIRED_MESSAGE, 403);
    }
    return existing;
  }

  return {
    /** A single-use nonce for the next sign-in (auth/signInChallenge.ts). Unauthenticated; rate-limited per IP. */
    issueChallenge: async (_req: Request, res: Response) => {
      res.json({ success: true, data: await issueSignInChallenge(authChallengeRepository) });
    },

    signInWithGoogle: async (req: Request, res: Response) => {
      const parsed = googleSignInSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new AppError('Invalid sign-in request.', 400);
      }

      // Identity comes only from the verified token — the request body
      // carries nothing else that could influence which account this
      // resolves to. See Part B §7.
      const identity = await googleVerifier.verifyIdToken(parsed.data.idToken);
      logBinding('google', await bindSignIn(authChallengeRepository, identity.nonce, { required: nonceRequired }));
      const user = await resolveAccount(
        { provider: 'google', providerSubject: identity.providerSubject, email: identity.email, emailVerified: identity.emailVerified },
        parsed.data.accountAgeConfirmation,
      );

      await respondWithNewSession(res, user);
    },

    signInWithApple: async (req: Request, res: Response) => {
      const parsed = appleSignInSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new AppError('Invalid sign-in request.', 400);
      }

      const identity = await appleVerifier.verifyIdToken(parsed.data.idToken);
      logBinding('apple', await bindSignIn(authChallengeRepository, identity.nonce, { required: nonceRequired }));
      const user = await resolveAccount(
        { provider: 'apple', providerSubject: identity.providerSubject, email: identity.email, emailVerified: identity.emailVerified },
        parsed.data.accountAgeConfirmation,
      );

      // Best-effort: captures a revocation credential now, while a fresh
      // authorization code happens to be available, so a later account
      // deletion (accountController.deleteAccount) doesn't need to ask the
      // person to sign in with Apple again. Never blocks sign-in itself —
      // a transient failure here just leaves this account without a
      // stored credential, falling back to the re-authentication path at
      // deletion time. See Part B4 §4/§5.
      if (parsed.data.authorizationCode) {
        try {
          const { refreshToken, subject } = await appleRevocationClient.exchangeAuthorizationCode(parsed.data.authorizationCode, {
            timeoutMs: APPLE_SIGN_IN_CAPTURE_TIMEOUT_MS,
          });
          // Only a code issued to the Apple ID that just signed in: a mismatched one is skipped like a failed capture.
          if (subject === identity.providerSubject) {
            await appleCredentialRepository.save(user.id, refreshToken);
          }
        } catch {
          // Swallowed deliberately — see doc comment above.
        }
      }

      await respondWithNewSession(res, user);
    },

    getCurrentUser: async (req: Request, res: Response) => {
      const { userId } = (req as AuthenticatedRequest).auth;
      const user = await userRepository.findById(userId);

      if (!user) {
        throw new AppError('Account not found.', 404);
      }

      res.json({ success: true, data: user });
    },

    /**
     * Rotates this device's refresh token and issues a new access token.
     * Only ever touches the one session the presented refresh token
     * belongs to — every other session (this user's other devices) is
     * untouched. See SessionRepository.rotateSession for reuse handling.
     */
    refreshSession: async (req: Request, res: Response) => {
      const parsed = refreshSessionSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new AppError('Invalid refresh request.', 400);
      }

      const { sessionId, refreshToken, userId } = await sessionRepository.rotateSession(parsed.data.refreshToken);
      res.json({ success: true, data: { token: signAccessToken(userId, sessionId), refreshToken } });
    },

    /**
     * Normal logout: revokes only the current device's session. Never
     * revokes any other session for this user — "log out of all devices"
     * is a distinct, not-yet-built feature (Part 1). A missing/already-
     * invalid refresh token is not an error — the device is signed out
     * locally regardless, so this always reports success.
     */
    logout: async (req: Request, res: Response) => {
      const parsed = logoutSchema.safeParse(req.body);
      if (parsed.success && parsed.data.refreshToken) {
        await sessionRepository.revokeSession(parsed.data.refreshToken);
      }
      res.json({ success: true, data: null });
    },
  };
}

import type { Request, Response } from 'express';

import type { AppleTokenVerifier } from '../auth/appleTokenVerifier';
import type { GoogleTokenVerifier } from '../auth/googleTokenVerifier';
import { signAccessToken } from '../auth/session';
import { AppError } from '../errors/AppError';
import type { AuthenticatedRequest } from '../middleware/requireAuth';
import type { SessionRepository } from '../services/SessionRepository';
import type { UserRepository } from '../services/UserRepository';
import type { UserDto } from '../types/accountDto';
import { appleSignInSchema, googleSignInSchema, logoutSchema, refreshSessionSchema } from '../validators/authValidators';

type AuthControllerDeps = {
  userRepository: UserRepository;
  sessionRepository: SessionRepository;
  googleVerifier: GoogleTokenVerifier;
  appleVerifier: AppleTokenVerifier;
};

export function createAuthController({ userRepository, sessionRepository, googleVerifier, appleVerifier }: AuthControllerDeps) {
  // A fresh, independent session per sign-in — never overwrites or revokes
  // any session already issued to this user on another device (Part 1 of
  // the multi-device auth phase).
  async function respondWithNewSession(res: Response, user: UserDto) {
    const { sessionId, refreshToken } = await sessionRepository.createSession(user.id);
    res.json({ success: true, data: { token: signAccessToken(user.id, sessionId), refreshToken, user } });
  }

  return {
    signInWithGoogle: async (req: Request, res: Response) => {
      const parsed = googleSignInSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new AppError('Invalid sign-in request.', 400);
      }

      // Identity comes only from the verified token — the request body
      // carries nothing else that could influence which account this
      // resolves to. See Part B §7.
      const identity = await googleVerifier.verifyIdToken(parsed.data.idToken);
      const user = await userRepository.findOrCreateByProviderIdentity({
        provider: 'google',
        providerSubject: identity.providerSubject,
        email: identity.email,
        emailVerified: identity.emailVerified,
      });

      await respondWithNewSession(res, user);
    },

    signInWithApple: async (req: Request, res: Response) => {
      const parsed = appleSignInSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new AppError('Invalid sign-in request.', 400);
      }

      const identity = await appleVerifier.verifyIdToken(parsed.data.idToken);
      const user = await userRepository.findOrCreateByProviderIdentity({
        provider: 'apple',
        providerSubject: identity.providerSubject,
        email: identity.email,
        emailVerified: identity.emailVerified,
      });

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

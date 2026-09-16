import type { Request, Response } from 'express';

import type { AppleTokenVerifier } from '../auth/appleTokenVerifier';
import type { GoogleTokenVerifier } from '../auth/googleTokenVerifier';
import { signSessionToken } from '../auth/session';
import { AppError } from '../errors/AppError';
import type { AuthenticatedRequest } from '../middleware/requireAuth';
import type { UserRepository } from '../services/UserRepository';
import { appleSignInSchema, googleSignInSchema } from '../validators/authValidators';

type AuthControllerDeps = {
  userRepository: UserRepository;
  googleVerifier: GoogleTokenVerifier;
  appleVerifier: AppleTokenVerifier;
};

export function createAuthController({ userRepository, googleVerifier, appleVerifier }: AuthControllerDeps) {
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

      res.json({ success: true, data: { token: signSessionToken(user.id), user } });
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

      res.json({ success: true, data: { token: signSessionToken(user.id), user } });
    },

    getCurrentUser: async (req: Request, res: Response) => {
      const { userId } = (req as AuthenticatedRequest).auth;
      const user = await userRepository.findById(userId);

      if (!user) {
        throw new AppError('Account not found.', 404);
      }

      res.json({ success: true, data: user });
    },
  };
}

import { Router } from 'express';

import type { AppleTokenVerifier } from '../auth/appleTokenVerifier';
import type { GoogleTokenVerifier } from '../auth/googleTokenVerifier';
import { createAuthController } from '../controllers/authController';
import { asyncHandler } from '../middleware/asyncHandler';
import { requireAuth } from '../middleware/requireAuth';
import type { SessionRepository } from '../services/SessionRepository';
import type { UserRepository } from '../services/UserRepository';

export function createAuthRoutes(deps: {
  userRepository: UserRepository;
  sessionRepository: SessionRepository;
  googleVerifier: GoogleTokenVerifier;
  appleVerifier: AppleTokenVerifier;
}) {
  const router = Router();
  const controller = createAuthController(deps);

  router.post('/google', asyncHandler(controller.signInWithGoogle));
  router.post('/apple', asyncHandler(controller.signInWithApple));
  router.get('/session', requireAuth, asyncHandler(controller.getCurrentUser));
  // Neither route requires requireAuth — a refresh must work with an
  // already-expired access token (that's the point), and logout must
  // still succeed even if the access token expired first.
  router.post('/refresh', asyncHandler(controller.refreshSession));
  router.post('/logout', asyncHandler(controller.logout));

  return router;
}

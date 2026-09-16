import { Router } from 'express';

import type { AppleTokenVerifier } from '../auth/appleTokenVerifier';
import type { GoogleTokenVerifier } from '../auth/googleTokenVerifier';
import { createAuthController } from '../controllers/authController';
import { asyncHandler } from '../middleware/asyncHandler';
import { requireAuth } from '../middleware/requireAuth';
import type { UserRepository } from '../services/UserRepository';

export function createAuthRoutes(deps: {
  userRepository: UserRepository;
  googleVerifier: GoogleTokenVerifier;
  appleVerifier: AppleTokenVerifier;
}) {
  const router = Router();
  const controller = createAuthController(deps);

  router.post('/google', asyncHandler(controller.signInWithGoogle));
  router.post('/apple', asyncHandler(controller.signInWithApple));
  router.get('/session', requireAuth, asyncHandler(controller.getCurrentUser));

  return router;
}

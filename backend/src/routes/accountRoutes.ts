import { Router, type RequestHandler } from 'express';

import type { AppleRevocationClient } from '../auth/appleRevocationClient';
import type { AppleTokenVerifier } from '../auth/appleTokenVerifier';
import type { GoogleTokenVerifier } from '../auth/googleTokenVerifier';
import { createAccountController } from '../controllers/accountController';
import { asyncHandler } from '../middleware/asyncHandler';
import type { createRequireAuth } from '../middleware/requireAuth';
import type { AccountDeletionService } from '../services/AccountDeletionService';
import type { AppleCredentialRepository } from '../services/AppleCredentialRepository';
import type { UserRepository } from '../services/UserRepository';

export function createAccountRoutes(deps: {
  accountDeletionService: AccountDeletionService;
  userRepository: UserRepository;
  appleCredentialRepository: AppleCredentialRepository;
  appleRevocationClient: AppleRevocationClient;
  googleVerifier: GoogleTokenVerifier;
  appleVerifier: AppleTokenVerifier;
  requireAuth: ReturnType<typeof createRequireAuth>;
  accountReauthLimiter: RequestHandler;
}) {
  const router = Router();
  const controller = createAccountController(deps);

  // No :userId param — the account to delete comes only from the verified
  // session (requireAuth). The body only ever carries a fresh provider
  // credential, after a 428. See accountController.deleteAccount.
  router.delete('/', deps.requireAuth, deps.accountReauthLimiter, asyncHandler(controller.deleteAccount));

  return router;
}

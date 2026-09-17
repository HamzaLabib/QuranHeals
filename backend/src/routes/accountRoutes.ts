import { Router } from 'express';

import { createAccountController } from '../controllers/accountController';
import { asyncHandler } from '../middleware/asyncHandler';
import { requireAuth } from '../middleware/requireAuth';
import type { AccountDeletionService } from '../services/AccountDeletionService';

export function createAccountRoutes(deps: { accountDeletionService: AccountDeletionService }) {
  const router = Router();
  const controller = createAccountController(deps);

  // No body, no :userId param — the account to delete comes only from the
  // verified session (requireAuth). See accountController.deleteAccount.
  router.delete('/', requireAuth, asyncHandler(controller.deleteAccount));

  return router;
}

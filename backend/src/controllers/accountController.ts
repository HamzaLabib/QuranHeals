import type { Request, Response } from 'express';

import type { AuthenticatedRequest } from '../middleware/requireAuth';
import type { AccountDeletionService } from '../services/AccountDeletionService';

type AccountControllerDeps = {
  accountDeletionService: AccountDeletionService;
};

export function createAccountController({ accountDeletionService }: AccountControllerDeps) {
  return {
    /**
     * The account to delete is always the currently-authenticated user
     * (req.auth.userId, set by requireAuth from a verified access token) —
     * never a client-supplied id in the URL or body. See Part B §7 and the
     * account-deletion phase's "never accept DELETE /users/:userId."
     */
    deleteAccount: async (req: Request, res: Response) => {
      const { userId } = (req as AuthenticatedRequest).auth;
      await accountDeletionService.deleteAccount(userId);
      res.json({ success: true, data: null });
    },
  };
}

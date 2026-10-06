import { z } from 'zod';

/**
 * Only ever sent on a retry of DELETE /api/account, after the first
 * attempt told the client Apple re-authentication was required because no
 * stored Apple revocation credential existed yet (see
 * accountController.deleteAccount). `provider` is always `'apple'` —
 * Google accounts never need or send this body. Strict: nothing but these
 * three fields is read.
 */
export const appleReauthForDeletionSchema = z
  .object({
    provider: z.literal('apple'),
    idToken: z.string().trim().min(1).max(4096),
    authorizationCode: z.string().trim().min(1).max(2048),
  })
  .strict();

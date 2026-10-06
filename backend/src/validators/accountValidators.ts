import { z } from 'zod';

/**
 * Only ever sent on a retry of DELETE /api/account, after the first
 * attempt told the client Apple re-authentication was required because no
 * stored Apple revocation credential existed yet (see
 * accountController.deleteAccount). Google accounts send
 * googleReauthForDeletionSchema below instead. Strict: nothing but these
 * three fields is read.
 */
export const appleReauthForDeletionSchema = z
  .object({
    provider: z.literal('apple'),
    idToken: z.string().trim().min(1).max(4096),
    authorizationCode: z.string().trim().min(1).max(2048),
  })
  .strict();

/**
 * Sent on the retry of DELETE /api/account for a Google account, after the
 * first attempt answered 428: a fresh Google ID token proving the person
 * still controls the account's Google identity. Strict, like the Apple one.
 */
export const googleReauthForDeletionSchema = z
  .object({
    provider: z.literal('google'),
    idToken: z.string().trim().min(1).max(4096),
  })
  .strict();

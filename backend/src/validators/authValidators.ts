import { z } from 'zod';

// Only ever an idToken — never a userId/email supplied directly by the
// client for account identity. See Part B §7.
export const googleSignInSchema = z.object({
  idToken: z.string().trim().min(1).max(4096),
});

export const appleSignInSchema = z.object({
  idToken: z.string().trim().min(1).max(4096),
});

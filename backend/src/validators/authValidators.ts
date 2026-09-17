import { z } from 'zod';

// Only ever an idToken — never a userId/email supplied directly by the
// client for account identity. See Part B §7.
export const googleSignInSchema = z.object({
  idToken: z.string().trim().min(1).max(4096),
});

export const appleSignInSchema = z.object({
  idToken: z.string().trim().min(1).max(4096),
});

// The refresh token this device already holds — opaque to the client,
// never a userId or any other identity claim. See auth/session.ts.
export const refreshSessionSchema = z.object({
  refreshToken: z.string().trim().min(1).max(512),
});

// Optional: a client that never completed sign-in (or already lost its
// refresh token) still gets a successful logout response — see
// authController.logout.
export const logoutSchema = z.object({
  refreshToken: z.string().trim().min(1).max(512).optional(),
});

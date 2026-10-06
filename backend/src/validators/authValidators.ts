import { z } from 'zod';

// Only ever an idToken — never a userId/email supplied directly by the
// client for account identity. See Part B §7.
export const googleSignInSchema = z.object({
  idToken: z.string().trim().min(1).max(4096),
});

export const appleSignInSchema = z.object({
  idToken: z.string().trim().min(1).max(4096),
  // Only ever present on the native sign-in flow, and only while this
  // single-use, ~5-minute-lived code is still fresh — see
  // mobile/src/auth/appleAuth.ts and auth/appleRevocationClient.ts.
  // Absent entirely on an ordinary re-sign-in; best-effort, never required
  // for sign-in itself to succeed (see authController.signInWithApple).
  authorizationCode: z.string().trim().min(1).max(2048).optional(),
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

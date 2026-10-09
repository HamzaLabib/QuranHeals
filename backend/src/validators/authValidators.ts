import { z } from 'zod';

/**
 * The account-age policy version a new account must declare (16+, approved
 * 2026-10-09). Mirrors AGE_CONFIRMATION_POLICY_VERSION in
 * mobile/src/auth/ageConfirmation.ts. Raising it makes every client re-ask
 * before creating an account; existing accounts are never affected.
 */
export const ACCOUNT_AGE_POLICY_VERSION = 1;

// A self-declaration only ("I confirm that I meet the minimum age
// requirement") — never a date of birth or an age. Optional so existing
// accounts (and older app builds) can keep signing in; whether a NEW
// account may be created is decided in authController, not here. Strict:
// any extra or misshapen field fails the whole request with 400. An
// unknown-but-well-formed version is accepted here and simply treated as
// "no valid declaration" (see hasCurrentAgeDeclaration).
const accountAgeConfirmationSchema = z
  .object({ policyVersion: z.number().int().min(1).max(1000) })
  .strict()
  .optional();

// Only ever an idToken — never a userId/email supplied directly by the
// client for account identity. See Part B §7.
export const googleSignInSchema = z.object({
  idToken: z.string().trim().min(1).max(4096),
  accountAgeConfirmation: accountAgeConfirmationSchema,
});

export const appleSignInSchema = z.object({
  idToken: z.string().trim().min(1).max(4096),
  // Only ever present on the native sign-in flow, and only while this
  // single-use, ~5-minute-lived code is still fresh — see
  // mobile/src/auth/appleAuth.ts and auth/appleRevocationClient.ts.
  // Absent entirely on an ordinary re-sign-in; best-effort, never required
  // for sign-in itself to succeed (see authController.signInWithApple).
  authorizationCode: z.string().trim().min(1).max(2048).optional(),
  accountAgeConfirmation: accountAgeConfirmationSchema,
});

/** True only for a declaration of the current policy version. */
export function hasCurrentAgeDeclaration(declaration: { policyVersion: number } | undefined): boolean {
  return declaration?.policyVersion === ACCOUNT_AGE_POLICY_VERSION;
}

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

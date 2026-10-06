import * as AppleAuthentication from 'expo-apple-authentication';
import { Platform } from 'react-native';

export class AppleSignInCancelledError extends Error {}

/** Apple's native Sign In UI is iOS-only (and web via JS SDK, not used here) — Android has no Apple button, matching standard practice. */
export function isAppleSignInSupportedPlatform(): boolean {
  return Platform.OS === 'ios';
}

export type AppleCredential = {
  identityToken: string;
  /**
   * Short-lived (~5 minutes), single-use — only useful to the backend for
   * exchanging it for a revocable refresh token (see
   * backend/src/auth/appleRevocationClient.ts), either right after sign-in
   * or when account deletion needs a fresh one (no stored credential yet).
   * Apple can in principle omit this; callers that need it should treat a
   * missing code as "revocation can't be captured this time," never as a
   * reason to fail the overall sign-in/re-authentication.
   */
  authorizationCode: string | null;
};

/**
 * Requests a fresh Apple credential via the native Sign In with Apple
 * sheet. Apple only returns the user's name/email on the very first
 * authorization for this app; a caller wanting to keep an email should read
 * it from the backend's sign-in response instead of relying on a later call
 * here returning it again.
 */
export async function requestAppleCredential(): Promise<AppleCredential> {
  if (!isAppleSignInSupportedPlatform()) {
    throw new Error('Sign in with Apple is only available on iOS.');
  }

  let credential: AppleAuthentication.AppleAuthenticationCredential;
  try {
    credential = await AppleAuthentication.signInAsync({
      requestedScopes: [
        AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
        AppleAuthentication.AppleAuthenticationScope.EMAIL,
      ],
    });
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && (error as { code: unknown }).code === 'ERR_REQUEST_CANCELED') {
      throw new AppleSignInCancelledError('Apple sign-in was cancelled.');
    }
    throw error;
  }

  if (!credential.identityToken) {
    throw new Error('Apple did not return an identity token.');
  }

  return { identityToken: credential.identityToken, authorizationCode: credential.authorizationCode };
}

/**
 * The identity token alone, for callers that only need to prove identity
 * (never a revocation credential) — e.g. the existing sync-password-reset
 * re-authentication. See backend/src/auth/appleTokenVerifier.ts, the only
 * thing that ever verifies it.
 */
export async function requestAppleIdentityToken(): Promise<string> {
  return (await requestAppleCredential()).identityToken;
}

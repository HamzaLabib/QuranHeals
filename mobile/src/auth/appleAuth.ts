import * as AppleAuthentication from 'expo-apple-authentication';
import { Platform } from 'react-native';

export class AppleSignInCancelledError extends Error {}

/** Apple's native Sign In UI is iOS-only (and web via JS SDK, not used here) — Android has no Apple button, matching standard practice. */
export function isAppleSignInSupportedPlatform(): boolean {
  return Platform.OS === 'ios';
}

/**
 * Requests an Apple identity token via the native Sign In with Apple sheet.
 * Returns the raw identityToken JWT for the backend to verify
 * (backend/src/auth/appleTokenVerifier.ts) — this module never verifies it
 * itself. Apple only returns the user's name/email on the very first
 * authorization for this app; a caller wanting to keep an email should read
 * it from the backend's sign-in response instead of relying on a later call
 * here returning it again.
 */
export async function requestAppleIdentityToken(): Promise<string> {
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

  return credential.identityToken;
}

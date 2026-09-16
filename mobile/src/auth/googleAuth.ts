import type { AuthSessionResult } from 'expo-auth-session';
import * as Google from 'expo-auth-session/providers/google';

/**
 * Google sign-in uses expo-auth-session's official Google provider (a
 * browser-based OAuth flow via expo-web-browser) rather than the
 * community native-module Google Sign-In SDK — it works in both Expo Go
 * and a custom dev/production build without ejecting from the managed
 * workflow, matching "smallest secure architecture that fits the
 * repository" (Part B §4). Client IDs are public OAuth identifiers (not
 * secrets — see Part B §6) and must be supplied via these env vars; see
 * docs/auth-setup.md for how to obtain real ones from Google Cloud
 * Console. Until they are set, isGoogleAuthConfigured() is false and the
 * sign-in UI should not offer this option.
 */
export function isGoogleAuthConfigured(): boolean {
  return Boolean(
    process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID ||
      process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID ||
      process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID,
  );
}

/**
 * React hook — must be called from a component. Returns the loaded auth
 * request, the latest response, and the prompt function, exactly as
 * expo-auth-session's Google provider does; a caller shows the Google
 * button when `request` is non-null and calls `promptAsync()` on tap. The
 * resulting `response` (read via extractGoogleIdToken) arrives on a later
 * render, not from promptAsync's own resolved value — see the provider's
 * own auto code-exchange behavior.
 */
export function useGoogleAuthRequest() {
  // expo-auth-session throws synchronously during render if its platform's
  // client ID is `undefined` (see invariantClientId in the library) — an
  // empty string keeps the hook safely inert instead of crashing the
  // Settings screen whenever Google sign-in isn't configured yet (the
  // expected state until real Google Cloud Console credentials are set —
  // see docs/auth-setup.md). isGoogleAuthConfigured() gates whether the
  // button is shown or promptAsync is ever actually called.
  return Google.useIdTokenAuthRequest({
    iosClientId: process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID ?? '',
    androidClientId: process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID ?? '',
    webClientId: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID ?? '',
  });
}

export function extractGoogleIdToken(response: AuthSessionResult | null): string | null {
  if (
    response?.type === 'success' &&
    typeof response.params?.id_token === 'string' &&
    response.params.id_token.length > 0
  ) {
    return response.params.id_token;
  }
  return null;
}

export function wasGoogleSignInCancelled(response: AuthSessionResult | null): boolean {
  return response?.type === 'cancel' || response?.type === 'dismiss';
}

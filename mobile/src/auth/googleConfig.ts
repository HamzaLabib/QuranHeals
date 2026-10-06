/**
 * Google OAuth client IDs (public identifiers, never secrets), one per
 * platform, set per EAS environment:
 *   EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID      — iOS app
 *   EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID  — Android app
 *   EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID      — web
 * See docs/auth-and-sync/setup.md. Each property is read directly so Expo
 * inlines it at build time.
 */
export type GoogleClientIds = { ios?: string; android?: string; web?: string };

export function readGoogleClientIds(): GoogleClientIds {
  return {
    ios: process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID?.trim() || undefined,
    android: process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID?.trim() || undefined,
    web: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID?.trim() || undefined,
  };
}

/**
 * The client ID this platform's Google sign-in actually uses
 * (expo-auth-session picks iosClientId / androidClientId / webClientId by
 * Platform.OS). Another platform's ID never counts: an iPhone build with
 * only the Android ID would otherwise show a Google button that cannot work.
 */
export function googleClientIdForPlatform(os: string, ids: GoogleClientIds): string | undefined {
  if (os === 'ios') return ids.ios;
  if (os === 'android') return ids.android;
  return ids.web;
}

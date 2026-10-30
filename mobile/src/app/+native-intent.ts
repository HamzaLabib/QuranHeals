import type { NativeIntent } from 'expo-router';
import { Platform } from 'react-native';

/**
 * Google sign-in's redirect (`<applicationId>:/oauthredirect?code=…`, see
 * expo-auth-session's Google provider) is not a screen. On Android the
 * browser session has no native capture: expo-web-browser waits for the
 * redirect on Linking's 'url' event, and Expo Router hears the same event and
 * would open "Unmatched Route" on top of Settings. iOS never delivers it here
 * (ASWebAuthenticationSession keeps it); the Android check keeps iOS exactly as it was regardless.
 */
export function isOAuthRedirect(path: string): boolean {
  return /^[a-z][a-z0-9+.-]*:\/{0,3}oauthredirect(?:[/?#]|$)/i.test(path);
}

/** While the app is running, stay on the current screen; WebBrowser's own listener completes the sign-in. A cold start
 * (the app was killed while the browser was open) has no pending request left to complete, so it opens Home. */
export const redirectSystemPath: NonNullable<NativeIntent['redirectSystemPath']> = ({ path, initial }) => {
  if (Platform.OS === 'android' && isOAuthRedirect(path)) return initial ? '/' : null;
  return path;
};

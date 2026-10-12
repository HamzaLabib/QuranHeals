import { router } from 'expo-router';

/**
 * Back to the previous app screen; Home when there is none (the screen was
 * opened directly, e.g. from a link on a cold start).
 */
export function goBackOrHome() {
  if (router.canGoBack()) router.back();
  else router.replace('/');
}

import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { useIsFocused } from 'expo-router';
import { useEffect, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

import { useKeepAwakePreference } from './useKeepAwakePreference';

/** The reader's own keep-awake tag: activation and release always use this one, never the shared default tag. */
export const MUSHAF_KEEP_AWAKE_TAG = 'quran-heals-mushaf-reader';

/** Keep the screen awake only when all three hold: the setting is ON, the reader is the focused screen, the app is in the foreground. */
export function shouldKeepMushafAwake(enabled: boolean, focused: boolean, appState: AppStateStatus | null): boolean {
  return enabled && focused && appState === 'active';
}

/**
 * Keep Screen Awake for the Mushaf reader (Settings → Keep Screen Awake). Held while the reader is focused and the
 * app is active; released the moment any of that stops (another tab or route, background, the setting turned OFF)
 * and on unmount. Only `awake` changing (re)runs the effect, so turning pages, full screen and the reader's own
 * popups and sheets never toggle it. It only stops inactivity dimming and locking: the power button and the device's
 * security settings are untouched. No timers or polling: one AppState listener, removed on unmount.
 */
export function useMushafKeepAwake(): boolean {
  const { enabled, isReady } = useKeepAwakePreference();
  const focused = useIsFocused();
  const [appState, setAppState] = useState<AppStateStatus | null>(() => AppState.currentState);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', setAppState);
    return () => subscription.remove();
  }, []);

  // Not before the saved choice has loaded: a reader who chose OFF is never held, even for a moment at launch.
  const awake = shouldKeepMushafAwake(enabled && isReady, focused, appState);
  useEffect(() => {
    if (!awake) return undefined;
    // Best effort: a device without keep-awake support simply follows its own timeout.
    activateKeepAwakeAsync(MUSHAF_KEEP_AWAKE_TAG).catch(() => undefined);
    return () => {
      deactivateKeepAwake(MUSHAF_KEEP_AWAKE_TAG).catch(() => undefined);
    };
  }, [awake]);
  return awake;
}

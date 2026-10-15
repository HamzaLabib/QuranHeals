import { useIsFocused } from 'expo-router';
import { useEffect } from 'react';

/**
 * A reminder that arrives while the app is open is listed in Notification
 * Centre as usual, but shows no banner and plays no sound while the Mushaf
 * reader is the focused screen, so reading is never interrupted. Nothing is
 * cancelled or removed because the app is open.
 */
let mushafReaders = 0;

export function isMushafReadingFocused(): boolean {
  return mushafReaders > 0;
}

/** Called once at the top of the Mushaf screen. */
export function useQuietRemindersWhileReading(): void {
  const focused = useIsFocused();
  useEffect(() => {
    if (!focused) return undefined;
    mushafReaders += 1;
    return () => {
      mushafReaders -= 1;
    };
  }, [focused]);
}

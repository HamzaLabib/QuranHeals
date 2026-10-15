import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import {
  DEFAULT_QURAN_FONT_SIZE,
  MAX_QURAN_FONT_SIZE,
  MIN_QURAN_FONT_SIZE,
  isValidQuranFontSize,
  loadQuranFontSizePreference,
  saveQuranFontSizePreference,
  stepQuranFontSize,
} from './quranFontSizePreference';
import { recordLocalPreferenceChange } from '@/sync/preferencesSyncState';

export type QuranFontSizePreferenceContextValue = {
  /** The user's chosen main-screen size, before any per-ayah automatic length adjustment. */
  preferredSize: number;
  isReady: boolean;
  increase: () => void;
  decrease: () => void;
  /** Resets `preferredSize` to the default — automatic length adjustment still applies afterwards, same as at any other preferred size. */
  reset: () => void;
  /** The signed-in account's size, applied on this device without being recorded as this device's change (useAuth.tsx). */
  applySyncedSize: (size: number) => void;
  canIncrease: boolean;
  canDecrease: boolean;
};

const QuranFontSizePreferenceContext = createContext<QuranFontSizePreferenceContextValue | undefined>(undefined);

/**
 * Global Quran-text size preference. Stored on the device and synced with
 * the signed-in account (sync/preferenceFields.ts); a guest's stays here.
 * Shared via context so Favorites' compact cards read the same value
 * without each card independently touching AsyncStorage.
 */
export function QuranFontSizePreferenceProvider({ children }: { children: ReactNode }) {
  const [preferredSize, setPreferredSize] = useState<number>(DEFAULT_QURAN_FONT_SIZE);
  const [isReady, setIsReady] = useState(false);
  // Read synchronously by each step, so a change and what is recorded for the account always agree.
  const sizeRef = useRef(DEFAULT_QURAN_FONT_SIZE);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const loaded = await loadQuranFontSizePreference();
      if (!cancelled) {
        sizeRef.current = loaded;
        setPreferredSize(loaded);
        setIsReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const apply = useCallback((next: number, fromUser: boolean) => {
    if (next === sizeRef.current) return;
    sizeRef.current = next;
    // The user's own change is recorded for the signed-in account (sync/preferencesSyncState.ts).
    if (fromUser) recordLocalPreferenceChange('quranFontSize', next);
    setPreferredSize(next);
    void saveQuranFontSizePreference(next);
  }, []);

  const increase = useCallback(() => apply(stepQuranFontSize(sizeRef.current, 1), true), [apply]);
  const decrease = useCallback(() => apply(stepQuranFontSize(sizeRef.current, -1), true), [apply]);
  const reset = useCallback(() => apply(DEFAULT_QURAN_FONT_SIZE, true), [apply]);
  const applySyncedSize = useCallback((size: number) => {
    if (isValidQuranFontSize(size)) apply(size, false);
  }, [apply]);

  const value = useMemo<QuranFontSizePreferenceContextValue>(
    () => ({
      preferredSize,
      isReady,
      increase,
      decrease,
      reset,
      applySyncedSize,
      canIncrease: preferredSize < MAX_QURAN_FONT_SIZE,
      canDecrease: preferredSize > MIN_QURAN_FONT_SIZE,
    }),
    [preferredSize, isReady, increase, decrease, reset, applySyncedSize],
  );

  return <QuranFontSizePreferenceContext.Provider value={value}>{children}</QuranFontSizePreferenceContext.Provider>;
}

/** For account sync (useAuth.tsx): outside the provider (an isolated test), nothing to apply and nothing to wait for. */
export function useQuranFontSizeSync(): Pick<QuranFontSizePreferenceContextValue, 'applySyncedSize' | 'isReady'> {
  return useContext(QuranFontSizePreferenceContext) ?? { applySyncedSize: () => undefined, isReady: true };
}

export function useQuranFontSizePreference(): QuranFontSizePreferenceContextValue {
  const context = useContext(QuranFontSizePreferenceContext);
  if (!context) {
    throw new Error('useQuranFontSizePreference must be used within a QuranFontSizePreferenceProvider');
  }
  return context;
}

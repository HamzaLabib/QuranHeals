import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import {
  DEFAULT_QURAN_FONT_SIZE,
  MAX_QURAN_FONT_SIZE,
  MIN_QURAN_FONT_SIZE,
  loadQuranFontSizePreference,
  saveQuranFontSizePreference,
  stepQuranFontSize,
} from './quranFontSizePreference';

export type QuranFontSizePreferenceContextValue = {
  /** The user's chosen main-screen size, before any per-ayah automatic length adjustment. */
  preferredSize: number;
  isReady: boolean;
  increase: () => void;
  decrease: () => void;
  /** Resets `preferredSize` to the default — automatic length adjustment still applies afterwards, same as at any other preferred size. */
  reset: () => void;
  canIncrease: boolean;
  canDecrease: boolean;
};

const QuranFontSizePreferenceContext = createContext<QuranFontSizePreferenceContextValue | undefined>(undefined);

/**
 * Global, purely local Quran-text size preference (see
 * quranFontSizePreference.ts for why this never syncs to an account).
 * Shared via context so Favorites' compact cards read the same value
 * without each card independently touching AsyncStorage.
 */
export function QuranFontSizePreferenceProvider({ children }: { children: ReactNode }) {
  const [preferredSize, setPreferredSize] = useState<number>(DEFAULT_QURAN_FONT_SIZE);
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const loaded = await loadQuranFontSizePreference();
      if (!cancelled) {
        setPreferredSize(loaded);
        setIsReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const increase = useCallback(() => {
    setPreferredSize((current) => {
      const next = stepQuranFontSize(current, 1);
      void saveQuranFontSizePreference(next);
      return next;
    });
  }, []);

  const decrease = useCallback(() => {
    setPreferredSize((current) => {
      const next = stepQuranFontSize(current, -1);
      void saveQuranFontSizePreference(next);
      return next;
    });
  }, []);

  const reset = useCallback(() => {
    setPreferredSize(DEFAULT_QURAN_FONT_SIZE);
    void saveQuranFontSizePreference(DEFAULT_QURAN_FONT_SIZE);
  }, []);

  const value = useMemo<QuranFontSizePreferenceContextValue>(
    () => ({
      preferredSize,
      isReady,
      increase,
      decrease,
      reset,
      canIncrease: preferredSize < MAX_QURAN_FONT_SIZE,
      canDecrease: preferredSize > MIN_QURAN_FONT_SIZE,
    }),
    [preferredSize, isReady, increase, decrease, reset],
  );

  return <QuranFontSizePreferenceContext.Provider value={value}>{children}</QuranFontSizePreferenceContext.Provider>;
}

export function useQuranFontSizePreference(): QuranFontSizePreferenceContextValue {
  const context = useContext(QuranFontSizePreferenceContext);
  if (!context) {
    throw new Error('useQuranFontSizePreference must be used within a QuranFontSizePreferenceProvider');
  }
  return context;
}

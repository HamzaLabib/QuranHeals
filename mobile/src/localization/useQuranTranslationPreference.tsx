import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import {
  DEFAULT_QURAN_TRANSLATION_PREFERENCE,
  loadQuranTranslationPreference,
  saveQuranTranslationPreference,
  type QuranTranslationPreference,
  type TranslationDisplayMode,
} from './quranTranslationPreference';

export type QuranTranslationPreferenceContextValue = {
  preference: QuranTranslationPreference;
  setDisplayMode: (mode: TranslationDisplayMode) => void;
  isReady: boolean;
};

const QuranTranslationPreferenceContext = createContext<QuranTranslationPreferenceContextValue | undefined>(undefined);

/**
 * Global setting: which display mode (always/on-demand/off) governs the
 * English Pickthall translation everywhere it would appear. Deliberately
 * does NOT track "revealed on this ayah" — that is local, per-ayah screen
 * state (see AyahCard.tsx), reset whenever a different ayah loads. Only the
 * global mode itself is persisted here.
 */
export function QuranTranslationPreferenceProvider({ children }: { children: ReactNode }) {
  const [preference, setPreference] = useState<QuranTranslationPreference>(DEFAULT_QURAN_TRANSLATION_PREFERENCE);
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const loaded = await loadQuranTranslationPreference();
      if (!cancelled) {
        setPreference(loaded);
        setIsReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const setDisplayMode = useCallback((mode: TranslationDisplayMode) => {
    setPreference((current) => {
      const next = { ...current, displayMode: mode };
      void saveQuranTranslationPreference(next);
      return next;
    });
  }, []);

  const value = useMemo<QuranTranslationPreferenceContextValue>(
    () => ({ preference, setDisplayMode, isReady }),
    [preference, setDisplayMode, isReady],
  );

  return <QuranTranslationPreferenceContext.Provider value={value}>{children}</QuranTranslationPreferenceContext.Provider>;
}

export function useQuranTranslationPreference(): QuranTranslationPreferenceContextValue {
  const context = useContext(QuranTranslationPreferenceContext);
  if (!context) {
    throw new Error('useQuranTranslationPreference must be used within a QuranTranslationPreferenceProvider');
  }
  return context;
}

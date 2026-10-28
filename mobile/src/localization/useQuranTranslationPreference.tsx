import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import {
  DEFAULT_QURAN_TRANSLATION_PREFERENCE,
  loadQuranTranslationPreference,
  saveQuranTranslationPreference,
  type EnabledTranslationMode,
  type QuranTranslationPreference,
  type TranslationDisplayMode,
} from './quranTranslationPreference';
import type { PreferenceChangeOptions } from './useAppLocale';
import { recordLocalPreferenceChange } from '@/sync/preferencesSyncState';

export type QuranTranslationPreferenceContextValue = {
  preference: QuranTranslationPreference;
  /** Sets the synced display mode directly (account sync); a mode other than 'off' also becomes the dropdown's choice. */
  setDisplayMode: (mode: TranslationDisplayMode, options?: PreferenceChangeOptions) => void;
  /** Settings → Show Translation's switch: ON restores the dropdown's choice, OFF keeps it. */
  setShowTranslation: (on: boolean) => void;
  /** Settings → Show Translation's dropdown: applied at once while ON, kept for later while OFF. */
  setTranslationMode: (mode: EnabledTranslationMode) => void;
  /**
   * The signed-in account's kept dropdown choice (useAuth.tsx). Applied while
   * the switch is OFF; while ON the account's display mode already is that
   * choice (setDisplayMode). Never recorded as this device's change.
   */
  applySyncedTranslationMode: (mode: EnabledTranslationMode) => void;
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
  // The value every change starts from, read synchronously (a change's synced fields are compared against it).
  const currentRef = useRef<QuranTranslationPreference>(DEFAULT_QURAN_TRANSLATION_PREFERENCE);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const loaded = await loadQuranTranslationPreference();
      if (!cancelled) {
        currentRef.current = loaded;
        setPreference(loaded);
        setIsReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const update = useCallback((change: (current: QuranTranslationPreference) => QuranTranslationPreference, options?: PreferenceChangeOptions) => {
    const current = currentRef.current;
    const next = change(current);
    currentRef.current = next;
    // See useAppLocale.tsx's setLocale: only a user's own change is recorded,
    // and only the synced fields it actually changed.
    if (!options?.fromSync) {
      if (next.displayMode !== current.displayMode) recordLocalPreferenceChange('translationDisplayMode', next.displayMode);
      if (next.translationId !== current.translationId) recordLocalPreferenceChange('translationId', next.translationId);
      if (next.enabledMode !== current.enabledMode) recordLocalPreferenceChange('translationEnabledMode', next.enabledMode);
    }
    setPreference(next);
    void saveQuranTranslationPreference(next);
  }, []);

  const setDisplayMode = useCallback((mode: TranslationDisplayMode, options?: PreferenceChangeOptions) => {
    update((current) => ({ ...current, displayMode: mode, enabledMode: mode === 'off' ? current.enabledMode : mode }), options);
  }, [update]);

  const setShowTranslation = useCallback((on: boolean) => {
    update((current) => ({ ...current, displayMode: on ? current.enabledMode : 'off' }));
  }, [update]);

  const setTranslationMode = useCallback((mode: EnabledTranslationMode) => {
    update((current) => ({ ...current, enabledMode: mode, displayMode: current.displayMode === 'off' ? 'off' : mode }));
  }, [update]);

  const applySyncedTranslationMode = useCallback((mode: EnabledTranslationMode) => {
    update((current) => (current.displayMode === 'off' && current.enabledMode !== mode ? { ...current, enabledMode: mode } : current), { fromSync: true });
  }, [update]);

  const value = useMemo<QuranTranslationPreferenceContextValue>(
    () => ({ preference, setDisplayMode, setShowTranslation, setTranslationMode, applySyncedTranslationMode, isReady }),
    [preference, setDisplayMode, setShowTranslation, setTranslationMode, applySyncedTranslationMode, isReady],
  );

  return <QuranTranslationPreferenceContext.Provider value={value}>{children}</QuranTranslationPreferenceContext.Provider>;
}

/**
 * The stored display mode for the ayah screen's starting state (AyahCard), or
 * null outside the provider (a card rendered alone in a test), which then
 * starts hidden. Never throws.
 */
export function useQuranTranslationDisplayMode(): TranslationDisplayMode | null {
  return useContext(QuranTranslationPreferenceContext)?.preference.displayMode ?? null;
}

export function useQuranTranslationPreference(): QuranTranslationPreferenceContextValue {
  const context = useContext(QuranTranslationPreferenceContext);
  if (!context) {
    throw new Error('useQuranTranslationPreference must be used within a QuranTranslationPreferenceProvider');
  }
  return context;
}

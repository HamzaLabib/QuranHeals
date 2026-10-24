import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useState } from 'react';

import { recordLocalPreferenceChange } from '@/sync/preferencesSyncState';

/**
 * Quran Translation (ترجمة القرآن; formerly shown as Quran Language): the primary full-Quran reading mode.
 *
 * One mode exists today: 'quran-text', shown as None / بدون ترجمة — the
 * traditional 604-page Arabic Mushaf, exactly as it is, without a
 * translation. Its stored and synced id is unchanged from when the setting was
 * called Quran Language, so every saved or synced value keeps its meaning (no
 * migration); any other value is not a mode and reads as this default. A future mode (a verified translation of the
 * meanings, e.g. English or Turkish) is added as one more entry in
 * QURAN_READING_MODES with its own reading layout (by Surah and Ayah,
 * never the Arabic Mushaf's page geometry; see
 * docs/localization/quran-language.md). Nothing is listed until it exists:
 * no disabled or "coming soon" options.
 *
 * The stored value is the stable mode id, never a displayed label.
 */
export type QuranReadingMode = 'quran-text';

type QuranReadingModeDefinition = {
  id: QuranReadingMode;
  /** Key of the mode's name in messages.settings. */
  labelKey: 'quranTranslationNone';
};

export const QURAN_READING_MODES: readonly QuranReadingModeDefinition[] = [{ id: 'quran-text', labelKey: 'quranTranslationNone' }];
export const DEFAULT_QURAN_READING_MODE: QuranReadingMode = 'quran-text';
export const QURAN_LANGUAGE_STORAGE_KEY = 'quran-heals:quran-language:v1';

export function isQuranReadingMode(value: unknown): value is QuranReadingMode {
  return QURAN_READING_MODES.some((mode) => mode.id === value);
}

/** Stored mode, or the default if none (or one that no longer exists). Never throws. */
export async function loadQuranReadingMode(): Promise<QuranReadingMode> {
  try {
    const stored = await AsyncStorage.getItem(QURAN_LANGUAGE_STORAGE_KEY);
    return isQuranReadingMode(stored) ? stored : DEFAULT_QURAN_READING_MODE;
  } catch {
    return DEFAULT_QURAN_READING_MODE;
  }
}

export async function saveQuranReadingMode(mode: QuranReadingMode): Promise<void> {
  try {
    await AsyncStorage.setItem(QURAN_LANGUAGE_STORAGE_KEY, mode);
  } catch {
    // Non-fatal: the in-memory choice still applies this session.
  }
}

const listeners = new Set<(mode: QuranReadingMode) => void>();

/** The signed-in account's Quran Translation (synced as quranLanguage), applied on this device (useAuth.tsx): saved and shown, never recorded as the user's own change. */
export async function applySyncedQuranReadingMode(mode: QuranReadingMode): Promise<void> {
  listeners.forEach((listener) => listener(mode));
  await saveQuranReadingMode(mode);
}

/** Settings' selector state. Only Settings reads it today: the Mushaf has a single mode. */
export function useQuranReadingMode(): { mode: QuranReadingMode; setMode: (mode: QuranReadingMode) => void } {
  const [mode, setModeState] = useState<QuranReadingMode>(DEFAULT_QURAN_READING_MODE);
  useEffect(() => {
    let cancelled = false;
    const listener = (next: QuranReadingMode) => {
      if (!cancelled) setModeState(next);
    };
    listeners.add(listener);
    void loadQuranReadingMode().then((loaded) => {
      if (!cancelled) setModeState(loaded);
    });
    return () => {
      cancelled = true;
      listeners.delete(listener);
    };
  }, []);
  const setMode = useCallback((next: QuranReadingMode) => {
    // The user's own choice, recorded for the signed-in account (sync/preferencesSyncState.ts).
    recordLocalPreferenceChange('quranLanguage', next);
    setModeState(next);
    void saveQuranReadingMode(next);
  }, []);
  return { mode, setMode };
}

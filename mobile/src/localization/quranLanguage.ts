import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useState } from 'react';

/**
 * Quran Language (لغة القرآن): the primary full-Quran reading mode.
 *
 * One mode exists today: 'quran-text' — the traditional 604-page Arabic
 * Mushaf, exactly as it is. A future mode (a verified translation of the
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
  labelKey: 'quranTextOption';
};

export const QURAN_READING_MODES: readonly QuranReadingModeDefinition[] = [{ id: 'quran-text', labelKey: 'quranTextOption' }];
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

/** Settings' selector state. Only Settings reads it today: the Mushaf has a single mode. */
export function useQuranReadingMode(): { mode: QuranReadingMode; setMode: (mode: QuranReadingMode) => void } {
  const [mode, setModeState] = useState<QuranReadingMode>(DEFAULT_QURAN_READING_MODE);
  useEffect(() => {
    let cancelled = false;
    void loadQuranReadingMode().then((loaded) => {
      if (!cancelled) setModeState(loaded);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  const setMode = useCallback((next: QuranReadingMode) => {
    setModeState(next);
    void saveQuranReadingMode(next);
  }, []);
  return { mode, setMode };
}

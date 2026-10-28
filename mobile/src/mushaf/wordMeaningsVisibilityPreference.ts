import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Word Meanings (Settings, below Keep Screen Awake): whether the reader shows its المعاني button
 * (mushafFeatures/MushafFeatureLayer.tsx). An account setting since 2026-10-27, like Keep Screen Awake
 * (`wordMeaningsVisible`, sync/preferenceFields.ts). ON for anyone who has never chosen; an explicit choice is only ever
 * replaced by the user's own later one (here, or on the account's other devices).
 */
export const DEFAULT_WORD_MEANINGS_VISIBLE = true;
export const WORD_MEANINGS_VISIBLE_STORAGE_KEY = 'quran-heals:word-meanings-visible:v1';

/** The stored value ('true' / 'false'), or the default for anything else (none, corrupt, another type). */
export function parseWordMeaningsVisible(raw: string | null): boolean {
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  return DEFAULT_WORD_MEANINGS_VISIBLE;
}

/** Never throws: an unreadable store means the default. */
export async function loadWordMeaningsVisible(): Promise<boolean> {
  try {
    return parseWordMeaningsVisible(await AsyncStorage.getItem(WORD_MEANINGS_VISIBLE_STORAGE_KEY));
  } catch {
    return DEFAULT_WORD_MEANINGS_VISIBLE;
  }
}

export async function saveWordMeaningsVisible(visible: boolean): Promise<void> {
  try {
    await AsyncStorage.setItem(WORD_MEANINGS_VISIBLE_STORAGE_KEY, visible ? 'true' : 'false');
  } catch {
    // Non-fatal: the in-memory choice still applies this session.
  }
}

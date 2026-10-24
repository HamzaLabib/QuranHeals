import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Word Meanings (Settings, below Keep Screen Awake): whether the reader shows its المعاني button
 * (mushafFeatures/MushafFeatureLayer.tsx). A purely local device setting like Keep Screen Awake: never synced, no
 * account, no backend. ON for anyone who has never chosen; an explicit OFF is kept for good (nothing ever rewrites it).
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

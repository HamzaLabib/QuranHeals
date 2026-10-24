import AsyncStorage from '@react-native-async-storage/async-storage';

import { DEFAULT_FAVORITE_RECITER_ID, isReciterId } from './reciters';

/**
 * Settings → Quran → Favorite Reciter (الإعدادات ← القرآن ← القارئ المفضل): the voice for the Mushaf's Play and Listen
 * (unless a reciter is chosen in the player for that session) and the ayah screens' play button. A device setting like
 * Keep Screen Awake: stored on this device, not synced with the account. Muhammad Siddiq Al-Minshawi (reciters.ts DEFAULT_RECITER_ID) for anyone who has never
 * chosen. A choice in the player never changes it.
 */
export const FAVORITE_RECITER_STORAGE_KEY = 'quran-heals:favorite-reciter:v1';

/** The stored reciter, or the default for anything else (none, corrupt, a reciter no longer listed). */
export function parseFavoriteReciter(raw: string | null): string {
  return isReciterId(raw) ? raw : DEFAULT_FAVORITE_RECITER_ID;
}

/** Never throws: an unreadable store means the default. */
export async function loadFavoriteReciter(): Promise<string> {
  try {
    return parseFavoriteReciter(await AsyncStorage.getItem(FAVORITE_RECITER_STORAGE_KEY));
  } catch {
    return DEFAULT_FAVORITE_RECITER_ID;
  }
}

export async function saveFavoriteReciter(reciterId: string): Promise<void> {
  if (!isReciterId(reciterId)) return;
  try {
    await AsyncStorage.setItem(FAVORITE_RECITER_STORAGE_KEY, reciterId);
  } catch {
    // Non-fatal: the in-memory choice still applies this session.
  }
}

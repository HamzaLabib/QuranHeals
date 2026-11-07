import AsyncStorage from '@react-native-async-storage/async-storage';

import { isTafsirEditionId, type TafsirEditionId } from './editions';

/**
 * The tafsir edition last chosen in the reader, kept on the device across sessions. It is only a preference: the reader
 * opens it when it is ready on this device, and otherwise الميسر (library.ts resolve), without overwriting the choice,
 * so a downloaded edition removed and fetched again is preferred again.
 */
export const TAFSIR_EDITION_STORAGE_KEY = 'quran-heals:tafsir-edition:v1';

export async function loadTafsirEditionPreference(): Promise<TafsirEditionId | null> {
  try {
    const raw = await AsyncStorage.getItem(TAFSIR_EDITION_STORAGE_KEY);
    return isTafsirEditionId(raw) ? raw : null;
  } catch {
    return null;
  }
}

export async function saveTafsirEditionPreference(edition: TafsirEditionId): Promise<void> {
  try {
    await AsyncStorage.setItem(TAFSIR_EDITION_STORAGE_KEY, edition);
  } catch {
    // Best effort: the reader still shows the edition; only the next session would not remember it.
  }
}

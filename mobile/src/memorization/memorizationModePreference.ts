import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Memorization Mode (Settings → Quran, below Word Meanings): whether the reader shows its Eye button beside the page
 * number (memorization/MemorizationControls.tsx). It never hides any ayah by itself: entering Memorization Mode stays
 * the reader's own tap on the Eye. An account setting since 2026-10-27, like Word Meanings and Keep Screen Awake
 * (`memorizationModeVisible`, sync/preferenceFields.ts). ON for anyone who has never chosen (owner request, 2026-10-25:
 * the Eye offered by default); a saved choice — ON or OFF — always wins, and nothing ever saves one except the reader's
 * own switch, here or on the account's other devices.
 */
export const DEFAULT_MEMORIZATION_MODE_VISIBLE = true;
export const MEMORIZATION_MODE_VISIBLE_STORAGE_KEY = 'quran-heals:memorization-mode-visible:v1';

/** The stored value ('true' / 'false'), or the default for anything else (none, corrupt, another type). */
export function parseMemorizationModeVisible(raw: string | null): boolean {
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  return DEFAULT_MEMORIZATION_MODE_VISIBLE;
}

/** Never throws: an unreadable store means the default. */
export async function loadMemorizationModeVisible(): Promise<boolean> {
  try {
    return parseMemorizationModeVisible(await AsyncStorage.getItem(MEMORIZATION_MODE_VISIBLE_STORAGE_KEY));
  } catch {
    return DEFAULT_MEMORIZATION_MODE_VISIBLE;
  }
}

export async function saveMemorizationModeVisible(visible: boolean): Promise<void> {
  try {
    await AsyncStorage.setItem(MEMORIZATION_MODE_VISIBLE_STORAGE_KEY, visible ? 'true' : 'false');
  } catch {
    // Non-fatal: the in-memory choice still applies this session.
  }
}

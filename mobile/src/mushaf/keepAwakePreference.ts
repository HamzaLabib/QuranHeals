import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Keep Screen Awake (Settings, below Quran Translation): while ON, the Mushaf reader stops the screen dimming and
 * locking from inactivity (mushaf/useMushafKeepAwake.ts) — only while the reader is focused and the app active, on
 * whichever device. An account setting since 2026-10-27 (`keepAwake`, sync/preferenceFields.ts): a choice made while
 * signed in follows the account. ON for anyone who has never chosen; an explicit choice is only ever replaced by the
 * user's own later one (here, or on the account's other devices).
 */
export const DEFAULT_KEEP_AWAKE = true;
export const KEEP_AWAKE_STORAGE_KEY = 'quran-heals:mushaf-keep-awake:v1';

/** The stored value ('true' / 'false'), or the default for anything else (none, corrupt, another type). */
export function parseKeepAwake(raw: string | null): boolean {
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  return DEFAULT_KEEP_AWAKE;
}

/** Never throws: an unreadable store means the default. */
export async function loadKeepAwake(): Promise<boolean> {
  try {
    return parseKeepAwake(await AsyncStorage.getItem(KEEP_AWAKE_STORAGE_KEY));
  } catch {
    return DEFAULT_KEEP_AWAKE;
  }
}

export async function saveKeepAwake(enabled: boolean): Promise<void> {
  try {
    await AsyncStorage.setItem(KEEP_AWAKE_STORAGE_KEY, enabled ? 'true' : 'false');
  } catch {
    // Non-fatal: the in-memory choice still applies this session.
  }
}

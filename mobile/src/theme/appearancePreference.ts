import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * The user's explicit appearance choice. 'system' means "follow the device
 * color scheme"; 'light'/'dark' force that theme regardless of the device
 * appearance. Stored on the device, and synced with the signed-in
 * account like the other settings in sync/preferenceFields.ts.
 */
export type AppearanceMode = 'system' | 'light' | 'dark';

/**
 * A user who has never chosen an Appearance option follows the device's
 * Light/Dark appearance (System). A saved Light or Dark choice is kept as it
 * is; nothing ever rewrites it. Also the fallback for a missing/corrupted
 * stored value or a storage read failure.
 */
export const DEFAULT_APPEARANCE_MODE: AppearanceMode = 'system';

const APPEARANCE_MODES: readonly AppearanceMode[] = ['system', 'light', 'dark'];

const STORAGE_KEY = 'quran-heals:appearance-preference:v1';

export function isValidAppearanceMode(value: unknown): value is AppearanceMode {
  return typeof value === 'string' && (APPEARANCE_MODES as readonly string[]).includes(value);
}

/** Validates an arbitrary stored payload — never throws, never returns anything outside the three valid modes. */
export function parseAppearanceMode(raw: unknown): AppearanceMode {
  return isValidAppearanceMode(raw) ? raw : DEFAULT_APPEARANCE_MODE;
}

/** Never throws and never blocks app startup: any read failure (or nothing stored yet) resolves to DEFAULT_APPEARANCE_MODE ('system'). */
export async function loadAppearancePreference(): Promise<AppearanceMode> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (raw === null) return DEFAULT_APPEARANCE_MODE;
    return parseAppearanceMode(JSON.parse(raw));
  } catch {
    return DEFAULT_APPEARANCE_MODE;
  }
}

export async function saveAppearancePreference(mode: AppearanceMode): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(mode));
  } catch {
    // Persistence failure is non-fatal: the in-memory selection still applies this session.
  }
}

import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * The Qibla screen's chosen city: its ID only (a Natural Earth place ID from assets/qibla/cities.json), on this device.
 * Never coordinates, never synced (not in sync/preferenceFields.ts), never sent. Cleared when the user goes back to
 * "Use my location". The ONLY Qibla file allowed to use storage (tests/qiblaPrivacy.test.ts).
 */

export const MANUAL_CITY_KEY = 'qibla.manualCityId';

export async function loadManualCityId(): Promise<number | null> {
  try {
    const raw = await AsyncStorage.getItem(MANUAL_CITY_KEY);
    if (raw === null || !/^\d{1,15}$/.test(raw)) return null;
    return Number(raw);
  } catch {
    return null;
  }
}

export async function saveManualCityId(id: number): Promise<void> {
  if (!Number.isSafeInteger(id) || id <= 0) return;
  try {
    await AsyncStorage.setItem(MANUAL_CITY_KEY, String(id));
  } catch {
    // Best effort: the choice still applies for this visit.
  }
}

export async function clearManualCityId(): Promise<void> {
  try {
    await AsyncStorage.removeItem(MANUAL_CITY_KEY);
  } catch {
    // Best effort.
  }
}

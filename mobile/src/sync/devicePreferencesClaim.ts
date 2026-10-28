import AsyncStorage from '@react-native-async-storage/async-storage';

import { MEMORIZATION_GUIDE_STORAGE_KEY } from '@/memorization/memorizationGuide';
import { MEMORIZATION_MODE_VISIBLE_STORAGE_KEY } from '@/memorization/memorizationModePreference';
import { KEEP_AWAKE_STORAGE_KEY } from '@/mushaf/keepAwakePreference';
import { MUSHAF_GUIDE_STORAGE_KEY } from '@/mushaf/mushafGuide';
import { WORD_MEANINGS_VISIBLE_STORAGE_KEY } from '@/mushaf/wordMeaningsVisibilityPreference';
import { NOTIFICATION_PREFERENCES_STORAGE_KEY } from '@/notifications/preferences';

import { isSyncedPreferenceValue, type SyncedPreferenceField, type SyncedPreferenceValue } from './preferenceFields';
import { updateAccountPreferenceState } from './preferencesSyncState';

/**
 * The settings that became account settings on 2026-10-27
 * (sync/preferenceFields.ts) were, until then, stored on the device only,
 * for whoever used it. Once, on the first launch of this version, the
 * account whose session is restored then — the one signed in on this
 * device across the update — takes the choices actually saved here as its
 * own (exactly as claimLegacyPreferenceChanges does for the earlier
 * settings):
 *  - only a value really saved (a key on the device), never a default the
 *    user never chose, so a default never reaches the account;
 *  - never over a change this account already recorded here;
 *  - at the earliest instant there is (SEED_AT): the account keeps any
 *    value it already holds (another device's, or one claimed there first),
 *    and any change made with this version, on any device, wins over it.
 * A guest at that launch, or a later sign-in (interactive: the device's
 * values may be a guest's or another account's), claims nothing — those
 * values stay on the device, as before, until changed (guest-data consent).
 * Home's recent emotions need no claim: they were already kept per account.
 */
const CLAIMED_KEY = 'quran-heals:device-preferences-claimed:v1';
/** audio/favoriteReciterPreference.ts FAVORITE_RECITER_STORAGE_KEY (not imported: it pulls in the whole reciter catalog). */
const FAVORITE_RECITER_STORAGE_KEY = 'quran-heals:favorite-reciter:v1';
const TRANSLATION_STORAGE_KEY = 'quran-heals:quran-translation-preference:v1';
/** The earliest instant: below any change ever made (backend preferencesMerge.ts keeps a stored value at a tie). */
export const SEED_AT = 1;

const flag = (raw: string | null) => (raw === 'true' ? true : raw === 'false' ? false : undefined);
const json = (raw: string | null): unknown => {
  if (raw === null) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
};

/** The new account settings saved on this device, in their synced form. */
async function savedDeviceValues(): Promise<Partial<Record<SyncedPreferenceField, unknown>>> {
  const read = (key: string) => AsyncStorage.getItem(key);
  const [reciter, keepAwake, wordMeanings, memorization, notifications, mushafGuide, memorizationGuide, translation] = await Promise.all([
    read(FAVORITE_RECITER_STORAGE_KEY),
    read(KEEP_AWAKE_STORAGE_KEY),
    read(WORD_MEANINGS_VISIBLE_STORAGE_KEY),
    read(MEMORIZATION_MODE_VISIBLE_STORAGE_KEY),
    read(NOTIFICATION_PREFERENCES_STORAGE_KEY),
    read(MUSHAF_GUIDE_STORAGE_KEY),
    read(MEMORIZATION_GUIDE_STORAGE_KEY),
    read(TRANSLATION_STORAGE_KEY),
  ]);
  const reminders = json(notifications) as Record<string, unknown> | undefined;
  const guide = json(mushafGuide) as { status?: unknown; finished?: unknown } | undefined;
  const memorizationProgress = json(memorizationGuide) as { status?: unknown } | undefined;
  const translationPreference = json(translation) as { enabledMode?: unknown } | undefined;
  return {
    favoriteReciter: reciter ?? undefined,
    keepAwake: flag(keepAwake),
    wordMeaningsVisible: flag(wordMeanings),
    memorizationModeVisible: flag(memorization),
    notificationWird: reminders?.wird,
    notificationRandomAyah: reminders?.randomAyah,
    notificationEmotionCheckIn: reminders?.emotionCheckIn,
    // Only a completed guide: a step in progress stays on the device.
    mushafGuide: guide?.status === 'done' ? (guide.finished === false ? 'closed' : 'finished') : undefined,
    memorizationGuide: memorizationProgress?.status === 'done' ? 'done' : undefined,
    // Only a dropdown choice actually saved (one saved before the dropdown existed is derived, not chosen).
    translationEnabledMode: translationPreference?.enabledMode,
  };
}

/** Restored at launch: `userId` takes this device's saved choices, once (see above). Never throws. */
export async function claimDevicePreferences(userId: string): Promise<void> {
  try {
    if ((await AsyncStorage.getItem(CLAIMED_KEY)) !== null) return;
    const values = await savedDeviceValues();
    await updateAccountPreferenceState(userId, (state) => {
      for (const [field, value] of Object.entries(values) as [SyncedPreferenceField, unknown][]) {
        if (state.fields[field] || !isSyncedPreferenceValue(field, value)) continue;
        state.fields[field] = { value: value as SyncedPreferenceValue, updatedAt: SEED_AT, synced: false };
      }
    });
    await AsyncStorage.setItem(CLAIMED_KEY, userId);
  } catch {
    // Left for the next launch.
  }
}

/** A guest at launch, or an interactive sign-in: nothing on this device is ever claimed from now on. Never throws. */
export async function forgoDevicePreferencesClaim(): Promise<void> {
  try {
    if ((await AsyncStorage.getItem(CLAIMED_KEY)) === null) await AsyncStorage.setItem(CLAIMED_KEY, 'none');
  } catch {
    // Retried at the next launch or sign-in.
  }
}

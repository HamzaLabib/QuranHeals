import AsyncStorage from '@react-native-async-storage/async-storage';

import { loadQuranTranslationPreference } from '@/localization/quranTranslationPreference';
import { getActiveLocalOwner, ownerStorageKey, peekActiveLocalOwner } from '@/storage/localDataOwner';
import type { RecentEmotionUse } from '@/storage/recentEmotions';

import { isSyncedPreferenceValue, SYNCED_PREFERENCE_FIELDS, type SyncedPreferenceField, type SyncedPreferenceValue } from './preferenceFields';

/**
 * What one account knows about its synced settings on this device, per
 * field (sync/preferenceFields.ts): the value, when it was changed, and
 * whether the account has confirmed it. One document per account
 * (`<key>:account:<userId>`); a guest has none.
 *
 * A setting changed by the user is recorded ONLY for the account signed in
 * at that moment, with the value chosen. That is what is uploaded — never
 * whatever the device happens to show later — so:
 *  - a guest's settings, or another account's, are never uploaded to an
 *    account: signing in only downloads that account's settings;
 *  - a change made offline stays pending until the account confirms it;
 *  - switching accounts on one device can never move one account's value
 *    into another's.
 *
 * Replaces `quran-heals:preferences-updated-at:v1`, a single timestamp for
 * the whole device. It is claimed once by the account whose session is
 * restored at launch (claimLegacyPreferenceChanges), as before, and
 * discarded otherwise.
 */
const STATE_KEY = 'quran-heals:preferences-sync:v2';
export const LEGACY_PREFERENCES_UPDATED_AT_KEY = 'quran-heals:preferences-updated-at:v1';
const APP_LOCALE_STORAGE_KEY = 'quran-heals:app-locale:v1';
const TRANSLATION_STORAGE_KEY = 'quran-heals:quran-translation-preference:v1';

export type PreferenceEntry = {
  value: SyncedPreferenceValue;
  /** Epoch ms: when the value was chosen on a device. */
  updatedAt: number;
  /** True once the account holds this value at this instant. */
  synced: boolean;
};
export type AccountPreferenceState = {
  schema: 1;
  fields: Partial<Record<SyncedPreferenceField, PreferenceEntry>>;
  /**
   * Home's recent emotions as the account last returned them (the device's
   * own list is storage/recentEmotions.ts): what this device has beyond it
   * is what goes up next. Absent until the account has returned one.
   */
  recentEmotions?: RecentEmotionUse[];
};

const stateKey = (userId: string) => ownerStorageKey(STATE_KEY, userId);
const emptyState = (): AccountPreferenceState => ({ schema: 1, fields: {} });

const cache = new Map<string, AccountPreferenceState>();
let chain: Promise<unknown> = Promise.resolve();
/** Every read-modify-write runs one at a time, so no change is ever lost to a concurrent one. */
function serialized<T>(task: () => Promise<T>): Promise<T> {
  const run = chain.then(task, task);
  chain = run.catch(() => undefined);
  return run;
}

function parseState(raw: string | null): AccountPreferenceState {
  if (raw === null) return emptyState();
  try {
    const parsed = JSON.parse(raw) as { schema?: unknown; fields?: Record<string, unknown> };
    if (parsed.schema !== 1 || !parsed.fields || typeof parsed.fields !== 'object') return emptyState();
    const state = emptyState();
    for (const field of SYNCED_PREFERENCE_FIELDS) {
      const entry = parsed.fields[field] as Partial<PreferenceEntry> | undefined;
      if (!entry || !isSyncedPreferenceValue(field, entry.value) || typeof entry.updatedAt !== 'number' || !Number.isFinite(entry.updatedAt)) continue;
      state.fields[field] = { value: entry.value, updatedAt: entry.updatedAt, synced: entry.synced === true };
    }
    const recent = (parsed as { recentEmotions?: unknown }).recentEmotions;
    if (Array.isArray(recent)) {
      state.recentEmotions = recent.filter((use): use is RecentEmotionUse =>
        !!use && typeof use === 'object' && typeof (use as RecentEmotionUse).key === 'string' && Number.isFinite((use as RecentEmotionUse).at));
    }
    return state;
  } catch {
    return emptyState();
  }
}

async function read(userId: string): Promise<AccountPreferenceState> {
  const cached = cache.get(userId);
  if (cached) return cached;
  let raw: string | null = null;
  try {
    raw = await AsyncStorage.getItem(stateKey(userId));
  } catch {
    // Unreadable: treated as empty, so the account's own values are downloaded.
  }
  const state = parseState(raw);
  cache.set(userId, state);
  return state;
}

/** A copy of `userId`'s state. Never throws. */
export function loadAccountPreferenceState(userId: string): Promise<AccountPreferenceState> {
  return serialized(async () => structuredClone(await read(userId)));
}

/** Changes `userId`'s state in place (one at a time) and persists it. A storage failure keeps the in-memory state for this session. */
export function updateAccountPreferenceState<T>(userId: string, change: (state: AccountPreferenceState) => T): Promise<T> {
  return serialized(async () => {
    const state = structuredClone(await read(userId));
    const result = change(state);
    cache.set(userId, state);
    try {
      await AsyncStorage.setItem(stateKey(userId), JSON.stringify(state));
    } catch {
      // Non-fatal: kept in memory; a later change persists it again.
    }
    return result;
  });
}

// ── The user's own changes ────────────────────────────────────────────────

const listeners = new Set<(userId: string) => void>();
let lastInstant = 0;
let lastChangeForTests: { field: SyncedPreferenceField; value: SyncedPreferenceValue; owner: string | null } | null = null;

/** Called with the account a change was recorded for; useAuth.tsx uploads it. */
export function subscribeToLocalPreferenceChanges(listener: (userId: string) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * The user changed `field` to `value` on this device (never a value
 * applied from the account). Recorded for the account active right now;
 * nothing is recorded for a guest. Instants never repeat, so two quick
 * changes are always ordered.
 */
export function recordLocalPreferenceChange(field: SyncedPreferenceField, value: SyncedPreferenceValue): void {
  const at = Math.max(Date.now(), lastInstant + 1);
  lastInstant = at;
  const known = peekActiveLocalOwner();
  void (async () => {
    const owner = known === undefined ? await getActiveLocalOwner().catch(() => null) : known;
    lastChangeForTests = { field, value, owner };
    if (owner === null) return;
    await updateAccountPreferenceState(owner, (state) => {
      state.fields[field] = { value, updatedAt: at, synced: false };
    });
    listeners.forEach((listener) => listener(owner));
  })().catch(() => {
    // Storage unavailable: the change still applies on this device.
  });
}

/** Account deletion: `userId`'s settings record leaves this device (the settings shown on the device stay as they are). */
export function clearAccountPreferenceState(userId: string): Promise<void> {
  return serialized(async () => {
    cache.delete(userId);
    await AsyncStorage.removeItem(stateKey(userId));
  });
}

/** True when `userId` holds a change the account has not confirmed. */
export async function hasUnsyncedPreferences(userId: string): Promise<boolean> {
  const state = await loadAccountPreferenceState(userId);
  return Object.values(state.fields).some((entry) => entry && !entry.synced);
}

// ── The single device-wide timestamp of earlier versions ─────────────────

/**
 * The account whose session is restored at launch inherits the earlier
 * versions' device-wide "changed at" for the settings they synced (App
 * Language and Show Translation), with the values stored on the device —
 * exactly what those versions would have uploaded or compared. Then the
 * old timestamp is removed. Only if the account has no state of its own
 * yet. Never throws.
 */
export async function claimLegacyPreferenceChanges(userId: string): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(LEGACY_PREFERENCES_UPDATED_AT_KEY);
    if (raw === null) return;
    const at = Number(raw);
    // Only settings actually stored on the device: a default the user never chose is never uploaded.
    const storedLocale = await AsyncStorage.getItem(APP_LOCALE_STORAGE_KEY);
    const translation = (await AsyncStorage.getItem(TRANSLATION_STORAGE_KEY)) === null ? null : await loadQuranTranslationPreference();
    await updateAccountPreferenceState(userId, (state) => {
      if (Object.keys(state.fields).length > 0 || !Number.isFinite(at) || at <= 0) return;
      const locale = storedLocale === 'en' ? 'en' : storedLocale === 'ar' || storedLocale === 'ar-EG' ? 'ar' : null;
      if (locale) state.fields.locale = { value: locale, updatedAt: at, synced: false };
      if (translation) {
        state.fields.translationDisplayMode = { value: translation.displayMode, updatedAt: at, synced: false };
        state.fields.translationId = { value: translation.translationId, updatedAt: at, synced: false };
      }
    });
    await AsyncStorage.removeItem(LEGACY_PREFERENCES_UPDATED_AT_KEY);
  } catch {
    // Left for the next launch.
  }
}

/** An interactive sign-in or a sign-out: the old device-wide timestamp belongs to no account. Never throws. */
export async function discardLegacyPreferenceChanges(): Promise<void> {
  await AsyncStorage.removeItem(LEGACY_PREFERENCES_UPDATED_AT_KEY).catch(() => undefined);
}

/** Test-only: the last change recorded (and for which owner), or null. */
export function getLastLocalPreferenceChangeForTests() {
  return lastChangeForTests;
}

/** Test-only: forget all in-memory state so the next read reloads from storage (simulates an app restart). */
export function resetPreferencesSyncStateForTests(): void {
  cache.clear();
  chain = Promise.resolve();
  lastChangeForTests = null;
}

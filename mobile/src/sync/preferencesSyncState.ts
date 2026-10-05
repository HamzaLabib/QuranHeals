import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * When this device's synced preferences (locale, translation display mode,
 * translation id) last changed, as epoch milliseconds — either because the
 * user changed one here, or because a newer account-wide value was adopted
 * from the cloud. Compared against the account preference's own `updatedAt`
 * so the newer value wins in either direction; the backend applies the
 * same last-write-wins rule (MongooseSyncRepository.putPreferences).
 *
 * `null` means this device has never recorded a change (including every
 * install from before this existed): an existing account preference is
 * then adopted, exactly as before.
 *
 * The in-memory value updates synchronously so a change made while a sync
 * request is in flight is seen by that sync's decision; persistence is
 * serialized so a slower earlier write can never land after a newer one.
 */
const STORAGE_KEY = 'quran-heals:preferences-updated-at:v1';

let localUpdatedAt: number | null = null;
// The newest timestamp known to match the account's stored preference.
// Memory-only: after a restart it is unknown, and a full sync re-derives it.
let syncedUpdatedAt: number | null = null;
let loadPromise: Promise<void> | null = null;
let persistChain: Promise<void> = Promise.resolve();

function isTimestamp(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function load(): Promise<void> {
  loadPromise ??= (async () => {
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      const stored = raw === null ? null : Number(raw);
      if (isTimestamp(stored)) localUpdatedAt = Math.max(localUpdatedAt ?? 0, stored);
    } catch {
      // Unreadable storage: treated as "never changed here", never as an error.
    }
  })();
  return loadPromise;
}

export async function getLocalPreferencesUpdatedAt(): Promise<number | null> {
  await load();
  return localUpdatedAt;
}

/** Never moves backwards. */
export function recordLocalPreferencesUpdatedAt(at: number): void {
  if (!isTimestamp(at)) return;
  localUpdatedAt = Math.max(localUpdatedAt ?? 0, at);
  persistChain = persistChain
    .then(load)
    .then(() => AsyncStorage.setItem(STORAGE_KEY, String(localUpdatedAt)))
    .catch(() => {
      // Non-fatal: the in-memory value still applies for this session.
    });
}

export function markPreferencesSynced(at: number): void {
  if (!isTimestamp(at)) return;
  syncedUpdatedAt = Math.max(syncedUpdatedAt ?? 0, at);
}

/** True when this device holds a preference change the account has not yet confirmed. */
export async function hasUnsyncedLocalPreferences(): Promise<boolean> {
  const local = await getLocalPreferencesUpdatedAt();
  return local !== null && (syncedUpdatedAt === null || local > syncedUpdatedAt);
}

/** Test-only: forget all in-memory state so the next read reloads from storage (simulates an app restart). */
export function resetPreferencesSyncStateForTests(): void {
  localUpdatedAt = null;
  syncedUpdatedAt = null;
  loadPromise = null;
  persistChain = Promise.resolve();
}

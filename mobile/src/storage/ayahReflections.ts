import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Private, device-local خواطر (reflections) — one per ayah, keyed by the
 * stable verseKey (never a localized emotion/surah name; never Quran Arabic
 * or translation text — see Part C §15). Guest and signed-in users both
 * keep this local copy; when signed in, mobile/src/sync/reflectionsSync.ts
 * layers encrypted cross-device sync on top without changing this module.
 */
const STORAGE_KEY = 'quran-heals:ayah-reflections:v1';

export const REFLECTION_MAX_LENGTH = 2000;

export type SyncState = 'local' | 'pending' | 'synced';

export type AyahReflection = {
  verseKey: string;
  text: string;
  createdAt: number;
  updatedAt: number;
  /** Present only once a signed-in device has attempted to sync this reflection at least once. Absent for a purely local/guest reflection. */
  syncState?: SyncState;
};

type ReflectionMap = Record<string, AyahReflection>;

function isVerseKeyShape(value: unknown): value is string {
  return typeof value === 'string' && /^[1-9]\d{0,2}:[1-9]\d{0,2}$/.test(value);
}

function isSyncState(value: unknown): value is SyncState {
  return value === 'local' || value === 'pending' || value === 'synced';
}

function isReflection(value: unknown): value is AyahReflection {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return (
    isVerseKeyShape(record.verseKey) &&
    typeof record.text === 'string' &&
    typeof record.createdAt === 'number' &&
    Number.isFinite(record.createdAt) &&
    typeof record.updatedAt === 'number' &&
    Number.isFinite(record.updatedAt) &&
    (record.syncState === undefined || isSyncState(record.syncState))
  );
}

// A read never replaces a stored snapshot — mirrors storage/favorites.ts.
// Corrupt/unexpectedly-shaped storage is surfaced as a thrown error rather
// than silently treated as empty, so a caller can never accidentally wipe a
// user's private reflections by saving over unreadable storage.
async function readRawReflections(): Promise<ReflectionMap> {
  const raw = await AsyncStorage.getItem(STORAGE_KEY);
  if (raw === null) return {};

  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const map: ReflectionMap = {};
      for (const [verseKey, value] of Object.entries(parsed as Record<string, unknown>)) {
        if (isReflection(value) && value.verseKey === verseKey) {
          map[verseKey] = value;
        }
      }
      return map;
    }
  } catch {
    // Leave the original storage value intact, including malformed JSON.
  }
  throw new Error('Your reflections could not be read. Your stored data has been kept.');
}

// Serializes every read/mutation through this module — mirrors
// storage/favorites.ts's mutation queue, so a rapid double-tap Save never
// interleaves a read of stale state with another call's write.
let pendingMutation: Promise<unknown> = Promise.resolve();
function mutate<T>(operation: () => Promise<T>): Promise<T> {
  const result = pendingMutation.then(operation, operation);
  pendingMutation = result.catch(() => undefined);
  return result;
}

export async function getReflection(verseKey: string): Promise<AyahReflection | null> {
  const map = await readRawReflections();
  return map[verseKey] ?? null;
}

export async function getAllReflections(): Promise<AyahReflection[]> {
  return Object.values(await readRawReflections());
}

/**
 * Saves (or edits) the reflection for one ayah. Whitespace is trimmed
 * before checking emptiness and before storing; a whitespace-only or empty
 * result deletes any existing reflection for this verseKey instead of
 * storing an empty one (Part C §16) and resolves to `null`. Text longer
 * than REFLECTION_MAX_LENGTH is truncated — the UI is expected to enforce
 * the limit itself, this is defense in depth, not the primary UX.
 */
export function saveReflection(verseKey: string, text: string, now: number = Date.now()): Promise<AyahReflection | null> {
  return mutate(async () => {
    const map = await readRawReflections();
    const trimmed = text.trim().slice(0, REFLECTION_MAX_LENGTH);

    if (trimmed.length === 0) {
      if (!(verseKey in map)) return null;
      const { [verseKey]: _removed, ...rest } = map;
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(rest));
      return null;
    }

    const existing = map[verseKey];
    const reflection: AyahReflection = {
      verseKey,
      text: trimmed,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      syncState: existing ? 'pending' : undefined,
    };

    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify({ ...map, [verseKey]: reflection }));
    return reflection;
  });
}

/** Marks a reflection's syncState after a sync attempt — used only by mobile/src/sync/reflectionsSync.ts, never by the reflection UI directly. */
export function markReflectionSyncState(verseKey: string, syncState: SyncState): Promise<void> {
  return mutate(async () => {
    const map = await readRawReflections();
    const existing = map[verseKey];
    if (!existing) return;
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify({ ...map, [verseKey]: { ...existing, syncState } }));
  });
}

/** Upserts a reflection downloaded (and decrypted) from the cloud, or created locally from a merge — used only by mobile/src/sync/reflectionsSync.ts. */
export function putReflectionFromSync(reflection: AyahReflection): Promise<void> {
  return mutate(async () => {
    const map = await readRawReflections();
    await AsyncStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ ...map, [reflection.verseKey]: { ...reflection, syncState: 'synced' as const } }),
    );
  });
}

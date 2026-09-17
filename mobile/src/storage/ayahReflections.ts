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

/**
 * A durable local deletion marker for a verseKey, created when an existing
 * reflection's text is cleared (see saveReflection). Never returned by
 * getReflection()/getAllReflections() and never rendered anywhere
 * user-facing — its only purpose is telling sync (mobile/src/sync/
 * reflectionsSync.ts) that this verseKey was deleted, so a stale cloud copy
 * (or an older/offline device) can never resurrect it. Deliberately carries
 * no reflection content, just enough to compare timestamps and propagate
 * the deletion. It is NOT erased after a successful sync — an offline
 * device could otherwise still hold, and re-upload, the pre-deletion
 * active reflection later.
 */
export type ReflectionTombstone = {
  verseKey: string;
  deletedAt: number;
  syncState?: SyncState;
};

type ReflectionEntry = AyahReflection | ReflectionTombstone;
type ReflectionMap = Record<string, ReflectionEntry>;

function isVerseKeyShape(value: unknown): value is string {
  return typeof value === 'string' && /^[1-9]\d{0,2}:[1-9]\d{0,2}$/.test(value);
}

function isSyncState(value: unknown): value is SyncState {
  return value === 'local' || value === 'pending' || value === 'synced';
}

function isActiveReflection(value: unknown): value is AyahReflection {
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

function isTombstone(value: unknown): value is ReflectionTombstone {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return (
    isVerseKeyShape(record.verseKey) &&
    record.text === undefined &&
    typeof record.deletedAt === 'number' &&
    Number.isFinite(record.deletedAt) &&
    (record.syncState === undefined || isSyncState(record.syncState))
  );
}

function isReflectionEntry(value: unknown): value is ReflectionEntry {
  return isActiveReflection(value) || isTombstone(value);
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
        if (isReflectionEntry(value) && value.verseKey === verseKey) {
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

/** Returns null for a verseKey with no reflection AND for one that's been deleted (a tombstone) — both mean "nothing to show/edit". */
export async function getReflection(verseKey: string): Promise<AyahReflection | null> {
  const map = await readRawReflections();
  const entry = map[verseKey];
  return entry && isActiveReflection(entry) ? entry : null;
}

/** Active reflections only — tombstones are never included, matching every user-facing list (My Reflections, etc.). */
export async function getAllReflections(): Promise<AyahReflection[]> {
  return Object.values(await readRawReflections()).filter(isActiveReflection);
}

/** Deletion tombstones only — used exclusively by mobile/src/sync/reflectionsSync.ts to learn which local deletions still need to be pushed to the cloud. Never surfaced to any UI. */
export async function getAllTombstones(): Promise<ReflectionTombstone[]> {
  return Object.values(await readRawReflections()).filter(isTombstone);
}

/**
 * Saves (or edits) the reflection for one ayah. Whitespace is trimmed
 * before checking emptiness and before storing.
 *
 * A whitespace-only or empty result deletes any existing ACTIVE reflection
 * for this verseKey (Part C §16) and resolves to `null` — but instead of
 * simply removing the map entry, it replaces it with a durable
 * ReflectionTombstone, so the deletion itself can be synced and a stale
 * cloud copy can never quietly restore it later. Re-deleting a verseKey
 * that has no active reflection (nothing to delete, or already a
 * tombstone) is a no-op, exactly as it always resolved to null before.
 *
 * Saving new, non-empty text for a verseKey that currently holds a
 * tombstone replaces it with a fresh active reflection (a newer timestamp
 * supersedes the deletion) — this is how "un-deleting" by writing a new
 * reflection works.
 *
 * Text longer than REFLECTION_MAX_LENGTH is truncated — the UI is expected
 * to enforce the limit itself, this is defense in depth, not the primary UX.
 */
export function saveReflection(verseKey: string, text: string, now: number = Date.now()): Promise<AyahReflection | null> {
  return mutate(async () => {
    const map = await readRawReflections();
    const trimmed = text.trim().slice(0, REFLECTION_MAX_LENGTH);
    const existing = map[verseKey];

    if (trimmed.length === 0) {
      if (!existing || !isActiveReflection(existing)) return null;

      const tombstone: ReflectionTombstone = { verseKey, deletedAt: now, syncState: 'pending' };
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify({ ...map, [verseKey]: tombstone }));
      return null;
    }

    const reflection: AyahReflection = {
      verseKey,
      text: trimmed,
      createdAt: existing && isActiveReflection(existing) ? existing.createdAt : now,
      updatedAt: now,
      // Any prior entry (active or a tombstone) means the cloud may already
      // know something different about this verseKey — always mark pending
      // so sync re-uploads this write, including a tombstone-superseding
      // recreation.
      syncState: existing ? 'pending' : undefined,
    };

    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify({ ...map, [verseKey]: reflection }));
    return reflection;
  });
}

/**
 * Marks a reflection OR tombstone's syncState after a sync attempt — used
 * only by mobile/src/sync/reflectionsSync.ts, never by the reflection UI
 * directly. A tombstone is never erased after a successful sync (only its
 * syncState changes) — see ReflectionTombstone's doc comment.
 */
export function markReflectionSyncState(verseKey: string, syncState: SyncState): Promise<void> {
  return mutate(async () => {
    const map = await readRawReflections();
    const existing = map[verseKey];
    if (!existing) return;
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify({ ...map, [verseKey]: { ...existing, syncState } }));
  });
}

/** Upserts a reflection downloaded (and decrypted) from the cloud, or created locally from a merge — used only by mobile/src/sync/reflectionsSync.ts. Overwrites any local tombstone for this verseKey, since the cloud's active record is newer (recreation). */
export function putReflectionFromSync(reflection: AyahReflection): Promise<void> {
  return mutate(async () => {
    const map = await readRawReflections();
    await AsyncStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ ...map, [reflection.verseKey]: { ...reflection, syncState: 'synced' as const } }),
    );
  });
}

/** Upserts a deletion tombstone downloaded from the cloud (the cloud's tombstone is newer) — used only by mobile/src/sync/reflectionsSync.ts. Overwrites any local active reflection for this verseKey, since the cloud has since deleted it. */
export function putTombstoneFromSync(tombstone: { verseKey: string; deletedAt: number }): Promise<void> {
  return mutate(async () => {
    const map = await readRawReflections();
    const next: ReflectionTombstone = { verseKey: tombstone.verseKey, deletedAt: tombstone.deletedAt, syncState: 'synced' };
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify({ ...map, [tombstone.verseKey]: next }));
  });
}

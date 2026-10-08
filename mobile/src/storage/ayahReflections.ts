import AsyncStorage from '@react-native-async-storage/async-storage';

import { getActiveLocalOwner, GUEST_REFLECTIONS_KEY, reflectionsStorageKey } from './localDataOwner';

/**
 * Private, device-local خواطر (reflections) — one per ayah, keyed by the
 * stable verseKey (never a localized emotion/surah name; never Quran Arabic
 * or translation text — see Part C §15). Guest and signed-in users both
 * keep this local copy; when signed in, mobile/src/sync/reflectionsSync.ts
 * layers encrypted cross-device sync on top without changing this module.
 *
 * Stored per owner (see localDataOwner.ts): every function works on the
 * active owner's partition unless an explicit `ownerUserId` is given — sync
 * always passes one, so it can only ever read or write the partition of the
 * account it is syncing for, even if the active account changes mid-sync.
 */

/** The partition an operation uses, resolved when the operation runs (never when it was queued). */
async function storageKey(ownerUserId?: string | null): Promise<string> {
  return reflectionsStorageKey(ownerUserId === undefined ? await getActiveLocalOwner() : ownerUserId);
}

export const REFLECTION_MAX_LENGTH = 2000;

export type SyncState = 'local' | 'pending' | 'synced';

export type AyahReflection = {
  verseKey: string;
  text: string;
  createdAt: number;
  updatedAt: number;
  /** Present only once a signed-in device has attempted to sync this reflection at least once. Absent for a purely local/guest reflection. */
  syncState?: SyncState;
  /**
   * For an unsynced edit: the timestamp of the synced version it was made
   * on top of (see syncBaseOf). Lets sync tell a change made after seeing
   * the cloud's version from one made concurrently with another device's.
   * Absent for new reflections and for data from before this field existed.
   */
  baseUpdatedAt?: number;
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
  /** See AyahReflection.baseUpdatedAt. */
  baseUpdatedAt?: number;
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
function parseReflectionMap(raw: string | null): ReflectionMap {
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

async function readRawReflections(key: string): Promise<ReflectionMap> {
  return parseReflectionMap(await AsyncStorage.getItem(key));
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
export async function getReflection(verseKey: string, ownerUserId?: string | null): Promise<AyahReflection | null> {
  const map = await readRawReflections(await storageKey(ownerUserId));
  const entry = map[verseKey];
  return entry && isActiveReflection(entry) ? entry : null;
}

/** Active reflections only — tombstones are never included, matching every user-facing list (My Reflections, etc.). */
export async function getAllReflections(ownerUserId?: string | null): Promise<AyahReflection[]> {
  return Object.values(await readRawReflections(await storageKey(ownerUserId))).filter(isActiveReflection);
}

/** Deletion tombstones only — used exclusively by mobile/src/sync/reflectionsSync.ts to learn which local deletions still need to be pushed to the cloud. Never surfaced to any UI. */
export async function getAllTombstones(ownerUserId?: string | null): Promise<ReflectionTombstone[]> {
  return Object.values(await readRawReflections(await storageKey(ownerUserId))).filter(isTombstone);
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
    const key = await storageKey();
    const map = await readRawReflections(key);
    const trimmed = text.trim().slice(0, REFLECTION_MAX_LENGTH);
    const existing = map[verseKey];
    const base = syncBaseOf(existing);

    if (trimmed.length === 0) {
      if (!existing || !isActiveReflection(existing)) return null;

      const tombstone: ReflectionTombstone = { verseKey, deletedAt: now, syncState: 'pending', ...(base !== undefined ? { baseUpdatedAt: base } : {}) };
      await AsyncStorage.setItem(key, JSON.stringify({ ...map, [verseKey]: tombstone }));
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
      ...(base !== undefined ? { baseUpdatedAt: base } : {}),
    };

    await AsyncStorage.setItem(key, JSON.stringify({ ...map, [verseKey]: reflection }));
    return reflection;
  });
}

/**
 * Sync works from a snapshot read when it started. `expectedLocalTimestamp`
 * is that snapshot's timestamp for the verseKey (null: no entry then); when
 * given, a write only applies if the entry is still exactly that one, so a
 * reflection the user saved or deleted while sync was running is never
 * overwritten or mislabelled — the next sync handles it. Undefined skips the
 * check.
 */
function stillAsSnapshotted(entry: ReflectionEntry | undefined, expectedLocalTimestamp: number | null | undefined): boolean {
  if (expectedLocalTimestamp === undefined) return true;
  return (entry ? entryTimestamp(entry) : null) === expectedLocalTimestamp;
}

/**
 * Marks a reflection OR tombstone's syncState after a sync attempt — used
 * only by mobile/src/sync/reflectionsSync.ts, never by the reflection UI
 * directly. A tombstone is never erased after a successful sync (only its
 * syncState changes) — see ReflectionTombstone's doc comment.
 */
export function markReflectionSyncState(
  verseKey: string,
  syncState: SyncState,
  ownerUserId?: string | null,
  expectedLocalTimestamp?: number | null,
): Promise<void> {
  return mutate(async () => {
    const key = await storageKey(ownerUserId);
    const map = await readRawReflections(key);
    const existing = map[verseKey];
    if (!existing || !stillAsSnapshotted(existing, expectedLocalTimestamp)) return;
    await AsyncStorage.setItem(key, JSON.stringify({ ...map, [verseKey]: { ...existing, syncState } }));
  });
}

/**
 * After the server stored exactly the entry this device uploaded (its
 * timestamp is `uploadedTimestamp`): marks it synced, or — if the user has
 * changed it since — records the uploaded version as the base of that newer
 * edit, since it was made on top of what is now the cloud's version. Used
 * only by mobile/src/sync/reflectionsSync.ts.
 */
export function markReflectionUploaded(verseKey: string, uploadedTimestamp: number, ownerUserId?: string | null): Promise<void> {
  return mutate(async () => {
    const key = await storageKey(ownerUserId);
    const map = await readRawReflections(key);
    const existing = map[verseKey];
    if (!existing) return;
    const next = entryTimestamp(existing) === uploadedTimestamp
      ? { ...existing, syncState: 'synced' as const }
      : existing.syncState === 'synced'
        ? existing
        : { ...existing, baseUpdatedAt: uploadedTimestamp };
    if (next === existing) return;
    await AsyncStorage.setItem(key, JSON.stringify({ ...map, [verseKey]: next }));
  });
}

/** Upserts a reflection downloaded (and decrypted) from the cloud, or created locally from a merge — used only by mobile/src/sync/reflectionsSync.ts. Overwrites any local tombstone for this verseKey, since the cloud's active record is newer (recreation). Resolves false when skipped (see stillAsSnapshotted). */
export function putReflectionFromSync(reflection: AyahReflection, ownerUserId?: string | null, expectedLocalTimestamp?: number | null): Promise<boolean> {
  return mutate(async () => {
    const key = await storageKey(ownerUserId);
    const map = await readRawReflections(key);
    if (!stillAsSnapshotted(map[reflection.verseKey], expectedLocalTimestamp)) return false;
    await AsyncStorage.setItem(
      key,
      JSON.stringify({ ...map, [reflection.verseKey]: { ...reflection, syncState: 'synced' as const } }),
    );
    return true;
  });
}

/**
 * Wipes every locally-stored reflection on this device — used only by
 * account deletion (mobile/src/auth/useAuth.tsx's deleteAccount), never by
 * ordinary sign-out (which deliberately preserves local reflections). Safe
 * to call even if nothing is stored.
 */
export function clearAllReflections(ownerUserId?: string | null): Promise<void> {
  return mutate(async () => AsyncStorage.removeItem(await storageKey(ownerUserId)));
}

/**
 * Upserts a deletion tombstone downloaded from the cloud (the cloud's
 * tombstone is newer) — used only by mobile/src/sync/reflectionsSync.ts.
 * Overwrites any local active reflection for this verseKey, since the cloud
 * has since deleted it.
 */
export function putTombstoneFromSync(
  tombstone: {
    verseKey: string;
    deletedAt: number;
  },
  ownerUserId?: string | null,
  expectedLocalTimestamp?: number | null,
): Promise<boolean> {
  return mutate(async () => {
    const key = await storageKey(ownerUserId);
    const map = await readRawReflections(key);
    if (!stillAsSnapshotted(map[tombstone.verseKey], expectedLocalTimestamp)) return false;
    const next: ReflectionTombstone = {
      verseKey: tombstone.verseKey,
      deletedAt: tombstone.deletedAt,
      syncState: 'synced',
    };

    await AsyncStorage.setItem(
      key,
      JSON.stringify({
        ...map,
        [tombstone.verseKey]: next,
      }),
    );
    return true;
  });
}

function entryTimestamp(entry: ReflectionEntry): number {
  return isActiveReflection(entry) ? entry.updatedAt : entry.deletedAt;
}

/**
 * The cloud version a local entry is known to be based on: its own
 * timestamp once synced (a synced entry equals the cloud's), otherwise the
 * base recorded when it was edited. Undefined when unknown (a new
 * reflection, guest data, or data from before bases were recorded) — sync
 * then treats any different cloud version as concurrent and keeps both.
 */
export function syncBaseOf(entry: ReflectionEntry | undefined): number | undefined {
  if (!entry) return undefined;
  if (entry.syncState === 'synced') return entryTimestamp(entry);
  return typeof entry.baseUpdatedAt === 'number' && Number.isFinite(entry.baseUpdatedAt) ? entry.baseUpdatedAt : undefined;
}

/**
 * Moves the guest partition into an account's partition — only after the
 * user chose "Add to this account" (see localDataOwnership.ts). Per verseKey, the
 * newer entry (reflection or deletion) wins; a tie keeps the account's. The
 * guest partition is removed only after the merged result is written, so an
 * interrupted move simply repeats. Returns false — moving nothing — if
 * either side cannot be read, so unreadable data is never overwritten.
 */
export function adoptGuestReflections(userId: string): Promise<boolean> {
  return mutate(async () => {
    const guestRaw = await AsyncStorage.getItem(GUEST_REFLECTIONS_KEY);
    if (guestRaw === null) return true;
    const destinationKey = reflectionsStorageKey(userId);
    let guest: ReflectionMap;
    let destination: ReflectionMap;
    try {
      guest = parseReflectionMap(guestRaw);
      destination = parseReflectionMap(await AsyncStorage.getItem(destinationKey));
    } catch {
      return false;
    }
    const merged: ReflectionMap = { ...destination };
    for (const [verseKey, entry] of Object.entries(guest)) {
      const existing = merged[verseKey];
      if (!existing || entryTimestamp(entry) > entryTimestamp(existing)) merged[verseKey] = entry;
    }
    await AsyncStorage.setItem(destinationKey, JSON.stringify(merged));
    await AsyncStorage.removeItem(GUEST_REFLECTIONS_KEY);
    return true;
  });
}

/** Whether the guest partition holds a reflection to offer to an account — see favorites.ts's guestHasFavorites. */
export async function guestHasReflections(): Promise<boolean> {
  await pendingMutation;
  try {
    return Object.values(parseReflectionMap(await AsyncStorage.getItem(GUEST_REFLECTIONS_KEY))).some(isActiveReflection);
  } catch {
    return false;
  }
}

/**
 * After a forgotten-password reset deleted this account's cloud copy, every
 * local entry is unsynced again (and is re-uploaded under the new key by
 * the next sync). Only the sync status label changes; text and timestamps
 * are untouched.
 */
export function markAllReflectionsPending(ownerUserId: string): Promise<void> {
  return mutate(async () => {
    const key = await storageKey(ownerUserId);
    const map = await readRawReflections(key);
    let changed = false;
    const next: ReflectionMap = {};
    for (const [verseKey, entry] of Object.entries(map)) {
      if (entry.syncState === 'synced') {
        next[verseKey] = { ...entry, syncState: 'pending', baseUpdatedAt: entryTimestamp(entry) };
        changed = true;
      } else {
        next[verseKey] = entry;
      }
    }
    if (changed) await AsyncStorage.setItem(key, JSON.stringify(next));
  });
}

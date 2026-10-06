import AsyncStorage from '@react-native-async-storage/async-storage';

import { resolveAyahArabic } from '@/services/quran';
import { resolveVerseKey } from '@/services/quranReference';
import type { Ayah, FavoriteAyah } from '@/types/domain';
import { favoritesStorageKey, getActiveLocalOwner, GUEST_FAVORITES_KEY } from './localDataOwner';

/**
 * Stored per owner, exactly like ayahReflections.ts (see localDataOwner.ts):
 * the active owner's partition unless an explicit `ownerUserId` is given,
 * which sync always passes. Resolved when an operation runs, not when queued.
 */
async function storageKey(ownerUserId?: string): Promise<string> {
  return favoritesStorageKey(ownerUserId ?? (await getActiveLocalOwner()));
}

export type FavoriteReadResult = {
  favorites: FavoriteAyah[];
  unresolvedCount: number;
};

/**
 * A durable local deletion marker for a verseKey, written in place of a
 * favorite snapshot when the user unfavorites an ayah (see removeFavorite).
 * Never returned by getFavoriteState()/getFavorites() and never rendered
 * anywhere user-facing — its only purpose is telling sync
 * (mobile/src/sync/favoritesSync.ts) that this verseKey was deleted, so a
 * stale cloud copy (or another device) can never resurrect it. It is NOT
 * erased after a successful sync, for the same reason as
 * ReflectionTombstone (storage/ayahReflections.ts): an offline device could
 * otherwise still hold, and re-upload, the pre-deletion favorite later.
 */
export type FavoriteTombstone = {
  verseKey: string;
  deleted: true;
  deletedAt: number;
};

type ResolvedFavorite = { index: number; favorite: FavoriteAyah & { verseKey: string } };

// A read never replaces a stored snapshot. Mutations work on the original unknown
// records, so an entry that cannot be opened is never discarded as a side effect.
async function readRawFavorites(key: string): Promise<unknown[]> {
  return parseFavoriteRecords(await AsyncStorage.getItem(key));
}

function parseFavoriteRecords(raw: string | null): unknown[] {
  if (raw === null) return [];

  try {
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed;
  } catch {
    // Leave the original storage value intact, including malformed JSON.
  }
  throw new Error('Saved ayahs could not be read. Your stored data has been kept.');
}

function isFavoriteSnapshot(value: unknown): value is FavoriteAyah {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.id === 'string' && record.id.length > 0 &&
    typeof record.savedAt === 'string' &&
    typeof record.englishTranslation === 'string' &&
    typeof record.surahNameEnglish === 'string' &&
    typeof record.translationSource === 'string'
  );
}

function isFavoriteTombstone(value: unknown): value is FavoriteTombstone {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return (
    record.deleted === true &&
    typeof record.verseKey === 'string' && record.verseKey.length > 0 &&
    typeof record.deletedAt === 'number' && Number.isFinite(record.deletedAt)
  );
}

/** A comparable last-write-wins instant for a stored record — an active favorite's `savedAt`, or a tombstone's `deletedAt`. Null for anything else (e.g. a corrupt/unreadable record). */
function favoriteEntryTimestamp(record: unknown): number | null {
  if (isFavoriteTombstone(record)) return record.deletedAt;
  if (isFavoriteSnapshot(record)) return new Date(record.savedAt).getTime();
  return null;
}

async function resolveFavorites(records: unknown[]): Promise<ResolvedFavorite[]> {
  const results = await Promise.all(records.map(async (record, index) => {
    if (!isFavoriteSnapshot(record)) return null;
    try {
      return { index, favorite: await resolveAyahArabic(record) };
    } catch {
      // Never render cached Arabic when the local verse cannot be resolved.
      return null;
    }
  }));
  return results.filter((result): result is ResolvedFavorite => result !== null);
}

function toReadResult(records: unknown[], resolved: ResolvedFavorite[]): FavoriteReadResult {
  // Tombstones are expected, invisible records — not a resolution failure —
  // so they're excluded from both the visible list and the "could not be
  // loaded" count.
  const tombstoneCount = records.filter(isFavoriteTombstone).length;
  return {
    favorites: resolved.map(({ favorite }) => favorite),
    unresolvedCount: records.length - resolved.length - tombstoneCount,
  };
}

// Serialize read/modify/write operations from the reflection and favorites screens.
let pendingMutation: Promise<unknown> = Promise.resolve();
function mutateFavorites<T>(operation: () => Promise<T>): Promise<T> {
  const result = pendingMutation.then(operation, operation);
  pendingMutation = result.catch(() => undefined);
  return result;
}

export async function getFavoriteState(ownerUserId?: string): Promise<FavoriteReadResult> {
  await pendingMutation;
  const records = await readRawFavorites(await storageKey(ownerUserId));
  return toReadResult(records, await resolveFavorites(records));
}

export async function getFavorites(ownerUserId?: string): Promise<FavoriteAyah[]> {
  return (await getFavoriteState(ownerUserId)).favorites;
}

export function addFavorite(ayah: Ayah, ownerUserId?: string): Promise<FavoriteReadResult> {
  return mutateFavorites(async () => {
    const key = await storageKey(ownerUserId);
    const localAyah = await resolveAyahArabic(ayah);
    const records = await readRawFavorites(key);
    const resolved = await resolveFavorites(records);
    if (resolved.some(({ favorite }) => favorite.verseKey === localAyah.verseKey)) {
      return toReadResult(records, resolved);
    }

    const favorite: FavoriteAyah & { verseKey: string } = {
      ...localAyah,
      savedAt: new Date().toISOString(),
    };
    // Replace a tombstone for this verseKey rather than appending a second
    // entry — a fresh add supersedes the earlier deletion (Part 3: a newer
    // add beats an older delete).
    const tombstoneIndex = records.findIndex((record) => isFavoriteTombstone(record) && record.verseKey === localAyah.verseKey);
    const next = tombstoneIndex === -1
      ? [favorite, ...records]
      : records.map((record, index) => (index === tombstoneIndex ? favorite : record));
    await AsyncStorage.setItem(key, JSON.stringify(next));
    return toReadResult(next, await resolveFavorites(next));
  });
}

export function removeFavorite(id: string, ownerUserId?: string): Promise<FavoriteReadResult> {
  return mutateFavorites(async () => {
    const key = await storageKey(ownerUserId);
    const records = await readRawFavorites(key);
    const resolved = await resolveFavorites(records);
    const matches = resolved.filter(({ favorite }) => favorite.id === id);
    if (matches.length === 0) return toReadResult(records, resolved);

    // Replaced in place (never spliced out) so a durable tombstone survives
    // for sync — see FavoriteTombstone's doc comment.
    const matchedIndices = new Set(matches.map(({ index }) => index));
    const now = Date.now();
    const next = records.map((record, index) => {
      const match = matches.find((entry) => entry.index === index);
      return matchedIndices.has(index) && match
        ? ({ verseKey: match.favorite.verseKey, deleted: true, deletedAt: now } satisfies FavoriteTombstone)
        : record;
    });
    await AsyncStorage.setItem(key, JSON.stringify(next));
    return toReadResult(next, await resolveFavorites(next));
  });
}

/**
 * Deletion tombstones only — used exclusively by mobile/src/sync/
 * favoritesSync.ts to learn which local deletions still need to be pushed
 * to the cloud, or compared against the cloud's own state. Never surfaced
 * to any UI.
 */
export async function getAllFavoriteTombstones(ownerUserId?: string): Promise<FavoriteTombstone[]> {
  await pendingMutation;
  const records = await readRawFavorites(await storageKey(ownerUserId));
  return records.filter(isFavoriteTombstone);
}

/**
 * Upserts a favorite snapshot downloaded from the cloud (the cloud's active
 * record is newer) — used only by mobile/src/sync/favoritesSync.ts.
 * Overwrites any local tombstone for this verseKey, since the cloud's
 * active record is newer (a recreation on another device). `favorite.savedAt`
 * is taken from the cloud record's own timestamp, not "now", so later
 * last-write-wins comparisons stay accurate.
 */
export function putFavoriteFromSync(favorite: FavoriteAyah, ownerUserId?: string): Promise<FavoriteReadResult> {
  return mutateFavorites(async () => {
    const key = await storageKey(ownerUserId);
    const localAyah = await resolveAyahArabic(favorite);
    const next: FavoriteAyah & { verseKey: string } = { ...localAyah, savedAt: favorite.savedAt };
    const records = await readRawFavorites(key);
    const resolved = await resolveFavorites(records);
    const existingActiveIndex = resolved.find(({ favorite: f }) => f.verseKey === next.verseKey)?.index;
    const existingTombstoneIndex = records.findIndex((record) => isFavoriteTombstone(record) && record.verseKey === next.verseKey);

    let updated: unknown[];
    if (existingActiveIndex !== undefined) {
      updated = records.map((record, index) => (index === existingActiveIndex ? next : record));
    } else if (existingTombstoneIndex !== -1) {
      updated = records.map((record, index) => (index === existingTombstoneIndex ? next : record));
    } else {
      updated = [next, ...records];
    }

    await AsyncStorage.setItem(key, JSON.stringify(updated));
    return toReadResult(updated, await resolveFavorites(updated));
  });
}

/**
 * Upserts a deletion tombstone downloaded from the cloud (the cloud's
 * tombstone is newer) — used only by mobile/src/sync/favoritesSync.ts.
 * Overwrites any local active favorite for this verseKey, since the cloud
 * has since deleted it.
 */
export function putFavoriteTombstoneFromSync(tombstone: { verseKey: string; deletedAt: number }, ownerUserId?: string): Promise<void> {
  return mutateFavorites(async () => {
    const key = await storageKey(ownerUserId);
    const records = await readRawFavorites(key);
    const resolved = await resolveFavorites(records);
    const next: FavoriteTombstone = { verseKey: tombstone.verseKey, deleted: true, deletedAt: tombstone.deletedAt };
    const existingActiveIndex = resolved.find(({ favorite }) => favorite.verseKey === tombstone.verseKey)?.index;
    const existingTombstoneIndex = records.findIndex((record) => isFavoriteTombstone(record) && record.verseKey === tombstone.verseKey);

    let updated: unknown[];
    if (existingActiveIndex !== undefined) {
      updated = records.map((record, index) => (index === existingActiveIndex ? next : record));
    } else if (existingTombstoneIndex !== -1) {
      updated = records.map((record, index) => (index === existingTombstoneIndex ? next : record));
    } else {
      updated = [next, ...records];
    }

    await AsyncStorage.setItem(key, JSON.stringify(updated));
  });
}

/**
 * Wipes every locally-stored favorite on this device — used only by account
 * deletion (mobile/src/auth/useAuth.tsx's deleteAccount), never by ordinary
 * sign-out. Safe to call even if nothing is stored.
 */
export function clearAllFavorites(ownerUserId?: string): Promise<void> {
  return mutateFavorites(async () => AsyncStorage.removeItem(await storageKey(ownerUserId)));
}

function verseKeyOrNull(record: unknown): string | null {
  try {
    return resolveVerseKey(record);
  } catch {
    return null;
  }
}

/**
 * Moves the guest partition into an account's partition (the first-sign-in
 * guest → account migration; see localDataOwnership.ts). Per verseKey, the
 * newer entry (a favorite or a deletion) wins — mirrors
 * ayahReflections.ts's adoptGuestReflections — so a guest deletion can
 * still beat (or lose to) an older/newer account favorite for the same
 * verseKey; a tie keeps the account's copy. A record with no resolvable
 * verseKey (unreadable shape) is always carried over rather than dropped.
 * The guest partition is removed only after the merged result is written,
 * so an interrupted move simply repeats. Returns false — moving nothing —
 * if either side cannot be read.
 */
export function adoptGuestFavorites(userId: string): Promise<boolean> {
  return mutateFavorites(async () => {
    const guestRaw = await AsyncStorage.getItem(GUEST_FAVORITES_KEY);
    if (guestRaw === null) return true;
    const destinationKey = favoritesStorageKey(userId);
    let guest: unknown[];
    let destination: unknown[];
    try {
      guest = parseFavoriteRecords(guestRaw);
      destination = parseFavoriteRecords(await AsyncStorage.getItem(destinationKey));
    } catch {
      return false;
    }

    const merged = [...destination];
    const indexByVerseKey = new Map<string, number>();
    merged.forEach((record, index) => {
      const verseKey = verseKeyOrNull(record);
      if (verseKey !== null) indexByVerseKey.set(verseKey, index);
    });

    for (const record of guest) {
      const verseKey = verseKeyOrNull(record);
      if (verseKey === null) {
        merged.push(record);
        continue;
      }
      const existingIndex = indexByVerseKey.get(verseKey);
      if (existingIndex === undefined) {
        indexByVerseKey.set(verseKey, merged.length);
        merged.push(record);
        continue;
      }
      const existingTimestamp = favoriteEntryTimestamp(merged[existingIndex]) ?? -Infinity;
      const incomingTimestamp = favoriteEntryTimestamp(record) ?? -Infinity;
      if (incomingTimestamp > existingTimestamp) merged[existingIndex] = record;
    }

    await AsyncStorage.setItem(destinationKey, JSON.stringify(merged));
    await AsyncStorage.removeItem(GUEST_FAVORITES_KEY);
    return true;
  });
}

export function favoriteMatchesAyah(favorite: FavoriteAyah, ayah: Ayah | string): boolean {
  if (typeof ayah === 'string') return favorite.id === ayah;
  try {
    return resolveVerseKey(favorite) === resolveVerseKey(ayah);
  } catch {
    return false;
  }
}

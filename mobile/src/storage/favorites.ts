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
  return {
    favorites: resolved.map(({ favorite }) => favorite),
    unresolvedCount: records.length - resolved.length,
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
    const next = [favorite, ...records];
    await AsyncStorage.setItem(key, JSON.stringify(next));
    return toReadResult(next, [{ index: 0, favorite }, ...resolved.map((entry) => ({
      ...entry,
      index: entry.index + 1,
    }))]);
  });
}

export function removeFavorite(id: string, ownerUserId?: string): Promise<FavoriteReadResult> {
  return mutateFavorites(async () => {
    const key = await storageKey(ownerUserId);
    const records = await readRawFavorites(key);
    const resolved = await resolveFavorites(records);
    const removed = new Set(resolved.filter(({ favorite }) => favorite.id === id).map(({ index }) => index));
    if (removed.size === 0) return toReadResult(records, resolved);

    const next = records.filter((_, index) => !removed.has(index));
    await AsyncStorage.setItem(key, JSON.stringify(next));
    return toReadResult(next, resolved.filter(({ index }) => !removed.has(index)));
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
 * Moves the guest partition into an account's partition (first-sign-in
 * guest → account migration; see localDataOwnership.ts): the account's
 * favorites first, then every guest favorite it doesn't already have.
 * Unreadable individual records are carried over, never dropped. The guest
 * partition is removed only after the merge is written; returns false —
 * moving nothing — if either side cannot be read.
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
    const known = new Set(destination.map(verseKeyOrNull).filter((key): key is string => key !== null));
    const merged = [...destination, ...guest.filter((record) => {
      const verseKey = verseKeyOrNull(record);
      return verseKey === null || !known.has(verseKey);
    })];
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

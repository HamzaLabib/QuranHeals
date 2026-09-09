import AsyncStorage from '@react-native-async-storage/async-storage';

import { resolveAyahArabic } from '@/services/quran';
import { resolveVerseKey } from '@/services/quranReference';
import type { Ayah, FavoriteAyah } from '@/types/domain';

const favoritesKey = 'quran-heals:favorites';

export type FavoriteReadResult = {
  favorites: FavoriteAyah[];
  unresolvedCount: number;
};

type ResolvedFavorite = { index: number; favorite: FavoriteAyah & { verseKey: string } };

// A read never replaces a stored snapshot. Mutations work on the original unknown
// records, so an entry that cannot be opened is never discarded as a side effect.
async function readRawFavorites(): Promise<unknown[]> {
  const raw = await AsyncStorage.getItem(favoritesKey);
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

export async function getFavoriteState(): Promise<FavoriteReadResult> {
  await pendingMutation;
  const records = await readRawFavorites();
  return toReadResult(records, await resolveFavorites(records));
}

export async function getFavorites(): Promise<FavoriteAyah[]> {
  return (await getFavoriteState()).favorites;
}

export function addFavorite(ayah: Ayah): Promise<FavoriteReadResult> {
  return mutateFavorites(async () => {
    const localAyah = await resolveAyahArabic(ayah);
    const records = await readRawFavorites();
    const resolved = await resolveFavorites(records);
    if (resolved.some(({ favorite }) => favorite.verseKey === localAyah.verseKey)) {
      return toReadResult(records, resolved);
    }

    const favorite: FavoriteAyah & { verseKey: string } = {
      ...localAyah,
      savedAt: new Date().toISOString(),
    };
    const next = [favorite, ...records];
    await AsyncStorage.setItem(favoritesKey, JSON.stringify(next));
    return toReadResult(next, [{ index: 0, favorite }, ...resolved.map((entry) => ({
      ...entry,
      index: entry.index + 1,
    }))]);
  });
}

export function removeFavorite(id: string): Promise<FavoriteReadResult> {
  return mutateFavorites(async () => {
    const records = await readRawFavorites();
    const resolved = await resolveFavorites(records);
    const removed = new Set(resolved.filter(({ favorite }) => favorite.id === id).map(({ index }) => index));
    if (removed.size === 0) return toReadResult(records, resolved);

    const next = records.filter((_, index) => !removed.has(index));
    await AsyncStorage.setItem(favoritesKey, JSON.stringify(next));
    return toReadResult(next, resolved.filter(({ index }) => !removed.has(index)));
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

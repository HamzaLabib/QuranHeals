import { getAyah } from '@/services/api';
import { resolveVerseKey } from '@/services/quranReference';
import { addFavorite, getFavorites } from '@/storage/favorites';
import { addCloudFavorites, getCloudFavorites, removeCloudFavorite } from './syncApi';

/**
 * Guest → account migration + ongoing merge for favorites (Part E §24/§25,
 * Part G §30): union by stable verseKey, both directions, never deletes a
 * favorite the other side doesn't have. Safe to call repeatedly (e.g. on
 * every sign-in and app foreground while signed in).
 */
export async function syncFavorites(sessionToken: string): Promise<void> {
  const localFavorites = await getFavorites();
  const localVerseKeys = localFavorites.map((favorite) => resolveVerseKey(favorite));

  if (localVerseKeys.length > 0) {
    await addCloudFavorites(sessionToken, localVerseKeys);
  }

  const cloudFavorites = await getCloudFavorites(sessionToken);
  const localSet = new Set(localVerseKeys);
  const missingLocally = cloudFavorites.filter((favorite) => !localSet.has(favorite.verseKey));

  for (const favorite of missingLocally) {
    try {
      const ayah = await getAyah(favorite.verseKey);
      await addFavorite(ayah);
    } catch {
      // One unresolved cloud favorite (e.g. a transient network error) must
      // never abort syncing the rest.
    }
  }
}

/**
 * Explicit removal must propagate — otherwise the next syncFavorites() union
 * would silently resurrect it from the cloud. Local removal has already
 * happened by the time this is called (see hooks/useFavorites.ts); a cloud
 * failure here is logged to the caller via the thrown error but never
 * un-does the already-successful local removal.
 */
export function propagateFavoriteRemoval(sessionToken: string, verseKey: string): Promise<void> {
  return removeCloudFavorite(sessionToken, verseKey).then(() => undefined);
}

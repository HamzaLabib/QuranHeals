import { useCallback, useEffect, useState } from 'react';

import { getCurrentSessionToken } from '@/auth/useAuth';
import { resolveVerseKey } from '@/services/quranReference';
import { addFavorite, favoriteMatchesAyah, getFavoriteState, removeFavorite as removeStoredFavorite, type FavoriteReadResult } from '@/storage/favorites';
import { addCloudFavorites, removeCloudFavorite } from '@/sync/syncApi';
import type { Ayah, FavoriteAyah } from '@/types/domain';

/**
 * Best-effort, fire-and-forget propagation to the cloud when signed in — a
 * failure here never affects the already-applied local change (Part E: the
 * device is always correct locally; sync catches up later, e.g. on the next
 * full sync at sign-in/reconnect). A guest (no session token) is a no-op.
 */
async function propagateToCloud(action: 'add' | 'remove', verseKey: string) {
  const token = await getCurrentSessionToken().catch(() => null);
  if (!token) return;
  try {
    if (action === 'add') {
      await addCloudFavorites(token, [verseKey]);
    } else {
      await removeCloudFavorite(token, verseKey);
    }
  } catch {
    // Swallowed deliberately — see doc comment above.
  }
}

export function useFavorites() {
  const [favorites, setFavorites] = useState<FavoriteAyah[]>([]);
  const [isReady, setIsReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unresolvedCount, setUnresolvedCount] = useState(0);

  const applyResult = useCallback((result: FavoriteReadResult) => {
    setFavorites(result.favorites);
    setUnresolvedCount(result.unresolvedCount);
    setError(null);
  }, []);

  const refreshFavorites = useCallback(async () => {
    try {
      applyResult(await getFavoriteState());
    } catch {
      setError('Saved ayahs could not be read. Your stored data has been kept. Please try again.');
    } finally {
      setIsReady(true);
    }
  }, [applyResult]);

  useEffect(() => {
    const timeoutId = setTimeout(() => {
      void refreshFavorites();
    }, 0);

    return () => clearTimeout(timeoutId);
  }, [refreshFavorites]);

  const isFavorite = useCallback((ayah: Ayah | string) => favorites.some(favorite => favoriteMatchesAyah(favorite, ayah)), [favorites]);

  const removeFavorite = useCallback(async (id: string) => {
    try {
      const removed = favorites.find((favorite) => favorite.id === id);
      applyResult(await removeStoredFavorite(id));
      if (removed) void propagateToCloud('remove', resolveVerseKey(removed));
    } catch {
      setError('The saved ayah could not be removed. Please try again.');
    }
  }, [applyResult, favorites]);

  const toggleFavorite = useCallback(
    async (ayah: Ayah) => {
      try {
        const saved = favorites.find(favorite => favoriteMatchesAyah(favorite, ayah));
        applyResult(saved ? await removeStoredFavorite(saved.id) : await addFavorite(ayah));
        void propagateToCloud(saved ? 'remove' : 'add', resolveVerseKey(ayah));
      } catch {
        setError('Saved ayahs could not be updated. Please try again.');
      }
    },
    [favorites, applyResult],
  );

  return {
    favorites,
    isReady,
    error,
    unresolvedCount,
    isFavorite,
    removeFavorite,
    toggleFavorite,
    refreshFavorites,
  };
}

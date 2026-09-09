import { useCallback, useEffect, useState } from 'react';

import { addFavorite, favoriteMatchesAyah, getFavoriteState, removeFavorite as removeStoredFavorite, type FavoriteReadResult } from '@/storage/favorites';
import type { Ayah, FavoriteAyah } from '@/types/domain';

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
      applyResult(await removeStoredFavorite(id));
    } catch {
      setError('The saved ayah could not be removed. Please try again.');
    }
  }, [applyResult]);

  const toggleFavorite = useCallback(
    async (ayah: Ayah) => {
      try {
        const saved = favorites.find(favorite => favoriteMatchesAyah(favorite, ayah));
        applyResult(saved ? await removeStoredFavorite(saved.id) : await addFavorite(ayah));
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

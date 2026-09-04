import { useCallback, useEffect, useMemo, useState } from 'react';

import { addFavorite, getFavorites, removeFavorite as removeStoredFavorite } from '@/storage/favorites';
import type { Ayah, FavoriteAyah } from '@/types/domain';

export function useFavorites() {
  const [favorites, setFavorites] = useState<FavoriteAyah[]>([]);
  const [isReady, setIsReady] = useState(false);

  const refreshFavorites = useCallback(async () => {
    const storedFavorites = await getFavorites();
    setFavorites(storedFavorites);
    setIsReady(true);
  }, []);

  useEffect(() => {
    const timeoutId = setTimeout(() => {
      void refreshFavorites();
    }, 0);

    return () => clearTimeout(timeoutId);
  }, [refreshFavorites]);

  const favoriteIds = useMemo(() => new Set(favorites.map((favorite) => favorite.id)), [favorites]);

  const isFavorite = useCallback((id: string) => favoriteIds.has(id), [favoriteIds]);

  const removeFavorite = useCallback(async (id: string) => {
    const nextFavorites = await removeStoredFavorite(id);
    setFavorites(nextFavorites);
  }, []);

  const toggleFavorite = useCallback(
    async (ayah: Ayah) => {
      const nextFavorites = favoriteIds.has(ayah.id)
        ? await removeStoredFavorite(ayah.id)
        : await addFavorite(ayah);

      setFavorites(nextFavorites);
    },
    [favoriteIds],
  );

  return {
    favorites,
    isReady,
    isFavorite,
    removeFavorite,
    toggleFavorite,
    refreshFavorites,
  };
}

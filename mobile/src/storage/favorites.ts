import AsyncStorage from '@react-native-async-storage/async-storage';

import type { Ayah, FavoriteAyah } from '@/types/domain';

const favoritesKey = 'quran-heals:favorites';

function toFavorite(ayah: Ayah): FavoriteAyah {
  return {
    ...ayah,
    savedAt: new Date().toISOString(),
  };
}

export async function getFavorites(): Promise<FavoriteAyah[]> {
  const rawFavorites = await AsyncStorage.getItem(favoritesKey);

  if (!rawFavorites) {
    return [];
  }

  try {
    const parsed = JSON.parse(rawFavorites) as FavoriteAyah[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function saveFavorites(favorites: FavoriteAyah[]) {
  await AsyncStorage.setItem(favoritesKey, JSON.stringify(favorites));
  return favorites;
}

export async function addFavorite(ayah: Ayah) {
  const favorites = await getFavorites();
  const withoutExisting = favorites.filter((favorite) => favorite.id !== ayah.id);

  return saveFavorites([toFavorite(ayah), ...withoutExisting]);
}

export async function removeFavorite(id: string) {
  const favorites = await getFavorites();

  return saveFavorites(favorites.filter((favorite) => favorite.id !== id));
}


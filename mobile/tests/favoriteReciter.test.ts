import { beforeEach, describe, expect, it, vi } from 'vitest';

const storage = vi.hoisted(() => new Map<string, string>());
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: async (key: string) => storage.get(key) ?? null,
    setItem: async (key: string, value: string) => void storage.set(key, value),
  },
}));

import { FAVORITE_RECITER_STORAGE_KEY, loadFavoriteReciter, parseFavoriteReciter, saveFavoriteReciter } from '@/audio/favoriteReciterPreference';

describe('Favorite Reciter preference', () => {
  beforeEach(() => storage.clear());

  it('defaults to Muhammad Siddiq Al-Minshawi', async () => {
    expect(await loadFavoriteReciter()).toBe('minshawi');
    expect(parseFavoriteReciter(null)).toBe('minshawi');
  });

  it('persists a choice', async () => {
    await saveFavoriteReciter('minshawi');
    expect(storage.get(FAVORITE_RECITER_STORAGE_KEY)).toBe('minshawi');
    expect(await loadFavoriteReciter()).toBe('minshawi');
  });

  it('keeps a reciter without ayah playback as chosen (shown with its availability, never swapped)', async () => {
    await saveFavoriteReciter('yasser-salama');
    expect(await loadFavoriteReciter()).toBe('yasser-salama');
  });

  it('a reciter on hold (Rifaat, Gebril) reads as the default, and the stored choice is not deleted', async () => {
    for (const id of ['rifaat', 'gebril']) {
      storage.set(FAVORITE_RECITER_STORAGE_KEY, id);
      expect(await loadFavoriteReciter(), id).toBe('minshawi');
      expect(storage.get(FAVORITE_RECITER_STORAGE_KEY), id).toBe(id);
    }
  });

  it('ignores unknown or excluded reciters', async () => {
    await saveFavoriteReciter('alafasy');
    expect(storage.has(FAVORITE_RECITER_STORAGE_KEY)).toBe(false);
    storage.set(FAVORITE_RECITER_STORAGE_KEY, 'sudais');
    expect(await loadFavoriteReciter()).toBe('minshawi');
  });

  it('an existing saved choice is kept as it is: the new default never overwrites it (Maher stays Maher)', async () => {
    storage.set(FAVORITE_RECITER_STORAGE_KEY, 'maher');
    expect(await loadFavoriteReciter()).toBe('maher');
    expect(storage.get(FAVORITE_RECITER_STORAGE_KEY)).toBe('maher');
  });
});

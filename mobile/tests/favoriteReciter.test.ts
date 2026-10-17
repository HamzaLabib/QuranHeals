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

  it('defaults to Maher Al-Muaiqly', async () => {
    expect(await loadFavoriteReciter()).toBe('maher');
    expect(parseFavoriteReciter(null)).toBe('maher');
  });

  it('persists a choice', async () => {
    await saveFavoriteReciter('minshawi');
    expect(storage.get(FAVORITE_RECITER_STORAGE_KEY)).toBe('minshawi');
    expect(await loadFavoriteReciter()).toBe('minshawi');
  });

  it('keeps a reciter without ayah playback as chosen (shown with its availability, never swapped)', async () => {
    await saveFavoriteReciter('rifaat');
    expect(await loadFavoriteReciter()).toBe('rifaat');
  });

  it('ignores unknown or excluded reciters', async () => {
    await saveFavoriteReciter('alafasy');
    expect(storage.has(FAVORITE_RECITER_STORAGE_KEY)).toBe(false);
    storage.set(FAVORITE_RECITER_STORAGE_KEY, 'sudais');
    expect(await loadFavoriteReciter()).toBe('maher');
  });
});

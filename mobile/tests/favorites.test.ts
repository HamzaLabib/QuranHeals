import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => new Map<string, string>());
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async (key: string) => state.get(key) ?? null),
    setItem: vi.fn(async (key: string, value: string) => {
      state.set(key, value);
    }),
    removeItem: vi.fn(async (key: string) => {
      state.delete(key);
    }),
  },
}));

vi.mock('@/services/quran', () => ({
  resolveAyahArabic: async (value: Record<string, unknown>) => ({ ...value, arabicText: 'ARABIC' }),
}));

const {
  getFavoriteState,
  getFavorites,
  addFavorite,
  removeFavorite,
  clearAllFavorites,
  getAllFavoriteTombstones,
  putFavoriteFromSync,
  putFavoriteTombstoneFromSync,
  adoptGuestFavorites,
  favoriteMatchesAyah,
} = await import('@/storage/favorites');

const FAVORITES_KEY = 'quran-heals:favorites';

function ayah(verseKey: string) {
  const [surahNumber, ayahNumber] = verseKey.split(':').map(Number);
  return {
    id: verseKey,
    verseKey,
    referenceKey: verseKey,
    surahNumber,
    ayahNumber,
    surahNameArabic: '',
    surahNameEnglish: 'Surah',
    arabicText: '',
    englishTranslation: 'translation',
    emotions: [],
    quranTextSource: 'Tanzil',
    translationSource: 'Pickthall',
  };
}

beforeEach(() => state.clear());

describe('favorites: add/remove and tombstone persistence', () => {
  it('adds a favorite and loads it back', async () => {
    await addFavorite(ayah('2:255'));
    expect((await getFavorites()).map((f) => f.id)).toEqual(['2:255']);
  });

  it('unfavoriting removes it from the visible list immediately', async () => {
    await addFavorite(ayah('2:255'));
    const { favorites, unresolvedCount } = await removeFavorite('2:255');
    expect(favorites).toEqual([]);
    expect(unresolvedCount).toBe(0); // a tombstone is not an "unresolved" error
  });

  it('unfavoriting writes a durable tombstone to storage rather than erasing all evidence', async () => {
    await addFavorite(ayah('2:255'));
    await removeFavorite('2:255');

    const raw = JSON.parse(state.get(FAVORITES_KEY)!);
    expect(raw).toHaveLength(1);
    expect(raw[0]).toMatchObject({ verseKey: '2:255', deleted: true });
    expect(typeof raw[0].deletedAt).toBe('number');
  });

  it('a tombstone survives a simulated app restart (fresh read from the same storage, no in-memory cache)', async () => {
    await addFavorite(ayah('2:255'));
    await removeFavorite('2:255');

    // Re-reading from scratch (as a fresh app launch would) still sees the tombstone, not the favorite.
    expect(await getAllFavoriteTombstones()).toEqual([expect.objectContaining({ verseKey: '2:255', deleted: true })]);
    expect(await getFavorites()).toEqual([]);
  });

  it('re-favoriting after a delete supersedes the tombstone instead of creating a duplicate entry', async () => {
    await addFavorite(ayah('2:255'));
    await removeFavorite('2:255');
    await addFavorite(ayah('2:255'));

    expect((await getFavorites()).map((f) => f.id)).toEqual(['2:255']);
    expect(await getAllFavoriteTombstones()).toEqual([]);
    const raw = JSON.parse(state.get(FAVORITES_KEY)!);
    expect(raw).toHaveLength(1);
  });

  it('clearAllFavorites wipes tombstones too', async () => {
    await addFavorite(ayah('2:255'));
    await removeFavorite('2:255');
    await clearAllFavorites();

    expect(await getAllFavoriteTombstones()).toEqual([]);
    expect(state.has(FAVORITES_KEY)).toBe(false);
  });
});

describe('favorites: applying sync results', () => {
  it('putFavoriteFromSync overwrites a local tombstone with the cloud active record', async () => {
    await addFavorite(ayah('2:255'));
    await removeFavorite('2:255');

    await putFavoriteFromSync({ ...ayah('2:255'), savedAt: new Date(9000).toISOString() });

    expect(await getAllFavoriteTombstones()).toEqual([]);
    expect((await getFavorites())[0]).toMatchObject({ id: '2:255', savedAt: new Date(9000).toISOString() });
  });

  it('putFavoriteTombstoneFromSync overwrites a local active favorite', async () => {
    await addFavorite(ayah('2:255'));

    await putFavoriteTombstoneFromSync({ verseKey: '2:255', deletedAt: 9000 });

    expect(await getFavorites()).toEqual([]);
    expect(await getAllFavoriteTombstones()).toEqual([{ verseKey: '2:255', deleted: true, deletedAt: 9000 }]);
  });
});

describe('favorites: guest adoption (Test J)', () => {
  it('a guest favorite is adopted into a freshly-signed-in account', async () => {
    await addFavorite(ayah('1:1')); // guest partition (no ownerUserId)
    await adoptGuestFavorites('user-a');

    expect(await getFavorites('user-a')).toHaveLength(1);
    expect(state.has('quran-heals:favorites')).toBe(false); // guest partition removed after adoption
  });

  it('a guest deletion (tombstone) is adopted too, rather than silently dropped', async () => {
    await addFavorite(ayah('1:1'));
    await removeFavorite('1:1'); // guest deletes it before ever signing in
    await adoptGuestFavorites('user-a');

    expect(await getFavorites('user-a')).toEqual([]);
    expect(await getAllFavoriteTombstones('user-a')).toEqual([expect.objectContaining({ verseKey: '1:1' })]);
  });

  it('a newer guest favorite beats an older account tombstone for the same verseKey', async () => {
    await putFavoriteTombstoneFromSync({ verseKey: '1:1', deletedAt: 1000 }, 'user-a');
    await addFavorite(ayah('1:1')); // guest, timestamped "now" — newer than 1000

    await adoptGuestFavorites('user-a');

    expect((await getFavorites('user-a')).map((f) => f.id)).toEqual(['1:1']);
  });

  it('an older guest favorite never overrides a newer account tombstone for the same verseKey', async () => {
    await addFavorite(ayah('1:1')); // guest, timestamped "now"
    await putFavoriteTombstoneFromSync({ verseKey: '1:1', deletedAt: Date.now() + 1_000_000 }, 'user-a');

    await adoptGuestFavorites('user-a');

    expect(await getFavorites('user-a')).toEqual([]);
  });

  it('never leaks into a second account that adopts nothing (only the first sign-in may adopt)', async () => {
    await addFavorite(ayah('1:1'));
    await adoptGuestFavorites('user-a');

    // Guest partition is already gone — adopting again for a different account is a no-op.
    await adoptGuestFavorites('user-b');
    expect(await getFavorites('user-b')).toEqual([]);
  });
});

describe('favorites: account isolation for tombstones (Test I)', () => {
  it("account A's tombstone is never visible in account B's partition", async () => {
    await addFavorite(ayah('2:255'), 'user-a');
    await removeFavorite('2:255', 'user-a');

    expect(await getAllFavoriteTombstones('user-b')).toEqual([]);
    expect(await getFavoriteState('user-b')).toMatchObject({ favorites: [], unresolvedCount: 0 });
  });
});

describe('favoriteMatchesAyah', () => {
  it('matches by id or by verseKey', async () => {
    const favorite = (await addFavorite(ayah('2:255'))).favorites[0];
    expect(favoriteMatchesAyah(favorite, '2:255')).toBe(true);
    expect(favoriteMatchesAyah(favorite, ayah('2:255'))).toBe(true);
    expect(favoriteMatchesAyah(favorite, ayah('2:256'))).toBe(false);
  });
});

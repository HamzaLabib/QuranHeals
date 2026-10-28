import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The Mushaf's Save and Share without a connection (services/ayahForAction.ts): the verified local Tanzil Arabic, the
 * verified local Surah names, never an invented translation; Favorites kept per owner (account or guest), across a
 * restart, and completed and synchronised once the backend can be reached again. The real local Quran database.
 */
const state = vi.hoisted(() => ({
  storage: new Map<string, string>(),
  fetch: vi.fn(),
  uploads: [] as unknown[][],
  cloud: [] as { type: string; verseKey: string; updatedAt?: string; createdAt?: string }[],
}));
vi.mock('react-native', () => ({ Platform: { OS: 'ios', select: (values: { ios: unknown }) => values.ios } }));
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: async (key: string) => state.storage.get(key) ?? null,
    setItem: async (key: string, value: string) => { state.storage.set(key, value); },
    removeItem: async (key: string) => { state.storage.delete(key); },
  },
}));
vi.mock('@/services/quranAsset', async () => {
  const { openTestDatabase } = await import('./helpers/sqlite');
  return { openBundledQuran: async () => openTestDatabase() };
});
vi.mock('@/services/fetchWithTimeout', () => ({ fetchWithTimeout: state.fetch, DEFAULT_FETCH_TIMEOUT_MS: 8000 }));
vi.mock('@/sync/syncApi', () => ({
  getCloudFavoriteSyncRecords: async () => state.cloud,
  putCloudFavoriteSyncRecords: async (_token: string, records: unknown[]) => { state.uploads.push(records); },
}));

const json = (status: number, body: unknown) => ({ ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) });
/** The backend's ayah for a key, as served: its translation; its Arabic is then resolved from the local text. */
const apiAyah = (verseKey: string) => {
  const [surahNumber, ayahNumber] = verseKey.split(':').map(Number);
  return { id: `mongo-${verseKey}`, verseKey, referenceKey: verseKey, surahNumber, ayahNumber, surahNameArabic: 'x', surahNameEnglish: 'Al-Baqara', arabicText: 'not used', englishTranslation: `Translation of ${verseKey}`, emotions: ['hope'], quranTextSource: 'x', translationSource: 'Saheeh International' };
};
const online = () => state.fetch.mockImplementation(async (url: string) => json(200, { success: true, data: apiAyah(decodeURIComponent(String(url).split('/').pop()!)) }));
const offline = () => state.fetch.mockImplementation(async () => { throw new TypeError('Network request failed'); });

const { getAyahForAction, localAyah } = await import('@/services/ayahForAction');
const { getAyah } = await import('@/services/api');
const { getVerseByKey } = await import('@/services/quran');
const favorites = await import('@/storage/favorites');

beforeEach(() => {
  state.storage.clear();
  state.fetch.mockReset();
  state.uploads = [];
  state.cloud = [];
});

describe('the ayah for an action', () => {
  it('online: the backend`s ayah, its translation kept, its Arabic the verified local text', async () => {
    online();
    const ayah = await getAyahForAction('2:255');
    expect(ayah).toMatchObject({ verseKey: '2:255', englishTranslation: 'Translation of 2:255', translationSource: 'Saheeh International' });
    expect(ayah.arabicText).toBe((await getVerseByKey('2:255')).arabicText);
  });

  it.each([
    ['offline (no network)', async () => { throw new TypeError('Network request failed'); }],
    ['timed out', async () => { throw Object.assign(new Error('aborted'), { name: 'AbortError' }); }],
    ['backend unavailable (503)', async () => json(503, { success: false })],
    ['server error (500)', async () => json(500, { success: false })],
  ])('%s: the device`s own ayah — exact local Arabic and Surah names, no translation, no emotions', async (_label, response) => {
    state.fetch.mockImplementation(response);
    for (const verseKey of ['1:1', '2:255', '3:85', '9:1', '114:6']) {
      const ayah = await getAyahForAction(verseKey);
      const verse = await getVerseByKey(verseKey);
      expect(ayah).toMatchObject({ id: verseKey, verseKey, referenceKey: verseKey, surahNumber: verse.surah, ayahNumber: verse.ayah, englishTranslation: '', translationSource: '', emotions: [] });
      expect(ayah.arabicText).toBe(verse.arabicText);
      expect(ayah.arabicText.length).toBeGreaterThan(0);
    }
    expect((await localAyah('3:85')).surahNameEnglish).toBe('Aal-i-Imraan');
    expect((await localAyah('3:85')).surahNameArabic).toBe('آل عمران');
  });

  it('a refused request (the ayah isn`t found, or invalid) is still an error — never replaced by a local ayah', async () => {
    state.fetch.mockImplementation(async () => json(404, { success: false }));
    await expect(getAyahForAction('2:255')).rejects.toMatchObject({ kind: 'no_ayah' });
    state.fetch.mockImplementation(async () => json(400, { success: false }));
    await expect(getAyahForAction('2:255')).rejects.toMatchObject({ kind: 'invalid_request' });
    await expect(localAyah('115:1')).rejects.toThrow();
  });
});

describe('Favorites saved offline', () => {
  it('Save, Unsave and Save again with no connection; the account`s and the guest`s Favorites stay apart', async () => {
    offline();
    await favorites.addFavorite(await getAyahForAction('2:255'), 'user-a');
    expect((await favorites.getFavorites('user-a')).map((f) => f.verseKey)).toEqual(['2:255']);
    expect(await favorites.getFavorites(null)).toEqual([]);
    expect(await favorites.getFavorites('user-b')).toEqual([]);
    const [saved] = await favorites.getFavorites('user-a');
    await favorites.removeFavorite(saved.id, 'user-a');
    expect(await favorites.getFavorites('user-a')).toEqual([]);
    expect((await favorites.getAllFavoriteTombstones('user-a')).map((t) => t.verseKey)).toEqual(['2:255']);
    await favorites.addFavorite(await getAyahForAction('2:255'), 'user-a');
    expect((await favorites.getFavorites('user-a')).map((f) => f.verseKey)).toEqual(['2:255']);
    expect(state.fetch).toHaveBeenCalled(); // every attempt was offline
  });

  it('kept across a restart (a fresh copy of the storage module reading the same device storage)', async () => {
    offline();
    await favorites.addFavorite(await getAyahForAction('3:85'), null);
    vi.resetModules();
    const fresh = await import('@/storage/favorites');
    const [kept] = await fresh.getFavorites(null);
    expect(kept).toMatchObject({ verseKey: '3:85', englishTranslation: '' });
    expect(kept.arabicText).toBe((await getVerseByKey('3:85')).arabicText);
  });

  it('the connection returns: the translation is completed from the backend; the Arabic, id and savedAt are unchanged', async () => {
    offline();
    await favorites.addFavorite(await getAyahForAction('2:255'), 'user-a');
    const [before] = await favorites.getFavorites('user-a');
    // Still offline: nothing changes, nothing throws.
    expect(await favorites.completePendingFavoriteTranslations(getAyah, 'user-a')).toBe(0);
    online();
    expect(await favorites.completePendingFavoriteTranslations(getAyah, 'user-a')).toBe(1);
    const [after] = await favorites.getFavorites('user-a');
    expect(after).toMatchObject({ id: before.id, savedAt: before.savedAt, verseKey: '2:255', englishTranslation: 'Translation of 2:255', translationSource: 'Saheeh International', emotions: ['hope'] });
    expect(after.arabicText).toBe((await getVerseByKey('2:255')).arabicText);
    // Only the waiting one, and only once.
    expect(await favorites.completePendingFavoriteTranslations(getAyah, 'user-a')).toBe(0);
  });

  it('completion never resurrects a favorite removed meanwhile, never touches another owner, and ignores a mismatched answer', async () => {
    offline();
    await favorites.addFavorite(await getAyahForAction('2:255'), 'user-a');
    await favorites.addFavorite(await getAyahForAction('1:1'), null);
    // Removed while its translation is being fetched.
    let release: () => void = () => undefined;
    const slow = (verseKey: string) => new Promise<ReturnType<typeof apiAyah>>((resolve) => { release = () => resolve(apiAyah(verseKey)); });
    const pending = favorites.completePendingFavoriteTranslations(slow as never, 'user-a');
    await new Promise((r) => setTimeout(r, 10));
    const [saved] = await favorites.getFavorites('user-a');
    await favorites.removeFavorite(saved.id, 'user-a');
    release();
    expect(await pending).toBe(0);
    expect(await favorites.getFavorites('user-a')).toEqual([]);
    // The guest's still waits; a wrong ayah from the backend is never written into it.
    expect(await favorites.completePendingFavoriteTranslations(async () => apiAyah('2:1') as never, null)).toBe(0);
    expect((await favorites.getFavorites(null))[0]).toMatchObject({ verseKey: '1:1', englishTranslation: '' });
  });

  it('synchronisation when the connection returns: the offline save is uploaded for its own account', async () => {
    offline();
    await favorites.addFavorite(await getAyahForAction('2:255'), 'user-a');
    await favorites.addFavorite(await getAyahForAction('1:1'), null); // the guest's: never uploaded with the account
    online();
    const { syncFavorites } = await import('@/sync/favoritesSync');
    await syncFavorites('token-a', 'user-a');
    const [saved] = await favorites.getFavorites('user-a');
    expect(state.uploads).toEqual([[{ type: 'active', verseKey: '2:255', createdAt: saved.savedAt, updatedAt: saved.savedAt }]]);
  });
});

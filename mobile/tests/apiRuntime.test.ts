import { afterEach, expect, it, vi } from 'vitest';
import { legacyAyah, openTestDatabase } from './helpers/sqlite';

vi.mock('react-native', () => ({ Platform: { OS: 'web' } }));
vi.mock('@/services/quranAsset', () => ({ openBundledQuran: async () => openTestDatabase() }));
const { getAyah, getRandomAyah } = await import('@/services/api');
afterEach(() => vi.unstubAllGlobals());

it('API response → reliable verseKey → exact SQLite Arabic for emotion and old-ID lookup routes', async () => {
  const payload = legacyAyah();
  const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response(JSON.stringify({ success: true, data: payload }), { status: 200 }));
  vi.stubGlobal('fetch', fetch);
  const result = await getRandomAyah('sad', ['66f100000000000000000099']);
  const [row] = await openTestDatabase().getAllAsync<{ arabic_text: string }>('SELECT arabic_text FROM verses WHERE verse_key = ?', '2:153');
  expect(result.arabicText).toBe(row.arabic_text);
  expect(result.verseKey).toBe('2:153');
  expect(fetch.mock.calls[0][0]).toContain('/api/ayahs/random?emotion=sad&exclude=66f100000000000000000099');
  expect((await getAyah(payload.id)).arabicText).toBe(row.arabic_text);
  expect(fetch.mock.calls[1][0]).toContain(`/api/ayahs/${payload.id}`);
  expect(fetch).toHaveBeenCalledTimes(2); // Local lookup issues no network request.
});

it('does not display API Arabic for missing or inconsistent references', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ success: true, data: legacyAyah({ referenceKey: '2:154' }) }), { status: 200 })));
  await expect(getRandomAyah('sad')).rejects.toMatchObject({ kind: 'invalid_reference' });
});

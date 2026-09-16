import { beforeEach, expect, it, vi } from 'vitest';

import { legacyAyah } from './helpers/sqlite';

const state = vi.hoisted(() => new Map<string, string>());
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async (key: string) => state.get(key) ?? null),
    setItem: vi.fn(async (key: string, value: string) => {
      state.set(key, value);
    }),
  },
}));

const { getRecentAyahs, getExcludedVerseKeys, recordShownAyah, removeExpiredEntries, buildExhaustionRetryExclusions, RECENT_AYAH_TTL_MS } =
  await import('@/storage/recentAyahHistory');

const STORAGE_KEY = 'quran-heals:recent-emotion-ayahs:v1';
const NOW = 1_700_000_000_000;

beforeEach(() => state.clear());

it('excludes a recently shown ayah for the same emotion', async () => {
  await recordShownAyah('sad', legacyAyah({ referenceKey: '2:286', surahNumber: 2, ayahNumber: 286 }), NOW);
  expect(await getExcludedVerseKeys('sad', NOW)).toEqual(['2:286']);
});

it('does not exclude the same ayah for a different emotion', async () => {
  await recordShownAyah('sad', legacyAyah({ referenceKey: '2:286', surahNumber: 2, ayahNumber: 286 }), NOW);
  expect(await getExcludedVerseKeys('anxious', NOW)).toEqual([]);
  // Confirms the emotions have fully independent buckets, not just an empty read.
  expect(await getExcludedVerseKeys('sad', NOW)).toEqual(['2:286']);
});

it('an entry shown 9 minutes ago is still excluded', async () => {
  const shownAt = NOW - 9 * 60 * 1000;
  await recordShownAyah('sad', legacyAyah({ referenceKey: '2:286', surahNumber: 2, ayahNumber: 286 }), shownAt);
  expect(await getExcludedVerseKeys('sad', NOW)).toEqual(['2:286']);
});

it('an entry shown 11 minutes ago is no longer excluded', async () => {
  const shownAt = NOW - 11 * 60 * 1000;
  await recordShownAyah('sad', legacyAyah({ referenceKey: '2:286', surahNumber: 2, ayahNumber: 286 }), shownAt);
  expect(await getExcludedVerseKeys('sad', NOW)).toEqual([]);
});

it('is still excluded 1ms before the exact 10-minute boundary, and eligible again exactly at it', async () => {
  expect(RECENT_AYAH_TTL_MS).toBe(600_000);

  const stillActive = NOW - (RECENT_AYAH_TTL_MS - 1);
  await recordShownAyah('sad', legacyAyah({ referenceKey: '2:286', surahNumber: 2, ayahNumber: 286 }), stillActive);
  expect(await getExcludedVerseKeys('sad', NOW)).toEqual(['2:286']);

  state.clear();
  const exactlyExpired = NOW - RECENT_AYAH_TTL_MS;
  await recordShownAyah('sad', legacyAyah({ referenceKey: '2:286', surahNumber: 2, ayahNumber: 286 }), exactlyExpired);
  expect(await getExcludedVerseKeys('sad', NOW)).toEqual([]);
});

it('persists across a simulated app restart (a fresh read after the write)', async () => {
  await recordShownAyah('sad', legacyAyah({ referenceKey: '94:5', surahNumber: 94, ayahNumber: 5 }), NOW);
  await recordShownAyah('sad', legacyAyah({ referenceKey: '39:53', surahNumber: 39, ayahNumber: 53 }), NOW + 1000);

  // Nothing about getExcludedVerseKeys/getRecentAyahs holds in-memory state
  // between calls other than the AsyncStorage-backed map itself, so calling
  // them again exercises exactly what a fresh app launch would do: read
  // persisted storage from scratch.
  const active = await getRecentAyahs('sad', NOW + 2000);
  expect(active.map((entry) => entry.verseKey)).toEqual(['94:5', '39:53']);
});

it('treats missing, corrupt, and malformed storage as empty history without throwing', async () => {
  expect(await getExcludedVerseKeys('sad', NOW)).toEqual([]);

  state.set(STORAGE_KEY, '{not valid json');
  await expect(getExcludedVerseKeys('sad', NOW)).resolves.toEqual([]);

  state.set(STORAGE_KEY, JSON.stringify([1, 2, 3])); // wrong top-level shape (array, not a map)
  await expect(getExcludedVerseKeys('sad', NOW)).resolves.toEqual([]);

  state.set(
    STORAGE_KEY,
    JSON.stringify({
      sad: [
        { verseKey: '2:286', shownAt: NOW }, // valid
        { verseKey: 'not-a-verse-key', shownAt: NOW }, // malformed verseKey
        { verseKey: '2:153' }, // missing shownAt
        'just-a-string', // wrong entry shape entirely
        null,
      ],
    }),
  );
  expect(await getExcludedVerseKeys('sad', NOW)).toEqual(['2:286']);

  // A write must still succeed normally after reading corrupt/malformed data.
  await recordShownAyah('sad', legacyAyah({ referenceKey: '94:6', surahNumber: 94, ayahNumber: 6 }), NOW);
  expect(await getExcludedVerseKeys('sad', NOW)).toEqual(expect.arrayContaining(['2:286', '94:6']));
});

it('a write failure never rejects recordShownAyah (must not block displaying the already-fetched ayah)', async () => {
  const AsyncStorage = (await import('@react-native-async-storage/async-storage')).default;
  vi.mocked(AsyncStorage.setItem).mockRejectedValueOnce(new Error('disk full'));

  await expect(
    recordShownAyah('sad', legacyAyah({ referenceKey: '2:286', surahNumber: 2, ayahNumber: 286 }), NOW),
  ).resolves.toBeUndefined();
});

it('prunes expired records on read and persists the cleaned-up history', async () => {
  await recordShownAyah('sad', legacyAyah({ referenceKey: '2:286', surahNumber: 2, ayahNumber: 286 }), NOW - 11 * 60 * 1000);
  await recordShownAyah('sad', legacyAyah({ referenceKey: '94:5', surahNumber: 94, ayahNumber: 5 }), NOW);

  await getRecentAyahs('sad', NOW);

  const persisted = JSON.parse(state.get(STORAGE_KEY)!);
  expect(persisted.sad.map((entry: { verseKey: string }) => entry.verseKey)).toEqual(['94:5']);
});

it('removeExpiredEntries prunes every emotion, dropping any left with zero active entries, without touching unrelated still-active emotions', async () => {
  await recordShownAyah('sad', legacyAyah({ referenceKey: '2:286', surahNumber: 2, ayahNumber: 286 }), NOW - 11 * 60 * 1000);
  await recordShownAyah('anxious', legacyAyah({ referenceKey: '94:5', surahNumber: 94, ayahNumber: 5 }), NOW);

  await removeExpiredEntries(NOW);

  const persisted = JSON.parse(state.get(STORAGE_KEY)!);
  expect(persisted.sad).toBeUndefined();
  expect(persisted.anxious.map((entry: { verseKey: string }) => entry.verseKey)).toEqual(['94:5']);
});

it('buildExhaustionRetryExclusions is a no-op when the returned ayah was not actually excluded (the normal, non-exhausted path)', () => {
  expect(buildExhaustionRetryExclusions(['2:286', '94:5'], '39:53')).toBeNull();
  expect(buildExhaustionRetryExclusions([], '2:286')).toBeNull();
});

it('buildExhaustionRetryExclusions drops only the single oldest entry, regardless of which excluded ayah the backend fell back to returning', () => {
  const excluded = ['2:286', '94:5', '39:53']; // oldest first: A, B, C
  expect(buildExhaustionRetryExclusions(excluded, '2:286')).toEqual(['94:5', '39:53']);
  expect(buildExhaustionRetryExclusions(excluded, '94:5')).toEqual(['94:5', '39:53']);
  expect(buildExhaustionRetryExclusions(excluded, '39:53')).toEqual(['94:5', '39:53']);
});

it('exhaustion scenario: A@8:00, B@8:03, C@8:07 all still active at an exhausted request at 8:08 — the retry drops only A (oldest); B and C stay excluded', async () => {
  const t800 = NOW;
  const t803 = NOW + 3 * 60 * 1000;
  const t807 = NOW + 7 * 60 * 1000;
  const t808 = NOW + 8 * 60 * 1000;

  await recordShownAyah('sad', legacyAyah({ referenceKey: '2:286', surahNumber: 2, ayahNumber: 286 }), t800); // A
  await recordShownAyah('sad', legacyAyah({ referenceKey: '94:5', surahNumber: 94, ayahNumber: 5 }), t803); // B
  await recordShownAyah('sad', legacyAyah({ referenceKey: '39:53', surahNumber: 39, ayahNumber: 53 }), t807); // C

  const excludedAt808 = await getExcludedVerseKeys('sad', t808);
  expect(excludedAt808).toEqual(['2:286', '94:5', '39:53']); // A, B, C: none expired yet (all <10 min old)

  // Every approved ayah for "sad" is excluded, so — matching the real
  // backend's exhaustion fallback (MongooseQuranRepository) — it ignores the
  // exclusion list and returns one of them anyway. Whichever one it picks,
  // the bounded retry must drop only the oldest (A).
  const retryExclusions = buildExhaustionRetryExclusions(excludedAt808, '39:53');

  expect(retryExclusions).toEqual(['94:5', '39:53']);
  expect(retryExclusions).not.toContain('2:286'); // A becomes eligible
  expect(retryExclusions).toContain('94:5'); // B remains excluded
  expect(retryExclusions).toContain('39:53'); // C remains excluded
});

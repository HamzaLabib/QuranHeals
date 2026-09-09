import { beforeEach, expect, it, vi } from 'vitest';
import { legacyAyah, openTestDatabase } from './helpers/sqlite';

const state = vi.hoisted(() => new Map<string, string>());
vi.mock('@react-native-async-storage/async-storage', () => ({ default: {
  getItem: vi.fn(async (key: string) => state.get(key) ?? null),
  setItem: vi.fn(async (key: string, value: string) => { state.set(key, value); }),
  multiSet: vi.fn(async (entries: [string, string][]) => { for (const [key, value] of entries) state.set(key, value); }),
} }));
vi.mock('@/services/quranAsset', () => ({ openBundledQuran: async () => openTestDatabase() }));
const { getFavoriteState, addFavorite, removeFavorite, favoriteMatchesAyah } = await import('@/storage/favorites');
const { getRecentAyahIds, getRecentAyahState, getRecentVerseKeys, rememberAyahForEmotion } = await import('@/storage/recentAyahs');
const favoritesKey = 'quran-heals:favorites';
const recentKey = 'quran-heals:recent-ayahs';
const saved = () => ({ ...legacyAyah(), savedAt: '2026-01-01T00:00:00.000Z' });
beforeEach(() => state.clear());

it('lazily reads full old favorites using SQLite without changing raw storage, IDs or saved dates', async () => {
  const snapshot = saved();
  state.set(favoritesKey, JSON.stringify([snapshot]));
  const original = state.get(favoritesKey);
  const result = await getFavoriteState();
  expect(result.unresolvedCount).toBe(0);
  expect(result.favorites[0]).toMatchObject({ id: snapshot.id, savedAt: snapshot.savedAt, verseKey: '2:153', englishTranslation: snapshot.englishTranslation });
  expect(result.favorites[0].arabicText).not.toBe(snapshot.arabicText);
  expect(state.get(favoritesKey)).toBe(original);
  expect(favoriteMatchesAyah(result.favorites[0], legacyAyah({ id: '66f100000000000000000088' }))).toBe(true);
});

it('resolves numeric-only old snapshots and preserves unresolvable Mongo-ID-only/malformed records across mutations', async () => {
  const { referenceKey: _reference, ...numericOnly } = saved();
  const unresolved = { id: '66f100000000000000000099' };
  state.set(favoritesKey, JSON.stringify([numericOnly, unresolved, null]));
  const result = await getFavoriteState();
  expect(result.favorites).toHaveLength(1);
  expect(result.unresolvedCount).toBe(2);
  await addFavorite(legacyAyah({ id: '66f100000000000000000088', referenceKey: '94:6', surahNumber: 94, ayahNumber: 6 }));
  await removeFavorite(numericOnly.id);
  const raw = JSON.parse(state.get(favoritesKey)!);
  expect(raw).toContainEqual(unresolved);
  expect(raw).toContain(null);
  expect(raw[0].verseKey).toBe('94:6');
  expect((await getFavoriteState()).unresolvedCount).toBe(2);
});

it('does not overwrite unreadable favorites or lose entries during concurrent saves', async () => {
  state.set(favoritesKey, '{invalid');
  await expect(addFavorite(legacyAyah())).rejects.toThrow();
  expect(state.get(favoritesKey)).toBe('{invalid');
  state.delete(favoritesKey);
  await Promise.all([addFavorite(legacyAyah()), addFavorite(legacyAyah({ id: '66f100000000000000000088', referenceKey: '94:6', surahNumber: 94, ayahNumber: 6 }))]);
  expect((await getFavoriteState()).favorites).toHaveLength(2);
});

it('preserves legacy history IDs and records new stable keys separately without inventing old references', async () => {
  const oldId = '66f100000000000000000099';
  state.set(recentKey, JSON.stringify({ sad: [oldId], anxious: [oldId] }));
  expect(await getRecentAyahIds('sad')).toEqual([oldId]);
  expect(await getRecentVerseKeys('sad')).toEqual([]);
  await rememberAyahForEmotion('sad', legacyAyah());
  expect(await getRecentAyahIds('sad')).toEqual([legacyAyah().id, oldId]);
  expect(await getRecentAyahIds('anxious')).toEqual([oldId]);
  expect(await getRecentVerseKeys('sad')).toEqual(['2:153']);
});

it('preserves malformed history and rejects inconsistent new references without resetting it', async () => {
  state.set(recentKey, '{invalid');
  await expect(rememberAyahForEmotion('sad', legacyAyah())).rejects.toThrow();
  expect(state.get(recentKey)).toBe('{invalid');
  state.set(recentKey, JSON.stringify({ sad: [null, 'not-an-object-id'] }));
  await rememberAyahForEmotion('sad', legacyAyah());
  expect(JSON.parse(state.get(recentKey)!).sad).toContain(null);
  expect(JSON.parse(state.get(recentKey)!).sad).toContain('not-an-object-id');
  expect(await getRecentAyahIds('sad')).toEqual([legacyAyah().id]);
  expect((await getRecentAyahState('sad')).unresolvedCount).toBe(2);
  const before = state.get(recentKey);
  await expect(rememberAyahForEmotion('sad', legacyAyah({ verseKey: '2:154' }))).rejects.toThrow();
  expect(state.get(recentKey)).toBe(before);
});

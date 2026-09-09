import { describe, expect, it, vi } from 'vitest';
import { composeLocalAyah, createQuranRepository } from '@/services/quranRepository';
import { parseVerseKey, resolveVerseKey } from '@/services/quranReference';
import { legacyAyah, openTestDatabase } from './helpers/sqlite';

describe('immutable runtime repository', () => {
  it('gets by key and numbers, and compares all 6,236 runtime strings to SQLite', async () => {
    const db = openTestDatabase();
    const repository = createQuranRepository(async () => db);
    expect(await repository.getVerse(2, 153)).toEqual(await repository.getVerseByKey('2:153'));
    const rows = await db.getAllAsync<{ verse_key: string; arabic_text: string }>('SELECT verse_key, arabic_text FROM verses');
    expect(rows).toHaveLength(6236);
    for (const row of rows) expect((await repository.getVerseByKey(row.verse_key)).arabicText).toBe(row.arabic_text);
    await expect(db.execAsync('DELETE FROM verses')).rejects.toThrow(/readonly/i);
  });

  it('rejects malformed, conflicting and nonexistent references without guessing from ObjectIds', async () => {
    for (const value of [' 2:153', '2:153 ', '02:153', '0:1', '115:1', '2:287', '2:1;DROP TABLE verses', '2.0:1']) {
      expect(() => parseVerseKey(value)).toThrow();
    }
    expect(() => resolveVerseKey({ id: '66f100000000000000000001' })).toThrow();
    expect(() => resolveVerseKey({ verseKey: '2:153', surahNumber: 2, ayahNumber: 154 })).toThrow();
    expect(() => resolveVerseKey({ verseKey: '2:153', referenceKey: '2:154' })).toThrow();
    expect(resolveVerseKey({ surahNumber: 2, ayahNumber: 153 })).toBe('2:153');
    expect(resolveVerseKey({ surah: 2, ayah: 153 })).toBe('2:153');
    const repository = createQuranRepository(async () => openTestDatabase());
    await expect(repository.getVerseByKey('1:8')).rejects.toMatchObject({ kind: 'not_found' });
  });

  it('replaces Arabic and its provenance while preserving IDs, translations and original snapshots', async () => {
    const repository = createQuranRepository(async () => openTestDatabase());
    const input = legacyAyah();
    const result = await composeLocalAyah(input, repository);
    expect(result.arabicText).toBe((await repository.getVerseByKey('2:153')).arabicText);
    expect(result).toMatchObject({ id: input.id, verseKey: '2:153', englishTranslation: input.englishTranslation, translationSource: input.translationSource });
    expect(result.quranTextSource).toContain('https://tanzil.net');
    expect(input.arabicText).toBe('UNTRUSTED_BACKEND_SNAPSHOT');
  });

  it('shares one initialization, retries an open failure and never returns cached/API Arabic', async () => {
    const db = openTestDatabase();
    const open = vi.fn().mockRejectedValueOnce(new Error('asset failure')).mockResolvedValue(db);
    const repository = createQuranRepository(open);
    await expect(composeLocalAyah(legacyAyah(), repository)).rejects.toMatchObject({ kind: 'unavailable' });
    await Promise.all([repository.getVerse(2, 153), repository.getVerse(94, 6)]);
    expect(open).toHaveBeenCalledTimes(2);
  });

  it('rejects a wrong row count and duplicate lookup results', async () => {
    const real = openTestDatabase();
    const wrongCount = { ...real, getAllAsync: vi.fn(async (sql: string, ...params: (string | number)[]) =>
      sql.startsWith('SELECT COUNT') ? [{ rows: 6235, surahs: 114, keys: 6235 }] : real.getAllAsync(sql, ...params)) };
    await expect(createQuranRepository(async () => wrongCount as typeof real).getVerse(2, 153)).rejects.toMatchObject({ kind: 'integrity' });
    const duplicate = { ...real, getAllAsync: vi.fn(async (sql: string, ...params: (string | number)[]) => {
      const rows = await real.getAllAsync(sql, ...params);
      return sql.includes('WHERE verse_key') ? [...rows, ...rows] : rows;
    }) };
    await expect(createQuranRepository(async () => duplicate as typeof real).getVerse(2, 153)).rejects.toMatchObject({ kind: 'integrity' });
  });
});

import type { Ayah } from '@/types/domain';
import { parseVerseKey, QuranDataError, resolveVerseKey, verseKeyFromNumbers } from './quranReference';

export type QuranVerse = { surah: number; ayah: number; verseKey: string; arabicText: string };
type VerseRow = { surah: number; ayah: number; verse_key: string; arabic_text: string };

export interface QuranConnection {
  getAllAsync<T>(sql: string, ...params: (string | number)[]): Promise<T[]>;
  execAsync(sql: string): Promise<void>;
  closeAsync(): Promise<void>;
}

export interface QuranRepository {
  getVerseByKey(verseKey: string): Promise<QuranVerse>;
  getVerse(surah: number, ayah: number): Promise<QuranVerse>;
  /**
   * Picks one verseKey uniformly at random from the complete verified local
   * Quran (all 6,236 ayahs) — the general "Need an ayah from the Quran?"
   * flow's selection, entirely independent of emotions/mappings/favorites.
   * `excludedVerseKeys` (recently-shown general-flow ayahs) are skipped when
   * possible; if they happen to cover the whole pool, falls back to
   * selecting from the full pool rather than failing.
   */
  getRandomVerseKey(excludedVerseKeys?: string[]): Promise<string>;
}

// The raw connection stays private. No mutation methods are exposed to callers.
export function createQuranRepository(open: () => Promise<QuranConnection>): QuranRepository {
  let initialization: Promise<QuranConnection> | undefined;
  async function initialize() {
    const db = await open();
    try {
      await db.execAsync('PRAGMA query_only = ON; PRAGMA trusted_schema = OFF;');
      const [counts] = await db.getAllAsync<{ rows: number; surahs: number; keys: number }>(
        'SELECT COUNT(*) AS rows, COUNT(DISTINCT surah) AS surahs, COUNT(DISTINCT verse_key) AS keys FROM verses',
      );
      const [version] = await db.getAllAsync<{ user_version: number }>('PRAGMA user_version');
      const [identity] = await db.getAllAsync<{ application_id: number }>('PRAGMA application_id');
      if (counts?.rows !== 6236 || counts.surahs !== 114 || counts.keys !== 6236 ||
          version?.user_version !== 1 || identity?.application_id !== 1363694158) {
        throw new QuranDataError('The local Quran data could not be verified. Please try again.', 'integrity');
      }
      return db;
    } catch (error) {
      await db.closeAsync();
      throw error;
    }
  }

  function connection() {
    initialization ??= initialize().catch(error => {
      initialization = undefined; // A retry may recover from a temporary asset load failure.
      if (error instanceof QuranDataError) throw error;
      throw new QuranDataError('The local Quran could not be opened. Please try again.');
    });
    return initialization;
  }

  async function getVerseByKey(verseKey: string): Promise<QuranVerse> {
    const reference = parseVerseKey(verseKey);
    const db = await connection();
    let rows: VerseRow[];
    try {
      rows = await db.getAllAsync<VerseRow>(
        'SELECT surah, ayah, verse_key, arabic_text FROM verses WHERE verse_key = ? LIMIT 2', verseKey,
      );
    } catch {
      throw new QuranDataError('The local Quran could not be read. Please try again.');
    }
    if (rows.length === 0) throw new QuranDataError('This ayah reference is not present in the local Quran.', 'not_found');
    const [row] = rows;
    if (rows.length !== 1 || row.verse_key !== verseKey || row.surah !== reference.surah ||
        row.ayah !== reference.ayah || typeof row.arabic_text !== 'string' || row.arabic_text.length === 0) {
      throw new QuranDataError('The local ayah could not be verified.', 'integrity');
    }
    return { surah: row.surah, ayah: row.ayah, verseKey: row.verse_key, arabicText: row.arabic_text };
  }

  async function getRandomVerseKey(excludedVerseKeys: string[] = []): Promise<string> {
    const db = await connection();
    const placeholders = excludedVerseKeys.map(() => '?').join(', ');
    const sql = excludedVerseKeys.length > 0
      ? `SELECT verse_key FROM verses WHERE verse_key NOT IN (${placeholders}) ORDER BY RANDOM() LIMIT 1`
      : 'SELECT verse_key FROM verses ORDER BY RANDOM() LIMIT 1';
    let rows: { verse_key: string }[];
    try {
      rows = await db.getAllAsync<{ verse_key: string }>(sql, ...excludedVerseKeys);
    } catch {
      throw new QuranDataError('The local Quran could not be read. Please try again.');
    }
    if (rows.length === 0) {
      // Only reachable if excludedVerseKeys somehow covered the entire
      // 6,236-ayah pool — fall back to an unrestricted pick rather than
      // failing outright.
      if (excludedVerseKeys.length === 0) {
        throw new QuranDataError('The local Quran could not be read. Please try again.');
      }
      return getRandomVerseKey([]);
    }
    return rows[0].verse_key;
  }

  return { getVerseByKey, getVerse: (surah, ayah) => getVerseByKey(verseKeyFromNumbers(surah, ayah)), getRandomVerseKey };
}

export async function composeLocalAyah<T extends Ayah>(ayah: T, repository: QuranRepository): Promise<T & { verseKey: string }> {
  const verse = await repository.getVerseByKey(resolveVerseKey(ayah));
  return {
    ...ayah,
    verseKey: verse.verseKey,
    referenceKey: verse.verseKey,
    surahNumber: verse.surah,
    ayahNumber: verse.ayah,
    arabicText: verse.arabicText,
    quranTextSource: 'Tanzil Quran Text — Uthmani 1.1 — https://tanzil.net',
  };
}

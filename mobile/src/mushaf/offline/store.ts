import type { QuranVerse } from '@/services/quranRepository';

import type { ChunkPage, ChunkWord, ManifestChunk, OfflineChunk, OfflineManifest, WordType } from './dataset';

/**
 * The device's offline QPC V1 Mushaf: its own SQLite file
 * (`mushaf-qpc-v1.db`), separate from the bundled Tanzil Quran database.
 *
 *   meta           key/value: version, sequences, sync and check times, counts
 *   pages          page → its ayah range and chunk
 *   words          one row per word in page order (position = position_in_page),
 *                  with its line, global verse id, surah:ayah, position in the
 *                  ayah, type and QCF V1 glyph code
 *   chunks         the installed version's chunk hashes (an unchanged chunk is never downloaded again)
 *   staged_chunks  verified downloads waiting for installation (kept across restarts, so a download resumes)
 *   fonts          the downloaded page fonts' size, SHA-256 and ETag (the files live in the app's documents)
 *
 * A new version replaces the old one in one exclusive transaction, only
 * after the whole Mushaf has been validated: readers see the old version
 * or the new one, never a mix or a partial download.
 */

export const OFFLINE_DB_NAME = 'mushaf-qpc-v1.db';
export const STORE_SCHEMA = 1;

type Param = string | number | null;
export interface OfflineDb {
  execAsync(sql: string): Promise<void>;
  runAsync(sql: string, ...params: Param[]): Promise<unknown>;
  getAllAsync<T>(sql: string, ...params: Param[]): Promise<T[]>;
  getFirstAsync<T>(sql: string, ...params: Param[]): Promise<T | null>;
  /** Exclusive transaction: commits only if `task` resolves. */
  withExclusiveTransactionAsync(task: (txn: OfflineDb) => Promise<void>): Promise<void>;
  closeAsync(): Promise<void>;
}

export async function initSchema(db: OfflineDb) {
  await db.execAsync(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT;
    CREATE TABLE IF NOT EXISTS pages (
      page INTEGER PRIMARY KEY CHECK (page BETWEEN 1 AND 604),
      first_verse_id INTEGER NOT NULL, last_verse_id INTEGER NOT NULL, chunk INTEGER NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS words (
      page INTEGER NOT NULL, position INTEGER NOT NULL, line INTEGER NOT NULL CHECK (line BETWEEN 1 AND 15),
      verse_id INTEGER NOT NULL, surah INTEGER NOT NULL, ayah INTEGER NOT NULL, position_in_verse INTEGER NOT NULL,
      kind TEXT NOT NULL, glyph TEXT NOT NULL,
      PRIMARY KEY (page, position)
    ) STRICT, WITHOUT ROWID;
    CREATE TABLE IF NOT EXISTS chunks (idx INTEGER PRIMARY KEY, sha256 TEXT NOT NULL, first_page INTEGER NOT NULL, last_page INTEGER NOT NULL) STRICT;
    CREATE TABLE IF NOT EXISTS staged_chunks (sha256 TEXT PRIMARY KEY, idx INTEGER NOT NULL, json TEXT NOT NULL, staged_at TEXT NOT NULL) STRICT;
    -- Downloaded QCF V1 page fonts (fonts.ts): one row per stored, verified font file.
    CREATE TABLE IF NOT EXISTS fonts (
      page INTEGER PRIMARY KEY CHECK (page BETWEEN 1 AND 604),
      bytes INTEGER NOT NULL, sha256 TEXT NOT NULL, etag TEXT, last_modified TEXT,
      verified_at TEXT NOT NULL, checked_at TEXT NOT NULL
    ) STRICT;
  `);
  const schema = await db.getFirstAsync<{ value: string }>("SELECT value FROM meta WHERE key = 'schema'");
  if (!schema) await db.runAsync("INSERT INTO meta (key, value) VALUES ('schema', ?)", String(STORE_SCHEMA));
}

export type Meta = Partial<Record<'schema' | 'version' | 'synced_at' | 'installed_at' | 'last_check_at' | 'applied_sequence' | 'snapshot_sequence' | 'word_count' | 'attribution', string>>;

export async function readMeta(db: OfflineDb): Promise<Meta> {
  const rows = await db.getAllAsync<{ key: string; value: string }>('SELECT key, value FROM meta');
  return Object.fromEntries(rows.map((row) => [row.key, row.value])) as Meta;
}

export async function setMeta(db: OfflineDb, values: Meta) {
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined) await db.runAsync('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, value);
  }
}

/**
 * 'ready': a complete, consistent installed version; 'empty': nothing
 * installed; 'corrupt': the file or its rows don't add up (to be reset).
 */
export async function checkIntegrity(db: OfflineDb): Promise<'ready' | 'empty' | 'corrupt'> {
  const check = await db.getFirstAsync<{ quick_check: string }>('PRAGMA quick_check');
  if (check?.quick_check !== 'ok') return 'corrupt';
  const meta = await readMeta(db);
  if (meta.schema !== String(STORE_SCHEMA)) return 'corrupt';
  const counts = await db.getFirstAsync<{ pages: number; words: number; chunks: number }>(
    'SELECT (SELECT COUNT(*) FROM pages) AS pages, (SELECT COUNT(*) FROM words) AS words, (SELECT COUNT(*) FROM chunks) AS chunks',
  );
  if (!meta.version) return counts && counts.pages + counts.words + counts.chunks === 0 ? 'empty' : 'corrupt';
  return counts?.pages === 604 && counts.chunks === 31 && String(counts.words) === meta.word_count ? 'ready' : 'corrupt';
}

/** Wipes the installed version and staging, keeping the schema (recovery from a damaged file). */
export async function resetStore(db: OfflineDb) {
  await db.withExclusiveTransactionAsync(async (txn) => {
    await txn.execAsync("DELETE FROM words; DELETE FROM pages; DELETE FROM chunks; DELETE FROM staged_chunks; DELETE FROM fonts; DELETE FROM meta WHERE key <> 'schema';");
  });
}

export async function installedChunks(db: OfflineDb): Promise<Map<number, string>> {
  const rows = await db.getAllAsync<{ idx: number; sha256: string }>('SELECT idx, sha256 FROM chunks');
  return new Map(rows.map((row) => [row.idx, row.sha256]));
}

export async function stagedChunkHashes(db: OfflineDb): Promise<Set<string>> {
  return new Set((await db.getAllAsync<{ sha256: string }>('SELECT sha256 FROM staged_chunks')).map((row) => row.sha256));
}

export async function stageChunk(db: OfflineDb, chunk: ManifestChunk, json: string, at: string) {
  await db.runAsync('INSERT OR REPLACE INTO staged_chunks (sha256, idx, json, staged_at) VALUES (?, ?, ?, ?)', chunk.sha256, chunk.index, json, at);
}

export async function readStagedChunk(db: OfflineDb, sha256: string): Promise<string | null> {
  return (await db.getFirstAsync<{ json: string }>('SELECT json FROM staged_chunks WHERE sha256 = ?', sha256))?.json ?? null;
}

export async function dropStagedChunks(db: OfflineDb, keep: ReadonlySet<string> = new Set()) {
  for (const sha of await stagedChunkHashes(db)) if (!keep.has(sha)) await db.runAsync('DELETE FROM staged_chunks WHERE sha256 = ?', sha);
}

type WordRow = { page: number; line: number; verse_id: number; position_in_verse: number; kind: string; glyph: string };

/** Installed pages from `first` to `last`, in the chunk form (for validating a partial update). */
export async function readInstalledPages(db: OfflineDb, first: number, last: number): Promise<ChunkPage[]> {
  const pages = await db.getAllAsync<{ page: number; first_verse_id: number; last_verse_id: number }>('SELECT page, first_verse_id, last_verse_id FROM pages WHERE page BETWEEN ? AND ? ORDER BY page', first, last);
  const words = await db.getAllAsync<WordRow>('SELECT page, line, verse_id, position_in_verse, kind, glyph FROM words WHERE page BETWEEN ? AND ? ORDER BY page, position', first, last);
  const byPage = new Map<number, ChunkWord[]>();
  for (const row of words) {
    const list = byPage.get(row.page) ?? [];
    list.push([row.line, row.verse_id, row.position_in_verse, row.kind as WordType, row.glyph]);
    byPage.set(row.page, list);
  }
  return pages.map((page) => ({ page: page.page, firstVerseId: page.first_verse_id, lastVerseId: page.last_verse_id, words: byPage.get(page.page) ?? [] }));
}

const ROWS_PER_INSERT = 300; // 9 values each: well under SQLite's bound-parameter limit

/**
 * Replaces the changed chunks' pages and records the new version, in one
 * exclusive transaction. `verses` maps each global verse id to surah:ayah.
 */
export async function installVersion(db: OfflineDb, args: {
  manifest: OfflineManifest;
  replaced: readonly OfflineChunk[];
  verses: readonly QuranVerse[];
  wordCount: number;
  at: string;
}) {
  const { manifest, replaced, verses } = args;
  await db.withExclusiveTransactionAsync(async (txn) => {
    for (const chunk of replaced) {
      await txn.runAsync('DELETE FROM words WHERE page BETWEEN ? AND ?', chunk.firstPage, chunk.lastPage);
      await txn.runAsync('DELETE FROM pages WHERE page BETWEEN ? AND ?', chunk.firstPage, chunk.lastPage);
      const rows: Param[][] = [];
      for (const page of chunk.pages) {
        await txn.runAsync('INSERT INTO pages (page, first_verse_id, last_verse_id, chunk) VALUES (?, ?, ?, ?)', page.page, page.firstVerseId, page.lastVerseId, chunk.index);
        page.words.forEach(([line, verseId, positionInVerse, kind, glyph], i) => {
          const verse = verses[verseId - 1];
          rows.push([page.page, i + 1, line, verseId, verse.surah, verse.ayah, positionInVerse, kind, glyph]);
        });
      }
      for (let start = 0; start < rows.length; start += ROWS_PER_INSERT) {
        const batch = rows.slice(start, start + ROWS_PER_INSERT);
        await txn.runAsync(
          `INSERT INTO words (page, position, line, verse_id, surah, ayah, position_in_verse, kind, glyph) VALUES ${batch.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?)').join(', ')}`,
          ...batch.flat(),
        );
      }
    }
    await txn.runAsync('DELETE FROM chunks');
    for (const chunk of manifest.chunks) {
      await txn.runAsync('INSERT INTO chunks (idx, sha256, first_page, last_page) VALUES (?, ?, ?, ?)', chunk.index, chunk.sha256, chunk.firstPage, chunk.lastPage);
    }
    await setMeta(txn, {
      version: manifest.version,
      synced_at: manifest.syncedAt,
      applied_sequence: String(manifest.source.appliedSequence),
      snapshot_sequence: String(manifest.source.snapshotSequence),
      word_count: String(args.wordCount),
      attribution: manifest.attribution,
      installed_at: args.at,
      last_check_at: args.at,
    });
    // Its staged downloads are installed now.
    for (const chunk of replaced) await txn.runAsync('DELETE FROM staged_chunks WHERE idx = ?', chunk.index);
  });
}

export type StoredWord = { line: number; verseId: number; surah: number; ayah: number; positionInVerse: number; kind: WordType; glyph: string };

export async function readPageWords(db: OfflineDb, page: number): Promise<StoredWord[]> {
  const rows = await db.getAllAsync<WordRow & { surah: number; ayah: number }>(
    'SELECT page, line, verse_id, surah, ayah, position_in_verse, kind, glyph FROM words WHERE page = ? ORDER BY position', page,
  );
  return rows.map((row) => ({ line: row.line, verseId: row.verse_id, surah: row.surah, ayah: row.ayah, positionInVerse: row.position_in_verse, kind: row.kind as WordType, glyph: row.glyph }));
}

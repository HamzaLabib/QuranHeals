/// <reference types="node" />
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

import { expectedMushafWords, type ChunkPage, type ChunkWord, type OfflineManifest } from '@/mushaf/offline/dataset';
import { RelayError, type OfflineRelay } from '@/mushaf/offline/relayTypes';
import type { OfflineDb } from '@/mushaf/offline/store';
import type { QuranVerse } from '@/services/quranRepository';

/**
 * SYNTHETIC offline Mushaf for tests: 604 pages holding all 6,236 ayahs with
 * as many words as the verified local Tanzil text (less basmala and joined
 * pairs) plus one marker each, made-up glyph codes, packed into 31 chunks
 * exactly as the backend relay serves them. No Quran Foundation data.
 */
export function syntheticPages(verses: readonly QuranVerse[]): ChunkPage[] {
  const basmala = verses[0].arabicText.trim().split(/\s+/);
  const pages: ChunkPage[] = [];
  let id = 1;
  for (let page = 1; page <= 604; page++) {
    const count = Math.floor((page * 6236) / 604) - Math.floor(((page - 1) * 6236) / 604);
    const words: ChunkWord[] = [];
    const first = id;
    for (let v = id; v < id + count; v++) {
      const n = expectedMushafWords(verses[v - 1], basmala);
      for (let p = 1; p <= n + 1; p++) words.push([0, v, p, p > n ? 'end' : 'word', String.fromCharCode(0xe000 + ((v + p) % 4000))]);
    }
    const perLine = Math.ceil(words.length / 15);
    words.forEach((word, i) => { word[0] = Math.min(15, Math.floor(i / perLine) + 1); });
    pages.push({ page, firstVerseId: first, lastVerseId: id + count - 1, words });
    id += count;
  }
  return pages;
}

const sha = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');

/** A published version: manifest plus chunk texts, as the backend builds them. */
export function publishVersion(pages: readonly ChunkPage[], syncedAt = '2026-10-11T00:00:00.000Z') {
  const chunks: { index: number; firstPage: number; lastPage: number; json: string }[] = [];
  for (let first = 1, index = 0; first <= 604; first += 20, index++) {
    const last = Math.min(604, first + 19);
    chunks.push({ index, firstPage: first, lastPage: last, json: JSON.stringify({ schema: 1, index, firstPage: first, lastPage: last, pages: pages.slice(first - 1, last) }) });
  }
  const meta = chunks.map((c) => ({ index: c.index, firstPage: c.firstPage, lastPage: c.lastPage, sha256: sha(c.json), bytes: Buffer.byteLength(c.json) }));
  const version = sha(meta.map((c) => c.sha256).join(',')).slice(0, 24);
  const manifest: OfflineManifest = {
    schema: 1, edition: 'qpc-v1', version,
    mushaf: { id: 2, name: 'QCF V1', description: 'Synthetic', pagesCount: 604, linesPerPage: 15, defaultFontName: 'v1' },
    verses: 6236, words: pages.reduce((n, p) => n + p.words.length, 0),
    source: { provider: 'Quran Foundation', resource: 'mushafs:2', snapshotSequence: 100, appliedSequence: 100 },
    publishedAt: syncedAt, syncedAt, attribution: 'Mushaf layout: Quran Foundation (synthetic test data)',
    chunks: meta, totalBytes: meta.reduce((n, c) => n + c.bytes, 0),
  };
  return { manifest, texts: new Map(chunks.map((c) => [c.index, c.json])) };
}

/** A relay serving `current`, with hooks to break it the ways real networks do. */
export function fakeRelay(current: ReturnType<typeof publishVersion>) {
  const state = {
    current,
    online: true,
    available: true,
    chunkCalls: [] as number[],
    /** Fail (offline) once this many chunk downloads have happened. */
    dropAfter: Infinity,
    /** Chunks served with a byte flipped: 'once' then correct, or 'always'. */
    tamper: new Map<number, 'once' | 'always'>(),
  };
  const relay: OfflineRelay = {
    async manifest() {
      if (!state.online) throw new RelayError('offline', 'offline');
      if (!state.available) throw new RelayError('unavailable', 'unavailable');
      return JSON.parse(JSON.stringify(state.current.manifest));
    },
    async chunk(version, index) {
      if (!state.online || state.chunkCalls.length >= state.dropAfter) throw new RelayError('offline', 'offline');
      if (version !== state.current.manifest.version) throw new RelayError('gone', 'http');
      state.chunkCalls.push(index);
      const text = state.current.texts.get(index)!;
      const tamper = state.tamper.get(index);
      if (tamper) {
        if (tamper === 'once') state.tamper.delete(index);
        return text.replace('"pages":[', '"pages": [');
      }
      return text;
    },
  };
  return { relay, state };
}

/** expo-sqlite's async API over node:sqlite, on a real file (so restarts and damage are real). */
export function nodeOfflineDb(path: string): OfflineDb {
  const db = new DatabaseSync(path);
  const wrap = (): OfflineDb => ({
    async execAsync(sql) { db.exec(sql); },
    async runAsync(sql, ...params) { return db.prepare(sql).run(...params); },
    async getAllAsync<T>(sql: string, ...params: (string | number | null)[]) { return db.prepare(sql).all(...params) as T[]; },
    async getFirstAsync<T>(sql: string, ...params: (string | number | null)[]) { return (db.prepare(sql).get(...params) as T | undefined) ?? null; },
    async withExclusiveTransactionAsync(task) {
      db.exec('BEGIN EXCLUSIVE');
      try {
        await task(wrap());
        db.exec('COMMIT');
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    },
    async closeAsync() { db.close(); },
  });
  return wrap();
}

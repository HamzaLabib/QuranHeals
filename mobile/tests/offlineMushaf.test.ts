/// <reference types="node" />
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { expectedMushafWords, parseManifest, validateOfflinePages, type ChunkPage } from '@/mushaf/offline/dataset';
import { createOfflineMushaf, OfflineMushafError, UPDATE_CHECK_MS, type DownloadProgress } from '@/mushaf/offline/offlineMushaf';
import type { OfflineDb } from '@/mushaf/offline/store';
import { createQuranRepository, type QuranVerse } from '@/services/quranRepository';

import { openTestDatabase } from './helpers/sqlite';
import { fakeRelay, nodeOfflineDb, publishVersion, syntheticPages } from './helpers/syntheticOfflineMushaf';

/**
 * The offline QPC V1 Mushaf on the device: download, resume, verification,
 * atomic installation, restarts, recovery and the sync policy. A SYNTHETIC
 * 604-page dataset over the real verified local Quran; a real SQLite file
 * per test (node:sqlite behind expo-sqlite's API). No Quran Foundation data.
 */

let verses: QuranVerse[];
let pagesV1: ChunkPage[];
beforeAll(async () => {
  verses = await createQuranRepository(async () => openTestDatabase()).getAllVerses();
  pagesV1 = syntheticPages(verses);
});

let dir: string;
let opened: OfflineDb[];
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'offline-mushaf-'));
  opened = [];
});
afterEach(async () => {
  for (const db of opened) await db.closeAsync().catch(() => undefined);
  rmSync(dir, { recursive: true, force: true });
});

const dbPath = () => join(dir, 'mushaf-qpc-v1.db');
function app(relay: ReturnType<typeof fakeRelay>['relay'], options: { now?: () => Date; freeBytes?: number | null } = {}) {
  return createOfflineMushaf({
    openDb: async () => { const db = nodeOfflineDb(dbPath()); opened.push(db); return db; },
    relay,
    verses: async () => verses,
    freeBytes: () => (options.freeBytes === undefined ? 1e10 : options.freeBytes),
    now: options.now,
  });
}
const withChange = (pages: ChunkPage[], page: number, glyph: string) =>
  pages.map((p) => (p.page === page ? { ...p, words: p.words.map((w, i) => (i === 0 ? [w[0], w[1], w[2], w[3], glyph] as typeof w : w)) } : p));

describe('validation against the verified local Quran', () => {
  it('accepts the complete Mushaf and names what is wrong otherwise', () => {
    expect(validateOfflinePages(pagesV1, verses)).toEqual([]);
    const noMarker = pagesV1.map((p) => (p.page === 100 ? { ...p, words: p.words.filter((w) => !(w[3] === 'end' && w[1] === p.firstVerseId)) } : p));
    expect(validateOfflinePages(noMarker, verses).join()).toMatch(/marker missing or misplaced/);
    const missing = pagesV1.filter((p) => p.page !== 300);
    expect(validateOfflinePages(missing, verses).join()).toMatch(/603 pages|is missing/);
    const extraWord = pagesV1.map((p) => (p.page === 5 ? { ...p, words: [p.words[0], ...p.words.map((w) => w)].map((w, i) => (i === 0 ? w : w)) } : p));
    expect(validateOfflinePages(extraWord, verses).length).toBeGreaterThan(0);
  });

  it('counts first ayahs without Tanzil`s basmala and joins only the documented pairs', () => {
    const basmala = verses[0].arabicText.split(/\s+/);
    const v = (key: string) => verses.find((verse) => verse.verseKey === key)!;
    expect(expectedMushafWords(v('2:1'), basmala)).toBe(v('2:1').arabicText.split(/\s+/).length - 4);
    expect(expectedMushafWords(v('1:1'), basmala)).toBe(4);
    expect(expectedMushafWords(v('9:1'), basmala)).toBe(v('9:1').arabicText.split(/\s+/).length);
    expect(expectedMushafWords(v('37:130'), basmala)).toBe(3);
  });

  it('rejects a manifest that is not the 604-page QPC V1 Mushaf', () => {
    const { manifest } = publishVersion(pagesV1);
    expect(parseManifest(manifest).version).toBe(manifest.version);
    expect(() => parseManifest({ ...manifest, chunks: manifest.chunks.slice(1) })).toThrow(/31 chunks/);
    expect(() => parseManifest({ ...manifest, mushaf: { ...manifest.mushaf, id: 1 } })).toThrow(/604-page QPC V1/);
    expect(() => parseManifest({ ...manifest, attribution: '' })).toThrow(/attribution/);
  });
});

// Every test below downloads and validates the whole synthetic 604-page Mushaf
// into a real SQLite file: ~0.5 s alone, but several times that when the full
// suite runs files in parallel and the disk is busy (one run on Windows hit
// 6.1 s against the 5 s default). The same allowance as mushafAutoDownload's
// real-engine tests.
const REAL_DOWNLOAD = { timeout: 20_000 };

describe('initial download', REAL_DOWNLOAD, () => {
  it('downloads all 31 chunks with progress, verifies them, and installs the Mushaf into its own database', async () => {
    const { relay, state } = fakeRelay(publishVersion(pagesV1));
    const mushaf = app(relay);
    expect(await mushaf.status()).toEqual({ installed: false, stagedChunks: 0 });
    const progress: DownloadProgress[] = [];
    const result = await mushaf.download({ onProgress: (p) => progress.push(p) });
    expect(result).toMatchObject({ status: 'installed', downloadedChunks: 31, reusedChunks: 0 });
    expect(state.chunkCalls).toHaveLength(31);
    expect(progress.map((p) => p.phase)).toEqual(expect.arrayContaining(['checking', 'downloading', 'verifying', 'installing', 'done']));
    const downloading = progress.filter((p) => p.phase === 'downloading').map((p) => p.chunksReady);
    expect(downloading).toEqual([...downloading].sort((a, b) => a - b));
    expect(progress.at(-1)).toMatchObject({ chunksReady: 31, chunksTotal: 31 });
    expect(await mushaf.status()).toMatchObject({ installed: true, version: state.current.manifest.version, stagedChunks: 0 });

    // Reading needs nothing but the database: surah:ayah from the verified Quran, words in page order.
    const page = (await mushaf.readPage(61))!;
    expect(page.fontFamily).toBe('QCF_P061');
    expect(page.verseKeys[0]).toBe(verses[pagesV1[60].firstVerseId - 1].verseKey);
    expect(page.lines.flatMap((line) => line.words)).toHaveLength(pagesV1[60].words.length);
    expect(page.lines.flatMap((line) => line.words).filter((w) => w.kind === 'end')).toHaveLength(pagesV1[60].lastVerseId - pagesV1[60].firstVerseId + 1);
    expect(await mushaf.readPage(605)).toBeNull();

    // A separate file from the bundled Tanzil database.
    const raw = new DatabaseSync(dbPath(), { readOnly: true });
    expect(raw.prepare('SELECT COUNT(*) AS n FROM pages').get()).toEqual({ n: 604 });
    expect((raw.prepare('SELECT COUNT(DISTINCT verse_id) AS n FROM words').get() as { n: number }).n).toBe(6236);
    raw.close();
  });

  it('can be cancelled, and resumes with only what is missing — even after a restart', async () => {
    const { relay, state } = fakeRelay(publishVersion(pagesV1));
    const controller = new AbortController();
    await expect(app(relay).download({ signal: controller.signal, onProgress: (p) => { if (p.chunksReady === 5) controller.abort(); } }))
      .rejects.toMatchObject({ kind: 'cancelled' });
    // Restart: a new instance on the same file.
    const restarted = app(relay);
    expect(await restarted.status()).toEqual({ installed: false, stagedChunks: 5 });
    const result = await restarted.download();
    expect(result).toMatchObject({ status: 'installed', downloadedChunks: 26 });
    expect(state.chunkCalls).toHaveLength(31);
  });

  it('a dropped connection keeps what was verified; the next attempt continues', async () => {
    const { relay, state } = fakeRelay(publishVersion(pagesV1));
    state.dropAfter = 12;
    await expect(app(relay).download()).rejects.toMatchObject({ kind: 'offline' });
    state.dropAfter = Infinity;
    expect(await app(relay).download()).toMatchObject({ status: 'installed', downloadedChunks: 19 });
  });

  it('a damaged chunk is downloaded again; one that stays damaged is never installed', async () => {
    const { relay, state } = fakeRelay(publishVersion(pagesV1));
    state.tamper.set(7, 'once');
    expect(await app(relay).download()).toMatchObject({ status: 'installed' });
    expect(state.chunkCalls.filter((i) => i === 7)).toHaveLength(2);

    for (const db of opened) await db.closeAsync();
    opened = [];
    rmSync(dir, { recursive: true, force: true });
    dir = mkdtempSync(join(tmpdir(), 'offline-mushaf-'));
    const broken = fakeRelay(publishVersion(pagesV1));
    broken.state.tamper.set(3, 'always');
    await expect(app(broken.relay).download()).rejects.toMatchObject({ kind: 'integrity' });
    expect(await app(broken.relay).status()).toMatchObject({ installed: false, stagedChunks: 3 });
  });

  it('refuses to start without enough free storage, changing nothing', async () => {
    const { relay, state } = fakeRelay(publishVersion(pagesV1));
    await expect(app(relay, { freeBytes: 5 * 1024 * 1024 }).download()).rejects.toMatchObject({ kind: 'insufficient_storage' });
    expect(state.chunkCalls).toHaveLength(0);
    expect(await app(relay).status()).toEqual({ installed: false, stagedChunks: 0 });
  });

  it('one download at a time', async () => {
    const { relay } = fakeRelay(publishVersion(pagesV1));
    const mushaf = app(relay);
    const first = mushaf.download();
    await expect(mushaf.download()).rejects.toMatchObject({ kind: 'busy' });
    await first;
  });
});

describe('updates and the sync policy', REAL_DOWNLOAD, () => {
  const day = 24 * 60 * 60 * 1000;

  it('a new version replaces only changed chunks, atomically, after validating the whole Mushaf', async () => {
    let clock = Date.parse('2026-10-11T00:00:00Z');
    const now = () => new Date(clock);
    const { relay, state } = fakeRelay(publishVersion(pagesV1));
    await app(relay, { now }).download();
    const v1 = state.current.manifest.version;
    state.current = publishVersion(withChange(pagesV1, 300, ''), '2026-10-12T00:00:00.000Z');
    state.chunkCalls = [];
    clock += 2 * day;
    expect(await app(relay, { now }).checkForUpdate()).toBe('updated');
    expect(state.chunkCalls).toEqual([14]); // pages 281–300 only
    const status = await app(relay, { now }).status();
    expect(status).toMatchObject({ installed: true, syncedAt: '2026-10-12T00:00:00.000Z' });
    expect(status.installed && status.version).not.toBe(v1);
    expect((await app(relay, { now }).readPage(300))!.lines[0].words[0].glyph).toBe('');
  });

  it('a new version that fails validation never replaces the valid one', async () => {
    const { relay, state } = fakeRelay(publishVersion(pagesV1));
    await app(relay).download();
    const v1 = (await app(relay).status()) as { version: string };
    // Correct hashes, wrong content: an ayah loses its marker.
    const broken = pagesV1.map((p) => (p.page === 450 ? { ...p, words: p.words.filter((w, i) => !(i === p.words.length - 1)) } : p));
    state.current = publishVersion(broken);
    await expect(app(relay).download()).rejects.toMatchObject({ kind: 'integrity' });
    expect(await app(relay).status()).toMatchObject({ installed: true, version: v1.version, stagedChunks: 0 });
    expect(await app(relay).readPage(450)).not.toBeNull();
  });

  it('checks at most daily when online; stays readable offline indefinitely, then updates on reconnect', async () => {
    let clock = Date.parse('2026-10-11T00:00:00Z');
    const now = () => new Date(clock);
    const { relay, state } = fakeRelay(publishVersion(pagesV1));
    await app(relay, { now }).download();
    clock += UPDATE_CHECK_MS - 1;
    expect(await app(relay, { now }).checkForUpdate()).toBe('not-due');
    // Offline for over a year: nothing expires, nothing is removed.
    state.online = false;
    clock += 400 * day;
    expect(await app(relay, { now }).checkForUpdate()).toBe('offline');
    const offline = app(relay, { now });
    expect(await offline.status()).toMatchObject({ installed: true });
    expect((await offline.readPage(1))!.verseKeys[0]).toBe('1:1');
    expect((await offline.readPage(604))!.verseKeys.at(-1)).toBe('114:6');
    // Back online with a newer version.
    state.online = true;
    state.current = publishVersion(withChange(pagesV1, 1, ''));
    expect(await app(relay, { now }).checkForUpdate()).toBe('updated');
    // Same version later: just a successful check.
    clock += 2 * day;
    expect(await app(relay, { now }).checkForUpdate()).toBe('up-to-date');
    expect(await app(relay, { now }).checkForUpdate()).toBe('not-due');
  });

  it('the server being unavailable is not an error for the reader', async () => {
    const { relay, state } = fakeRelay(publishVersion(pagesV1));
    await app(relay).download();
    state.available = false;
    expect(await app(relay).checkForUpdate({ force: true })).toBe('offline');
    expect(await app(relay).readPage(2)).not.toBeNull();
  });
});

describe('restarts and recovery', REAL_DOWNLOAD, () => {
  it('a damaged database is detected on open, reset, and can be downloaded again', async () => {
    const { relay } = fakeRelay(publishVersion(pagesV1));
    await app(relay).download();
    for (const db of opened) await db.closeAsync();
    opened = [];
    const raw = new DatabaseSync(dbPath());
    raw.exec('DELETE FROM words WHERE page = 200');
    raw.close();
    const reopened = app(relay);
    expect(await reopened.status()).toEqual({ installed: false, stagedChunks: 0 });
    expect(await reopened.readPage(61)).toBeNull();
    expect(await reopened.download()).toMatchObject({ status: 'installed', downloadedChunks: 31 });
  });

  it('remove() deletes the offline Mushaf and any partial download', async () => {
    const { relay } = fakeRelay(publishVersion(pagesV1));
    const mushaf = app(relay);
    await mushaf.download();
    await mushaf.remove();
    expect(await mushaf.status()).toEqual({ installed: false, stagedChunks: 0 });
  });

  it('errors are typed, so the screen can explain them', () => {
    const error = new OfflineMushafError('x', 'insufficient_storage');
    expect(error).toBeInstanceOf(Error);
    expect(error.kind).toBe('insufficient_storage');
  });
});

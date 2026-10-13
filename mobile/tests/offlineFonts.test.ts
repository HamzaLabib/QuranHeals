/// <reference types="node" />
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { checkPageFont } from '@/mushaf/offline/fontFile';
import { FONT_UPDATE_CHECK_MS, qcfFontUrl } from '@/mushaf/offline/fonts';
import { createOfflineMushaf, type DownloadProgress } from '@/mushaf/offline/offlineMushaf';
import type { OfflineDb } from '@/mushaf/offline/store';
import type { ChunkPage } from '@/mushaf/offline/dataset';
import { createQuranRepository, type QuranVerse } from '@/services/quranRepository';

import { openTestDatabase } from './helpers/sqlite';
import { fakeFontCdn, memoryFontFiles, syntheticFont } from './helpers/syntheticFonts';
import { fakeRelay, nodeOfflineDb, publishVersion, syntheticPages } from './helpers/syntheticOfflineMushaf';

/**
 * The 604 QCF V1 page fonts in the offline Mushaf: checked before use,
 * resumable, repaired when damaged, updated by ETag. Layout and fonts are
 * SYNTHETIC; only the font checker is also run on the real bundled p61.ttf.
 */

const realP61 = new Uint8Array(readFileSync(fileURLToPath(new URL('../assets/mushaf/qpc-v1/p61.ttf', import.meta.url))));

describe('font checks (fontFile.ts)', () => {
  it('accepts the real QCF V1 page-61 font as page 61, and only as page 61', () => {
    expect(checkPageFont(realP61, 61, [])).toEqual([]);
    expect(checkPageFont(realP61, 62, []).join()).toMatch(/not QCF_P062 \(names: QCF_P061\)/);
  });

  it('rejects a truncated font, a non-font, and a font missing the page`s glyph codes', () => {
    expect(checkPageFont(realP61.slice(0, 1000), 61, []).length).toBeGreaterThan(0);
    expect(checkPageFont(new TextEncoder().encode('<html>Not found</html>'), 61, [])).toEqual(['not a TrueType font']);
    expect(checkPageFont(realP61, 61, ['']).join()).toMatch(/glyph codes have no glyph/);
    expect(checkPageFont(syntheticFont(5, { coverUpTo: 0xe0ff }), 5, ['', '']).join()).toMatch(/1 of the page's glyph codes/);
    expect(checkPageFont(syntheticFont(5), 5, ['', ''])).toEqual([]);
  });

  it('uses Quran Foundation`s documented CDN path for each page', () => {
    expect(qcfFontUrl(1)).toBe('https://verses.quran.foundation/fonts/quran/hafs/v1/ttf/p1.ttf');
    expect(qcfFontUrl(604)).toBe('https://verses.quran.foundation/fonts/quran/hafs/v1/ttf/p604.ttf');
  });
});

let verses: QuranVerse[];
let pages: ChunkPage[];
beforeAll(async () => {
  verses = await createQuranRepository(async () => openTestDatabase()).getAllVerses();
  pages = syntheticPages(verses);
});

let dir: string;
let opened: OfflineDb[];
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'offline-fonts-'));
  opened = [];
});
afterEach(async () => {
  for (const db of opened) await db.closeAsync().catch(() => undefined);
  rmSync(dir, { recursive: true, force: true });
});

// Tests that install the Mushaf run the real path end to end: ~85k words into SQLite, then 603
// fonts each fetched, parsed, SHA-256 hashed and recorded, and some check all 603 again (ETag).
// About 1.2–1.9 s each locally; one exceeded the 5 s default on a loaded CI runner. The scoped
// limit below keeps a real hang failing without flaking on load.
const FULL_INSTALL_TIMEOUT_MS = 15_000;

function setup() {
  const relay = fakeRelay(publishVersion(pages));
  const cdn = fakeFontCdn();
  const files = memoryFontFiles();
  let clock = Date.parse('2026-10-11T00:00:00Z');
  // Bound now, not read from `dir` later: work left running by a timed-out test never opens the next test's database.
  const dbPath = join(dir, 'm.db');
  const make = (options: { freeBytes?: number | null } = {}) => createOfflineMushaf({
    openDb: async () => { const db = nodeOfflineDb(dbPath); opened.push(db); return db; },
    relay: relay.relay,
    verses: async () => verses,
    freeBytes: () => (options.freeBytes === undefined ? 1e10 : options.freeBytes),
    now: () => new Date(clock),
    fonts: { source: cdn.source, files },
  });
  return { relay, cdn, files, make, advance: (ms: number) => { clock += ms; } };
}

describe('downloading the page fonts with the Mushaf', { timeout: FULL_INSTALL_TIMEOUT_MS }, () => {
  it('one download brings the layout and the 603 fonts not in the app (page 61 is bundled): complete', async () => {
    const { cdn, files, make } = setup();
    const progress: DownloadProgress[] = [];
    const result = await make().download({ onProgress: (p) => progress.push(p) });
    expect(result).toMatchObject({ status: 'installed', fontsDownloaded: 603 });
    expect(cdn.state.calls).toHaveLength(603);
    expect(cdn.state.calls).not.toContain(61);
    expect(files.stored.size).toBe(603);
    const fontsPhase = progress.filter((p) => p.phase === 'fonts');
    expect(fontsPhase.length).toBeGreaterThan(10);
    expect(progress.at(-1)).toMatchObject({ phase: 'done', fontsReady: 604, fontsTotal: 604 });
    // The layout step never says 'done' before the fonts are in.
    expect(progress.findIndex((p) => p.phase === 'done')).toBe(progress.length - 1);
    expect(await make().status()).toMatchObject({ installed: true, complete: true, fonts: { ready: 604, total: 604 } });
    expect(await make().pageFont(61)).toBe('bundled');
    expect(await make().pageFont(300)).toEqual({ family: 'QCF_P300', uri: 'file:///fonts/p300.ttf' });
  });

  it('is never complete until every font is verified; an interrupted font download resumes with what is missing', async () => {
    const { cdn, make } = setup();
    cdn.state.dropAfter = 250;
    await expect(make().download()).rejects.toMatchObject({ kind: 'offline' });
    const partial = await make().status();
    expect(partial).toMatchObject({ installed: true, complete: false });
    expect(partial.fonts!.ready).toBeGreaterThanOrEqual(250);
    expect(partial.fonts!.ready).toBeLessThan(604);
    cdn.state.dropAfter = Infinity;
    cdn.state.calls = [];
    const resumed = await make().download();
    expect(resumed.status).toBe('up-to-date'); // the layout was already installed
    expect(cdn.state.calls.length).toBe(604 - partial.fonts!.ready);
    expect(await make().status()).toMatchObject({ complete: true });
  });

  it('can be cancelled during the fonts; nothing verified is lost', async () => {
    const { make } = setup();
    const controller = new AbortController();
    await expect(make().download({ signal: controller.signal, onProgress: (p) => { if ((p.fontsReady ?? 0) > 100) controller.abort(); } }))
      .rejects.toMatchObject({ kind: 'cancelled' });
    const status = await make().status();
    expect(status.fonts!.ready).toBeGreaterThan(100);
    expect(await make().download()).toMatchObject({ fontsDownloaded: 604 - status.fonts!.ready });
  });

  it('a wrong or truncated font is never stored; the layout stays installed', async () => {
    const { cdn, files, make } = setup();
    cdn.state.wrongFont.add(200);
    cdn.state.truncated.add(201);
    await expect(make().download()).rejects.toMatchObject({ kind: 'integrity' });
    expect(files.stored.has(200)).toBe(false);
    expect(files.stored.has(201)).toBe(false);
    expect(await make().status()).toMatchObject({ installed: true, complete: false });
    cdn.state.wrongFont.clear();
    cdn.state.truncated.clear();
    expect(await make().download()).toMatchObject({ status: 'up-to-date' });
    expect(await make().status()).toMatchObject({ complete: true });
  });

  it('checks free storage before the fonts; the layout is kept', async () => {
    const { cdn, make } = setup();
    // Enough for the layout alone; not for 603 fonts.
    await expect(make({ freeBytes: 60 * 1024 * 1024 }).download()).rejects.toMatchObject({ kind: 'insufficient_storage' });
    expect(cdn.state.calls).toHaveLength(0);
    // With the layout already installed, its space check is past; the fonts' own check still refuses.
    await make().download({ signal: AbortSignal.abort() }).catch(() => undefined);
    await expect(make({ freeBytes: 30 * 1024 * 1024 }).download()).rejects.toMatchObject({ kind: 'insufficient_storage' });
    expect(cdn.state.calls).toHaveLength(0);
  });
});

describe('damage, restarts and updates', { timeout: FULL_INSTALL_TIMEOUT_MS }, () => {
  it('a damaged font is found (on load, or a full check), deleted, and downloaded again alone', async () => {
    const { cdn, files, make } = setup();
    await make().download();
    files.stored.get(77)![100] ^= 0xff; // same size, different bytes
    expect(await make().pageFont(77)).toBeNull();
    files.stored.set(78, files.stored.get(78)!.slice(0, 100)); // truncated on disk
    files.stored.get(79)![10] ^= 0xff;
    expect(await make().verifyFonts()).toEqual({ checked: 602, damaged: [78, 79] });
    expect(await make().status()).toMatchObject({ complete: false, fonts: { ready: 601 } });
    cdn.state.calls = [];
    await make().download();
    expect(cdn.state.calls.sort((a, b) => a - b)).toEqual([77, 78, 79]);
    expect(await make().status()).toMatchObject({ complete: true });
  });

  it('after a restart with no connection, every font is still there and loads', async () => {
    const { cdn, relay, make } = setup();
    await make().download();
    cdn.state.online = false;
    relay.state.online = false;
    const offline = make();
    expect(await offline.status()).toMatchObject({ complete: true });
    expect(await offline.pageFont(604)).toEqual({ family: 'QCF_P604', uri: 'file:///fonts/p604.ttf' });
    expect(await offline.checkForUpdate({ force: true })).toBe('offline');
  });

  it('asks the CDN at most monthly whether fonts changed (ETag); only changed fonts are replaced', async () => {
    const { cdn, files, make, advance } = setup();
    await make().download();
    advance(FONT_UPDATE_CHECK_MS / 2);
    cdn.state.calls = [];
    expect(await make().checkForUpdate({ force: true })).toBe('up-to-date');
    expect(cdn.state.calls).toHaveLength(0); // fonts not due yet
    advance(FONT_UPDATE_CHECK_MS);
    cdn.state.updated.add(450);
    const before = files.stored.get(450)!;
    expect(await make().checkForUpdate({ force: true })).toBe('updated');
    expect(cdn.state.calls).toHaveLength(603); // one conditional request each; the changed one is answered with the new font
    expect(files.stored.get(450)).not.toEqual(before);
    expect(await make().pageFont(450)).toEqual({ family: 'QCF_P450', uri: 'file:///fonts/p450.ttf' });
  });

  it('a layout update that changes a page`s glyph codes replaces a font that no longer covers them', async () => {
    const { relay, cdn, files, make } = setup();
    await make().download();
    // Page 300's layout now uses a code its stored font lacks; the CDN has a font covering it.
    files.stored.set(300, syntheticFont(300, { coverUpTo: 0xe0ff }));
    const changed = pages.map((p) => (p.page === 300 ? { ...p, words: p.words.map((w, i) => (i === 0 ? [w[0], w[1], w[2], w[3], ''] as typeof w : w)) } : p));
    relay.state.current = publishVersion(changed);
    cdn.state.calls = [];
    await make().download();
    expect(cdn.state.calls).toEqual([300]);
    expect(checkPageFont(files.stored.get(300)!, 300, [''])).toEqual([]);
  });

  it('remove() deletes the layout and every font', async () => {
    const { files, make } = setup();
    await make().download();
    await make().remove();
    expect(files.stored.size).toBe(0);
    expect(await make().status()).toMatchObject({ installed: false, complete: false, fonts: { ready: 1 } }); // the bundled page-61 font
  });
});

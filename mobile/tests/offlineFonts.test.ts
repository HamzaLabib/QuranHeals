/// <reference types="node" />
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { checkPageFont } from '@/mushaf/offline/fontFile';
import { FONT_UPDATE_CHECK_MS, qcfFontUrl, type BundledFonts } from '@/mushaf/offline/fonts';
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

describe('fonts bundled with the app (all 604)', { timeout: FULL_INSTALL_TIMEOUT_MS }, () => {
  // The app ships the CDN's current (v1) synthetic font for every page, pinned with the CDN's v1 ETag.
  const pins: BundledFonts['pins'] = new Map(Array.from({ length: 604 }, (_, i) => i + 1).map((page) =>
    [page, { sha256: createHash('sha256').update(syntheticFont(page)).digest('hex'), etag: `"v1-${page}"`, lastModified: null }]));

  function bundledSetup() {
    const base = setup();
    let assetsResolve = true;
    /** Pages whose file inside the app is damaged on this device. */
    const damagedInApp = new Set<number>();
    const bundled: BundledFonts = {
      pins,
      uri: async (page) => (assetsResolve ? `file:///app/p${page}.ttf` : null),
      read: async (uri) => {
        const page = Number(/p(\d+)\.ttf$/.exec(uri)![1]);
        const bytes = syntheticFont(page);
        if (damagedInApp.has(page)) bytes[bytes.length - 1] ^= 0xff;
        return bytes;
      },
    };
    const dbPath = join(dir, 'm.db');
    let clock = Date.parse('2026-10-11T00:00:00Z');
    const make = (options: { bundled?: boolean } = {}) => createOfflineMushaf({
      openDb: async () => { const db = nodeOfflineDb(dbPath); opened.push(db); return db; },
      relay: base.relay.relay,
      verses: async () => verses,
      freeBytes: () => 1e10,
      now: () => new Date(clock),
      fonts: { source: base.cdn.source, files: base.files, bundled: options.bundled === false ? undefined : bundled },
    });
    return { ...base, make, damagedInApp, advance: (ms: number) => { clock += ms; }, failAssets: () => { assetsResolve = false; } };
  }

  it('a first download brings only the layout: no font is downloaded, and the Mushaf is complete', async () => {
    const { cdn, files, make } = bundledSetup();
    expect(await make().status()).toMatchObject({ installed: false, complete: false, fonts: { ready: 604, total: 604 } });
    const progress: DownloadProgress[] = [];
    expect(await make().download({ onProgress: (p) => progress.push(p) })).toMatchObject({ status: 'installed', fontsDownloaded: 0 });
    expect(cdn.state.calls).toEqual([]);
    expect(files.stored.size).toBe(0);
    expect(progress.at(-1)).toMatchObject({ phase: 'done', fontsReady: 604, fontsTotal: 604 });
    expect(await make().status()).toMatchObject({ installed: true, complete: true, fonts: { ready: 604, total: 604, bytes: 0 } });
    expect(await make().pageFont(300)).toEqual({ family: 'QCF_P300', uri: 'file:///app/p300.ttf' });
    expect(await make().pageFont(61)).toBe('bundled');
    // A second run downloads nothing at all.
    expect(await make().download()).toMatchObject({ status: 'up-to-date', fontsDownloaded: 0 });
    expect(cdn.state.calls).toEqual([]);
  });

  it('an install from before the fonts were bundled: nothing is deleted on upgrade; a copy goes only once its bundled font is confirmed on the device', async () => {
    const { cdn, files, make, damagedInApp } = bundledSetup();
    cdn.state.updated.add(450); // this device downloaded a font that differs from the one the app ships
    await make({ bundled: false }).download();
    expect(files.stored.size).toBe(603);
    cdn.state.calls = [];
    const upgraded = make();
    expect(await upgraded.status()).toMatchObject({ installed: true, complete: true, fonts: { ready: 604 } });
    expect(await upgraded.download()).toMatchObject({ status: 'up-to-date', fontsDownloaded: 0 });
    expect(cdn.state.calls).toEqual([]);
    expect(files.stored.size).toBe(603); // opening, status and the update check delete nothing
    // Page 300 opened: its bundled font matches its pin, so the identical download is replaced by it.
    expect(await upgraded.pageFont(300)).toEqual({ family: 'QCF_P300', uri: 'file:///app/p300.ttf' });
    expect(files.stored.has(300)).toBe(false);
    // Page 301's file inside the app is damaged on this device: the downloaded font stays and is used.
    damagedInApp.add(301);
    expect(await upgraded.pageFont(301)).toEqual({ family: 'QCF_P301', uri: 'file:///fonts/p301.ttf' });
    expect(files.stored.has(301)).toBe(true);
    // Page 450's download differs from the bundled font: a kept override.
    expect(await upgraded.pageFont(450)).toEqual({ family: 'QCF_P450', uri: 'file:///fonts/p450.ttf' });
    expect(files.stored.size).toBe(602);
  });

  it('a bundled font that doesn`t match its pin on the device is never used (the reader falls back to the CDN)', async () => {
    const { make, damagedInApp } = bundledSetup();
    await make().download();
    damagedInApp.add(300);
    expect(await make().pageFont(300)).toBeNull();
    expect(await make().pageFont(302)).toEqual({ family: 'QCF_P302', uri: 'file:///app/p302.ttf' });
  });

  it('the monthly update check asks about bundled fonts by their pinned ETag; a corrected font overrides the bundled one', async () => {
    const { cdn, files, make, advance } = bundledSetup();
    await make().download();
    advance(25 * 60 * 60 * 1000);
    expect(await make().checkForUpdate()).toBe('up-to-date');
    expect(cdn.state.calls).toEqual([]); // first seen now: not due for a month
    advance(FONT_UPDATE_CHECK_MS);
    cdn.state.updated.add(300);
    expect(await make().checkForUpdate()).toBe('updated');
    expect(cdn.state.calls).toHaveLength(603); // every page but 61, each a conditional request
    expect(cdn.state.calls).not.toContain(61);
    expect([...files.stored.keys()]).toEqual([300]);
    expect(await make().pageFont(300)).toEqual({ family: 'QCF_P300', uri: 'file:///fonts/p300.ttf' });
    cdn.state.calls = [];
    advance(25 * 60 * 60 * 1000);
    expect(await make().checkForUpdate()).toBe('up-to-date');
    expect(cdn.state.calls).toEqual([]); // checked again only after another month
  });

  it('a damaged override is rejected and the bundled font is used again', async () => {
    const { cdn, files, make, advance } = bundledSetup();
    await make().download();
    advance(25 * 60 * 60 * 1000);
    await make().checkForUpdate();
    cdn.state.updated.add(300);
    advance(FONT_UPDATE_CHECK_MS * 2);
    expect(await make().checkForUpdate()).toBe('updated');
    files.stored.get(300)![100] ^= 0xff;
    expect(await make().pageFont(300)).toEqual({ family: 'QCF_P300', uri: 'file:///app/p300.ttf' });
    expect(files.stored.has(300)).toBe(false);
    expect(await make().status()).toMatchObject({ complete: true });
    expect(await make().verifyFonts()).toEqual({ checked: 0, damaged: [] });
  });

  it('when the CDN`s font is the bundled one again, the override is replaced by it, then dropped for the confirmed bundled font', async () => {
    const { cdn, files, make, advance } = bundledSetup();
    await make().download();
    advance(25 * 60 * 60 * 1000);
    await make().checkForUpdate();
    cdn.state.updated.add(300);
    advance(FONT_UPDATE_CHECK_MS * 2);
    await make().checkForUpdate();
    const override = files.stored.get(300)!;
    cdn.state.updated.delete(300);
    advance(FONT_UPDATE_CHECK_MS * 2);
    expect(await make().checkForUpdate()).toBe('updated');
    expect(files.stored.get(300)).toEqual(syntheticFont(300)); // the CDN's (= bundled) bytes, not the old override
    expect(files.stored.get(300)).not.toEqual(override);
    expect(await make().pageFont(300)).toEqual({ family: 'QCF_P300', uri: 'file:///app/p300.ttf' });
    expect(files.stored.size).toBe(0);
  });

  it('a layout update asks the CDN about the changed pages` bundled fonts only', async () => {
    const { relay, cdn, files, make } = bundledSetup();
    await make().download();
    const changed = pages.map((p) => (p.page === 300 ? { ...p, words: p.words.map((w, i) => (i === 0 ? [w[0], w[1], w[2], w[3], ''] as typeof w : w)) } : p));
    relay.state.current = publishVersion(changed);
    cdn.state.calls = [];
    expect(await make().download()).toMatchObject({ status: 'installed' });
    // The changed chunk's pages (281–300): each answered "not modified", nothing stored.
    expect(cdn.state.calls.sort((a, b) => a - b)).toEqual(Array.from({ length: 20 }, (_, i) => 281 + i));
    expect(files.stored.size).toBe(0);
    expect(await make().status()).toMatchObject({ complete: true });
  });

  it('Remove offline copy deletes the layout and downloaded overrides; the bundled fonts stay', async () => {
    const { cdn, files, make, advance } = bundledSetup();
    await make().download();
    advance(25 * 60 * 60 * 1000);
    await make().checkForUpdate();
    cdn.state.updated.add(300);
    advance(FONT_UPDATE_CHECK_MS * 2);
    await make().checkForUpdate();
    expect(files.stored.size).toBe(1);
    await make().remove();
    expect(files.stored.size).toBe(0);
    expect(await make().status()).toMatchObject({ installed: false, complete: false, fonts: { ready: 604 } });
    expect(await make().readPage(300)).toBeNull();
  });

  it('a bundled font whose asset can`t be resolved is reported as unavailable (the reader falls back to the CDN)', async () => {
    const { make, failAssets } = bundledSetup();
    await make().download();
    failAssets();
    expect(await make().pageFont(300)).toBeNull();
  });
});

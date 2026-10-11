import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';

import { checkPageFont, qcfFamily } from './fontFile';
import type { OfflineDb } from './store';

/**
 * The 604 QCF V1 page fonts for the offline Mushaf, from Quran Foundation's
 * documented CDN (verses.quran.foundation/fonts/quran/hafs/v1/ttf/p{N}.ttf).
 * Under the Mushaf fonts terms they may be cached and kept inside the app
 * while the developer account is active, with credit to Quran Foundation;
 * they are never offered to anyone else. Page 61's font is bundled with the
 * app (qpcV1Fonts.ts) and is never downloaded.
 *
 *  - Each font is checked (fontFile.ts) against its page: the right font,
 *    whole, with a glyph for every code the page's verified layout uses;
 *    only then is it written (to a temporary name, then moved into place)
 *    and recorded with its size, SHA-256 and the server's ETag.
 *  - Resumable per font: recorded, present fonts are never downloaded again.
 *  - Corruption: a font whose size no longer matches its record, or (when
 *    loaded) whose SHA-256 doesn't, is deleted and downloaded again.
 *  - Updates: at most monthly, a conditional request per font (If-None-Match);
 *    a changed font is checked and replaced the same way.
 */

export const FONT_COUNT = 604;
/** Fonts that ship inside the app (never downloaded). */
export const BUNDLED_FONT_PAGES: ReadonlySet<number> = new Set([61]);
export const FONT_UPDATE_CHECK_MS = 30 * 24 * 60 * 60 * 1000;
/** Measured on the CDN (2026-10-11): 94.9 MB for all 604 TTF files, at most 177 KB each. */
export const FONT_BYTES_ESTIMATE = 160_000;
const CONCURRENCY = 4;

export const qcfFontUrl = (page: number) => `https://verses.quran.foundation/fonts/quran/hafs/v1/ttf/p${page}.ttf`;

export class FontSourceError extends Error {
  constructor(message: string, readonly kind: 'offline' | 'http') {
    super(message);
    this.name = 'FontSourceError';
  }
}

export type FontFetch =
  | { status: 'ok'; bytes: Uint8Array; etag: string | null; lastModified: string | null; contentLength: number | null }
  | { status: 'not-modified' };

export type FontSource = {
  fetch(page: number, conditional?: { etag: string | null; lastModified: string | null }): Promise<FontFetch>;
};

/** Where downloaded fonts live on the device (persistent storage). */
export type FontFiles = {
  read(page: number): Promise<Uint8Array | null>;
  size(page: number): number | null;
  /** Writes to a temporary name and moves it into place: never a half-written font. */
  write(page: number, bytes: Uint8Array): Promise<void>;
  remove(page: number): Promise<void>;
  removeAll(): Promise<void>;
  /** Leftover temporary files from an interrupted write. */
  cleanup(): Promise<void>;
  uri(page: number): string;
};

export type FontRecord = { page: number; bytes: number; sha256: string; etag: string | null; last_modified: string | null; verified_at: string; checked_at: string };

const hash = (bytes: Uint8Array) => bytesToHex(sha256(bytes));

export class FontDownloadError extends Error {
  constructor(message: string, readonly kind: 'offline' | 'integrity' | 'insufficient_storage' | 'cancelled' | 'storage') {
    super(message);
    this.name = 'FontDownloadError';
  }
}

export type FontProgress = { fontsTotal: number; fontsReady: number };

export function createFontStore(deps: { db: () => Promise<OfflineDb>; source: FontSource; files: FontFiles; now: () => Date }) {
  const records = async () => {
    const db = await deps.db();
    return new Map((await db.getAllAsync<FontRecord>('SELECT * FROM fonts')).map((row) => [row.page, row]));
  };

  /** The page's glyph codes, from the installed layout. */
  async function glyphsOf(page: number): Promise<string[]> {
    const db = await deps.db();
    return (await db.getAllAsync<{ glyph: string }>('SELECT glyph FROM words WHERE page = ?', page)).map((row) => row.glyph);
  }

  async function forget(page: number) {
    const db = await deps.db();
    await db.runAsync('DELETE FROM fonts WHERE page = ?', page);
    await deps.files.remove(page).catch(() => undefined);
  }

  /** Fonts that are recorded, present and the recorded size (cheap; the full SHA-256 check happens on load). */
  async function readyPages(): Promise<Set<number>> {
    const ready = new Set<number>(BUNDLED_FONT_PAGES);
    for (const [page, record] of await records()) {
      if (deps.files.size(page) === record.bytes) ready.add(page);
    }
    return ready;
  }

  /** Downloads, checks and stores one font (two attempts). */
  async function fetchAndStore(page: number, conditional?: { etag: string | null; lastModified: string | null }): Promise<'stored' | 'not-modified'> {
    const glyphs = await glyphsOf(page);
    if (glyphs.length === 0) throw new FontDownloadError(`Page ${page} has no installed layout to check its font against`, 'integrity');
    let problem = '';
    for (let attempt = 0; attempt < 2; attempt++) {
      let result: FontFetch;
      try {
        result = await deps.source.fetch(page, attempt === 0 ? conditional : undefined);
      } catch (error) {
        if (error instanceof FontSourceError && error.kind === 'offline') throw new FontDownloadError(error.message, 'offline');
        problem = (error as Error).message;
        continue;
      }
      if (result.status === 'not-modified') return 'not-modified';
      if (result.contentLength !== null && result.contentLength !== result.bytes.length) { problem = `page ${page}: incomplete font download`; continue; }
      const problems = checkPageFont(result.bytes, page, glyphs);
      if (problems.length > 0) { problem = `page ${page}: ${problems.join('; ')}`; continue; }
      try {
        await deps.files.write(page, result.bytes);
      } catch (error) {
        const message = (error as Error)?.message ?? '';
        throw new FontDownloadError(`Font ${page} could not be saved (${message})`, /space|full|disk/i.test(message) ? 'insufficient_storage' : 'storage');
      }
      const at = deps.now().toISOString();
      const db = await deps.db();
      await db.runAsync(
        'INSERT INTO fonts (page, bytes, sha256, etag, last_modified, verified_at, checked_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(page) DO UPDATE SET bytes = excluded.bytes, sha256 = excluded.sha256, etag = excluded.etag, last_modified = excluded.last_modified, verified_at = excluded.verified_at, checked_at = excluded.checked_at',
        page, result.bytes.length, hash(result.bytes), result.etag, result.lastModified, at, at,
      );
      return 'stored';
    }
    throw new FontDownloadError(`A font could not be verified: ${problem}`, 'integrity');
  }

  /** Runs `work` over `pages`, CONCURRENCY at a time, stopping at the first error or cancel. */
  async function pool(pages: number[], work: (page: number) => Promise<void>, signal?: AbortSignal) {
    let next = 0;
    let failure: unknown = null;
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, pages.length) }, async () => {
      while (failure === null && next < pages.length) {
        if (signal?.aborted) { failure ??= new FontDownloadError('The download was cancelled', 'cancelled'); break; }
        const page = pages[next++];
        try {
          await work(page);
        } catch (error) {
          failure ??= error;
        }
      }
    }));
    if (failure) throw failure;
  }

  return {
    readyPages,

    async status(): Promise<{ ready: number; total: number; bytes: number }> {
      const ready = await readyPages();
      const all = await records();
      return { ready: ready.size, total: FONT_COUNT, bytes: [...all.values()].filter((r) => ready.has(r.page)).reduce((sum, r) => sum + r.bytes, 0) };
    },

    /**
     * Downloads every font not yet stored and verified. `pagesToRecheck`:
     * pages whose layout just changed; their stored font is checked against
     * the new glyph codes and replaced if it no longer covers them.
     */
    async downloadMissing(options: { signal?: AbortSignal; onProgress?: (progress: FontProgress) => void; freeBytes: () => number | null; pagesToRecheck?: readonly number[] }) {
      await deps.files.cleanup().catch(() => undefined);
      for (const page of options.pagesToRecheck ?? []) {
        if (BUNDLED_FONT_PAGES.has(page)) continue;
        const bytes = await deps.files.read(page).catch(() => null);
        if (bytes && checkPageFont(bytes, page, await glyphsOf(page)).length > 0) await forget(page);
      }
      const all = await records();
      // A recorded font that is missing or the wrong size is forgotten (and downloaded again).
      for (const [page, record] of all) if (deps.files.size(page) !== record.bytes) await forget(page);
      const ready = await readyPages();
      const missing = Array.from({ length: FONT_COUNT }, (_, i) => i + 1).filter((page) => !ready.has(page));
      const report = () => options.onProgress?.({ fontsTotal: FONT_COUNT, fontsReady: FONT_COUNT - missing.length + done });
      let done = 0;
      report();
      if (missing.length === 0) return { downloaded: 0 };
      const free = options.freeBytes();
      const required = missing.length * FONT_BYTES_ESTIMATE * 2 + 20 * 1024 * 1024;
      if (free !== null && free < required) throw new FontDownloadError(`Not enough free storage for the page fonts: about ${Math.ceil(required / 1048576)} MB needed`, 'insufficient_storage');
      await pool(missing, async (page) => {
        await fetchAndStore(page);
        done++;
        report();
      }, options.signal);
      return { downloaded: missing.length };
    },

    /** At most monthly: ask the CDN whether each stored font changed (ETag), and replace changed ones. */
    async checkForUpdates(options: { force?: boolean; signal?: AbortSignal } = {}): Promise<{ checked: number; replaced: number } | 'not-due'> {
      const all = [...(await records()).values()];
      if (all.length === 0) return { checked: 0, replaced: 0 };
      const oldest = Math.min(...all.map((r) => Date.parse(r.checked_at)));
      if (!options.force && deps.now().getTime() - oldest < FONT_UPDATE_CHECK_MS) return 'not-due';
      let replaced = 0;
      await pool(all.map((r) => r.page), async (page) => {
        const record = all.find((r) => r.page === page)!;
        const outcome = await fetchAndStore(page, { etag: record.etag, lastModified: record.last_modified });
        if (outcome === 'stored') replaced++;
        else await (await deps.db()).runAsync('UPDATE fonts SET checked_at = ? WHERE page = ?', deps.now().toISOString(), page);
      }, options.signal);
      return { checked: all.length, replaced };
    },

    /**
     * The page's font, ready to register with expo-font: the bundled one
     * for page 61, otherwise the stored file after a full SHA-256 check.
     * A damaged file is deleted (the next download repairs it): null.
     */
    async pageFont(page: number): Promise<{ family: string; uri: string } | 'bundled' | null> {
      if (BUNDLED_FONT_PAGES.has(page)) return 'bundled';
      const record = (await records()).get(page);
      if (!record) return null;
      const bytes = await deps.files.read(page).catch(() => null);
      if (!bytes || bytes.length !== record.bytes || hash(bytes) !== record.sha256) {
        await forget(page);
        return null;
      }
      return { family: qcfFamily(page), uri: deps.files.uri(page) };
    },

    /** Full SHA-256 check of every stored font; damaged ones are deleted. */
    async verifyAll(): Promise<{ checked: number; damaged: number[] }> {
      const damaged: number[] = [];
      const all = await records();
      for (const [page, record] of all) {
        const bytes = await deps.files.read(page).catch(() => null);
        if (!bytes || bytes.length !== record.bytes || hash(bytes) !== record.sha256) {
          damaged.push(page);
          await forget(page);
        }
      }
      return { checked: all.size, damaged };
    },

    async removeAll() {
      const db = await deps.db();
      await db.runAsync('DELETE FROM fonts');
      await deps.files.removeAll();
    },
  };
}

export type FontStore = ReturnType<typeof createFontStore>;

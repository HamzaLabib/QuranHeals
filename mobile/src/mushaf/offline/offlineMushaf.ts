import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';

import type { QuranVerse } from '@/services/quranRepository';

import type { QpcV1PageLayout, QpcV1Word } from '../qpcV1Layout';
import { OfflineDatasetError, parseChunk, parseManifest, validateOfflinePages, type ChunkPage, type ManifestChunk, type OfflineChunk, type OfflineManifest } from './dataset';
import { createFontStore, FontDownloadError, FONT_BYTES_ESTIMATE, type FontFiles, type FontSource } from './fonts';
import { RelayError, type OfflineRelay } from './relayTypes';
import {
  checkIntegrity,
  dropStagedChunks,
  initSchema,
  installedChunks,
  installVersion,
  readInstalledPages,
  readMeta,
  readPageWords,
  readStagedChunk,
  resetStore,
  setMeta,
  stageChunk,
  stagedChunkHashes,
  type OfflineDb,
} from './store';

/**
 * Download, verification, installation and synchronisation of the offline
 * QPC V1 Mushaf (all 604 pages), through our backend's Content Sync relay.
 *
 *  - Download is started by autoDownload.ts (after the app opens, or from
 *    the reader's Download button), never by itself here. It resumes: every verified chunk
 *    is staged in SQLite at once, so a cancelled or interrupted download
 *    (even across restarts) continues with what is missing, and a chunk that
 *    hasn't changed since the installed version is never downloaded again.
 *  - Every chunk must match its SHA-256 from the manifest, and the whole
 *    Mushaf must pass validation against the verified local Quran before it
 *    replaces anything, in one transaction. A failure at any step leaves the
 *    installed version exactly as it was.
 *  - Sync (Quran Foundation's Content Sync terms, relayed by our backend):
 *    when online, check at least daily (`UPDATE_CHECK_MS`, inside the 7-day
 *    rule) and apply any new version the same way. Offline, the installed
 *    copy stays readable however long the device is offline; nothing here
 *    expires it. Reading never needs a signed-in session.
 *
 * Page fonts are separate (not downloaded here).
 */

export const UPDATE_CHECK_MS = 24 * 60 * 60 * 1000;
/** Headroom for SQLite's journal and indexes on top of the data itself. */
const SPACE_FACTOR = 4;
const SPACE_MARGIN = 20 * 1024 * 1024;

export type OfflineErrorKind = 'offline' | 'unavailable' | 'insufficient_storage' | 'integrity' | 'cancelled' | 'busy' | 'storage';
export class OfflineMushafError extends Error {
  constructor(message: string, readonly kind: OfflineErrorKind) {
    super(message);
    this.name = 'OfflineMushafError';
  }
}

/** Page fonts (when fonts are part of the offline Mushaf): how many of the 604 are stored and verified. */
export type FontStatus = { ready: number; total: number; bytes: number };

export type OfflineStatus =
  | { installed: false; stagedChunks: number; fonts?: FontStatus; complete?: false }
  | { installed: true; version: string; syncedAt: string; installedAt: string; lastCheckAt: string; attribution: string; stagedChunks: number; fonts?: FontStatus;
      /** Layout installed and all 604 page fonts verified: readable offline. Only reported when fonts are managed. */
      complete?: boolean };

export type DownloadProgress = {
  phase: 'checking' | 'downloading' | 'verifying' | 'installing' | 'fonts' | 'done';
  /** Chunks still needed for this version, and how many of them are ready (verified and staged). */
  chunksTotal: number;
  chunksReady: number;
  bytesTotal: number;
  bytesReady: number;
  /** Page fonts (fonts phase): all 604, and how many are stored and verified. */
  fontsTotal?: number;
  fontsReady?: number;
};

export type DownloadResult = { status: 'installed' | 'up-to-date'; version: string; downloadedChunks: number; reusedChunks: number; fontsDownloaded?: number };

export type OfflineMushafDeps = {
  openDb: () => Promise<OfflineDb>;
  relay: OfflineRelay;
  /** The verified local Quran (6,236 verses in canonical order). */
  verses: () => Promise<QuranVerse[]>;
  /** Free bytes on the device, or null when unknown. */
  freeBytes: () => number | null;
  now?: () => Date;
  /** The QCF V1 page fonts (fonts.ts). Without it only the layout is managed. */
  fonts?: { source: FontSource; files: FontFiles };
};

export function createOfflineMushaf(deps: OfflineMushafDeps) {
  const now = deps.now ?? (() => new Date());
  let dbPromise: Promise<OfflineDb> | null = null;
  let busy: Promise<unknown> | null = null;

  /** Opens the store once; a damaged store is reset (and must be downloaded again), never read. */
  function db(): Promise<OfflineDb> {
    dbPromise ??= (async () => {
      const opened = await deps.openDb();
      await initSchema(opened);
      if ((await checkIntegrity(opened)) === 'corrupt') {
        await resetStore(opened);
        // The font records went with it; their files are removed too (downloaded again).
        await deps.fonts?.files.removeAll().catch(() => undefined);
      }
      return opened;
    })().catch((error) => {
      dbPromise = null;
      throw new OfflineMushafError(`The offline Mushaf storage could not be opened (${(error as Error)?.message ?? 'unknown'})`, 'storage');
    });
    return dbPromise;
  }

  const fontStore = deps.fonts ? createFontStore({ db, source: deps.fonts.source, files: deps.fonts.files, now }) : null;

  const exclusive = <T>(work: () => Promise<T>): Promise<T> => {
    if (busy) return Promise.reject(new OfflineMushafError('A download is already in progress', 'busy'));
    const run = work().finally(() => { busy = null; });
    busy = run;
    return run;
  };

  async function fetchManifest(): Promise<OfflineManifest> {
    try {
      return parseManifest(await deps.relay.manifest());
    } catch (error) {
      if (error instanceof RelayError) throw new OfflineMushafError(error.message, error.kind === 'unavailable' ? 'unavailable' : 'offline');
      if (error instanceof OfflineDatasetError) throw new OfflineMushafError(error.message, 'integrity');
      throw error;
    }
  }

  /** Downloads one chunk and checks it is exactly the manifest's (two attempts). */
  async function fetchVerifiedChunk(manifest: OfflineManifest, chunk: ManifestChunk): Promise<string> {
    let lastProblem = '';
    for (let attempt = 0; attempt < 2; attempt++) {
      let text: string;
      try {
        text = await deps.relay.chunk(manifest.version, chunk.index);
      } catch (error) {
        if (error instanceof RelayError) throw new OfflineMushafError(error.message, error.kind === 'unavailable' ? 'unavailable' : 'offline');
        throw error;
      }
      if (bytesToHex(sha256(utf8ToBytes(text))) !== chunk.sha256) { lastProblem = `chunk ${chunk.index} failed its SHA-256 check`; continue; }
      try {
        parseChunk(text, chunk);
        return text;
      } catch (error) {
        lastProblem = (error as Error).message;
      }
    }
    throw new OfflineMushafError(`The download was damaged: ${lastProblem}`, 'integrity');
  }

  /** Layout, then (when managed) the page fonts. A font failure never undoes an installed layout. */
  async function sync(onProgress: (progress: DownloadProgress) => void, signal?: AbortSignal): Promise<DownloadResult> {
    const layout = await syncLayout(onProgress, signal);
    if (!fontStore) return layout.result;
    const last = { ...layout.lastProgress };
    onProgress({ ...last, phase: 'fonts', fontsTotal: 604, fontsReady: 0 });
    try {
      const fonts = await fontStore.downloadMissing({
        signal,
        freeBytes: deps.freeBytes,
        pagesToRecheck: layout.replacedPages,
        onProgress: ({ fontsTotal, fontsReady }) => onProgress({ ...last, phase: fontsReady === fontsTotal ? 'done' : 'fonts', fontsTotal, fontsReady }),
      });
      return { ...layout.result, fontsDownloaded: fonts.downloaded };
    } catch (error) {
      if (error instanceof FontDownloadError) throw new OfflineMushafError(error.message, error.kind);
      throw error;
    }
  }

  async function syncLayout(onProgress: (progress: DownloadProgress) => void, signal?: AbortSignal): Promise<{ result: DownloadResult; replacedPages: number[]; lastProgress: DownloadProgress }> {
    const store = await db();
    const progress: DownloadProgress = { phase: 'checking', chunksTotal: 0, chunksReady: 0, bytesTotal: 0, bytesReady: 0 };
    const report = (patch: Partial<DownloadProgress>) => {
      Object.assign(progress, patch);
      // With fonts to follow, the layout's 'done' is not the end of the download.
      onProgress({ ...progress, phase: progress.phase === 'done' && fontStore ? 'fonts' : progress.phase });
    };
    const checkCancel = () => { if (signal?.aborted) throw new OfflineMushafError('The download was cancelled', 'cancelled'); };
    report({});

    const manifest = await fetchManifest();
    const meta = await readMeta(store);
    const at = () => now().toISOString();
    if (meta.version === manifest.version && (await checkIntegrity(store)) === 'ready') {
      await setMeta(store, { last_check_at: at(), synced_at: manifest.syncedAt });
      report({ phase: 'done' });
      return { result: { status: 'up-to-date', version: manifest.version, downloadedChunks: 0, reusedChunks: 31 }, replacedPages: [], lastProgress: { ...progress } };
    }

    // What this version needs: chunks whose content differs from what is installed.
    const installed = meta.version ? await installedChunks(store) : new Map<number, string>();
    const needed = manifest.chunks.filter((chunk) => installed.get(chunk.index) !== chunk.sha256);
    const staged = await stagedChunkHashes(store);
    const toDownload = needed.filter((chunk) => !staged.has(chunk.sha256));
    const bytesTotal = needed.reduce((sum, chunk) => sum + chunk.bytes, 0);
    report({ phase: 'downloading', chunksTotal: needed.length, chunksReady: needed.length - toDownload.length, bytesTotal, bytesReady: bytesTotal - toDownload.reduce((sum, chunk) => sum + chunk.bytes, 0) });

    const free = deps.freeBytes();
    // The fonts' space is checked again before they download; this keeps a first download from starting hopelessly.
    const fontsAhead = fontStore && !meta.version ? (604 - (await fontStore.readyPages()).size) * FONT_BYTES_ESTIMATE : 0;
    const required = bytesTotal * SPACE_FACTOR + fontsAhead + SPACE_MARGIN;
    if (free !== null && free < required) {
      throw new OfflineMushafError(`Not enough free storage: about ${Math.ceil(required / 1048576)} MB needed`, 'insufficient_storage');
    }

    for (const chunk of toDownload) {
      checkCancel();
      const text = await fetchVerifiedChunk(manifest, chunk);
      try {
        await stageChunk(store, chunk, text, at());
      } catch (error) {
        throw storageError(error);
      }
      report({ chunksReady: progress.chunksReady + 1, bytesReady: progress.bytesReady + chunk.bytes });
    }
    checkCancel();

    // The whole Mushaf, new chunks and unchanged installed pages, must validate before anything changes.
    report({ phase: 'verifying' });
    const replaced: OfflineChunk[] = [];
    const pages: ChunkPage[] = [];
    for (const chunk of manifest.chunks) {
      if (needed.includes(chunk)) {
        const text = await readStagedChunk(store, chunk.sha256);
        if (text === null || bytesToHex(sha256(utf8ToBytes(text))) !== chunk.sha256) {
          await dropStagedChunks(store, new Set([...staged].filter((sha) => sha !== chunk.sha256)));
          throw new OfflineMushafError(`Staged chunk ${chunk.index} was damaged; it will be downloaded again`, 'integrity');
        }
        const parsed = parseChunk(text, chunk);
        replaced.push(parsed);
        pages.push(...parsed.pages);
      } else {
        pages.push(...(await readInstalledPages(store, chunk.firstPage, chunk.lastPage)));
      }
    }
    const verses = await deps.verses();
    const problems = validateOfflinePages(pages, verses);
    if (problems.length > 0) {
      // Verified downloads that don't add up to a valid Mushaf are discarded; the installed version stays.
      await dropStagedChunks(store);
      throw new OfflineMushafError(`The offline Mushaf failed validation: ${problems.join('; ')}`, 'integrity');
    }
    checkCancel();

    report({ phase: 'installing' });
    try {
      await installVersion(store, { manifest, replaced, verses, wordCount: pages.reduce((sum, page) => sum + page.words.length, 0), at: at() });
    } catch (error) {
      throw storageError(error);
    }
    // Leftovers from other versions are no longer useful.
    await dropStagedChunks(store);
    report({ phase: 'done' });
    const replacedPages = meta.version ? replaced.flatMap((chunk) => chunk.pages.map((page) => page.page)) : [];
    return { result: { status: 'installed', version: manifest.version, downloadedChunks: toDownload.length, reusedChunks: 31 - needed.length }, replacedPages, lastProgress: { ...progress } };
  }

  const storageError = (error: unknown) => {
    const message = (error as Error)?.message ?? '';
    return /full|SQLITE_FULL|disk|space/i.test(message)
      ? new OfflineMushafError('Not enough free storage to save the offline Mushaf', 'insufficient_storage')
      : new OfflineMushafError(`The offline Mushaf could not be saved (${message})`, 'storage');
  };

  async function status(): Promise<OfflineStatus> {
    const store = await db();
    const staged = (await stagedChunkHashes(store)).size;
    const fonts = fontStore ? await fontStore.status() : undefined;
    if ((await checkIntegrity(store)) !== 'ready') return fonts ? { installed: false, stagedChunks: staged, fonts, complete: false } : { installed: false, stagedChunks: staged };
    const meta = await readMeta(store);
    const base = { installed: true as const, version: meta.version!, syncedAt: meta.synced_at!, installedAt: meta.installed_at!, lastCheckAt: meta.last_check_at!, attribution: meta.attribution ?? '', stagedChunks: staged };
    return fonts ? { ...base, fonts, complete: fonts.ready === fonts.total } : base;
  }

  /** Download (or update to) the current version: resumable, cancellable, verified, atomic. */
  function download(options: { signal?: AbortSignal; onProgress?: (progress: DownloadProgress) => void } = {}) {
    return exclusive(() => sync(options.onProgress ?? (() => undefined), options.signal));
  }

  return {
    status,
    download,

    /**
     * When online and due (at least daily), check for a new version and
     * install it. Never throws for being offline and never removes the
     * installed copy; returns what happened.
     */
    async checkForUpdate(options: { force?: boolean; signal?: AbortSignal } = {}): Promise<'not-installed' | 'not-due' | 'up-to-date' | 'updated' | 'offline' | 'failed'> {
      const current = await status().catch(() => null);
      if (!current?.installed) return 'not-installed';
      if (!options.force && now().getTime() - Date.parse(current.lastCheckAt) < UPDATE_CHECK_MS) return 'not-due';
      try {
        const result = await download({ signal: options.signal });
        // Fonts: at most monthly, ask whether any stored font was corrected.
        const fonts = fontStore ? await fontStore.checkForUpdates({ signal: options.signal }).catch(() => null) : null;
        const fontsReplaced = fonts !== null && fonts !== 'not-due' && fonts.replaced > 0;
        return result.status === 'installed' || (result.fontsDownloaded ?? 0) > 0 || fontsReplaced ? 'updated' : 'up-to-date';
      } catch (error) {
        if (error instanceof OfflineMushafError && (error.kind === 'offline' || error.kind === 'unavailable' || error.kind === 'busy')) return 'offline';
        return 'failed';
      }
    },

    /** One page from the installed version, as the renderer's layout, or null when not installed. */
    async readPage(page: number): Promise<QpcV1PageLayout | null> {
      if (!Number.isInteger(page) || page < 1 || page > 604) return null;
      const store = await db();
      const meta = await readMeta(store);
      if (!meta.version) return null;
      const words = await readPageWords(store, page);
      if (words.length === 0) return null;
      const lines: QpcV1PageLayout['lines'] = [];
      const verseKeys: string[] = [];
      for (const word of words) {
        const verseKey = `${word.surah}:${word.ayah}`;
        if (verseKeys[verseKeys.length - 1] !== verseKey) verseKeys.push(verseKey);
        if (lines.length === 0 || lines[lines.length - 1].line !== word.line) lines.push({ line: word.line, words: [] });
        const kind: QpcV1Word['kind'] = word.kind === 'word' ? 'word' : word.kind === 'end' ? 'end' : 'mark';
        lines[lines.length - 1].words.push({ verseKey, position: word.positionInVerse, kind, glyph: word.glyph });
      }
      return {
        page,
        edition: 'qpc-v1',
        fontFamily: `QCF_P${String(page).padStart(3, '0')}`,
        lines,
        verseKeys,
        fetchedAt: meta.synced_at ?? '',
        // A Content Sync copy does not expire offline; this field only applies to the short-lived API copy.
        keepUntil: '9999-12-31T23:59:59.999Z',
      };
    },

    /** Removes the offline Mushaf (layout and page fonts) and any partial download. */
    async remove() {
      await exclusive(async () => {
        await resetStore(await db());
        await deps.fonts?.files.removeAll();
      });
    },

    /** A page's font for the renderer: 'bundled' (page 61), a verified stored file, or null (not available offline). */
    async pageFont(page: number) {
      return fontStore ? fontStore.pageFont(page) : null;
    },

    /** Full SHA-256 check of every stored font; damaged ones are deleted and downloaded again next time. */
    async verifyFonts() {
      return fontStore ? fontStore.verifyAll() : { checked: 0, damaged: [] as number[] };
    },
  };
}

export type OfflineMushaf = ReturnType<typeof createOfflineMushaf>;

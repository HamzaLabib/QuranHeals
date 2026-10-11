import { Directory, File, Paths } from 'expo-file-system';

import { getAllVerses } from '@/services/quran';

import { FontSourceError, qcfFontUrl, type FontFiles, type FontSource } from './fonts';
import { createOfflineMushaf } from './offlineMushaf';
import { offlineRelay } from './relay';
import { OFFLINE_DB_NAME, type OfflineDb } from './store';

export { OfflineMushafError, type DownloadProgress, type OfflineStatus } from './offlineMushaf';

const FONT_TIMEOUT_MS = 30_000;

/** QCF V1 page fonts straight from Quran Foundation's documented CDN (conditional requests via ETag). */
const fontSource: FontSource = {
  async fetch(page, conditional) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FONT_TIMEOUT_MS);
    try {
      const headers: Record<string, string> = {};
      if (conditional?.etag) headers['If-None-Match'] = conditional.etag;
      if (conditional?.lastModified) headers['If-Modified-Since'] = conditional.lastModified;
      let response: Response;
      try {
        response = await fetch(qcfFontUrl(page), { headers, signal: controller.signal });
      } catch {
        throw new FontSourceError('The font server could not be reached', 'offline');
      }
      if (response.status === 304) return { status: 'not-modified' };
      if (!response.ok) throw new FontSourceError(`The font server answered ${response.status}`, 'http');
      let bytes: Uint8Array;
      try {
        bytes = new Uint8Array(await response.arrayBuffer());
      } catch {
        throw new FontSourceError('The font download was interrupted', 'offline');
      }
      const length = Number(response.headers.get('content-length'));
      return {
        status: 'ok',
        bytes,
        etag: response.headers.get('etag'),
        lastModified: response.headers.get('last-modified'),
        // Only trusted when the body wasn't re-encoded on the way (fonts are served as-is).
        contentLength: Number.isFinite(length) && length > 0 && !response.headers.get('content-encoding') ? length : null,
      };
    } finally {
      clearTimeout(timer);
    }
  },
};

/** Persistent storage for the fonts: <documents>/mushaf/qpc-v1/fonts/p{N}.ttf. */
const fontsDir = () => new Directory(Paths.document, 'mushaf', 'qpc-v1', 'fonts');
const fontFile = (page: number) => new File(fontsDir(), `p${page}.ttf`);
const fontFiles: FontFiles = {
  async read(page) {
    const file = fontFile(page);
    return file.exists ? file.bytes() : null;
  },
  size(page) {
    const file = fontFile(page);
    return file.exists ? file.size : null;
  },
  async write(page, bytes) {
    const dir = fontsDir();
    if (!dir.exists) dir.create({ intermediates: true });
    const part = new File(dir, `p${page}.ttf.part`);
    if (part.exists) part.delete();
    part.create();
    part.write(bytes);
    await part.move(fontFile(page), { overwrite: true });
  },
  async remove(page) {
    const file = fontFile(page);
    if (file.exists) file.delete();
  },
  async removeAll() {
    const dir = fontsDir();
    if (dir.exists) dir.delete();
  },
  async cleanup() {
    const dir = fontsDir();
    if (!dir.exists) return;
    for (const entry of dir.list()) if (entry instanceof File && entry.name.endsWith('.part')) entry.delete();
  },
  uri: (page) => fontFile(page).uri,
};

/** The app's offline QPC V1 Mushaf: layout (Content Sync relay) and page fonts (see offlineMushaf.ts, fonts.ts). */
export const offlineMushaf = createOfflineMushaf({
  // Imported on first use, as services/quranAsset.ts does: a static import breaks the web bundle's SQLite worker.
  openDb: async () => {
    const { openDatabaseAsync } = await import('expo-sqlite');
    return (await openDatabaseAsync(OFFLINE_DB_NAME)) as unknown as OfflineDb;
  },
  relay: offlineRelay,
  verses: getAllVerses,
  freeBytes: () => {
    try {
      const free = Paths.availableDiskSpace;
      return Number.isFinite(free) && free > 0 ? free : null;
    } catch {
      return null;
    }
  },
  fonts: { source: fontSource, files: fontFiles },
});

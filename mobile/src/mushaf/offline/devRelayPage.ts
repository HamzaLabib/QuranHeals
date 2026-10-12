import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';

import type { QpcV1PageLayout, QpcV1Word } from '../qpcV1Layout';
import { getAllVerses } from '@/services/quran';

import { parseChunk, parseManifest } from './dataset';
import { offlineRelay } from './relay';

/**
 * Development builds only (the reader's ?source=online): one page of the
 * offline Mushaf, read straight from our backend's Content Sync relay without
 * installing anything — so pages 1–2 and Surah openings can be checked where
 * the offline store is unavailable (a browser). The chunk is verified exactly
 * as a download is (SHA-256 against the manifest, then parseChunk), held in
 * memory only, and converted the way offlineMushaf.readPage converts stored
 * words. Never used in release builds.
 */
export async function readRelayPageForDev(page: number): Promise<QpcV1PageLayout | null> {
  const manifest = parseManifest(await offlineRelay.manifest());
  const chunk = manifest.chunks.find((entry) => page >= entry.firstPage && page <= entry.lastPage);
  if (!chunk) return null;
  const text = await offlineRelay.chunk(manifest.version, chunk.index);
  if (bytesToHex(sha256(utf8ToBytes(text))) !== chunk.sha256) return null;
  const data = parseChunk(text, chunk).pages.find((entry) => entry.page === page);
  if (!data) return null;
  const verses = await getAllVerses();
  const lines: QpcV1PageLayout['lines'] = [];
  const verseKeys: string[] = [];
  for (const [line, verseId, positionInVerse, type, glyph] of data.words) {
    const verse = verses[verseId - 1];
    if (!verse) return null;
    const verseKey = `${verse.surah}:${verse.ayah}`;
    if (verseKeys[verseKeys.length - 1] !== verseKey) verseKeys.push(verseKey);
    if (lines.length === 0 || lines[lines.length - 1].line !== line) lines.push({ line, words: [] });
    const kind: QpcV1Word['kind'] = type === 'word' ? 'word' : type === 'end' ? 'end' : 'mark';
    lines[lines.length - 1].words.push({ verseKey, position: positionInVerse, kind, glyph });
  }
  return {
    page,
    edition: 'qpc-v1',
    fontFamily: `QCF_P${String(page).padStart(3, '0')}`,
    lines,
    verseKeys,
    fetchedAt: manifest.syncedAt ?? '',
    keepUntil: '9999-12-31T23:59:59.999Z',
  };
}

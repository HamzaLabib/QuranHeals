/**
 * The offline QPC V1 Mushaf as the app receives it from our backend's relay
 * (backend/src/mushaf/offline): Quran Foundation's mushafs:2 Content Sync
 * resource (QCF V1, King Fahd Complex 1405 AH print), in 31 content-addressed
 * chunks of 20 pages. Pure parsing and validation; no storage, no network.
 *
 * Each word is [line, verseId, positionInVerse, type, glyph], in page order
 * (Quran Foundation's position_in_page). `verseId` is the global ayah index
 * (1 = 1:1 … 6236 = 114:6), mapped to `surah:ayah` with the verified local
 * Quran, never trusted on its own.
 */

import type { QuranVerse } from '@/services/quranRepository';

export const OFFLINE_SCHEMA = 1;
export const PAGE_COUNT = 604;
export const LINES_PER_PAGE = 15;
export const VERSE_COUNT = 6236;
export const CHUNK_COUNT = 31;
export const PAGES_PER_CHUNK = 20;

export type ManifestChunk = { index: number; firstPage: number; lastPage: number; sha256: string; bytes: number };
export type OfflineManifest = {
  schema: number;
  edition: 'qpc-v1';
  version: string;
  mushaf: { id: number; name: string; description: string; pagesCount: number; linesPerPage: number; defaultFontName: string };
  verses: number;
  words: number;
  source: { provider: string; resource: string; snapshotSequence: number; appliedSequence: number };
  publishedAt: string;
  syncedAt: string;
  attribution: string;
  chunks: ManifestChunk[];
  totalBytes: number;
};

export type WordType = 'word' | 'end' | 'pause' | 'sajdah' | 'rub-el-hizb';
export type ChunkWord = [line: number, verseId: number, positionInVerse: number, type: WordType, glyph: string];
export type ChunkPage = { page: number; firstVerseId: number; lastVerseId: number; words: ChunkWord[] };
export type OfflineChunk = { schema: number; index: number; firstPage: number; lastPage: number; pages: ChunkPage[] };

export class OfflineDatasetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OfflineDatasetError';
  }
}

const isInt = (value: unknown, min: number, max: number): value is number => typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;
const TYPES: readonly string[] = ['word', 'end', 'pause', 'sajdah', 'rub-el-hizb'];

/** Checks a manifest's shape: the exact 31 chunks covering pages 1–604. */
export function parseManifest(value: unknown): OfflineManifest {
  const m = value as OfflineManifest;
  if (!m || m.schema !== OFFLINE_SCHEMA || m.edition !== 'qpc-v1' || typeof m.version !== 'string' || !/^[0-9a-f]{24}$/.test(m.version)) throw new OfflineDatasetError('Unsupported offline Mushaf manifest');
  if (m.mushaf?.id !== 2 || m.mushaf.pagesCount !== PAGE_COUNT || m.mushaf.linesPerPage !== LINES_PER_PAGE || m.verses !== VERSE_COUNT) throw new OfflineDatasetError('The manifest is not the 604-page QPC V1 Mushaf');
  if (!Array.isArray(m.chunks) || m.chunks.length !== CHUNK_COUNT) throw new OfflineDatasetError('The manifest does not list 31 chunks');
  m.chunks.forEach((chunk, index) => {
    const first = index * PAGES_PER_CHUNK + 1;
    if (chunk.index !== index || chunk.firstPage !== first || chunk.lastPage !== Math.min(PAGE_COUNT, first + PAGES_PER_CHUNK - 1)) throw new OfflineDatasetError(`Manifest chunk ${index} has the wrong pages`);
    if (typeof chunk.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(chunk.sha256) || !isInt(chunk.bytes, 1, 5_000_000)) throw new OfflineDatasetError(`Manifest chunk ${index} is malformed`);
  });
  if (typeof m.attribution !== 'string' || !/Quran Foundation/.test(m.attribution)) throw new OfflineDatasetError('The manifest has no Quran Foundation attribution');
  return m;
}

/** Parses one downloaded chunk (already SHA-256-verified) and checks it is the chunk the manifest names. */
export function parseChunk(text: string, expected: ManifestChunk): OfflineChunk {
  let value: OfflineChunk;
  try {
    value = JSON.parse(text) as OfflineChunk;
  } catch {
    throw new OfflineDatasetError(`Chunk ${expected.index} is not valid JSON`);
  }
  if (!value || value.schema !== OFFLINE_SCHEMA || value.index !== expected.index || value.firstPage !== expected.firstPage || value.lastPage !== expected.lastPage) throw new OfflineDatasetError(`Chunk ${expected.index} is not the expected chunk`);
  if (!Array.isArray(value.pages) || value.pages.length !== expected.lastPage - expected.firstPage + 1) throw new OfflineDatasetError(`Chunk ${expected.index} has the wrong number of pages`);
  value.pages.forEach((page, i) => {
    if (page?.page !== expected.firstPage + i || !Array.isArray(page.words) || page.words.length === 0) throw new OfflineDatasetError(`Chunk ${expected.index}: page ${expected.firstPage + i} is malformed`);
    for (const word of page.words) {
      if (!Array.isArray(word) || word.length !== 5 || !isInt(word[0], 1, LINES_PER_PAGE) || !isInt(word[1], 1, VERSE_COUNT) || !isInt(word[2], 1, 2000)
        || !TYPES.includes(word[3]) || typeof word[4] !== 'string' || word[4].length === 0 || word[4].length > 4) {
        throw new OfflineDatasetError(`Chunk ${expected.index}: page ${page.page} has a malformed word`);
      }
    }
  });
  return value;
}

// ── Validation against the verified local Quran ──────────────────────────

/** Standalone pause marks are separate tokens in Tanzil but not words (as in checkAgainstTanzil). */
const PAUSE_MARK = /^[ۖ-ۜ۞۩]+$/;
const tokens = (text: string) => text.trim().split(/\s+/).filter((token) => !PAUSE_MARK.test(token));
const SHADDA = 'ّ';

/**
 * Ayahs where the QCF V1 layout counts two Tanzil tokens as one word, as
 * the King Fahd print sets them (the same list as the backend's
 * JOINED_WORDS): the layout must have exactly one word fewer.
 */
export const JOINED_WORDS: Readonly<Record<string, readonly [string, string]>> = {
  '2:181': ['بَعْدَ', 'مَا'],
  '8:6': ['بَعْدَ', 'مَا'],
  '13:37': ['بَعْدَ', 'مَا'],
  '37:130': ['إِلْ', 'يَاسِينَ'],
};

/**
 * Words the Mushaf layout must have for an ayah: the Tanzil tokens, less
 * the basmala Tanzil puts at the start of the first ayah of 112 surahs (the
 * print sets it on its own line; matched exactly against 1:1, or with the
 * shadda of بِّسْمِ as in 95:1 and 97:1), less one for a documented joined pair.
 */
export function expectedMushafWords(verse: QuranVerse, basmala: readonly string[]): number {
  const own = tokens(verse.arabicText);
  const variants = [basmala, [basmala[0].slice(0, 1) + SHADDA + basmala[0].slice(1), ...basmala.slice(1)]];
  const prefixed = verse.ayah === 1 && verse.surah !== 1 && verse.surah !== 9 && variants.some((variant) => variant.every((token, i) => own[i] === token));
  let words = prefixed ? own.length - basmala.length : own.length;
  const pair = JOINED_WORDS[verse.verseKey];
  if (pair && own.some((token, i) => token === pair[0] && own[i + 1] === pair[1])) words -= 1;
  return words;
}

/**
 * The whole Mushaf must be exactly right before it replaces anything: 604
 * pages in order, every line 1–15 and never going back, all 6,236 ayahs in
 * reading order with positions 1…n, one marker each as the last word, and
 * as many words as the verified Tanzil text. Returns the first problems.
 */
export function validateOfflinePages(pages: readonly ChunkPage[], verses: readonly QuranVerse[]): string[] {
  const problems: string[] = [];
  const add = (message: string) => { if (problems.length < 20) problems.push(message); };
  if (verses.length !== VERSE_COUNT) return ['The local Quran is incomplete'];
  if (pages.length !== PAGE_COUNT || pages.some((page, i) => page.page !== i + 1)) add(`${pages.length} pages, not 1–${PAGE_COUNT} in order`);
  const perVerse: { type: WordType; position: number }[][] = Array.from({ length: VERSE_COUNT + 1 }, () => []);
  let previousVerse = 0;
  for (const page of pages) {
    let previousLine = 0;
    for (const [line, verseId, position, type] of page.words) {
      if (line < previousLine) add(`page ${page.page}: lines go backwards`);
      if (verseId < previousVerse) add(`page ${page.page}: ayahs go backwards`);
      previousLine = line;
      previousVerse = verseId;
      perVerse[verseId].push({ type, position });
    }
    if (page.firstVerseId !== page.words[0][1] || page.lastVerseId !== page.words[page.words.length - 1][1]) add(`page ${page.page}: its ayah range disagrees with its words`);
  }
  const basmala = tokens(verses[0].arabicText);
  for (let id = 1; id <= VERSE_COUNT; id++) {
    const verse = verses[id - 1];
    const own = perVerse[id];
    if (own.length === 0) { add(`${verse.verseKey} is missing`); continue; }
    if (own.some((word, i) => word.position !== i + 1)) add(`${verse.verseKey}: word positions are not 1…n`);
    if (own.filter((word) => word.type === 'end').length !== 1 || own[own.length - 1].type !== 'end') add(`${verse.verseKey}: ayah marker missing or misplaced`);
    const words = own.filter((word) => word.type === 'word').length;
    const expected = expectedMushafWords(verse, basmala);
    if (words !== expected) add(`${verse.verseKey}: ${words} words, the verified text has ${expected}`);
  }
  return problems;
}

import { createHash } from 'node:crypto';

/**
 * The offline QPC V1 Mushaf dataset: Quran Foundation's `mushafs:2` Content
 * Sync resource (QCF V1, King Fahd Complex 1405 AH print), kept as its raw
 * records, changed only by Content Sync mutations, and compiled into the
 * compact, validated form the app downloads.
 *
 * Words are ordered by `position_in_page`, never `position_in_line` (which
 * starts some lines with the line's last number). `verse_id` is the global
 * ayah index (1 = 1:1 … 6236 = 114:6); it is mapped to `surah:ayah` with
 * the canonical surah counts and checked against the verified Tanzil text.
 */

export const MUSHAF_RESOURCE = { group: 'mushafs', id: 2 } as const;
export const PAGE_COUNT = 604;
export const LINES_PER_PAGE = 15;
export const VERSE_COUNT = 6236;
export const DATASET_SCHEMA = 1;
/** Pages per downloadable chunk (31 chunks; the last holds 4 pages). */
export const PAGES_PER_CHUNK = 20;

/** Quran Foundation word types; pause, sajdah and rub-el-hizb symbols are marks, not words. */
export const WORD_TYPES = ['word', 'end', 'pause', 'sajdah', 'rub-el-hizb'] as const;
export type WordType = (typeof WORD_TYPES)[number];

export type RawRecord = Record<string, unknown>;

/** The resource's current rows, keyed as Content Sync identifies them: record type + id. */
export type RecordSet = {
  mushaf: RawRecord | null;
  pages: Map<number, RawRecord>;
  words: Map<number, RawRecord>;
};

export const emptyRecordSet = (): RecordSet => ({ mushaf: null, pages: new Map(), words: new Map() });

export class DatasetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DatasetError';
  }
}

const int = (value: unknown) => (typeof value === 'number' && Number.isInteger(value) ? value : Number.NaN);

/** Adds or replaces one row (snapshot record or ROW_CREATE / ROW_UPDATE data). */
export function upsertRecord(set: RecordSet, record: RawRecord) {
  const type = record.record_type;
  const id = int(record.id);
  if (type === 'mushaf') {
    set.mushaf = record;
    return;
  }
  if (!Number.isFinite(id)) throw new DatasetError(`A ${String(type)} record has no integer id`);
  if (type === 'mushaf_page') set.pages.set(id, record);
  else if (type === 'mushaf_word') set.words.set(id, record);
  else throw new DatasetError(`Unknown record type ${JSON.stringify(type)}`);
}

export function deleteRecord(set: RecordSet, type: unknown, id: number) {
  if (type === 'mushaf_page') set.pages.delete(id);
  else if (type === 'mushaf_word') set.words.delete(id);
  else if (type === 'mushaf') set.mushaf = null;
  else throw new DatasetError(`Unknown record type ${JSON.stringify(type)}`);
}

// ── Compiled form ─────────────────────────────────────────────────────────

/** One word, in page order: [line, verseId, positionInVerse, type, glyph]. */
export type CompiledWord = [number, number, number, WordType, string];
export type CompiledPage = { page: number; firstVerseId: number; lastVerseId: number; words: CompiledWord[] };

export type CanonicalQuran = {
  /** Ayahs per surah, 114 entries (surah-counts.json). */
  surahCounts: readonly number[];
  /** verseKey → exact Tanzil text. */
  text: (verseKey: string) => string;
};

export type DatasetReport = {
  pages: number;
  verses: number;
  words: number;
  wordTypes: Record<string, number>;
  /** First ayahs whose Tanzil text carries the basmala the Mushaf prints on its own line (112 expected). */
  basmalaPrefixes: number;
  /** Ayahs where the layout joins a documented Tanzil token pair (JOINED_WORDS, 4 expected). */
  joinedWords: number;
  /** Lines with no words, by page: where surah headers and basmala lines would be. Reported, never inferred. */
  emptyLines: Record<number, number[]>;
  /** For every surah: where its first ayah starts, and the empty lines just before it (same page or the end of the previous one). */
  surahStarts: { surah: number; page: number; line: number; emptyLinesBefore: number; emptyLinesAtPreviousPageEnd: number }[];
};

export type CompiledDataset = {
  mushaf: { name: string; description: string; pagesCount: number; linesPerPage: number; defaultFontName: string };
  pages: CompiledPage[];
  report: DatasetReport;
};

/** Standalone pause marks are separate tokens in Tanzil but not words (as in the app's check). */
const PAUSE_MARK = /^[ۖ-ۜ۞۩]+$/;
const tokens = (text: string) => text.trim().split(/\s+/).filter((token) => !PAUSE_MARK.test(token));
export const tanzilWordCount = (text: string) => tokens(text).length;

/**
 * Ayahs where the QCF V1 layout counts two Tanzil tokens as one word, as
 * the King Fahd print sets them. Each names the exact Tanzil token pair it
 * requires; the layout must then have exactly one word fewer. Observed in
 * mushafs:2 (2026-10-11) and in the King Fahd text (both keep the space;
 * see tools/quran-verification/output/kfgqpc-comparison-report.md).
 */
export const JOINED_WORDS: Readonly<Record<string, readonly [string, string]>> = {
  '2:181': ['بَعْدَ', 'مَا'],
  '8:6': ['بَعْدَ', 'مَا'],
  '13:37': ['بَعْدَ', 'مَا'],
  '37:130': ['إِلْ', 'يَاسِينَ'],
};

const SHADDA = 'ّ';

/**
 * Tanzil's Uthmani text starts the first ayah of 112 surahs (all but 1 and
 * 9) with the basmala; the printed Mushaf sets it on its own line, outside
 * the ayah, so its layout has no words for it (tools/quran-verification:
 * "Tanzil-only prefixes: 112"). Those four words are left out of the count
 * only when the ayah begins with exactly the four tokens of Tanzil's 1:1,
 * or (95:1 and 97:1 in Tanzil) the same with a shadda after the first
 * word's ب (بِّسْمِ).
 */
export function mushafWordCount(verseKey: string, text: string, basmala: readonly string[]): { words: number; basmalaPrefix: boolean; joined: boolean } {
  const own = tokens(text);
  const [surah, ayah] = verseKey.split(':').map(Number);
  const variants = basmala.length === 4 ? [basmala, [basmala[0].slice(0, 1) + SHADDA + basmala[0].slice(1), ...basmala.slice(1)]] : [];
  const prefixed = ayah === 1 && surah !== 1 && surah !== 9 && variants.some((variant) => variant.every((token, i) => own[i] === token));
  let words = prefixed ? own.length - basmala.length : own.length;
  const pair = JOINED_WORDS[verseKey];
  const joined = Boolean(pair && own.some((token, i) => token === pair[0] && own[i + 1] === pair[1]));
  if (joined) words -= 1;
  return { words, basmalaPrefix: prefixed, joined };
}

/** Global verse index ↔ surah:ayah, from the canonical counts. */
export function verseIndex(counts: readonly number[]) {
  const keys: string[] = [''];
  counts.forEach((count, surah) => {
    for (let ayah = 1; ayah <= count; ayah++) keys.push(`${surah + 1}:${ayah}`);
  });
  return { keyOf: (verseId: number) => keys[verseId] as string | undefined, total: keys.length - 1 };
}

/**
 * Validates every row and compiles the dataset. Throws a DatasetError
 * listing the first problems; never repairs or guesses.
 */
export function compileDataset(set: RecordSet, quran: CanonicalQuran): CompiledDataset {
  const problems: string[] = [];
  const problem = (message: string) => {
    if (problems.length < 40) problems.push(message);
  };
  const index = verseIndex(quran.surahCounts);
  if (index.total !== VERSE_COUNT) throw new DatasetError(`Canonical counts total ${index.total}, expected ${VERSE_COUNT}`);

  // Resource
  const m = set.mushaf;
  if (!m) throw new DatasetError('No mushaf record');
  if (int(m.id) !== MUSHAF_RESOURCE.id) problem(`mushaf id ${String(m.id)}, expected ${MUSHAF_RESOURCE.id}`);
  if (int(m.pages_count) !== PAGE_COUNT) problem(`pages_count ${String(m.pages_count)}, expected ${PAGE_COUNT}`);
  if (int(m.lines_per_page) !== LINES_PER_PAGE) problem(`lines_per_page ${String(m.lines_per_page)}, expected ${LINES_PER_PAGE}`);

  // Pages
  const pageRecords = new Map<number, RawRecord>();
  for (const record of set.pages.values()) {
    const page = int(record.page_number);
    if (int(record.mushaf_id) !== MUSHAF_RESOURCE.id) problem(`page record ${String(record.id)} belongs to mushaf ${String(record.mushaf_id)}`);
    if (!(page >= 1 && page <= PAGE_COUNT)) problem(`page record ${String(record.id)} has page ${String(record.page_number)}`);
    else if (pageRecords.has(page)) problem(`page ${page} appears twice`);
    else pageRecords.set(page, record);
  }
  if (pageRecords.size !== PAGE_COUNT) problem(`${pageRecords.size} pages, expected ${PAGE_COUNT}`);

  // Words, by page
  const byPage = new Map<number, RawRecord[]>();
  const wordTypes: Record<string, number> = {};
  for (const record of set.words.values()) {
    const page = int(record.page_number);
    const type = record.char_type_name;
    wordTypes[String(type)] = (wordTypes[String(type)] ?? 0) + 1;
    if (int(record.mushaf_id) !== MUSHAF_RESOURCE.id) problem(`word ${String(record.id)} belongs to mushaf ${String(record.mushaf_id)}`);
    if (!(page >= 1 && page <= PAGE_COUNT)) { problem(`word ${String(record.id)} has page ${String(record.page_number)}`); continue; }
    if (!(WORD_TYPES as readonly unknown[]).includes(type)) problem(`word ${String(record.id)} has type ${JSON.stringify(type)}`);
    const line = int(record.line_number);
    if (!(line >= 1 && line <= LINES_PER_PAGE)) problem(`word ${String(record.id)} on page ${page} has line ${String(record.line_number)}`);
    if (typeof record.text !== 'string' || record.text.length === 0 || record.text.length > 4) problem(`word ${String(record.id)} on page ${page} has no glyph code`);
    const verse = int(record.verse_id);
    if (!(verse >= 1 && verse <= VERSE_COUNT)) problem(`word ${String(record.id)} on page ${page} has verse ${String(record.verse_id)}`);
    if (!(int(record.position_in_verse) >= 1)) problem(`word ${String(record.id)} has position_in_verse ${String(record.position_in_verse)}`);
    const list = byPage.get(page);
    if (list) list.push(record); else byPage.set(page, [record]);
  }

  const pages: CompiledPage[] = [];
  const emptyLines: Record<number, number[]> = {};
  /** Every word of every verse, in reading order. */
  const verseWords = new Map<number, { type: WordType; position: number }[]>();
  let lastVerse = 0;
  for (let page = 1; page <= PAGE_COUNT; page++) {
    const words = [...(byPage.get(page) ?? [])].sort((a, b) => int(a.position_in_page) - int(b.position_in_page));
    if (words.length === 0) { problem(`page ${page} has no words`); continue; }
    // The first gap or repeat only: later positions on the page are off by the same cause.
    const gap = words.findIndex((word, i) => int(word.position_in_page) !== i + 1);
    if (gap >= 0) problem(`page ${page}: position_in_page ${String(words[gap].position_in_page)} where ${gap + 1} was expected`);
    const compiled: CompiledWord[] = [];
    let previousLine = 0;
    for (const word of words) {
      const line = int(word.line_number);
      const verse = int(word.verse_id);
      if (line < previousLine) problem(`page ${page}: lines go backwards at position ${String(word.position_in_page)}`);
      if (verse < lastVerse) problem(`page ${page}: ayahs go backwards at position ${String(word.position_in_page)}`);
      previousLine = line;
      lastVerse = Math.max(lastVerse, verse);
      const type = word.char_type_name as WordType;
      compiled.push([line, verse, int(word.position_in_verse), type, String(word.text)]);
      const own = verseWords.get(verse);
      const entry = { type, position: int(word.position_in_verse) };
      if (own) own.push(entry); else verseWords.set(verse, [entry]);
    }
    const used = new Set(compiled.map((word) => word[0]));
    const empty = [...Array(LINES_PER_PAGE).keys()].map((i) => i + 1).filter((line) => !used.has(line));
    if (empty.length > 0) emptyLines[page] = empty;

    const record = pageRecords.get(page);
    const firstVerse = compiled[0][1];
    const lastVerseOnPage = compiled[compiled.length - 1][1];
    if (record) {
      if (int(record.first_verse_id) !== firstVerse || int(record.last_verse_id) !== lastVerseOnPage) {
        problem(`page ${page}: words span ayahs ${firstVerse}–${lastVerseOnPage}, page record says ${String(record.first_verse_id)}–${String(record.last_verse_id)}`);
      }
      const distinct = new Set(compiled.map((word) => word[1])).size;
      if (int(record.verses_count) !== distinct) problem(`page ${page}: ${distinct} ayahs, page record says ${String(record.verses_count)}`);
    }
    pages.push({ page, firstVerseId: firstVerse, lastVerseId: lastVerseOnPage, words: compiled });
  }

  // Verses: all 6,236, each word counted against Tanzil, one marker, last.
  const basmala = tokens(quran.text('1:1'));
  let basmalaPrefixes = 0;
  let joinedWords = 0;
  for (let verse = 1; verse <= VERSE_COUNT; verse++) {
    const key = index.keyOf(verse)!;
    const own = verseWords.get(verse);
    if (!own) { problem(`ayah ${key} (verse ${verse}) is missing`); continue; }
    const gap = own.findIndex((word, i) => word.position !== i + 1);
    if (gap >= 0) problem(`ayah ${key}: position_in_verse ${own[gap].position} where ${gap + 1} was expected`);
    const markers = own.filter((word) => word.type === 'end').length;
    if (markers !== 1 || own[own.length - 1].type !== 'end') problem(`ayah ${key}: ${markers} ayah markers, or not last`);
    const words = own.filter((word) => word.type === 'word').length;
    const expected = mushafWordCount(key, quran.text(key), basmala);
    if (expected.basmalaPrefix) basmalaPrefixes++;
    if (expected.joined) joinedWords++;
    if (words !== expected.words) problem(`ayah ${key}: ${words} words, Tanzil has ${expected.words}${expected.basmalaPrefix ? ' after its basmala' : ''}`);
  }

  for (const key of Object.keys(JOINED_WORDS)) {
    if (!mushafWordCount(key, quran.text(key), basmala).joined) problem(`ayah ${key}: the documented joined pair is not in its Tanzil text`);
  }
  if (problems.length > 0) throw new DatasetError(`The mushafs:2 dataset failed validation: ${problems.join('; ')}`);

  // Surah boundaries (investigation data): where each surah starts and the empty lines before it.
  const surahStarts: DatasetReport['surahStarts'] = [];
  let firstVerseOfSurah = 1;
  quran.surahCounts.forEach((count, s) => {
    const page = pages.find((p) => p.words.some((word) => word[1] === firstVerseOfSurah))!;
    const line = page.words.find((word) => word[1] === firstVerseOfSurah)![0];
    const empty = new Set(emptyLines[page.page] ?? []);
    let before = 0;
    for (let l = line - 1; l >= 1 && empty.has(l); l--) before++;
    let atPreviousEnd = 0;
    if (before === line - 1 && page.page > 1) {
      const previousEmpty = new Set(emptyLines[page.page - 1] ?? []);
      for (let l = LINES_PER_PAGE; l >= 1 && previousEmpty.has(l); l--) atPreviousEnd++;
    }
    surahStarts.push({ surah: s + 1, page: page.page, line, emptyLinesBefore: before, emptyLinesAtPreviousPageEnd: atPreviousEnd });
    firstVerseOfSurah += count;
  });

  return {
    mushaf: {
      name: String(m.name ?? ''),
      description: String(m.description ?? '').trim(),
      pagesCount: int(m.pages_count),
      linesPerPage: int(m.lines_per_page),
      defaultFontName: String(m.default_font_name ?? ''),
    },
    pages,
    report: {
      pages: pages.length,
      verses: VERSE_COUNT,
      words: pages.reduce((sum, p) => sum + p.words.length, 0),
      wordTypes,
      basmalaPrefixes,
      joinedWords,
      emptyLines,
      surahStarts,
    },
  };
}

// ── Chunks and version ────────────────────────────────────────────────────

export type DatasetChunk = { index: number; firstPage: number; lastPage: number; sha256: string; bytes: number; json: string };

const sha256 = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');

/**
 * The app downloads the dataset as content-addressed chunks of 20 pages:
 * canonical JSON, identified by its SHA-256, so an unchanged chunk is never
 * downloaded twice and every chunk is verified on the device.
 */
export function chunkDataset(dataset: CompiledDataset): DatasetChunk[] {
  const chunks: DatasetChunk[] = [];
  for (let first = 1, index = 0; first <= PAGE_COUNT; first += PAGES_PER_CHUNK, index++) {
    const last = Math.min(PAGE_COUNT, first + PAGES_PER_CHUNK - 1);
    const pages = dataset.pages.slice(first - 1, last);
    const json = JSON.stringify({ schema: DATASET_SCHEMA, index, firstPage: first, lastPage: last, pages });
    chunks.push({ index, firstPage: first, lastPage: last, sha256: sha256(json), bytes: Buffer.byteLength(json, 'utf8'), json });
  }
  return chunks;
}

/** Same content, same version: a hash over the schema and every chunk's hash. */
export function datasetVersion(chunks: readonly DatasetChunk[]): string {
  return sha256(`qpc-v1:${DATASET_SCHEMA}:${chunks.map((chunk) => chunk.sha256).join(',')}`).slice(0, 24);
}

import { MUSHAF_PAGE_COUNT } from '@/mushaf/mushafPage';

import { bundledWordMeanings } from './bundledDataset';

/**
 * One entry of «الميسر في غريب القرآن الكريم»: a Quranic word or phrase the source selected on a page, and its short
 * explanation, both exactly as the source has them. `ayahEnd` equals `ayah` except where the source explains two
 * ayahs together (42:1–2, 53:19–20). `id`: the entry's place in the source (1, 2, …), stable for a given source file.
 */
export type WordMeaning = {
  id: number;
  surah: number;
  ayah: number;
  ayahEnd: number;
  word: string;
  /** Arabic, from the source. */
  explanation: string;
  /**
   * English, once a verified scholarly source is approved; none is today (the source is Arabic only, and meanings are
   * never machine-translated or generated).
   */
  explanationEnglish?: string;
};

/** The source's attribution, carried by the dataset itself. */
export type WordMeaningsSource = { title: string; publisher: string; url: string; sha256: string; retrieved: string };

export type WordMeaningsDataset =
  | { status: 'official'; source: WordMeaningsSource; entryCount: number; forPage: (page: number) => readonly WordMeaning[] }
  | { status: 'unavailable' };

type Row = [number, number, number, number, string, string];
type Raw = { format?: unknown; status?: unknown; source?: unknown; counts?: { entries?: unknown }; pages?: unknown };

const isRow = (row: unknown): row is Row =>
  Array.isArray(row) && row.length === 6 && row.slice(0, 4).every((n) => Number.isInteger(n)) && typeof row[4] === 'string' && typeof row[5] === 'string';

/**
 * The dataset's page lookup, from the generated file's shape (format 1: `pages[page - 1]` holds that page's entries as
 * rows, in source order). Anything else, including the "unavailable" placeholder the import writes when it cannot
 * restore the source, is unavailable: never a partial or guessed list. Each page's entries are made once, on first
 * request.
 */
export function readWordMeaningsDataset(raw: unknown): WordMeaningsDataset {
  const data = raw as Raw | null;
  if (!data || data.format !== 1 || data.status !== 'official' || !Array.isArray(data.pages) || data.pages.length !== MUSHAF_PAGE_COUNT) return { status: 'unavailable' };
  const pages = data.pages as unknown[];
  const cache = new Map<number, readonly WordMeaning[]>();
  return {
    status: 'official',
    source: data.source as WordMeaningsSource,
    entryCount: Number(data.counts?.entries ?? 0),
    forPage: (page) => {
      if (!Number.isInteger(page) || page < 1 || page > MUSHAF_PAGE_COUNT) return [];
      let entries = cache.get(page);
      if (!entries) {
        const rows = pages[page - 1];
        entries = Array.isArray(rows) && rows.every(isRow)
          ? rows.map(([id, surah, ayah, ayahEnd, word, explanation]) => ({ id, surah, ayah, ayahEnd, word, explanation }))
          : [];
        cache.set(page, entries);
      }
      return entries;
    },
  };
}

let loaded: WordMeaningsDataset | null = null;

/** The bundled dataset, read once (on first use) and kept: no network, no account, no backend. */
export function wordMeaningsDataset(): WordMeaningsDataset {
  if (!loaded) loaded = readWordMeaningsDataset(bundledWordMeanings());
  return loaded;
}

/** Tests only: the next use reads the bundled dataset again. */
export function resetWordMeaningsDatasetForTests() {
  loaded = null;
}

import { SURAH_AYAH_COUNTS } from '@/utils/ayahLink';

import type { TafsirEditionId } from './editions';

/**
 * A tafsir edition's app file (built by tools/tafsir/build.mjs; the same format bundled or downloaded):
 *
 *   { "format": "quran-heals-tafsir", "version": 1, "edition": "<id>", "language": "ar",
 *     "source": { "title", "author"?, "publisher", "distributor"?, "version"?, "url", "retrieved", "sha256" },
 *     "surahs": [ [ [from, to, "commentary"], … ], … 114 lists, in Surah order ] }
 *
 * Each entry is the source's commentary for ayahs from–to of that Surah, exactly as the source has it: one ayah
 * (from === to) or a passage the source comments on as a whole (في ظلال القرآن especially). A passage is shown once
 * with its range, never copied under each ayah or split by the app.
 *
 * The file is accepted only when every Surah's entries are in order, never overlap and cover each of its ayahs
 * (Tanzil's counts, utils/ayahLink.ts), and every text is non-empty. Anything else rejects the whole file: a partial
 * or altered edition is never shown.
 */
export const TAFSIR_FORMAT = 'quran-heals-tafsir';
export const TAFSIR_FORMAT_VERSION = 1;

export type TafsirEntry = { from: number; to: number; text: string };

export type TafsirSourceRecord = {
  title: string;
  author?: string;
  publisher: string;
  /** The digital edition's distributor and its version number (e.g. QuranEnc.com, 1.0.0), shown with the text. */
  distributor?: string;
  version?: string;
  url: string;
  retrieved: string;
  sha256: string;
};

export type TafsirDataset = {
  edition: TafsirEditionId;
  source: TafsirSourceRecord;
  /** The entries of one Surah (1–114), in order. */
  surah(surah: number): readonly TafsirEntry[];
  /** The entry covering this ayah. */
  entryFor(surah: number, ayah: number): TafsirEntry | null;
  entryCount: number;
  rangeCount: number;
};

export type ParseResult = { ok: true; dataset: TafsirDataset } | { ok: false; reason: string };

const isText = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;

export function parseTafsirDataset(raw: unknown, expected: TafsirEditionId): ParseResult {
  const file = raw as Record<string, unknown> | null;
  if (!file || typeof file !== 'object') return { ok: false, reason: 'not an object' };
  if (file.format !== TAFSIR_FORMAT || file.version !== TAFSIR_FORMAT_VERSION) return { ok: false, reason: 'unknown format' };
  if (file.edition !== expected) return { ok: false, reason: `edition ${String(file.edition)} is not ${expected}` };
  if (file.language !== 'ar') return { ok: false, reason: 'language' };
  const source = file.source as Record<string, unknown> | null;
  if (!source || !isText(source.title) || !isText(source.publisher) || !isText(source.url) || !isText(source.retrieved) || !isText(source.sha256)) {
    return { ok: false, reason: 'source record' };
  }
  for (const field of ['author', 'distributor', 'version'] as const) {
    if (source[field] !== undefined && !isText(source[field])) return { ok: false, reason: `source ${field}` };
  }
  const surahs = file.surahs;
  if (!Array.isArray(surahs) || surahs.length !== 114) return { ok: false, reason: 'surah count' };

  const bySurah: TafsirEntry[][] = [];
  let entryCount = 0;
  let rangeCount = 0;
  for (let s = 0; s < 114; s += 1) {
    const list = surahs[s];
    const count = SURAH_AYAH_COUNTS[s];
    if (!Array.isArray(list) || list.length === 0) return { ok: false, reason: `surah ${s + 1}: no entries` };
    const entries: TafsirEntry[] = [];
    let next = 1;
    for (const item of list) {
      if (!Array.isArray(item) || item.length !== 3) return { ok: false, reason: `surah ${s + 1}: entry shape` };
      const [from, to, text] = item as unknown[];
      if (!Number.isInteger(from) || !Number.isInteger(to)) return { ok: false, reason: `surah ${s + 1}: entry range` };
      // In order, no gap, no overlap: each entry starts right after the previous one ends.
      if (from !== next || (to as number) < (from as number) || (to as number) > count) return { ok: false, reason: `surah ${s + 1}: ayahs ${String(from)}–${String(to)} out of sequence` };
      if (!isText(text)) return { ok: false, reason: `surah ${s + 1}:${String(from)}: empty commentary` };
      entries.push({ from: from as number, to: to as number, text });
      if (to !== from) rangeCount += 1;
      next = (to as number) + 1;
    }
    if (next !== count + 1) return { ok: false, reason: `surah ${s + 1}: ayahs ${next}–${count} not covered` };
    entryCount += entries.length;
    bySurah.push(entries);
  }

  const dataset: TafsirDataset = {
    edition: expected,
    source: {
      title: source.title as string,
      ...(source.author !== undefined ? { author: source.author as string } : {}),
      publisher: source.publisher as string,
      ...(source.distributor !== undefined ? { distributor: source.distributor as string } : {}),
      ...(source.version !== undefined ? { version: source.version as string } : {}),
      url: source.url as string,
      retrieved: source.retrieved as string,
      sha256: source.sha256 as string,
    },
    surah: (surah) => bySurah[surah - 1] ?? [],
    entryFor: (surah, ayah) => entryCovering(bySurah[surah - 1] ?? [], ayah),
    entryCount,
    rangeCount,
  };
  return { ok: true, dataset };
}

/** Binary search: the entry whose range holds `ayah`. */
export function entryCovering(entries: readonly TafsirEntry[], ayah: number): TafsirEntry | null {
  let low = 0;
  let high = entries.length - 1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    const entry = entries[mid];
    if (ayah < entry.from) high = mid - 1;
    else if (ayah > entry.to) low = mid + 1;
    else return entry;
  }
  return null;
}

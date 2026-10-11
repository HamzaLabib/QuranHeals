import { Router, type Request, type Response } from 'express';

import { isValidVerseKey } from '../quran/referenceKeys';
import { QfUnavailableError, type QfContentClient } from '../quranFoundation/qfContentClient';

/**
 * QPC V1 (1405 AH Madani Mushaf, Uthman Taha) page layout for the mobile
 * /mushaf prototype: which glyph (QCF V1 page-font code) is each word,
 * on which of the page's lines, in which ayah.
 *
 * Source: Quran Foundation Content API, `GET /content/api/v4/verses/by_page/{page}`
 * with `words=true`, `word_fields=code_v1,line_number,page_number`, `mushaf=2`
 * (QCF V1). The data is Quran Foundation content: Content Sync does not
 * cover verse/word layout, so it may be cached for at most a week — here 24
 * hours in memory, and the app is told to keep its copy no longer than 7
 * days (`keepUntil`). Nothing is written to a database.
 *
 * The glyph codes are passed through unmodified; they are only rendered
 * with the matching page font, never treated as text.
 */

export const QPC_V1_MUSHAF_ID = 2;
/** Prototype scope: one page until the full reader is approved. */
export const QPC_V1_PROTOTYPE_PAGES: readonly number[] = [61];
export const SERVER_CACHE_MS = 24 * 60 * 60 * 1000;
export const CLIENT_KEEP_MS = 7 * 24 * 60 * 60 * 1000;

/** Quran Foundation word types; pause, sajdah and rub-el-hizb symbols are kept, in order, as marks. */
const KIND_MAP: Record<string, QpcV1Word['kind']> = { word: 'word', end: 'end', pause: 'mark', sajdah: 'mark', 'rub-el-hizb': 'mark' };

export type QpcV1Word = {
  verseKey: string;
  /** 1-based position of the word within its ayah (the ayah-end marker comes last). */
  position: number;
  kind: 'word' | 'end' | 'mark';
  /** QCF V1 glyph code for this page's font. */
  glyph: string;
};

export type QpcV1PageLayout = {
  page: number;
  edition: 'qpc-v1';
  /** The page-specific font's family name. */
  fontFamily: string;
  lines: { line: number; words: QpcV1Word[] }[];
  verseKeys: string[];
  source: 'quran-foundation-content-api';
  attribution: 'Quran Foundation';
  fetchedAt: string;
  /** The app must not keep this copy past this time. */
  keepUntil: string;
};

export class QpcLayoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'QpcLayoutError';
  }
}

type RawWord = { position?: unknown; char_type_name?: unknown; code_v1?: unknown; line_number?: unknown; page_number?: unknown };
type RawVerse = { verse_key?: unknown; words?: unknown };

/**
 * Validates the API's verses for one page and turns them into lines of
 * glyphs. Throws (never guesses) on anything that could misplace or
 * misattribute a word.
 */
export function buildQpcV1PageLayout(page: number, verses: unknown[], fetchedAt: Date): QpcV1PageLayout {
  if (verses.length === 0) throw new QpcLayoutError('No verses on page');
  const words: QpcV1Word[] = [];
  const lineOf: number[] = [];
  const verseKeys: string[] = [];
  let previousVerse: [number, number] | null = null;

  for (const rawVerse of verses as RawVerse[]) {
    const verseKey = rawVerse?.verse_key;
    if (typeof verseKey !== 'string' || !isValidVerseKey(verseKey)) throw new QpcLayoutError('Invalid verse key');
    const [surah, ayah] = verseKey.split(':').map(Number);
    if (previousVerse && !(surah === previousVerse[0] ? ayah === previousVerse[1] + 1 : surah === previousVerse[0] + 1 && ayah === 1)) {
      throw new QpcLayoutError('Verses are not consecutive');
    }
    previousVerse = [surah, ayah];
    verseKeys.push(verseKey);

    const rawWords = rawVerse.words;
    if (!Array.isArray(rawWords) || rawWords.length === 0) throw new QpcLayoutError(`${verseKey} has no words`);
    rawWords.forEach((rawWord: RawWord, index) => {
      const { position, char_type_name: kind, code_v1: glyph, line_number: line, page_number: wordPage } = rawWord ?? {};
      if (position !== index + 1) throw new QpcLayoutError(`${verseKey} word positions are not consecutive`);
      const mapped = typeof kind === 'string' ? KIND_MAP[kind] : undefined;
      if (!mapped) throw new QpcLayoutError(`${verseKey} has an unexpected word type`);
      if (typeof glyph !== 'string' || glyph.length === 0 || glyph.length > 4) throw new QpcLayoutError(`${verseKey} has an invalid glyph code`);
      if (typeof line !== 'number' || !Number.isInteger(line) || line < 1 || line > 15) throw new QpcLayoutError(`${verseKey} has an invalid line number`);
      if (wordPage !== page) throw new QpcLayoutError(`${verseKey} is not on page ${page}`);
      if (lineOf.length > 0 && line < lineOf[lineOf.length - 1]) throw new QpcLayoutError('Lines go backwards');
      words.push({ verseKey, position, kind: mapped, glyph });
      lineOf.push(line);
    });
    if (words[words.length - 1].kind !== 'end') throw new QpcLayoutError(`${verseKey} does not end with its ayah marker`);
    if (words.filter((word) => word.verseKey === verseKey && word.kind === 'end').length !== 1) {
      throw new QpcLayoutError(`${verseKey} must have exactly one ayah marker`);
    }
  }

  const lines: QpcV1PageLayout['lines'] = [];
  words.forEach((word, index) => {
    const line = lineOf[index];
    if (lines.length === 0 || lines[lines.length - 1].line !== line) lines.push({ line, words: [] });
    lines[lines.length - 1].words.push(word);
  });

  return {
    page,
    edition: 'qpc-v1',
    fontFamily: `QCF_P${String(page).padStart(3, '0')}`,
    lines,
    verseKeys,
    source: 'quran-foundation-content-api',
    attribution: 'Quran Foundation',
    fetchedAt: fetchedAt.toISOString(),
    keepUntil: new Date(fetchedAt.getTime() + CLIENT_KEEP_MS).toISOString(),
  };
}

export type QpcV1LayoutService = { getPage(page: number): Promise<QpcV1PageLayout> };

export function createQpcV1LayoutService(client: QfContentClient | null, options: { now?: () => Date } = {}): QpcV1LayoutService {
  const now = options.now ?? (() => new Date());
  const cache = new Map<number, { layout: QpcV1PageLayout; until: number }>();

  return {
    async getPage(page) {
      const cached = cache.get(page);
      if (cached && cached.until > now().getTime()) return cached.layout;
      if (!client) throw new QfUnavailableError('Quran Foundation credentials are not configured', 'not_configured');
      const verses: unknown[] = [];
      for (let apiPage = 1; apiPage <= 5; apiPage += 1) {
        const body = (await client.get(
          `/content/api/v4/verses/by_page/${page}?words=true&word_fields=code_v1,line_number,page_number&mushaf=${QPC_V1_MUSHAF_ID}&per_page=50&page=${apiPage}`,
        )) as { verses?: unknown; pagination?: { total_pages?: unknown } };
        if (!Array.isArray(body?.verses)) throw new QpcLayoutError('Malformed verses response');
        verses.push(...body.verses);
        const totalPages = typeof body.pagination?.total_pages === 'number' ? body.pagination.total_pages : 1;
        if (apiPage >= totalPages) break;
      }
      const fetchedAt = now();
      const layout = buildQpcV1PageLayout(page, verses, fetchedAt);
      cache.delete(page);
      cache.set(page, { layout, until: fetchedAt.getTime() + SERVER_CACHE_MS });
      return layout;
    },
  };
}

/** A safe, single-line reason for a failed layout request. */
export function describeFailure(error: unknown): string {
  if (error instanceof QfUnavailableError) return error.describe();
  // Validation messages name only ayah references and fields, never content.
  if (error instanceof QpcLayoutError) return `category=validation reason="${error.message}"`;
  return `category=internal type=${(error as { name?: unknown })?.name === undefined ? 'unknown' : String((error as { name: unknown }).name)}`;
}

export function createMushafRoutes(service: QpcV1LayoutService): Router {
  const router = Router();
  router.get('/qpc-v1/pages/:page', async (req: Request, res: Response) => {
    const raw = req.params.page;
    const page = /^[1-9]\d{0,2}$/.test(String(raw)) ? Number(raw) : Number.NaN;
    if (!QPC_V1_PROTOTYPE_PAGES.includes(page)) {
      res.status(404).json({ success: false, message: 'This Mushaf page is not available.' });
      return;
    }
    try {
      const layout = await service.getPage(page);
      res.set('Cache-Control', 'private, max-age=86400');
      res.json({ success: true, data: layout });
    } catch (error) {
      // The client gets one generic message; the server log gets the reason
      // (category, stage, environment, upstream status, path without query) —
      // never credentials, tokens or response bodies.
      console.warn(`QPC V1 layout for page ${page} unavailable: ${describeFailure(error)}`);
      res.status(503).json({ success: false, message: 'The 1405 Mushaf layout is not available right now.' });
    }
  });
  return router;
}

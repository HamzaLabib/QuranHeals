import { HIZB_QUARTER_STARTS } from './generated/hizbQuarters';
import { PAGE_FIRST_AYAH } from './generated/pageStarts';
import { SURAH_START_PAGES } from './generated/surahStartPages';
import { JUZ_STARTS, juzOfAyah, MUSHAF_PAGE_COUNT } from './mushafPage';
import { parsePageNumber } from './pageNumber';

/**
 * The reader's navigation metadata (2026-10-14 redesign): which Surah and juz' a page belongs to, and where each
 * Surah, juz' and Hizb begins. All from the verified tables (Tanzil's pinned quran-data.xml, checked against the QCF V1
 * print): PAGE_FIRST_AYAH, SURAH_START_PAGES, JUZ_STARTS and HIZB_QUARTER_STARTS. Nothing here changes a page.
 *
 * The rule for a page (the page selector's preview): the Surah and juz' of the ayah the page **begins** with: the
 * printed running heads' rule. A page where a Surah or juz' starts lower down still belongs to the one at its top.
 */

export const JUZ_COUNT = 30;
export const HIZB_COUNT = 60;

const ayahOrder = (surah: number, ayah: number) => surah * 1000 + ayah;

/** The page holding an ayah: the last page that begins at or before it. */
export function pageOfAyah(surah: number, ayah: number): number {
  const target = ayahOrder(surah, ayah);
  let low = 0;
  let high = PAGE_FIRST_AYAH.length - 1;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    const [s, a] = PAGE_FIRST_AYAH[mid];
    if (ayahOrder(s, a) <= target) low = mid;
    else high = mid - 1;
  }
  return low + 1;
}

export type PageInfo = { page: number; surah: number; juz: number };

/** The Surah and juz' at the top of a page (1–604); null for anything else. */
export function pageInfo(page: number): PageInfo | null {
  if (!Number.isInteger(page) || page < 1 || page > MUSHAF_PAGE_COUNT) return null;
  const [surah, ayah] = PAGE_FIRST_AYAH[page - 1];
  return { page, surah, juz: juzOfAyah(surah, ayah) };
}

/** The page on which each juz' (1–30) begins: the page holding its first ayah. */
export const JUZ_START_PAGES: readonly number[] = JUZ_STARTS.map(([surah, ayah]) => pageOfAyah(surah, ayah));

/**
 * The page on which each Hizb (1–60) begins: its first quarter's page. Whole Hizbs only: the quarter, half and
 * three-quarter markers (quarters 2–4 of each Hizb) are never Hizb starts.
 */
export const HIZB_START_PAGES: readonly number[] = HIZB_QUARTER_STARTS.filter(([quarter]) => (quarter - 1) % 4 === 0).map(([, , page]) => page);

/** The first page of a Surah (1–114). */
export const surahStartPage = (surah: number): number => SURAH_START_PAGES[surah - 1];

/** Western, Arabic-Indic and Extended Arabic-Indic digits to Western; everything else kept. */
export function westernDigits(text: string): string {
  return text.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660)).replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0));
}

/**
 * Juz' or Hizb search by number: every division whose number begins with the typed digits (Western or Arabic-Indic;
 * any words around them, e.g. "juz 3" or "الجزء ٣", are ignored). No digits: all of them.
 */
export function searchNumbered(query: string, count: number): number[] {
  const digits = westernDigits(query).replace(/\D/g, '');
  const all = Array.from({ length: count }, (_, i) => i + 1);
  return digits ? all.filter((n) => String(n).startsWith(digits.replace(/^0+(?=\d)/, ''))) : all;
}

/** A typed page number (Western or Arabic-Indic digits) as 1–604, or null: never a fraction, never out of range. */
export const parseTypedPage = (input: string): number | null => parsePageNumber(input);

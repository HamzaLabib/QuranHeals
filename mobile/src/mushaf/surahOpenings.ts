import type { QpcV1PageLayout } from '@/mushaf/qpcV1Layout';

/**
 * Where a page's Surah headings and Basmalas go. The QPC V1 layout gives
 * every text line its line number on the 15-line page and leaves the lines
 * of a Surah's opening empty. The empty lines are read like the print:
 * - before ayah 1 of a Surah: the heading, then the Basmala (Surah 9: the
 *   heading only; Surah 1: the heading only, its Basmala is ayah 1);
 * - one empty line at the top of a page before ayah 1: the Basmala, its
 *   heading being the last line of the page before;
 * - empty lines at the bottom of a page: the next Surah's heading, then its
 *   Basmala (or only its heading, the Basmala opening the next page).
 * Checked against all 604 pages (tools/mushaf-audit): 114 headings and
 * 112 Basmalas, every empty line accounted for.
 */
export type OpeningSlot = { line: number; kind: 'heading' | 'basmala'; surah: number };

const LINES_PER_PAGE = 15;
const SURAH_WITHOUT_BASMALA = 9;

const surahOf = (verseKey: string) => Number(verseKey.split(':')[0]);
const ayahOf = (verseKey: string) => Number(verseKey.split(':')[1]);

export function surahOpeningSlots(layout: Pick<QpcV1PageLayout, 'lines'>): OpeningSlot[] {
  const text = [...layout.lines].filter((line) => line.words.length > 0).sort((a, b) => a.line - b.line);
  if (text.length === 0) return [];
  const used = new Set(text.map((line) => line.line));
  const slots: OpeningSlot[] = [];
  const emptyAbove = (line: number) => {
    let count = 0;
    for (let l = line - 1; l >= 1 && !used.has(l); l--) count++;
    return count;
  };
  for (const line of text) {
    const first = line.words[0];
    if (ayahOf(first.verseKey) !== 1 || first.position !== 1) continue;
    const surah = surahOf(first.verseKey);
    const empty = emptyAbove(line.line);
    if (empty === 0) continue;
    if (surah === 1 || surah === SURAH_WITHOUT_BASMALA) {
      slots.push({ line: line.line - 1, kind: 'heading', surah });
    } else if (empty >= 2) {
      slots.push({ line: line.line - 2, kind: 'heading', surah }, { line: line.line - 1, kind: 'basmala', surah });
    } else {
      slots.push({ line: line.line - 1, kind: 'basmala', surah }); // its heading ends the page before
    }
  }
  // Empty lines after the page's last text line open the next Surah.
  const last = text[text.length - 1];
  const trailing = LINES_PER_PAGE - last.line;
  if (trailing > 0) {
    const lastWord = last.words[last.words.length - 1];
    const next = surahOf(lastWord.verseKey) + 1;
    if (next <= 114) {
      slots.push({ line: last.line + 1, kind: 'heading', surah: next });
      if (trailing >= 2 && next !== SURAH_WITHOUT_BASMALA) slots.push({ line: last.line + 2, kind: 'basmala', surah: next });
    }
  }
  return slots.sort((a, b) => a.line - b.line);
}

/** Pages 1 and 2 (Al-Fatihah, the start of Al-Baqarah): short lines, centred, in a block of their own. */
export const isOpeningPage = (page: number) => page === 1 || page === 2;

/**
 * The Basmala in QPC V1: the four word glyphs of 1:1 in page 1's font
 * (U+FB51–U+FB54, without its ayah marker), read from Quran Foundation's
 * layout of page 1 — the Mushaf's own calligraphy of the same words.
 */
export const BASMALA_FONT_PAGE = 1;
export const BASMALA_GLYPHS = ['\uFB51', '\uFB52', '\uFB53', '\uFB54'] as const;

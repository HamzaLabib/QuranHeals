import type { TafsirEntry } from './dataset';

/**
 * The reader's rows for one Surah and one edition, top to bottom: for each of the edition's entries, the verified Arabic
 * of each ayah it covers, then the entry's commentary once. A passage (from < to) therefore shows its ayahs one after
 * another and then its single commentary under a heading with the range: never repeated under each ayah, never split.
 */
export type TafsirAyahRow = {
  type: 'ayah';
  key: string;
  ayah: number;
  text: string;
  /** The passage holding this ayah when it covers more than one ayah (its commentary follows the passage's last ayah). */
  range: { from: number; to: number } | null;
};
export type TafsirCommentaryRow = { type: 'commentary'; key: string; from: number; to: number; text: string };
export type TafsirRow = TafsirAyahRow | TafsirCommentaryRow;

export function buildSurahRows(verses: readonly { ayah: number; text: string }[], entries: readonly TafsirEntry[]): TafsirRow[] {
  const rows: TafsirRow[] = [];
  for (const entry of entries) {
    const range = entry.to > entry.from ? { from: entry.from, to: entry.to } : null;
    for (let ayah = entry.from; ayah <= entry.to; ayah += 1) {
      const verse = verses[ayah - 1];
      if (!verse || verse.ayah !== ayah) throw new Error(`ayah ${ayah} missing`);
      rows.push({ type: 'ayah', key: `a${ayah}`, ayah, text: verse.text, range });
    }
    rows.push({ type: 'commentary', key: `c${entry.from}-${entry.to}`, from: entry.from, to: entry.to, text: entry.text });
  }
  return rows;
}

/** The index of an ayah's own row (its Arabic): where the reader opens, so that ayah is the first thing seen. */
export function rowIndexOfAyah(rows: readonly TafsirRow[], ayah: number): number {
  const index = rows.findIndex((row) => row.type === 'ayah' && row.ayah === ayah);
  return index < 0 ? 0 : index;
}

/** The index of the commentary row covering an ayah. */
export function commentaryIndexOf(rows: readonly TafsirRow[], ayah: number): number {
  return rows.findIndex((row) => row.type === 'commentary' && row.from <= ayah && ayah <= row.to);
}

/**
 * The ayah being read, from the first row on screen: an ayah row is that ayah; a commentary row is the first ayah it
 * explains (so switching edition shows that ayah's Arabic first, then its commentary in the new edition).
 */
export function anchorAyahOf(row: TafsirRow | null | undefined): number | null {
  if (!row) return null;
  return row.type === 'ayah' ? row.ayah : row.from;
}

/** How many rows to add above when scrolling up past the first one drawn. */
export const PREPEND_CHUNK = 24;

/** The next window start when the top is reached: earlier rows added above, never past the Surah's first row. */
export const earlierWindowStart = (start: number) => Math.max(0, start - PREPEND_CHUNK);

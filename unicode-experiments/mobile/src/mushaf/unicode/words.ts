/**
 * Unicode Mushaf prototype (development builds only): the units of verified Tanzil text the page draws.
 *
 * A word group is one space-separated Tanzil token plus the standalone pause or sajdah signs that follow it, joined
 * by their original spaces, so a sign is always drawn with the word it stands over. The same grouping as
 * tools/unicode-mushaf/measure-widths.py (groups_of), which measured every group's width.
 *
 * Justification may elongate a group with kashida: tatweels (U+0640) inserted at the one point the width tool found
 * legal for it (after a joining letter and all its marks). Nothing else ever changes: `withoutKashida` gives back the
 * verified text exactly, which is how every drawn line is checked (unicode/integrity.ts).
 */

export const TATWEEL = 'ـ';
/** Standalone pause marks, the rub' al-hizb sign and the sajdah sign: separate Tanzil tokens, not words. */
export const PAUSE_MARK = /^[ۖ-ۜ۞۩]+$/;

/** A group's span in its verse: Tanzil tokens first…last, and the characters start…end (exclusive) of the verse text. */
export type WordGroup = { firstToken: number; lastToken: number; start: number; end: number; text: string };

const groupCache = new Map<string, WordGroup[]>();

/** A verse's word groups, in reading order. */
export function wordGroups(verseText: string): WordGroup[] {
  const cached = groupCache.get(verseText);
  if (cached) return cached;
  const groups: WordGroup[] = [];
  let offset = 0;
  verseText.split(' ').forEach((token, index) => {
    const start = offset;
    offset += token.length + 1;
    const last = groups[groups.length - 1];
    if (last && PAUSE_MARK.test(token)) {
      last.lastToken = index;
      last.end = start + token.length;
      last.text = verseText.slice(last.start, last.end);
    } else {
      groups.push({ firstToken: index, lastToken: index, start, end: start + token.length, text: token });
    }
  });
  if (groupCache.size > 2000) groupCache.clear();
  groupCache.set(verseText, groups);
  return groups;
}

/** The group of each token (pause signs belong to the word before them). */
export function groupOfToken(groups: readonly WordGroup[], token: number): number {
  return groups.findIndex((group) => token >= group.firstToken && token <= group.lastToken);
}

/** `text` with `count` tatweels inserted at `index` (a kashida point from the width data). */
export function insertKashida(text: string, index: number, count: number): string {
  if (count <= 0 || index <= 0 || index >= text.length) return text;
  return text.slice(0, index) + TATWEEL.repeat(count) + text.slice(index);
}

/** A drawn group's text back to the verified text: the tatweels justification inserted removed (Tanzil's own stay). */
export function withoutKashida(drawn: string, index: number, count: number): string {
  if (count <= 0) return drawn;
  if (drawn.slice(index, index + count) !== TATWEEL.repeat(count)) throw new Error('kashida not where it was inserted');
  return drawn.slice(0, index) + drawn.slice(index + count);
}

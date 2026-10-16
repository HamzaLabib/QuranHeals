import { decodePage, layoutPage, pageVerseIndexes, verseKeyOf, type LaidPage, type UnicodeMushafData } from './layout';
import { withoutKashida, wordGroups } from './words';

/**
 * Before a Unicode page is drawn (as checkAgainstTanzil before a QPC V1 page): what it would draw must be exactly the
 * verified Tanzil text. Text validation only — rendering is checked separately (tests and screenshots).
 *
 * First, the loaded text must be the text the layout was generated from: the page's verses (and 1:1 for a Basmala
 * line) fingerprint to the checksum the generator recorded from the verified SQLite (a changed letter or mark, a
 * missing or extra word, another edition: refused). Then, for the page laid out at any width:
 *  - every drawn word, with the kashida justification inserted taken back out, is its verse's word group exactly as
 *    in the verified text (byte for byte: no normalisation, nothing else removed);
 *  - each verse's groups appear once, in order, with none missing or repeated, from where the verse starts on this
 *    page (or its first word after the Basmala Tanzil prefixes to ayah 1) to where it ends here;
 *  - each verse ending on the page has exactly one ayah number, after its last word, and it is that verse's number;
 *  - Basmala lines draw exactly 1:1's four words.
 */
export type UnicodeCheck = { ok: boolean; problems: string[] };

/** FNV-1a (32 bits) over UTF-16 code units, as tools/unicode-mushaf/generate-layout.mjs. */
export function fnv1a(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/** The fingerprint of a page's text as loaded: its verses in order, then 1:1 when it has a Basmala line. */
export function pageTextChecksum(data: UnicodeMushafData, page: number, verseText: (verseIndex: number) => string): string {
  const lines = decodePage(data, page);
  const indexes = pageVerseIndexes(lines);
  if (lines.some((line) => line.kind === 'basmala')) indexes.push(0);
  return fnv1a(indexes.map((verseIndex) => verseText(verseIndex)).join('\n'));
}

export function checkUnicodePage(data: UnicodeMushafData, page: number, verseText: (verseIndex: number) => string, laid?: LaidPage): UnicodeCheck {
  const problems: string[] = [];
  try {
    if (pageTextChecksum(data, page, verseText) !== data.pageTextChecksums[page - 1]) return { ok: false, problems: [`page ${page}: the loaded text is not the verified text the layout was made from`] };
  } catch (error) {
    return { ok: false, problems: [error instanceof Error ? error.message : 'text unavailable'] };
  }
  let laidPage: LaidPage;
  try {
    laidPage = laid ?? layoutPage(data, page, 1000, verseText);
  } catch (error) {
    return { ok: false, problems: [error instanceof Error ? error.message : 'layout failed'] };
  }
  const seen = new Map<number, number[]>(); // verse index -> groups drawn, in order
  const markers = new Map<number, number>();
  const order: number[] = [];
  for (const row of laidPage.rows) {
    if (row.kind === 'heading') continue;
    if (row.kind === 'basmala') {
      const basmala = wordGroups(verseText(0)).slice(0, 4).map((g) => g.text).join(' ');
      if (row.items.map((w) => w.text).join(' ') !== basmala) problems.push(`line ${row.line}: Basmala is not 1:1's words`);
      continue;
    }
    for (const item of row.items) {
      if (order[order.length - 1] !== item.verseIndex) order.push(item.verseIndex);
      if (item.kind === 'marker') {
        markers.set(item.verseIndex, (markers.get(item.verseIndex) ?? 0) + 1);
        if (item.verseKey !== verseKeyOf(data, item.verseIndex) || item.ayah !== Number(item.verseKey.split(':')[1])) problems.push(`${item.verseKey}: wrong number`);
        continue;
      }
      const groups = wordGroups(verseText(item.verseIndex));
      const group = groups[item.group];
      const drawn = item.kashida ? withoutKashida(item.text, item.kashida.index, item.kashida.count) : item.text;
      if (!group || drawn !== group.text || item.start !== group.start || item.end !== group.end) problems.push(`${item.verseKey} word ${item.group + 1}: drawn text is not the verified text`);
      if (markers.has(item.verseIndex)) problems.push(`${item.verseKey}: a word after its number`);
      seen.set(item.verseIndex, [...(seen.get(item.verseIndex) ?? []), item.group]);
    }
  }
  if (new Set(order).size !== order.length) problems.push('verses out of order or split');
  for (let k = 1; k < order.length; k++) if (order[k] !== order[k - 1] + 1) problems.push(`verse ${verseKeyOf(data, order[k])} does not follow ${verseKeyOf(data, order[k - 1])}`);
  order.forEach((verseIndex, k) => {
    const key = verseKeyOf(data, verseIndex);
    const groups = wordGroups(verseText(verseIndex));
    const drawn = seen.get(verseIndex) ?? [];
    const [surah, ayah] = key.split(':').map(Number);
    const firstExpected = k === 0 && drawn[0] !== undefined ? drawn[0] : ayah === 1 && surah !== 1 && surah !== 9 ? 4 : 0;
    const ends = markers.get(verseIndex) === 1;
    const lastExpected = ends ? groups.length - 1 : drawn[drawn.length - 1];
    for (let g = firstExpected, i = 0; drawn.length && g <= lastExpected; g++, i++) {
      if (drawn[i] !== g) {
        problems.push(`${key}: words ${drawn.map((d) => d + 1).join(',')} drawn, expected ${firstExpected + 1}…${lastExpected + 1}`);
        break;
      }
    }
    if (drawn.length && drawn.length !== lastExpected - firstExpected + 1) problems.push(`${key}: ${drawn.length} words drawn, expected ${lastExpected - firstExpected + 1}`);
    if ((markers.get(verseIndex) ?? 0) > 1) problems.push(`${key}: ${markers.get(verseIndex)} numbers`);
    if (!ends && k !== order.length - 1) problems.push(`${key}: no number, yet the next verse follows`);
  });
  return { ok: problems.length === 0, problems };
}

import type { DisplayEncoding } from './encoding';
import { groupOfToken, insertKashida, wordGroups, type WordGroup } from './words';

/**
 * Unicode Mushaf prototype (development builds only): lays out one page of the 1405 AH Madina Mushaf in a Unicode
 * Quran font, from the Madina05 line placement (generated/madina05Layout.ts) and the verified Tanzil text.
 *
 * Pure and deterministic: positions come from the font's own advance widths, measured with HarfBuzz
 * (generated/*WordWidths.ts; the shaper Android and Chrome use), not from on-device measuring, so a page lays out the
 * same in Normal Mode and full screen, with Tajweed colours on or off, and in tests.
 *
 * - One letter size on every page: the text area is `options.measureEm` em wide. The print's line breaks were set for
 *   its calligraphy, so in a Unicode font the lines' natural widths differ; a per-page size would change the letters
 *   from page to page.
 * - Every line is justified edge to edge as printed, without ever squeezing or stretching a glyph:
 *   - a line too wide first takes the font's narrower letter forms where it has them (`options.narrow`), then
 *     tightens its gaps to `gapMinEm`, then is drawn a little smaller as a whole (never squeezed sideways);
 *   - a line too short grows its gaps to `gapSoftMaxEm`, then elongates words — calligraphically
 *     (`options.elongation`: the font's own longer letter bodies, chosen per word, on a few words spread along the
 *     line, as a calligrapher does) or with kashida tatweels (`options.kashida`) — and anything left goes to the gaps.
 * - Centred, with the font's own spaces: pages 1–2 (their own block), Basmala lines, and a Surah's last line when it
 *   is short (it would not fill CENTRE_BELOW_FILL of the measure), as the print sets them.
 * - Each ayah ends with its number in the traditional medallion, a slot of MARKER_SLOT_EM in the line.
 */

/** KFGQPC Hafs's original measure (the first prototype): the text area's width in em of the Quran text. */
export const LINE_MEASURE_EM = 21;
/** A Surah's last line narrower than this share of the measure is centred, not stretched. */
export const CENTRE_BELOW_FILL = 0.8;
/** The ayah-number medallion: its height in em of the Quran text, and its slot (medallion and a little air) in the line. */
export const MEDALLION_HEIGHT_EM = 1.32;
export const MEDALLION_ASPECT = 16.797 / 22.093; // the shared ornament's width ÷ height (ayahMarkerArtwork.ts ornamentBox)
export const MARKER_SLOT_EM = MEDALLION_HEIGHT_EM * MEDALLION_ASPECT + 0.06;

export type LayoutOptions = {
  /** The text area's width in em: font size = width / measureEm. */
  measureEm: number;
  /** Justification grows the gaps up to this before elongating words. */
  gapSoftMaxEm: number;
  /** A line too wide tightens its gaps down to this before it is drawn smaller. */
  gapMinEm: number;
  /** Kashida tatweels: at most `max` per word, `looseMax` on sparse lines whose gaps would exceed `looseGapEm`. */
  kashida: { max: number; looseMax: number; looseGapEm: number } | null;
  /**
   * Calligraphic elongation (QH Old Madina: n tatweels at a word's kashida point make the letter before them take its
   * n-th longer form, the tatweels drawing nothing): at most `maxLevel`; at first on about one word in
   * `wordsPerElongation` (longer words first, never two neighbours, at most `firstPassLevel` each), then further.
   */
  elongation: { maxLevel: number; wordsPerElongation: number; firstPassLevel: number } | null;
  /** Narrower letter forms (the font's ss13) for lines wider than the measure. */
  narrow: boolean;
  /**
   * Natural fitting (candidate C2), replacing the edge-to-edge rules above for lines too short: the gaps grow to
   * `gapEm`; then a few words take mild calligraphic elongations; then the gaps grow to `gapMaxEm`; then the line may
   * stay up to `underfillMaxEm` short (centred); only what is left beyond that goes to the gaps. See `fitNatural`.
   */
  natural?: NaturalFit;
  /**
   * The text area's share of the reader's text area (1 when absent): above 1, the text reaches a little into the plain
   * paper margin inside the frame, equally on both sides (the frame and the page are unchanged).
   */
  widthShare?: number;
};

export type NaturalFit = {
  gapEm: number;
  /**
   * A word's elongation stays mild: at most `maxLevel` levels, `maxEm` em and `maxShare` of its own width; words
   * narrower than `minWordEm` never elongate; never two neighbours; about one word in `wordsPerElongation` at first.
   */
  elongation: { maxLevel: number; maxEm: number; maxShare: number; minWordEm: number; wordsPerElongation: number };
  gapMaxEm: number;
  underfillMaxEm: number;
};

export const KFGQPC_OPTIONS: LayoutOptions = {
  measureEm: LINE_MEASURE_EM,
  gapSoftMaxEm: 0.42,
  gapMinEm: 0.12,
  kashida: { max: 4, looseMax: 8, looseGapEm: 1 },
  elongation: null,
  narrow: false,
};

/** A word group's width (em), kashida point, calligraphic elongations and narrow form; `fallback`: drawn in the fallback font. */
export type GroupMetric = {
  width: number;
  kashidaIndex: number;
  first: number;
  next: number;
  fallback: boolean;
  /** Extra width at each elongation level (index = level; [0] = 0); [0] alone when the word cannot elongate. */
  stretch: number[];
  /** Its width with the font's narrower letter forms, or null. */
  narrow: number | null;
};
export type FontMetrics = { unitsPerEm: number; ascent: number; descent: number; spaceEm: number; tatweelEm: number };

/** The generated tables the layout reads (generated/*.ts); passed in, so this module stays free of them. */
export type UnicodeMushafData = {
  pages: readonly string[];
  /** Per page, the fingerprint of the verified text it was generated from (integrity.ts pageTextChecksum). */
  pageTextChecksums: readonly string[];
  surahAyahCounts: readonly number[];
  groupWidths: readonly string[];
  fontMetrics: FontMetrics;
  /** The text area's width in em of this font (options.measureEm). */
  measureEm: number;
  /** How the verified text is handed to this font (encoding.ts); null: as it is. */
  displayEncoding: DisplayEncoding | null;
  /** How lines are justified; KFGQPC_OPTIONS when absent. */
  options?: LayoutOptions;
};

export type Segment = { verseIndex: number; firstToken: number; lastToken: number; marker: boolean };
export type PageLine =
  | { line: number; kind: 'text'; segments: Segment[] }
  | { line: number; kind: 'heading'; surah: number }
  | { line: number; kind: 'basmala'; surah: number };

export const isOpeningPage = (page: number) => page === 1 || page === 2;

// ── Verse keys ────────────────────────────────────────────────────────────

const firstIndexCache = new WeakMap<readonly number[], number[]>();
function firstIndexes(counts: readonly number[]) {
  let firsts = firstIndexCache.get(counts);
  if (!firsts) {
    firsts = [];
    let total = 0;
    for (const count of counts) {
      firsts.push(total);
      total += count;
    }
    firstIndexCache.set(counts, firsts);
  }
  return firsts;
}

/** Verse index (0 = 1:1 … 6235 = 114:6) → "surah:ayah". */
export function verseKeyOf(data: Pick<UnicodeMushafData, 'surahAyahCounts'>, verseIndex: number): string {
  const firsts = firstIndexes(data.surahAyahCounts);
  let surah = firsts.length;
  while (surah > 1 && firsts[surah - 1] > verseIndex) surah--;
  return `${surah}:${verseIndex - firsts[surah - 1] + 1}`;
}

/** "surah:ayah" → verse index, or -1. */
export function verseIndexOf(data: Pick<UnicodeMushafData, 'surahAyahCounts'>, verseKey: string): number {
  const match = /^(\d{1,3}):(\d{1,3})$/.exec(verseKey);
  if (!match) return -1;
  const [surah, ayah] = [Number(match[1]), Number(match[2])];
  const counts = data.surahAyahCounts;
  if (surah < 1 || surah > counts.length || ayah < 1 || ayah > counts[surah - 1]) return -1;
  return firstIndexes(counts)[surah - 1] + ayah - 1;
}

// ── Decoding ──────────────────────────────────────────────────────────────

/** One page's lines (generated/madina05Layout.ts format). */
export function decodePage(data: Pick<UnicodeMushafData, 'pages'>, page: number): PageLine[] {
  const encoded = data.pages[page - 1];
  if (encoded === undefined) throw new Error(`No page ${page}`);
  return encoded.split('|').map((text, i): PageLine => {
    const line = i + 1;
    if (text.startsWith('h')) return { line, kind: 'heading', surah: Number(text.slice(1)) };
    if (text.startsWith('b')) return { line, kind: 'basmala', surah: Number(text.slice(1)) };
    return {
      line,
      kind: 'text',
      segments: text.split(';').map((segment) => {
        const [verseIndex, firstToken, lastToken, marker] = segment.split(',');
        return { verseIndex: Number(verseIndex), firstToken: Number(firstToken), lastToken: Number(lastToken), marker: marker === 'm' };
      }),
    };
  });
}

/** The verses a page shows words or numbers of, in order (to load their verified text). */
export function pageVerseIndexes(lines: readonly PageLine[]): number[] {
  const seen: number[] = [];
  for (const line of lines) if (line.kind === 'text') for (const s of line.segments) if (seen[seen.length - 1] !== s.verseIndex) seen.push(s.verseIndex);
  return seen;
}

/** One cell of a width table (tools/unicode-mushaf/measure-widths.py documents the format). */
export function parseGroupCell(cell: string, tatweelEm: number): GroupMetric {
  let rest = cell;
  let narrow: number | null = null;
  const bang = rest.indexOf('!');
  if (bang >= 0) {
    narrow = Number(rest.slice(bang + 1)) / 1000;
    rest = rest.slice(0, bang);
  }
  const stretch = [0];
  const tilde = rest.indexOf('~');
  if (tilde >= 0) {
    for (const run of rest.slice(tilde + 1).split('.')) {
      const [step, count] = run.split('x');
      const add = parseInt(step, 36) / 1000;
      for (let k = 0; k < (count ? parseInt(count, 36) : 1); k++) stretch.push(stretch[stretch.length - 1] + add);
    }
    rest = rest.slice(0, tilde);
  }
  const fallback = rest.endsWith('f');
  const [width, index, first, next] = (fallback ? rest.slice(0, -1) : rest).split(':').map(Number);
  return {
    width: width / 1000,
    kashidaIndex: !fallback && Number.isFinite(index) ? index : -1,
    first: Number.isFinite(first) ? first / 1000 : tatweelEm,
    next: Number.isFinite(next) ? next / 1000 : tatweelEm,
    fallback,
    stretch,
    narrow,
  };
}

const metricCaches = new WeakMap<readonly string[], Map<number, GroupMetric[]>>();
/** A verse's word-group metrics (em), from the generated width table. */
export function groupMetrics(data: Pick<UnicodeMushafData, 'groupWidths' | 'fontMetrics'>, verseIndex: number): GroupMetric[] {
  let cache = metricCaches.get(data.groupWidths);
  if (!cache) {
    cache = new Map();
    metricCaches.set(data.groupWidths, cache);
  }
  const cached = cache.get(verseIndex);
  if (cached) return cached;
  const metrics = (data.groupWidths[verseIndex] ?? '').split(',').map((cell) => parseGroupCell(cell, data.fontMetrics.tatweelEm));
  cache.set(verseIndex, metrics);
  return metrics;
}

// ── Laying out ───────────────────────────────────────────────────────────

/** A drawn word group or ayah number on a line. Widths and positions in px, x from the text area's left edge. */
export type LaidWord = {
  kind: 'word';
  verseIndex: number;
  verseKey: string;
  group: number;
  /** The group's characters in its verse's verified text (start…end, exclusive). */
  start: number;
  end: number;
  /** What is drawn: the verified group text, with `kashida.count` tatweels at `kashida.index` when elongated so. */
  text: string;
  kashida: { index: number; count: number } | null;
  /** Calligraphic elongation level: drawn as that many tatweels at the kashida point (`kashida`), 0 for none. */
  elongation: number;
  /** Drawn with the font's narrower letter forms (its ss13). Changes no character. */
  narrow: boolean;
  /** Drawn in the fallback font (a sign the primary font cannot draw). */
  fallback: boolean;
  x: number;
  width: number;
};
export type LaidMarker = { kind: 'marker'; verseIndex: number; verseKey: string; ayah: number; x: number; width: number };
export type LaidItem = LaidWord | LaidMarker;
export type LaidRow =
  | { line: number; kind: 'text'; items: LaidItem[]; fontSize: number; centred: boolean; gap: number; underfill: number }
  | { line: number; kind: 'heading'; surah: number }
  | { line: number; kind: 'basmala'; surah: number; items: LaidWord[]; fontSize: number };

export type LaidPage = {
  page: number;
  fontSize: number;
  rows: LaidRow[];
  /** Lines (1-based) the page uses: 15, or 8 on pages 1–2. */
  lineCount: number;
  stats: {
    justified: number; centred: number; kashidas: number; elongations: number; narrowed: number; shrunk: number; smallestScale: number; widestGapEm: number; maxLevel: number;
    /** The longest elongation on the page (em) and the justified lines left short (natural fitting), with the most left (em). */
    longestStretchEm: number; underfilled: number; largestUnderfillEm: number;
  };
};

type WordPiece = { kind: 'word'; verseIndex: number; group: number; g: WordGroup; m: GroupMetric; kashida: number; level: number; narrow: boolean };
type Piece = WordPiece | { kind: 'marker'; verseIndex: number };

/** The font size for a text area `width` px wide (the same on every page). */
export const unicodeFontSize = (width: number, measureEm = LINE_MEASURE_EM) => width / measureEm;

/**
 * Lays out page `page` in a text area `width` px wide. `verseText(i)` returns verse i's verified Tanzil text (every
 * verse the page shows, and 1:1 for a Basmala line). A Surah's last line is recognised by the heading after it, on
 * this page or opening the next.
 */
export function layoutPage(data: UnicodeMushafData, page: number, readerWidth: number, verseText: (verseIndex: number) => string): LaidPage {
  const options = data.options ?? { ...KFGQPC_OPTIONS, measureEm: data.measureEm };
  const lines = decodePage(data, page);
  const opening = isOpeningPage(page);
  // A text area wider than the reader's (widthShare) reaches equally into the paper margin on both sides.
  const width = readerWidth * (options.widthShare ?? 1);
  const offset = (readerWidth - width) / 2;
  const fontSize = unicodeFontSize(width, options.measureEm);
  const stats = { justified: 0, centred: 0, kashidas: 0, elongations: 0, narrowed: 0, shrunk: 0, smallestScale: 1, widestGapEm: 0, maxLevel: 0, longestStretchEm: 0, underfilled: 0, largestUnderfillEm: 0 };
  const shift = <T extends LaidItem>(items: T[]): T[] => (offset === 0 ? items : items.map((item) => ({ ...item, x: item.x + offset })));
  const nextFirst = page < data.pages.length ? decodePage(data, page + 1)[0] : null;
  const word = (verseIndex: number, group: number, g: WordGroup): WordPiece => ({ kind: 'word', verseIndex, group, g, m: groupMetrics(data, verseIndex)[group], kashida: 0, level: 0, narrow: false });
  const rows: LaidRow[] = lines.map((line, i): LaidRow => {
    if (line.kind === 'heading') return { line: line.line, kind: 'heading', surah: line.surah };
    if (line.kind === 'basmala') {
      // The Basmala: the four words of 1:1 (its verified text), centred, never a tap target.
      const pieces = wordGroups(verseText(0)).slice(0, 4).map((g, group) => word(0, group, g));
      const row = placeLine(data, options, pieces, width, fontSize, true);
      return { line: line.line, kind: 'basmala', surah: line.surah, items: shift(row.items as LaidWord[]), fontSize };
    }
    const pieces: Piece[] = [];
    for (const segment of line.segments) {
      const groups = wordGroups(verseText(segment.verseIndex));
      if (segment.firstToken <= segment.lastToken) {
        const firstGroup = groupOfToken(groups, segment.firstToken);
        const lastGroup = groupOfToken(groups, segment.lastToken);
        if (firstGroup < 0 || lastGroup < firstGroup) throw new Error(`Page ${page} line ${line.line}: tokens ${segment.firstToken}–${segment.lastToken} of verse ${segment.verseIndex} not in its text`);
        for (let group = firstGroup; group <= lastGroup; group++) pieces.push(word(segment.verseIndex, group, groups[group]));
      }
      if (segment.marker) pieces.push({ kind: 'marker', verseIndex: segment.verseIndex });
    }
    const next = lines[i + 1] ?? nextFirst;
    const endsSurah = next === null || next === undefined || next.kind === 'heading';
    const natural = pieceWidths(pieces) + Math.max(0, pieces.length - 1) * data.fontMetrics.spaceEm;
    const centred = opening || (endsSurah && natural < options.measureEm * CENTRE_BELOW_FILL);
    const row = placeLine(data, options, pieces, width, fontSize, centred);
    if (centred) stats.centred++;
    else stats.justified++;
    stats.kashidas += row.kashidas;
    stats.elongations += row.elongations;
    stats.narrowed += row.narrowed;
    stats.maxLevel = Math.max(stats.maxLevel, row.maxLevel);
    stats.longestStretchEm = Math.max(stats.longestStretchEm, row.longestStretchEm);
    if (row.scale < 1) {
      stats.shrunk++;
      stats.smallestScale = Math.min(stats.smallestScale, row.scale);
    }
    if (row.underfill > 0) {
      stats.underfilled++;
      stats.largestUnderfillEm = Math.max(stats.largestUnderfillEm, row.underfill / fontSize);
    }
    if (!centred) stats.widestGapEm = Math.max(stats.widestGapEm, row.gap / fontSize);
    return { line: line.line, kind: 'text', items: shift(row.items), fontSize: fontSize * row.scale, centred, gap: row.gap, underfill: row.underfill };
  });
  return { page, fontSize, rows, lineCount: opening ? lines.length : 15, stats };
}

const kashidaWidth = (m: GroupMetric, count: number) => (count <= 0 ? 0 : m.first + (count - 1) * m.next);
const wordWidth = (p: WordPiece) => (p.narrow && p.m.narrow !== null ? p.m.narrow : p.m.width) + kashidaWidth(p.m, p.kashida) + (p.m.stretch[p.level] ?? 0);
const pieceWidths = (pieces: readonly Piece[]) => pieces.reduce((sum, p) => sum + (p.kind === 'marker' ? MARKER_SLOT_EM : wordWidth(p)), 0);

/** Places one line's pieces right to left (the first piece at the right edge). Widths in em until the end. */
function placeLine(data: UnicodeMushafData, options: LayoutOptions, pieces: Piece[], width: number, fontSize: number, centred: boolean) {
  const measure = width / fontSize; // = options.measureEm
  const naturalGap = data.fontMetrics.spaceEm;
  const gaps = Math.max(0, pieces.length - 1);
  const words = pieces.filter((p): p is WordPiece => p.kind === 'word' && !p.m.fallback);
  let gapEm = naturalGap;
  let scale = 1;
  let kashidas = 0;
  let elongations = 0;
  let narrowed = 0;
  let underfillEm = 0;
  if (!centred && gaps > 0 && options.natural && pieceWidths(pieces) + gaps * naturalGap <= measure) {
    const fit = fitNatural(pieces, words, measure, gaps, naturalGap, options.natural);
    gapEm = fit.gapEm;
    underfillEm = fit.underfillEm;
    elongations = fit.elongations;
  } else if (!centred && gaps > 0) {
    if (pieceWidths(pieces) + gaps * naturalGap > measure) {
      // Too wide: narrower letter forms first (largest savings first), then tighter gaps, then a smaller size.
      if (options.narrow) {
        const candidates = words.filter((p) => p.m.narrow !== null && p.m.narrow < p.m.width).sort((a, b) => (b.m.width - (b.m.narrow ?? b.m.width)) - (a.m.width - (a.m.narrow ?? a.m.width)));
        for (const p of candidates) {
          if (pieceWidths(pieces) + gaps * naturalGap <= measure) break;
          p.narrow = true;
          narrowed++;
        }
      }
      gapEm = Math.min(naturalGap, (measure - pieceWidths(pieces)) / gaps);
      if (gapEm < options.gapMinEm) {
        gapEm = options.gapMinEm;
        scale = measure / (pieceWidths(pieces) + gaps * options.gapMinEm);
      }
    } else {
      const extra = measure - pieceWidths(pieces) - gaps * naturalGap;
      gapEm = Math.min(Math.max(options.gapSoftMaxEm, naturalGap), naturalGap + extra / gaps);
      let room = measure - pieceWidths(pieces) - gaps * gapEm;
      if (options.elongation && room > 0) {
        const result = elongate(pieces, words, room, options.elongation);
        elongations = result.count;
        room = result.room;
      }
      if (options.kashida && room > 0) {
        const { max, looseMax, looseGapEm } = options.kashida;
        const candidates = words.filter((p) => p.m.kashidaIndex > 0).sort((a, b) => b.m.width - a.m.width);
        const loose = (measure - pieceWidths(pieces)) / gaps - max * (candidates.length / gaps) * data.fontMetrics.tatweelEm > looseGapEm;
        for (let round = 0; round < (loose ? looseMax : max) && room > 0; round++) {
          for (const p of candidates) {
            const add = kashidaWidth(p.m, p.kashida + 1) - kashidaWidth(p.m, p.kashida);
            if (add > room) continue;
            p.kashida += 1;
            kashidas += 1;
            room -= add;
          }
        }
      }
      // What is left goes to the gaps.
      gapEm = (measure - pieceWidths(pieces)) / gaps;
    }
  } else if (!centred && gaps === 0) {
    const ink = pieceWidths(pieces);
    if (ink > measure) scale = measure / ink;
  }
  // Positions (px), right to left; a centred line sits in the middle with natural gaps.
  const em = fontSize * scale;
  const total = (pieceWidths(pieces) + gaps * gapEm) * em;
  let right = centred || gaps === 0 ? width - (width - total) / 2 : width - (underfillEm * em) / 2;
  let maxLevel = 0;
  let longestStretchEm = 0;
  const items: LaidItem[] = pieces.map((p) => {
    const w = (p.kind === 'marker' ? MARKER_SLOT_EM : wordWidth(p)) * em;
    const x = right - w;
    right = x - gapEm * em;
    const verseKey = verseKeyOf(data, p.verseIndex);
    if (p.kind === 'marker') return { kind: 'marker', verseIndex: p.verseIndex, verseKey, ayah: Number(verseKey.split(':')[1]), x, width: w };
    maxLevel = Math.max(maxLevel, p.level);
    longestStretchEm = Math.max(longestStretchEm, p.m.stretch[p.level] ?? 0);
    // Flat kashida, or calligraphic elongation — both drawn as tatweels at the word's kashida point.
    const count = p.kashida > 0 ? p.kashida : p.level;
    const kashida = count > 0 ? { index: p.m.kashidaIndex, count } : null;
    return {
      kind: 'word',
      verseIndex: p.verseIndex,
      verseKey,
      group: p.group,
      start: p.g.start,
      end: p.g.end,
      text: kashida ? insertKashida(p.g.text, kashida.index, kashida.count) : p.g.text,
      kashida,
      elongation: p.level,
      narrow: p.narrow,
      fallback: p.m.fallback,
      x,
      width: w,
    };
  });
  return { items, scale, kashidas, elongations, narrowed, maxLevel, longestStretchEm, gap: gapEm * em, underfill: underfillEm * em };
}

/**
 * Natural fitting of a line narrower than the measure (candidate C2): a handwritten line rather than one forced edge to
 * edge. In order, while room is left: the gaps grow to `gapEm`; mild elongations (fitNaturalElongation); the gaps grow
 * to `gapMaxEm`; the line stays up to `underfillMaxEm` short; what is left beyond that goes to the gaps after all.
 */
function fitNatural(pieces: readonly Piece[], words: readonly WordPiece[], measure: number, gaps: number, naturalGap: number, fit: NaturalFit) {
  const roomAt = (gap: number) => measure - pieceWidths(pieces) - gaps * gap;
  const soft = Math.max(naturalGap, Math.min(fit.gapEm, naturalGap + roomAt(naturalGap) / gaps));
  let elongations = 0;
  if (roomAt(soft) > 0) elongations = fitNaturalElongation(pieces, words, roomAt(soft), fit.elongation);
  const gapEm = Math.max(soft, Math.min(fit.gapMaxEm, soft + roomAt(soft) / gaps));
  const left = roomAt(gapEm);
  if (left <= fit.underfillMaxEm) return { gapEm, underfillEm: Math.max(0, left), elongations };
  return { gapEm: gapEm + (left - fit.underfillMaxEm) / gaps, underfillEm: fit.underfillMaxEm, elongations };
}

/**
 * Mild calligraphic elongation (candidate C2): the room is shared among several words, each a little, instead of a
 * few words drawn very long. Words of at least `minWordEm`, longer ones first, never two neighbours; at first about one
 * word in `wordsPerElongation`, then any other such word. Levels go up one at a time on the least elongated word, while
 * the step fits in the room and the word stays within `maxLevel`, `maxEm` and `maxShare` of its width. Returns how many
 * words elongated.
 */
function fitNaturalElongation(pieces: readonly Piece[], words: readonly WordPiece[], room: number, { maxLevel, maxEm, maxShare, minWordEm, wordsPerElongation }: NaturalFit['elongation']) {
  const position = new Map(pieces.map((p, i) => [p, i]));
  const capable = words.filter((p) => p.m.kashidaIndex > 0 && p.m.stretch.length > 1 && p.m.width >= minWordEm).sort((a, b) => b.m.width - a.m.width);
  const cap = (p: WordPiece) => Math.min(maxEm, maxShare * p.m.width);
  const chosen: WordPiece[] = [];
  const pick = (limit: number) => {
    for (const p of capable) {
      if (chosen.length >= limit) return;
      if (chosen.includes(p) || p.m.stretch[1] > cap(p)) continue;
      if (chosen.some((c) => Math.abs((position.get(c) ?? 0) - (position.get(p) ?? 0)) <= 1)) continue;
      chosen.push(p);
    }
  };
  let count = 0;
  const grow = () => {
    const step = (p: WordPiece) => {
      if (p.level >= Math.min(maxLevel, p.m.stretch.length - 1) || p.m.stretch[p.level + 1] > cap(p)) return Infinity;
      return p.m.stretch[p.level + 1] - p.m.stretch[p.level];
    };
    for (;;) {
      const next = chosen.filter((p) => step(p) <= room).sort((a, b) => a.level - b.level || b.m.width - a.m.width)[0];
      if (!next) return;
      room -= step(next);
      if (next.level === 0) count++;
      next.level += 1;
    }
  };
  pick(Math.max(1, Math.round(pieces.length / wordsPerElongation)));
  grow();
  if (room > 0.05) {
    pick(Infinity);
    grow();
  }
  return count;
}

/** Words shorter than this (em) elongate only when a line cannot be filled otherwise (a calligrapher stretches longer words). */
const SHORT_WORD_EM = 1.0;

/**
 * Calligraphic elongation: the letter before a word's kashida point takes a longer form, as a calligrapher stretches a
 * line — one connection per word, on a few words spread along the line. Longer words are chosen first, never two
 * neighbours, each at most `firstPassLevel` levels; levels go up one at a time, always on the least elongated chosen
 * word, while one more level fits. If the line still needs more, the chosen words may go up to `maxLevel`, then every
 * capable word may take part (short ones last). Returns the room left.
 */
function elongate(pieces: readonly Piece[], words: readonly WordPiece[], room: number, { maxLevel, wordsPerElongation, firstPassLevel }: { maxLevel: number; wordsPerElongation: number; firstPassLevel: number }) {
  const capable = words.filter((p) => p.m.stretch.length > 1 && p.m.kashidaIndex > 0);
  if (capable.length === 0) return { room, count: 0 };
  const position = new Map(pieces.map((p, i) => [p, i]));
  const longer = capable.filter((p) => p.m.width >= SHORT_WORD_EM).sort((a, b) => b.m.width - a.m.width);
  const target = Math.max(1, Math.round(pieces.length / wordsPerElongation));
  const chosen: WordPiece[] = [];
  for (const p of longer) {
    if (chosen.length >= target) break;
    if (chosen.some((c) => Math.abs((position.get(c) ?? 0) - (position.get(p) ?? 0)) <= 1)) continue;
    chosen.push(p);
  }
  let count = 0;
  const grow = (set: readonly WordPiece[], cap: number) => {
    const step = (p: WordPiece) => (p.level < Math.min(cap, p.m.stretch.length - 1) ? p.m.stretch[p.level + 1] - p.m.stretch[p.level] : Infinity);
    for (;;) {
      const next = set.filter((p) => step(p) <= room).sort((a, b) => a.level - b.level || b.m.width - a.m.width)[0];
      if (!next) return;
      room -= step(next);
      if (next.level === 0) count++;
      next.level += 1;
    }
  };
  grow(chosen, firstPassLevel);
  if (room > 0.05) grow([...chosen, ...longer.filter((p) => !chosen.includes(p))], firstPassLevel);
  if (room > 0.05) grow(longer, maxLevel);
  if (room > 0.05) grow(capable, maxLevel);
  return { room, count };
}

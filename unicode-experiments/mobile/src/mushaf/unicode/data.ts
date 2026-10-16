import { AMIRI_DISPLAY_ENCODING, AMIRI_FONT_METRICS, AMIRI_GROUP_WIDTHS } from './generated/amiriWordWidths';
import { HAFS_DISPLAY_ENCODING, HAFS_FALLBACK_METRICS, HAFS_FONT_METRICS, HAFS_GROUP_WIDTHS } from './generated/hafsWordWidths';
import { MADINA05_LAYOUT_SOURCE, MADINA05_PAGES, PAGE_TEXT_CHECKSUMS, SURAH_AYAH_COUNTS } from './generated/madina05Layout';
import { MADINA_DISPLAY_ENCODING, MADINA_FALLBACK_METRICS, MADINA_FONT_METRICS, MADINA_GROUP_WIDTHS } from './generated/madinaWordWidths';
import { TAJWEED_RULES, TAJWEED_SOURCE } from './generated/tajweedRules';
import type { DisplayEncoding } from './encoding';
import { KFGQPC_OPTIONS, type FontMetrics, type LayoutOptions, type UnicodeMushafData } from './layout';

/**
 * The Unicode Mushaf prototype's generated tables (about 3 MB of source). Reached only through
 * mushaf/unicode/index.ts, which the reader requires in development builds only, so release bundles never contain
 * them (Metro folds the `__DEV__` branch away before collecting dependencies).
 *
 * The renderings compared against QCF V1 (docs/unicode-mushaf/visual-candidates.md), each with its own measured widths
 * over the same layout and the same verified text:
 *  - 'hafs': the first prototype — KFGQPC HAFS Uthmanic Script v18 (Quran Foundation's CDN) at a 21-em measure.
 *  - 'hafsPlus' (candidate A): the same font, larger (19.5 em), lighter kashida, wider gaps allowed.
 *  - 'madina' (candidate B): QH Old Madina — DigitalKhatt Old Madina (OFL), drawn from the Madina Mushaf in Uthman
 *    Taha's hand — at 18.5 em, justified with spaces only (narrower forms for lines too wide).
 *  - 'madinaCalligraphic' (candidate C): the same font with calligraphic justification: one letter per word takes its
 *    own longer form (tatweels at the kashida point, drawn as nothing), on a few words per line.
 *  - 'madinaNatural' (candidate C2, after review of C): the same font, 6.4% larger, fitted naturally rather than
 *    edge to edge — mild elongations on more words (at most 0.42 em and 35% of a word), gaps up to 0.45 em, and lines
 *    allowed to end up to 2 em short (centred) rather than stretched; the text reaches 1% into the paper margin each side.
 *  - 'amiri': Amiri Quran (OFL), a comparison baseline.
 * KFGQPC and QH Old Madina draw the two (respectively two other) words they cannot in Amiri Quran.
 */
export type UnicodeFontId = 'hafs' | 'hafsPlus' | 'madina' | 'madinaCalligraphic' | 'madinaNatural' | 'amiri';
export const UNICODE_FONT_IDS: readonly UnicodeFontId[] = ['madinaNatural', 'madinaCalligraphic', 'madina', 'hafsPlus', 'hafs', 'amiri'];

const layout = { pages: MADINA05_PAGES, pageTextChecksums: PAGE_TEXT_CHECKSUMS, surahAyahCounts: SURAH_AYAH_COUNTS };
type FontData = UnicodeMushafData & { options: LayoutOptions; fallbackMetrics: FontMetrics | null };
const font = (base: Omit<FontData, 'measureEm' | keyof typeof layout>): FontData => ({ ...layout, ...base, measureEm: base.options.measureEm });

const HAFS = { groupWidths: HAFS_GROUP_WIDTHS, fontMetrics: HAFS_FONT_METRICS, displayEncoding: HAFS_DISPLAY_ENCODING as DisplayEncoding, fallbackMetrics: HAFS_FALLBACK_METRICS };
const MADINA = { groupWidths: MADINA_GROUP_WIDTHS, fontMetrics: MADINA_FONT_METRICS, displayEncoding: MADINA_DISPLAY_ENCODING as DisplayEncoding, fallbackMetrics: MADINA_FALLBACK_METRICS };

export const UNICODE_MUSHAF_FONTS: Readonly<Record<UnicodeFontId, FontData>> = {
  hafs: font({ ...HAFS, options: KFGQPC_OPTIONS }),
  hafsPlus: font({ ...HAFS, options: { measureEm: 19.5, gapSoftMaxEm: 0.55, gapMinEm: 0.1, kashida: { max: 2, looseMax: 5, looseGapEm: 1 }, elongation: null, narrow: false } }),
  madina: font({ ...MADINA, options: { measureEm: 18.5, gapSoftMaxEm: 2, gapMinEm: 0.1, kashida: null, elongation: null, narrow: true } }),
  madinaCalligraphic: font({ ...MADINA, options: { measureEm: 18, gapSoftMaxEm: 0.2, gapMinEm: 0.08, kashida: null, elongation: { maxLevel: 12, wordsPerElongation: 3, firstPassLevel: 4 }, narrow: true } }),
  madinaNatural: font({
    ...MADINA,
    options: {
      measureEm: 17.25, gapSoftMaxEm: 0.25, gapMinEm: 0.08, kashida: null, elongation: null, narrow: true, widthShare: 1.02,
      natural: { gapEm: 0.25, elongation: { maxLevel: 3, maxEm: 0.42, maxShare: 0.35, minWordEm: 1, wordsPerElongation: 3 }, gapMaxEm: 0.45, underfillMaxEm: 2 },
    },
  }),
  amiri: font({ groupWidths: AMIRI_GROUP_WIDTHS, fontMetrics: AMIRI_FONT_METRICS, displayEncoding: AMIRI_DISPLAY_ENCODING, fallbackMetrics: null, options: KFGQPC_OPTIONS }),
};

/** The first prototype's data (tests and tools). */
export const UNICODE_MUSHAF_DATA = UNICODE_MUSHAF_FONTS.hafs;

export { MADINA05_LAYOUT_SOURCE, TAJWEED_RULES, TAJWEED_SOURCE };

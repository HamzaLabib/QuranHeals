/**
 * Unicode Mushaf prototype — everything the reader needs, behind one module that app/(tabs)/mushaf.tsx requires only
 * in development builds (`typeof __DEV__ !== 'undefined' && __DEV__ ? require(…) : null`): Metro inlines __DEV__ and
 * folds that branch to null before collecting dependencies, so no prototype code, data or font is in a release bundle.
 *
 * The production QPC V1 reader stays the default and is unchanged. See docs/unicode-mushaf/feasibility-report.md.
 */
import { UnicodeMushafPageText } from '@/components/UnicodeMushafPageText';
import { getVerseByKey } from '@/services/quran';

import { TAJWEED_RULES, UNICODE_FONT_IDS, UNICODE_MUSHAF_FONTS, type UnicodeFontId } from './data';
import { AMIRI_QURAN_FONT, ensureUnicodeFont, MADINA_FONT, UNICODE_FONT } from './font';
import { checkUnicodePage } from './integrity';
import { decodePage, layoutPage, pageVerseIndexes, verseKeyOf, type FontMetrics, type LaidPage } from './layout';
import { loadPrototypeSettings, savePrototypeSettings, TAJWEED_COLORS_LABEL } from './settings';
import { TAJWEED_PALETTES, tajweedSpans } from './tajweed';

export { UnicodeMushafPageText, ensureUnicodeFont, loadPrototypeSettings, savePrototypeSettings, TAJWEED_COLORS_LABEL };
export { UNICODE_FONT_IDS };
export type { UnicodeFontId };

/** The development chip's short label for each rendering. */
export const UNICODE_FONT_LABELS: Readonly<Record<UnicodeFontId, string>> = { hafs: 'KF', hafsPlus: 'A·KF+', madina: 'B·Mad', madinaCalligraphic: 'C·Mad✦', madinaNatural: 'C2·Mad', amiri: 'Am' };

const layoutData = UNICODE_MUSHAF_FONTS.hafs; // the layout tables are the same for both fonts
const em = (m: FontMetrics) => ({ ascentEm: m.ascent / m.unitsPerEm, descentEm: m.descent / m.unitsPerEm });

/** How a font draws: its family, line box, display encoding, and the fallback for words it cannot draw. */
export function unicodeFontProps(font: UnicodeFontId) {
  const data = UNICODE_MUSHAF_FONTS[font];
  return {
    fontFamily: font === 'hafs' || font === 'hafsPlus' ? UNICODE_FONT.family : font === 'amiri' ? AMIRI_QURAN_FONT.family : MADINA_FONT.family,
    ...em(data.fontMetrics),
    // QH Old Madina: hhea 1500/700 with no line gap, OS/2 typo 1500/700 with a 200 line gap: by the TextKit rule its
    // baseline would be drawn (2200 − 700 − 200) − 1500 = −200 units = 0.2 em high on iOS; KFGQPC and Amiri have equal
    // sets (0). A prediction until device screenshots confirm it (docs/unicode-mushaf/device-testing-checklist.md).
    iosShiftEm: font.startsWith('madina') ? 0.2 : 0,
    displayEncoding: data.displayEncoding,
    fallback: data.fallbackMetrics ? { fontFamily: AMIRI_QURAN_FONT.family, ...em(data.fallbackMetrics) } : null,
  };
}

/** A page ready to draw: its verified verse texts (by verse index), checked against the layout. */
export type UnicodePageText = { page: number; font: UnicodeFontId; texts: ReadonlyMap<number, string>; firstVerseKey: string };

/**
 * Reads a page's verses from the verified SQLite (and 1:1 for a Basmala line) and checks them (integrity.ts): the text
 * must be exactly the one the layout was generated from, and the page must draw it exactly.
 */
export async function loadUnicodePage(page: number, font: UnicodeFontId = 'hafs'): Promise<{ ok: true; text: UnicodePageText } | { ok: false; problems: string[] }> {
  const lines = decodePage(layoutData, page);
  const indexes = pageVerseIndexes(lines);
  if (lines.some((line) => line.kind === 'basmala')) indexes.push(0);
  const texts = new Map<number, string>();
  for (const index of new Set(indexes)) texts.set(index, (await getVerseByKey(verseKeyOf(layoutData, index))).arabicText);
  const verseText = (index: number) => {
    const text = texts.get(index);
    if (text === undefined) throw new Error(`verse ${verseKeyOf(layoutData, index)} not loaded`);
    return text;
  };
  const check = checkUnicodePage(UNICODE_MUSHAF_FONTS[font], page, verseText);
  if (!check.ok) return { ok: false, problems: check.problems };
  return { ok: true, text: { page, font, texts, firstVerseKey: verseKeyOf(layoutData, pageVerseIndexes(lines)[0]) } };
}

const laidCache = new Map<string, LaidPage>();
/** The page laid out for a text area `width` px wide (cached: the reader draws the page and its neighbours). */
export function laidUnicodePage(text: UnicodePageText, width: number): LaidPage {
  const key = `${text.font}|${text.page}|${width}`;
  let laid = laidCache.get(key);
  if (!laid) {
    laid = layoutPage(UNICODE_MUSHAF_FONTS[text.font], text.page, width, (index) => text.texts.get(index) ?? '');
    if (laidCache.size > 12) laidCache.clear();
    laidCache.set(key, laid);
  }
  return laid;
}

const spans = (verseIndex: number) => tajweedSpans(TAJWEED_RULES, verseIndex);
const TAJWEED = { light: { spans, palette: TAJWEED_PALETTES.light }, dark: { spans, palette: TAJWEED_PALETTES.dark } } as const;
/** Tajweed Colors ON: the rule spans and the palette for Light or Dark. */
export const tajweedColours = (dark: boolean) => TAJWEED[dark ? 'dark' : 'light'];

/**
 * Ayah-end medallions for the QPC V1 renderer, on all 604 pages: the Quran
 * SVG pages' own artwork (quran-ws/quran-svg v1.1.1, KFGQPC), copied
 * verbatim by tools/mushaf/extract-ayah-marker-artwork.mjs into
 * generated/ayahMarkerArtwork.ts. All 6,236 medallions of the 604 SVG pages
 * share one ornament (page 61's, byte for byte); each ayah number 1–286 has
 * one authentic tracing. Every page takes the same path: until 2026-10-12
 * only page 61 had artwork, and every other page kept the font's own plain
 * marker glyph (the green outline seen on pages 1, 2, 322, 323, 465, 466…).
 * generated/ayahMarkers061.ts stays as the approved page-61 reference the
 * tests compare against.
 *
 * The QCF V1 font draws an ayah's marker and number as one glyph. That
 * glyph stays in the line, unchanged, so word positions, justification and
 * the tap-to-ayah mapping are exactly those of the font; it is only painted
 * transparent, and the medallion is drawn over its ring
 * (generated/ayahMarkerInk.ts: each marker glyph's ring, from its own page
 * font, since rings differ in size and position — smaller on pages 1–2).
 */

import { AYAH_MARKER_ARTWORK } from './generated/ayahMarkerArtwork';
import { AYAH_MARKER_INK } from './generated/ayahMarkerInk';

export type PageBox = { x: number; y: number; width: number; height: number };

/** Page 61's own medallions (generated/ayahMarkers061.ts): the approved reference. */
export type AyahMarkerArtwork = {
  page: number;
  svgSha256: string;
  /** The ornament, shared by every marker (its own coordinates). */
  ornamentPath: string;
  markers: {
    verseKey: string;
    ayah: number;
    /** From the artwork's coordinates to the Quran SVG page's (0 0 345 550). */
    ornamentTransform: string;
    numberTransform: string;
    numberPath: string;
    ornamentBox: PageBox;
    numberBox: PageBox;
  }[];
};

/** The medallions of all 604 pages (generated/ayahMarkerArtwork.ts), in page 61's frame. */
export type AyahMarkerArtworkSet = {
  source: { repository: string; tag: string; commit: string; edition: string };
  ornamentSha256: string;
  ornamentPath: string;
  ornamentTransform: string;
  ornamentBox: PageBox;
  numbers: { ayah: number; numberTransform: string; numberPath: string; numberBox: PageBox; source: { page: number; verseKey: string } }[];
};

/** A marker glyph's ring in its page font: font units (QCF_V1_METRICS.unitsPerEm). */
export type MarkerInk = { xMin: number; xMax: number; yMin: number; yMax: number };

export type AyahMarker = AyahMarkerArtwork['markers'][number] & { ornamentPath: string; ink: MarkerInk };

/**
 * The medallion for an ayah's marker on a page, or null when that ayah's
 * marker is not on that page (the font's glyph is then kept).
 */
export function getAyahMarker(page: number, verseKey: string): AyahMarker | null {
  const ink = AYAH_MARKER_INK[verseKey];
  const ayah = Number(verseKey.split(':')[1]);
  const number = AYAH_MARKER_ARTWORK.numbers[ayah - 1];
  if (!ink || ink[0] !== page || number?.ayah !== ayah) return null;
  const { ornamentPath, ornamentTransform, ornamentBox } = AYAH_MARKER_ARTWORK;
  return {
    verseKey,
    ayah,
    ornamentPath,
    ornamentTransform,
    ornamentBox,
    numberTransform: number.numberTransform,
    numberPath: number.numberPath,
    numberBox: number.numberBox,
    ink: { xMin: ink[1], xMax: ink[2], yMin: ink[3], yMax: ink[4] },
  };
}

/**
 * QCF V1 page-font metrics, read from p61.ttf (fontTools): units per em,
 * hhea ascent/descent, and the exact curve bounds of page 61's marker glyph
 * (the same for all eight markers on that page; other pages' rings are in
 * generated/ayahMarkerInk.ts).
 */
export const QCF_V1_METRICS = {
  unitsPerEm: 2048,
  ascent: 2541,
  descent: 1378,
  markerInk: { xMin: 2, xMax: 2546, yMin: -574, yMax: 1785 },
} as const;

/**
 * Height of every QPC V1 glyph's text box, in em: the page fonts' own line
 * (hhea ascent + descent). Audited on 2026-10-12 over all 604 page fonts
 * (603 use 2541 + 1378 of 2048 units; page 237 uses 2327 + 1331) and all
 * 88,444 glyphs of the 83,665 words: every glyph's outline lies inside its
 * font's ascent and descent, so a box this tall contains the whole of every
 * glyph — harakat, shadda, sukun, hamza, madd and the small Quranic letters
 * above, kasra and descenders below.
 *
 * A shorter box clips them on iOS and Android, which draw a Text only within
 * its bounds (the web does not, so the browser hid the problem): the former
 * 1.3 em box left 19,977 of those glyphs (22.6 %, on every page) partly
 * outside it, by up to 0.31 em. Centred in its line, a taller box moves no
 * glyph: the baseline stays (ascent − descent) ÷ 2 below the line's centre.
 * Equal to the font's own line, it also leaves no leading for a platform to
 * place differently.
 */
export const QCF_V1_LINE_BOX_EM = (QCF_V1_METRICS.ascent + QCF_V1_METRICS.descent) / QCF_V1_METRICS.unitsPerEm;

/**
 * The page fonts' vertical metrics (font units): hhea ascent/descent, which the layout centres in the line box
 * (cssBaseline), and the OS/2 typo descender and line gap. 603 fonts share them; page 237's differ (read 2026-10-12
 * from all 604 fonts).
 */
const QCF_V1_LINE_METRICS = { ascent: 2541, descent: 1378, typoDescent: 403, typoLineGap: 205 } as const;
const QCF_V1_LINE_METRICS_BY_PAGE: Readonly<Record<number, typeof QCF_V1_LINE_METRICS | { ascent: number; descent: number; typoDescent: number; typoLineGap: number }>> = {
  237: { ascent: 2327, descent: 1331, typoDescent: 410, typoLineGap: 0 },
};

/** Where the layout puts a page's glyph baseline, in font units below its line box's top (its hhea line centred). */
export function qcfV1IntendedBaselineUnits(page: number): number {
  const m = QCF_V1_LINE_METRICS_BY_PAGE[page] ?? QCF_V1_LINE_METRICS;
  return (QCF_V1_LINE_BOX_EM * QCF_V1_METRICS.unitsPerEm - (m.ascent + m.descent)) / 2 + m.ascent;
}

/**
 * How far below the layout's line the platform draws a page's glyphs, in em (0 where it draws them as laid out).
 *
 * The layout centres the font's hhea line in each glyph's line box (as CSS, the web, and Android's line-height span
 * do). iOS does not: TextKit sets the font's OS/2 line at the bottom of the box, the baseline above the typo descender
 * and line gap. Measured on the iPhone (2026-10-12): every line of pages 5, 61 and 466 drawn 770 units (0.376 em,
 * 8.2–8.6 pt) lower = 3311 − 2541, the rule below. The text keeps that (approved) position; the selection highlight and
 * taps use this so that they follow the words as drawn. Page 237's value follows the same rule from its own metrics
 * (not measured on a device).
 */
/**
 * Android: draw the Quran lines where the approved iPhone rendering draws them. Android places a QPC V1 glyph's
 * baseline where the layout means it (CustomLineHeightSpan centres the font's line in the box, as CSS does), 0.376 em
 * above the iPhone's (qcfV1DrawnLineShiftEm). The approved page (MUSHAF_TEXT_LIFT_PT included) was judged on the
 * iPhone, so on Android the Quran rows (lines and Basmala; not the Amiri headings) move down by the iPhone's amount:
 * every glyph, mark, medallion, highlight and tap target then sits where it does on the iPhone, relative to the frame.
 * false: Android draws at the layout's own baseline (MUSHAF_TEXT_LIFT_PT above it).
 */
export const ANDROID_MATCHES_IPHONE_BASELINE = true;

/** Android only: how far the Quran rows of `page` move down to match the iPhone, in em (see ANDROID_MATCHES_IPHONE_BASELINE). */
export function qcfV1AndroidRowShiftEm(page: number, os: string): number {
  return os === 'android' && ANDROID_MATCHES_IPHONE_BASELINE ? qcfV1DrawnLineShiftEm(page, 'ios') : 0;
}

/**
 * Surah headings follow the Quran lines (2026-10-12): the heading row's contents (ornament and name) move down by
 * as much as the platform draws the page's Quran glyphs below the layout (iOS: qcfV1DrawnLineShiftEm; Android: the
 * rows themselves, qcfV1AndroidRowShiftEm; the web: 0), plus HEADING_CLEARANCE_PITCH of the row. Without it, on the
 * iPhone and Android the line above a mid-page heading reached 3.0–8.5 pt into the heading row and the ornament, drawn
 * after it, covered its descenders and medallions (page 293's ayah 111). Checked against every heading's real ink
 * (mobile/tests/surahHeadingClearance.test.ts).
 */
export const HEADING_CLEARANCE_PITCH = 0.045;

/** How far a Surah heading row's contents move down, in pt, for a page at `fontSize` with rows `rowPitch` apart. */
export function surahHeadingShift(page: number, os: string, fontSize: number, rowPitch: number): number {
  return (qcfV1DrawnLineShiftEm(page, os) + qcfV1AndroidRowShiftEm(page, os)) * fontSize + HEADING_CLEARANCE_PITCH * rowPitch;
}

export function qcfV1DrawnLineShiftEm(page: number, os: string): number {
  if (os !== 'ios') return 0;
  const m = QCF_V1_LINE_METRICS_BY_PAGE[page] ?? QCF_V1_LINE_METRICS;
  const box = QCF_V1_LINE_BOX_EM * QCF_V1_METRICS.unitsPerEm;
  const drawn = box - m.typoDescent - m.typoLineGap;
  const intended = (box - (m.ascent + m.descent)) / 2 + m.ascent;
  return (drawn - intended) / QCF_V1_METRICS.unitsPerEm;
}

/**
 * Room each glyph's Text gets on both sides of its advance, in em.
 *
 * QCF V1 words draw ink outside their own advance: audited on 2026-10-12
 * over the 604 page fonts and all 83,665 words, 54,179 (65 %, on every
 * page) have outline outside it — the dots and tooth of an initial ت (39:57
 * تَقُولَ on page 465 then reads نقول), the kasra under an initial إِ, the
 * hamzat al-wasl of ٱ, fatha tips, and every waqf sign (صلى, قلى, ج, م, لا),
 * which the font places wholly outside the word it follows. The most is
 * 2.28 em to the left (page 272, line 9, word 4) and 2.33 em to the right
 * (page 524, line 7, word 8).
 *
 * iOS and Android draw a Text only within its own frame; a Text exactly as
 * wide as its advance clipped all of that (the web does not clip, so the
 * browser hid it, as it had hidden the vertical clipping). The word's
 * wrapper keeps the advance — positions, justification, taps and highlights
 * are unchanged — and its Text extends this far past both edges (negative
 * margin, equal padding), so the glyph sits exactly where it did.
 */
export const QCF_V1_INK_OVERFLOW_EM = 2.4;

/**
 * Room each drawn glyph's Text gets above and below its line box, in em.
 * The box (QCF_V1_LINE_BOX_EM) holds every outline, but with no slack: ink
 * reaches 1 font unit from its bottom on page 466 (−1377 of −1378) and 1–3
 * from its top on pages 322–323 (2540, 2538 of 2541). iOS snaps Text
 * frames and baselines to device pixels and antialiases half a pixel past
 * the outline, so those extreme rows could be cut. Pages 1 and 565 also set
 * USE_TYPO_METRICS (OS/2 line 1564 + 403 + 205): a platform honouring it
 * places their baseline differently. Like the horizontal room, margin and
 * padding cancel: line spacing, rows and glyph positions are unchanged;
 * only the area the platform may paint grows.
 */
export const QCF_V1_INK_ROOM_V_EM = 0.5;

/**
 * Normal Mode only: each drawn glyph's container (its Text box) is the
 * font's line plus this much above and below, in em — padding around an
 * unchanged line box — so the frame iOS paints in holds every glyph with
 * room to spare.
 *
 * Needed: the font's line has no slack (ink at −1377 of −1378 units on page
 * 466, 2540 of 2541 on page 322: 7 lines on a 393-pt iPhone, 14 on an
 * iPhone SE, had under 1.5 device pixels; tools/mushaf-audit/
 * audit_vertical_boxes.py). Sized for the worst placement a platform could
 * choose: pages 1 and 565 set USE_TYPO_METRICS (OS/2 1564 + 403, gap 205);
 * a platform honouring it could set their glyphs up to 101.5 + 205 = 306.5
 * units (0.15 em) lower; plus pixel snapping and antialiasing (1.5 device
 * pixels ≈ 0.03 em at the smallest iPhone text). 0.25 em covers both.
 *
 * Nothing moves: the line height (QCF_V1_LINE_BOX_EM) and so each glyph's
 * place in its line box are unchanged, the taller box stays centred in its
 * row, and the row and pitch are unchanged. (A taller lineHeight was tried
 * first: it is centred too, but browsers snap the baseline to a whole pixel
 * and some lines moved by 1 px.) Full-Screen does not use it.
 */
export const QCF_V1_NORMAL_BOX_MARGIN_EM = 0.25;
/** Normal Mode's drawn-glyph container height, in em (the font's line + the margin above and below). */
export const QCF_V1_NORMAL_LINE_BOX_EM = QCF_V1_LINE_BOX_EM + 2 * QCF_V1_NORMAL_BOX_MARGIN_EM;

/**
 * Medallion height ÷ the font's marker ink height. The printed medallions
 * are ≈ 42 × 35 px at a 52 px line pitch (0.82 of the pitch tall); this
 * gives 0.82 too. The artwork is narrower than the print's, so it stays
 * well inside the glyph's advance.
 */
export const MARKER_SCALE = 1.1;

/**
 * The baseline's distance from the top of a Text line box when the
 * platform can't report it (web): CSS centres the font's ascent + descent
 * in the line height. Chrome then snaps it to a whole pixel (measured 19
 * for 19.25), so the medallion is within half a pixel there.
 */
export function cssBaseline(fontSize: number, lineHeight: number): number {
  const { unitsPerEm, ascent, descent } = QCF_V1_METRICS;
  return (lineHeight - ((ascent + descent) / unitsPerEm) * fontSize) / 2 + (ascent / unitsPerEm) * fontSize;
}

/**
 * Where the medallion goes, relative to the marker glyph's Text box (its
 * advance): centred on the glyph's own ring, MARKER_SCALE of the ring's
 * height, in the ornament's proportions — so it is as large as the print's
 * ring on that page (pages 1–2 and some later pages set smaller rings).
 */
export function markerOverlayBox(marker: AyahMarker, fontSize: number, baseline: number): PageBox {
  const em = fontSize / QCF_V1_METRICS.unitsPerEm;
  const { xMin, xMax, yMin, yMax } = marker.ink;
  const height = (yMax - yMin) * em * MARKER_SCALE;
  const width = height * (marker.ornamentBox.width / marker.ornamentBox.height);
  const centreX = ((xMin + xMax) / 2) * em;
  const centreY = baseline - ((yMax + yMin) / 2) * em;
  return { x: centreX - width / 2, y: centreY - height / 2, width, height };
}

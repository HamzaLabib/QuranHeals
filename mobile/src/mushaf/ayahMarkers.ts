/**
 * Ayah-end medallions for the QPC V1 renderer, drawn from the Quran SVG
 * page's own artwork (generated/ayahMarkers061.ts, copied verbatim by
 * tools/mushaf/extract-ayah-markers.mjs).
 *
 * The QCF V1 font draws an ayah's marker and number as one glyph. That
 * glyph stays in the line, unchanged, so word positions, justification and
 * the tap-to-ayah mapping are exactly those of the font; it is only painted
 * transparent, and the medallion is drawn over the box its ink occupied.
 */

import { AYAH_MARKERS_061 } from './generated/ayahMarkers061';

export type PageBox = { x: number; y: number; width: number; height: number };

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

export type AyahMarker = AyahMarkerArtwork['markers'][number] & { ornamentPath: string };

const ARTWORK: Readonly<Record<number, AyahMarkerArtwork>> = { 61: AYAH_MARKERS_061 };

/** The medallion artwork for an ayah on a page, or null (the font's glyph is then kept). */
export function getAyahMarker(page: number, verseKey: string): AyahMarker | null {
  const artwork = ARTWORK[page];
  const marker = artwork?.markers.find((entry) => entry.verseKey === verseKey);
  return artwork && marker ? { ...marker, ornamentPath: artwork.ornamentPath } : null;
}

/**
 * QCF V1 page-font metrics, read from p61.ttf (fontTools): units per em,
 * hhea ascent/descent, and the exact curve bounds of the marker glyph
 * (the same for all eight markers on the page; ≈ one advance wide).
 */
export const QCF_V1_METRICS = {
  unitsPerEm: 2048,
  ascent: 2541,
  descent: 1378,
  markerInk: { xMin: 2, xMax: 2546, yMin: -574, yMax: 1785 },
} as const;

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
 * Where the medallion goes, relative to the marker glyph's Text box: centred
 * on the glyph's own ink (horizontally on its advance), MARKER_SCALE of its
 * height, in the ornament's proportions.
 */
export function markerOverlayBox(marker: AyahMarker, fontSize: number, baseline: number, boxWidth: number): PageBox {
  const { unitsPerEm, markerInk } = QCF_V1_METRICS;
  const em = fontSize / unitsPerEm;
  const inkHeight = (markerInk.yMax - markerInk.yMin) * em;
  const centreY = baseline - ((markerInk.yMax + markerInk.yMin) / 2) * em;
  const height = inkHeight * MARKER_SCALE;
  const width = height * (marker.ornamentBox.width / marker.ornamentBox.height);
  return { x: boxWidth / 2 - width / 2, y: centreY - height / 2, width, height };
}

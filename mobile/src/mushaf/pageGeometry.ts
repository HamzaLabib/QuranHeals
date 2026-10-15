/**
 * Printed-page geometry of the 1405 AH Madani Mushaf, measured from the
 * reference scan of page 61 (`Reference Design.jpg`, 707 × 1024 px) and
 * reduced to proportions so any renderer (the current SVG page, or QPC V1
 * glyph lines later) and the future vector border share one layout.
 *
 * Measured (reference px): outer brown rule x 20.5–613.5, y 95–951; inner
 * rule's inner edge x 49.5–584.5, y 124–921; border motif period 29.5 px
 * (one square tile per band width); 15 text lines, pitch 52.0 px, ink
 * x 77–561, y 133–909; juz'/surah headers centred 35 px above the frame,
 * flush with its edges; page number 20 px below it, centred. The scan is
 * rotated by ~0.4°, so individual edges vary by ±2 px.
 *
 * The border is modelled as a ring of square tiles, 20 across × 29 down
 * (corners shared): 593/20 = 29.7 and 856/29 = 29.5 px, within the scan's
 * error. Everything below is a fraction of the frame's outer width.
 */

export const BORDER_TILES_ACROSS = 20;
export const BORDER_TILES_DOWN = 29;

/** The printed page's plain margin between the inner rule and the text, each side (reference ink margins, rounded up). */
export const PRINTED_TEXT_INSET_X = 25 / 593;
/** The printed page's text width, as a share of the page width (the 1405 print's own proportions). */
export const PRINTED_TEXT_WIDTH_SHARE = 1 - 2 / BORDER_TILES_ACROSS - 2 * PRINTED_TEXT_INSET_X;
/**
 * Larger Quran text (approved 2026-10-14, candidate C: design-archive/experiments/larger-text-mushaf/): the text area,
 * and with it every QPC V1 glyph (the widest line fills the width), is this much wider than the print's, on the same
 * page width. The extra width comes only from the plain paper margin inside the frame (textInsetX below); the border
 * tiles, the page width and every line's words are unchanged. 1 restores the printed proportions (the original
 * geometry: design-archive/mushaf-page-layout-v1/).
 */
export const QURAN_TEXT_SCALE = 1.05;

/** Frame outer height ÷ width (29/20; the scan measures 1.4435). */
export const FRAME_ASPECT = BORDER_TILES_DOWN / BORDER_TILES_ACROSS;

export const PAGE_GEOMETRY = {
  /** One border tile = the band width (outer rule's outer edge → inner rule's inner edge). */
  tile: 1 / BORDER_TILES_ACROSS,
  /** Each brown rule, as a fraction of the frame width (≈ 4 px of 593). */
  rule: 4 / 593,
  /** Text safe area inside the inner rule: the print's (PRINTED_TEXT_INSET_X), narrowed for QURAN_TEXT_SCALE. */
  textInsetX: (1 - 2 / BORDER_TILES_ACROSS - QURAN_TEXT_SCALE * PRINTED_TEXT_WIDTH_SHARE) / 2,
  textInsetY: 10 / 593,
  lineCount: 15,
  /** Header text: size, and the gap below its line box (heads centred 35 px above the frame). */
  headerFontSize: 18 / 593,
  headerGap: 20.6 / 593,
  pageNumberFontSize: 18 / 593,
  pageNumberGap: 16 / 593,
} as const;

/** Colours sampled from the reference scan (paper, rules, band, medallions). */
export const REFERENCE_COLORS = {
  paper: '#F9F5DA',
  rule: '#826641',
  bandGround: '#E4F1D5',
  bandGreen: '#607A57',
  bandMint: '#B0D0A7',
  /** Anti-aliased average of the medallion ink; the solid fill is darker. */
  medallionAverage: '#7D9A71',
} as const;

export type Box = { x: number; y: number; width: number; height: number };

export type PageLayout = {
  /** The whole printed page including headers and page number. */
  page: { width: number; height: number };
  header: Box;
  frame: Box;
  /** Square border tile side. */
  tile: number;
  rule: number;
  /** Inside the inner rule. */
  inner: Box;
  /** Where Quran text may be drawn. */
  text: Box;
  /** Distance between the 15 lines' centres when text fills `text`. */
  linePitch: number;
  pageNumber: Box;
  headerFontSize: number;
  pageNumberFontSize: number;
};

/** The margin between the text area and the frame's inner edge, left and right, for a text area `textWidth` wide. */
export function textSideInset(textWidth: number): number {
  const g = PAGE_GEOMETRY;
  return (textWidth / (1 - 2 * g.tile - 2 * g.textInsetX)) * g.textInsetX;
}

/** The page width whose text area is `textWidth` wide. */
export function pageWidthOfText(textWidth: number): number {
  const g = PAGE_GEOMETRY;
  return textWidth / (1 - 2 * g.tile - 2 * g.textInsetX);
}

/** The margin between the text area and the frame's inner edge, top and bottom, for a text area `textWidth` wide. */
export function textVerticalInset(textWidth: number): number {
  const g = PAGE_GEOMETRY;
  return (textWidth / (1 - 2 * g.tile - 2 * g.textInsetX)) * g.textInsetY;
}

/**
 * The web's lift (2026-10-12): the whole Quran text area drawn this many points higher than the printed layout's
 * text area. On iOS and Android the lift is proportional instead (mushafTextLift). Until 2026-10-15 this fixed lift
 * applied on every platform.
 */
export const MUSHAF_TEXT_LIFT_PT = 4;

/**
 * iOS and Android: the lift, as a share of the letter size (2026-10-15). The iPhone draws QPC V1 glyphs 0.376 em below
 * the layout's baseline (qcfV1DrawnLineShiftEm; Android's rows follow it), a drop that grows with the letter size, so
 * the fixed 4 pt lift left the last line's descenders across the frame's inner rule on 8 pages of current iPhones
 * (docs/mushaf-verification/2026-10-15-final-604-page-verification.md, issue 1). Approved 2026-10-15.
 */
export const NATIVE_TEXT_LIFT_EM = 0.26;

/**
 * The regular pages' letter size, as a share of the text area's width: their median (pages 3–604), the size
 * QpcV1PageText's OPENING_PAGE_SIZE_PER_WIDTH gives on the printed width, here on the QURAN_TEXT_SCALE-wider text area.
 * Each page's own size is measured only once it is drawn; the lift uses this, so every page of a width sits alike.
 */
export const NOMINAL_LETTER_SIZE_PER_TEXT_WIDTH = 0.0692;

/**
 * How far the whole Quran text area — every line, Surah heading, Basmala, medallion, highlight and tap target (all are
 * inside it), pages 1–2 included — is drawn above the printed layout's text area, on every page, in Normal and
 * Full-Screen. Applied once, in MushafPageView; everything that needs the frame's edge in text-area coordinates uses
 * this same value. The frame, page size, letter size, line spacing and horizontal positions are unchanged.
 *  - iOS and Android: NATIVE_TEXT_LIFT_EM × the nominal letter size for a text area `textWidth` wide.
 *  - Web (and any other platform): MUSHAF_TEXT_LIFT_PT; the web draws glyphs at the layout's own baseline.
 */
export function mushafTextLift(textWidth: number, os: string): number {
  return os === 'ios' || os === 'android' ? NATIVE_TEXT_LIFT_EM * NOMINAL_LETTER_SIZE_PER_TEXT_WIDTH * textWidth : MUSHAF_TEXT_LIFT_PT;
}

/**
 * Lays out a printed page `width` points wide (the frame spans the full width).
 *
 * `tilesDown` is the frame's height in border tiles: 29 for the printed page
 * (the default, always used outside the Mobile-Optimized experiment). A
 * taller frame repeats the same square tiles further down its sides — never
 * stretched — and gives the 15 lines more space between them; the glyphs
 * keep the size the page width gives them.
 */
export function computePageLayout(width: number, tilesDown: number = BORDER_TILES_DOWN): PageLayout {
  if (!Number.isFinite(width) || width <= 0) throw new Error('Page width must be positive');
  if (!Number.isInteger(tilesDown) || tilesDown < BORDER_TILES_DOWN) throw new Error('A frame is at least the printed 29 tiles tall, in whole tiles');
  const g = PAGE_GEOMETRY;
  const tile = width * g.tile;
  const rule = Math.max(1, width * g.rule);
  const headerFontSize = width * g.headerFontSize;
  const headerHeight = headerFontSize * 1.6;
  const header: Box = { x: 0, y: 0, width, height: headerHeight };
  const frame: Box = { x: 0, y: headerHeight + width * g.headerGap, width, height: (width * tilesDown) / BORDER_TILES_ACROSS };
  const inner: Box = {
    x: frame.x + tile,
    y: frame.y + tile,
    width: frame.width - 2 * tile,
    height: frame.height - 2 * tile,
  };
  const text: Box = {
    x: inner.x + width * g.textInsetX,
    y: inner.y + width * g.textInsetY,
    width: inner.width - 2 * width * g.textInsetX,
    height: inner.height - 2 * width * g.textInsetY,
  };
  const pageNumberFontSize = width * g.pageNumberFontSize;
  const pageNumber: Box = {
    x: 0,
    y: frame.y + frame.height + width * g.pageNumberGap,
    width,
    height: pageNumberFontSize * 1.6,
  };
  return {
    page: { width, height: pageNumber.y + pageNumber.height },
    header,
    frame,
    tile,
    rule,
    inner,
    text,
    linePitch: text.height / g.lineCount,
    pageNumber,
    headerFontSize,
    pageNumberFontSize,
  };
}

/** Largest box with the given aspect (height ÷ width) centred inside `box`. */
export function fitInside(box: Box, aspect: number): Box {
  const width = Math.min(box.width, box.height / aspect);
  const height = width * aspect;
  return { x: box.x + (box.width - width) / 2, y: box.y + (box.height - height) / 2, width, height };
}

/**
 * The shortest frame, in tiles, for QPC pages: the first whose line pitch is at least QURAN_TEXT_SCALE times the
 * printed one (31 tiles for 1.05), so the larger glyphs (candidate C) are never closer together, relative to their
 * size, than the print's: every line, heading, Basmala and medallion keeps at least the printed proportional
 * clearance. Where the height is short (iPhone SE, small Android), the page is narrowed until this frame fits.
 */
export const MIN_TILES_DOWN = (() => {
  const printedPitch = computePageLayout(1000).linePitch;
  let tiles = BORDER_TILES_DOWN;
  while (computePageLayout(1000, tiles).linePitch < printedPitch * QURAN_TEXT_SCALE) tiles += 1;
  return tiles;
})();

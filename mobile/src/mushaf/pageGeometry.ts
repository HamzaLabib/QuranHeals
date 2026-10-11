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

/** Frame outer height ÷ width (29/20; the scan measures 1.4435). */
export const FRAME_ASPECT = BORDER_TILES_DOWN / BORDER_TILES_ACROSS;

export const PAGE_GEOMETRY = {
  /** One border tile = the band width (outer rule's outer edge → inner rule's inner edge). */
  tile: 1 / BORDER_TILES_ACROSS,
  /** Each brown rule, as a fraction of the frame width (≈ 4 px of 593). */
  rule: 4 / 593,
  /** Text safe area inside the inner rule (reference ink margins, rounded up). */
  textInsetX: 25 / 593,
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

/** Lays out a printed page `width` points wide (the frame spans the full width). */
export function computePageLayout(width: number): PageLayout {
  if (!Number.isFinite(width) || width <= 0) throw new Error('Page width must be positive');
  const g = PAGE_GEOMETRY;
  const tile = width * g.tile;
  const rule = Math.max(1, width * g.rule);
  const headerFontSize = width * g.headerFontSize;
  const headerHeight = headerFontSize * 1.6;
  const header: Box = { x: 0, y: 0, width, height: headerHeight };
  const frame: Box = { x: 0, y: headerHeight + width * g.headerGap, width, height: width * FRAME_ASPECT };
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

import { describe, expect, it } from 'vitest';

import {
  BORDER_TILES_ACROSS,
  BORDER_TILES_DOWN,
  computePageLayout,
  fitInside,
  FRAME_ASPECT,
  MIN_TILES_DOWN,
  PAGE_GEOMETRY,
  pageWidthOfText,
  PRINTED_TEXT_INSET_X,
  PRINTED_TEXT_WIDTH_SHARE,
  QURAN_TEXT_SCALE,
  textSideInset,
  textVerticalInset,
} from '@/mushaf/pageGeometry';

/** Page geometry measured from Reference Design.jpg (707 × 1024 px): frame, border tiles, safe text area. */

// At the reference's own scale the frame is 593 px wide (outer rule x 20.5–613.5).
const reference = computePageLayout(593);

describe('frame and border', () => {
  it('the frame is a ring of 20 × 29 square tiles, matching the measured 593 × 856 px within the scan`s ±2 px', () => {
    expect(BORDER_TILES_ACROSS).toBe(20);
    expect(BORDER_TILES_DOWN).toBe(29);
    expect(FRAME_ASPECT).toBe(1.45);
    expect(reference.frame.height).toBeCloseTo(856, -1); // 859.85 vs 856 measured
    expect(reference.tile).toBeCloseTo(29.65, 1); // measured motif period 29.5
    expect(reference.frame.width / reference.tile).toBeCloseTo(20);
    expect(reference.frame.height / reference.tile).toBeCloseTo(29);
  });

  it('the band is one tile between two ~4 px rules; the inner edge lands where the scan`s does', () => {
    expect(reference.rule).toBeCloseTo(4);
    // Measured inner edge: 29 px in from the outer edge on the left/top, 30 at the bottom.
    expect(reference.inner.x - reference.frame.x).toBeCloseTo(29.65, 1);
    expect(Math.abs(reference.inner.width - 535)).toBeLessThanOrEqual(2); // measured 584.5 − 49.5, scan error ±2 px
  });
});

describe('safe text area', () => {
  it('the printed proportions reproduce the reference ink block (484 × 776 px) and leave a margin inside the inner rule', () => {
    // The print's text width (PRINTED_TEXT_INSET_X), kept as the reference the larger text is measured from.
    expect(PRINTED_TEXT_INSET_X).toBe(25 / 593);
    expect(593 * PRINTED_TEXT_WIDTH_SHARE).toBeCloseTo(484, 0);
    expect(reference.text.width / QURAN_TEXT_SCALE).toBeCloseTo(484, 0);
    expect(reference.text.height).toBeGreaterThan(776);
    expect(reference.text.height).toBeLessThan(790);
    expect(reference.text.x).toBeGreaterThan(reference.inner.x);
    expect(reference.text.y).toBeGreaterThan(reference.inner.y);
    expect(reference.text.x + reference.text.width).toBeLessThan(reference.inner.x + reference.inner.width);
    expect(reference.text.y + reference.text.height).toBeLessThan(reference.inner.y + reference.inner.height);
  });

  it('15 lines at the measured 52 px pitch', () => {
    expect(PAGE_GEOMETRY.lineCount).toBe(15);
    expect(reference.linePitch).toBeCloseTo(52, 0);
  });

  it('the current SVG page (345 × 550) fits the printed text width almost exactly, and stays inside the wider text area', () => {
    const fitted = fitInside(reference.text, 550 / 345);
    // Its height decides now (the text area is wider, not taller): the same size as on the printed page, centred.
    expect(fitted.width / (593 * PRINTED_TEXT_WIDTH_SHARE)).toBeGreaterThan(0.98);
    expect(fitted.width).toBeLessThanOrEqual(reference.text.width);
    expect(fitted.x).toBeGreaterThan(reference.text.x);
    expect(fitted.height).toBeCloseTo(fitted.width * (550 / 345));
    expect(fitted.x).toBeGreaterThanOrEqual(reference.text.x);
    expect(fitted.y).toBeGreaterThanOrEqual(reference.text.y);
  });
});

describe('page furniture and scaling', () => {
  it('headers sit above the frame and the page number below it', () => {
    expect(reference.header.y + reference.header.height).toBeLessThanOrEqual(reference.frame.y);
    expect(reference.pageNumber.y).toBeGreaterThan(reference.frame.y + reference.frame.height);
    expect(reference.page.height).toBe(reference.pageNumber.y + reference.pageNumber.height);
  });

  it('scales linearly with width (rules never thinner than 1 pt) and rejects a non-positive width', () => {
    const half = computePageLayout(296.5);
    expect(half.frame.height).toBeCloseTo(reference.frame.height / 2);
    expect(half.text.width).toBeCloseTo(reference.text.width / 2);
    expect(computePageLayout(100).rule).toBe(1);
    expect(() => computePageLayout(0)).toThrow();
    expect(() => computePageLayout(Number.NaN)).toThrow();
  });
});

describe('text position: the printed layout, one lift for every page', () => {
  // The only vertical offset is MUSHAF_TEXT_LIFT_PT, applied once where the text area is drawn (MushafPageView); the
  // layout itself stays the printed one (no per-page shift, no other lift, no device baseline correction).
  it('the layout depends only on the width and the frame; the lift is a single constant', async () => {
    const geometry = await import('@/mushaf/pageGeometry');
    expect(geometry.MUSHAF_TEXT_LIFT_PT).toBe(4);
    expect('normalTextShift' in geometry).toBe(false);
    expect('NORMAL_TEXT_LIFT_PT' in geometry).toBe(false);
    expect(computePageLayout.length).toBeLessThanOrEqual(2);
    for (const [width, tiles] of [[317, 29], [387, 29], [434, 29], [387, 33], [406, 35]] as const) {
      const layout = computePageLayout(width, tiles);
      expect(layout.text.y - layout.inner.y).toBeCloseTo((width * 10) / 593, 9);
      expect(layout.text.height).toBeCloseTo(layout.inner.height - (2 * width * 10) / 593, 9);
    }
  });
});

describe('larger Quran text (candidate C, approved 2026-10-14)', () => {
  it('the text area is exactly QURAN_TEXT_SCALE (1.05) times the printed one, on the same page width', () => {
    expect(QURAN_TEXT_SCALE).toBe(1.05);
    for (const width of [290, 336, 384, 387, 406, 434]) {
      expect(computePageLayout(width).text.width / (width * PRINTED_TEXT_WIDTH_SHARE)).toBeCloseTo(1.05, 12);
    }
  });

  it('only the plain paper margin inside the inner rule is narrower: page, header, frame, tiles, inner edge, page number, the top and bottom margins unchanged', () => {
    const printedLayout = (width: number, tiles = BORDER_TILES_DOWN) => {
      // The printed geometry, recomputed independently from the reference proportions.
      const tile = width / 20;
      const headerHeight = width * (18 / 593) * 1.6;
      const frameY = headerHeight + width * (20.6 / 593);
      const frameHeight = (width * tiles) / 20;
      return { tile, frameY, frameHeight, insetY: width * (10 / 593), pageHeight: frameY + frameHeight + width * (16 / 593) + width * (18 / 593) * 1.6 };
    };
    for (const width of [290, 336, 384, 434]) for (const tiles of [29, 31, 33, 35]) {
      const layout = computePageLayout(width, tiles);
      const printed = printedLayout(width, tiles);
      expect(layout.tile).toBeCloseTo(printed.tile, 9);
      expect(layout.frame).toEqual({ x: 0, y: expect.closeTo(printed.frameY, 9), width, height: expect.closeTo(printed.frameHeight, 9) });
      expect(layout.page.height).toBeCloseTo(printed.pageHeight, 9);
      expect(layout.text.y - layout.inner.y).toBeCloseTo(printed.insetY, 9);
      expect(layout.text.height).toBeCloseTo(layout.inner.height - 2 * printed.insetY, 9);
      // The side margin: what the print had, less exactly the 5% extra text width, shared by both sides.
      const side = layout.text.x - layout.inner.x;
      expect(side).toBeCloseTo(width * PRINTED_TEXT_INSET_X - (width * PRINTED_TEXT_WIDTH_SHARE * (QURAN_TEXT_SCALE - 1)) / 2, 9);
      expect(side).toBeGreaterThan(width * 0.02); // 8.4 pt of plain paper on a 384-pt page (printed: 16.2)
      expect(layout.text.x + layout.text.width).toBeCloseTo(layout.inner.x + layout.inner.width - side, 9); // centred
      // The helpers the renderer uses agree with the layout.
      expect(textSideInset(layout.text.width)).toBeCloseTo(side, 9);
      expect(pageWidthOfText(layout.text.width)).toBeCloseTo(width, 9);
      expect(textVerticalInset(layout.text.width)).toBeCloseTo(printed.insetY, 9);
    }
  });

  it('the shortest frame for QPC pages keeps the printed spacing relative to the glyphs: 31 tiles, the first whose pitch is ≥ 1.05 × printed', () => {
    const printedPitch = computePageLayout(1000).linePitch;
    expect(MIN_TILES_DOWN).toBe(31);
    expect(computePageLayout(1000, MIN_TILES_DOWN).linePitch / printedPitch).toBeGreaterThanOrEqual(QURAN_TEXT_SCALE);
    expect(computePageLayout(1000, MIN_TILES_DOWN - 1).linePitch / printedPitch).toBeLessThan(QURAN_TEXT_SCALE);
  });
});

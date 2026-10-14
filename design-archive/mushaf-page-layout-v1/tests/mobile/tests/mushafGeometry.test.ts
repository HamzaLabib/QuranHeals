import { describe, expect, it } from 'vitest';

import {
  BORDER_TILES_ACROSS,
  BORDER_TILES_DOWN,
  computePageLayout,
  fitInside,
  FRAME_ASPECT,
  PAGE_GEOMETRY,
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
  it('reproduces the reference ink block (484 × 776 px) and leaves a margin inside the inner rule', () => {
    expect(reference.text.width).toBeCloseTo(484, 0);
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

  it('the current SVG page (345 × 550) fits the text area almost exactly', () => {
    const fitted = fitInside(reference.text, 550 / 345);
    expect(fitted.width / reference.text.width).toBeGreaterThan(0.98);
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

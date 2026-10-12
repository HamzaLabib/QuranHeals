import { describe, expect, it } from 'vitest';

import { clampPan, clampZoom, FLICK_DISTANCE, FLICK_VELOCITY, MAX_ZOOM, MIN_ZOOM, panBounds, SWIPE_DISTANCE, swipeTurn, ZOOM_SNAP, zoomAbout } from '@/mushaf/pageZoom';

/**
 * The Mushaf reader's pinch-to-zoom geometry (mushaf/pageZoom.ts), run on the
 * UI thread by MushafZoomView: zoom limits, pan bounds and zooming toward the
 * fingers. One axis at a time; the page scales about its own centre.
 */

describe('zoom limits', () => {
  it('1× (the fitted page) to 3×', () => {
    expect([MIN_ZOOM, MAX_ZOOM]).toEqual([1, 3]);
    expect(clampZoom(0.4)).toBe(1);
    expect(clampZoom(1.7)).toBe(1.7);
    expect(clampZoom(9)).toBe(3);
    expect(ZOOM_SNAP).toBeGreaterThan(1);
    expect(ZOOM_SNAP).toBeLessThan(1.05);
  });
});

describe('pan bounds', () => {
  // A phone: the page fills the width (390) and sits at the top of a taller viewport (655 for a 627-pt page).
  const width = { size: 390, viewport: 390, offset: 0 };
  const height = { size: 627, viewport: 655, offset: 627 / 2 - 655 / 2 };

  it('at 1× the page stays exactly where it is fitted', () => {
    expect(clampPan(120, width.size, width.viewport, width.offset, 1)).toBe(0);
    expect(clampPan(-80, height.size, height.viewport, height.offset, 1)).toBe(0);
  });

  it('a page larger than the viewport keeps covering it: no edge is pulled inside', () => {
    for (const scale of [1.5, 2, 3]) {
      const { min, max } = panBounds(width.size, width.viewport, width.offset, scale);
      const half = (width.size * scale) / 2;
      // Left edge at max (page pushed right) touches the viewport's left edge, and vice versa.
      expect(max - half).toBeCloseTo(-width.viewport / 2);
      expect(min + half).toBeCloseTo(width.viewport / 2);
      expect(clampPan(1e6, width.size, width.viewport, width.offset, scale)).toBeCloseTo(max);
      expect(clampPan(-1e6, width.size, width.viewport, width.offset, scale)).toBeCloseTo(min);
    }
  });

  it('vertically, from the top-pinned page: its top and bottom can each reach the viewport edge, never beyond', () => {
    const scale = 2;
    const { min, max } = panBounds(height.size, height.viewport, height.offset, scale);
    // Page centre on screen (relative to the viewport centre) = offset + t.
    const top = (t: number) => height.offset + t - (height.size * scale) / 2;
    const bottom = (t: number) => height.offset + t + (height.size * scale) / 2;
    expect(top(max)).toBeCloseTo(-height.viewport / 2);
    expect(bottom(min)).toBeCloseTo(height.viewport / 2);
  });

  it('a page still smaller than the viewport (a tablet, slightly zoomed) stays entirely inside it', () => {
    const tablet = { size: 640, viewport: 820, offset: 0 };
    const scale = 1.2; // 768 < 820
    const { min, max } = panBounds(tablet.size, tablet.viewport, tablet.offset, scale);
    expect(max + (tablet.size * scale) / 2).toBeCloseTo(tablet.viewport / 2);
    expect(min - (tablet.size * scale) / 2).toBeCloseTo(-tablet.viewport / 2);
  });
});

describe('zooming toward the fingers', () => {
  it('the page point under the fingers stays under them, from any starting zoom and translation', () => {
    for (const [startScale, startT, focal, scale] of [[1, 0, 80, 2], [2, -40, -120, 3], [3, 150, 10, 1.4]]) {
      const pagePoint = (focal - startT) / startScale;
      const t = zoomAbout(focal, focal, startT, startScale, scale);
      expect(t + scale * pagePoint).toBeCloseTo(focal);
    }
  });

  it('moving both fingers pans with them', () => {
    const t = zoomAbout(130, 100, 0, 2, 2); // no zoom change, fingers moved 30
    expect(t).toBeCloseTo(30);
  });
});

describe('page swipe direction (swipeTurn): finger left to right = next, right to left = previous, in every language', () => {
  it('a deliberate swipe turns one page; positive x (left to right) is next', () => {
    expect(swipeTurn(120, 0, 300)).toBe(1);
    expect(swipeTurn(-120, 0, -300)).toBe(-1);
    expect(swipeTurn(SWIPE_DISTANCE, 10, 0)).toBe(1);
    expect(swipeTurn(-SWIPE_DISTANCE, -10, 0)).toBe(-1);
  });
  it('a short quick flick turns too; short and slow, or flicked back the other way, does not', () => {
    expect(swipeTurn(FLICK_DISTANCE, 0, FLICK_VELOCITY)).toBe(1);
    expect(swipeTurn(-FLICK_DISTANCE, 0, -FLICK_VELOCITY)).toBe(-1);
    expect(swipeTurn(40, 0, 200)).toBe(0);
    expect(swipeTurn(40, 0, -900)).toBe(0);
    expect(swipeTurn(FLICK_DISTANCE - 1, 0, 2000)).toBe(0);
  });
  it('not clearly horizontal: no turn', () => {
    expect(swipeTurn(120, 90, 800)).toBe(0);
    expect(swipeTurn(-60, -60, -800)).toBe(0);
    expect(swipeTurn(0, 0, 0)).toBe(0);
  });
});

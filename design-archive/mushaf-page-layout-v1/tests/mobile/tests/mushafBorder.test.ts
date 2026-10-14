import { describe, expect, it } from 'vitest';

import { BORDER_INK_ORDER, BORDER_INKS, BORDER_RULE, buildBorderPattern } from '@/mushaf/borderPattern';
import { BORDER_TILES_ACROSS, BORDER_TILES_DOWN, computePageLayout, REFERENCE_COLORS } from '@/mushaf/pageGeometry';
import { pressLocation } from '@/mushaf/pressLocation';

/** The page frame's tiled border, traced from Reference Design.jpg (20 × 29 tiles, double brown rule). */

const pattern = buildBorderPattern(BORDER_TILES_ACROSS, BORDER_TILES_DOWN);
const numbers = (path: string) => (path.match(/-?\d+(\.\d+)?/g) ?? []).map(Number);

describe('border pattern', () => {
  it('has one rhombus on every tile boundary and an X junction on every tile, corners included', () => {
    // Boundaries: 19 per horizontal edge, 28 per vertical edge.
    expect(pattern.counts.rhombi).toBe(2 * 19 + 2 * 28);
    // Ring of tiles: 2·20 + 2·29 − 4 shared corners.
    expect(pattern.counts.junctions).toBe(2 * 20 + 2 * 29 - 4);
    // Four leaves per edge junction (two from each neighbouring rhombus), three per corner.
    expect(pattern.counts.leaves).toBe(4 * (pattern.counts.junctions - 4) + 3 * 4);
  });

  it('stays inside the frame and the band: nothing reaches past the inner rule into the text area', () => {
    for (const ink of BORDER_INK_ORDER) {
      const values = numbers(pattern.paths[ink]);
      expect(values.length).toBeGreaterThan(0);
      const xs = values.filter((_, index) => index % 2 === 0);
      const ys = values.filter((_, index) => index % 2 === 1);
      expect(Math.min(...xs)).toBeGreaterThanOrEqual(0);
      expect(Math.max(...xs)).toBeLessThanOrEqual(BORDER_TILES_ACROSS);
      expect(Math.min(...ys)).toBeGreaterThanOrEqual(0);
      expect(Math.max(...ys)).toBeLessThanOrEqual(BORDER_TILES_DOWN);
    }
    // Every motif point lies in the one-tile band (the paper starts at 1 tile in).
    for (const ink of ['mint', 'green', 'brown', 'ochre'] as const) {
      const values = numbers(pattern.paths[ink]);
      for (let index = 0; index < values.length; index += 2) {
        const x = values[index];
        const y = values[index + 1];
        const inBand = x <= 1 || x >= BORDER_TILES_ACROSS - 1 || y <= 1 || y >= BORDER_TILES_DOWN - 1;
        expect(inBand, `${ink} point ${x},${y}`).toBe(true);
      }
    }
  });

  it('uses the page geometry`s rule width and colour (≈ 4 px of the scan`s 29.65 px tile)', () => {
    const layout = computePageLayout(593);
    expect(BORDER_RULE * layout.tile).toBeCloseTo(layout.rule, 1);
    expect(BORDER_INKS.rule).toBe(REFERENCE_COLORS.rule);
  });

  it('is a handful of paths, one per ink, small enough to parse once', () => {
    expect(Object.keys(pattern.paths).sort()).toEqual([...BORDER_INK_ORDER].sort());
    const bytes = Object.values(pattern.paths).reduce((total, path) => total + path.length, 0);
    expect(bytes).toBeLessThan(150_000);
  });
});

describe('press location', () => {
  it('uses the native locationX/Y, and the web click`s offsetX/Y when they are missing', () => {
    expect(pressLocation({ nativeEvent: { locationX: 12, locationY: 34 } } as never)).toEqual({ x: 12, y: 34 });
    expect(pressLocation({ nativeEvent: { offsetX: 5, offsetY: 6 } } as never)).toEqual({ x: 5, y: 6 });
    const missing = pressLocation({ nativeEvent: {} } as never);
    expect(Number.isNaN(missing.x) && Number.isNaN(missing.y)).toBe(true);
  });
});

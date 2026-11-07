import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  KAABA_COLORS,
  KAABA_OUTLINE_WIDTH,
  KAABA_SHAPES,
  KAABA_SILHOUETTE,
  frontTopY,
  kaabaOutlineColor,
  sideTopY,
  toPointsAttribute,
  type Point,
} from '@/components/kaabaIconGeometry';

const iconSource = readFileSync(resolve(__dirname, '../src/components/KaabaIcon.tsx'), 'utf-8');
const shape = (id: string) => KAABA_SHAPES.find((s) => s.id === id)!;

/** Point-in-convex-polygon (inclusive), for "this detail sits on that face". */
function inside(p: Point, polygon: readonly Point[]): boolean {
  let sign = 0;
  for (let i = 0; i < polygon.length; i += 1) {
    const [x1, y1] = polygon[i];
    const [x2, y2] = polygon[(i + 1) % polygon.length];
    const cross = (x2 - x1) * (p[1] - y1) - (y2 - y1) * (p[0] - x1);
    if (Math.abs(cross) < 1e-9) continue;
    const s = Math.sign(cross);
    if (sign === 0) sign = s;
    else if (s !== sign) return false;
  }
  return true;
}

describe('Kaaba icon drawing', () => {
  it('stays inside the 24 × 24 grid with the outline, and is centred', () => {
    const half = KAABA_OUTLINE_WIDTH / 2;
    const all = [...KAABA_SHAPES.flatMap((s) => s.points), ...KAABA_SILHOUETTE];
    for (const [x, y] of all) {
      expect(x - half).toBeGreaterThanOrEqual(0);
      expect(x + half).toBeLessThanOrEqual(24);
      expect(y - half).toBeGreaterThanOrEqual(0);
      expect(y + half).toBeLessThanOrEqual(24);
    }
    const xs = KAABA_SILHOUETTE.map(([x]) => x);
    const ys = KAABA_SILHOUETTE.map(([, y]) => y);
    expect((Math.min(...xs) + Math.max(...xs)) / 2).toBeCloseTo(12, 6);
    expect((Math.min(...ys) + Math.max(...ys)) / 2).toBeCloseTo(12, 6);
  });

  it('is black and gold: three dark faces and two golds, no palette tokens', () => {
    expect(new Set(KAABA_SHAPES.map((s) => s.id))).toEqual(new Set(['top', 'front', 'side', 'bandFront', 'bandSide', 'door']));
    // WCAG relative luminance (linearised sRGB): 0 = black, 1 = white.
    const luminance = (hex: string) => {
      const [r, g, b] = [1, 3, 5].map((i) => {
        const c = parseInt(hex.slice(i, i + 2), 16) / 255;
        return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    for (const face of ['front', 'side', 'top'] as const) expect(luminance(KAABA_COLORS[face])).toBeLessThan(0.05);
    // The faces stay distinguishable: front darkest, roof lightest.
    expect(luminance(KAABA_COLORS.front)).toBeLessThan(luminance(KAABA_COLORS.side));
    expect(luminance(KAABA_COLORS.side)).toBeLessThan(luminance(KAABA_COLORS.top));
    for (const gold of ['gold', 'goldShade'] as const) {
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(KAABA_COLORS[gold].slice(i, i + 2), 16));
      expect(r).toBeGreaterThan(g);
      expect(g).toBeGreaterThan(b);
    }
    expect(Object.values(KAABA_COLORS).every((c) => /^#[0-9A-F]{6}$/.test(c))).toBe(true);
  });

  it('the band and the door sit on their faces; the door stands off the ground and below the band', () => {
    for (const p of shape('bandFront').points) expect(inside(p, shape('front').points)).toBe(true);
    for (const p of shape('bandSide').points) expect(inside(p, shape('side').points)).toBe(true);
    for (const p of shape('door').points) expect(inside(p, shape('front').points)).toBe(true);
    const doorBottom = Math.max(...shape('door').points.map(([, y]) => y));
    const doorTop = Math.min(...shape('door').points.map(([, y]) => y));
    const frontBottomAtDoor = frontTopY(shape('door').points[0][0]) + 12;
    expect(frontBottomAtDoor - doorBottom).toBeGreaterThan(1); // raised off the ground, like the real door
    const bandBottomAtDoor = Math.max(...shape('bandFront').points.map(([, y]) => y));
    expect(doorTop).toBeGreaterThan(bandBottomAtDoor);
  });

  it('the band follows the top edges on both faces (a continuous belt around the corner)', () => {
    const front = shape('bandFront').points;
    const side = shape('bandSide').points;
    // The two pieces meet on the corner at the same heights.
    expect(front[1]).toEqual(side[0]);
    expect(front[2]).toEqual(side[3]);
    expect(front[0][1] - frontTopY(front[0][0])).toBeCloseTo(side[1][1] - sideTopY(side[1][0]), 2);
  });

  it('outline (option B, approved 2026-11-06): gold #C9A24A in Dark; the palette textSecondary in Light, unchanged', () => {
    expect(kaabaOutlineColor('dark', { textSecondary: '#C9CFD9' })).toBe('#C9A24A');
    expect(kaabaOutlineColor('dark', { textSecondary: '#C9CFD9' })).toBe(KAABA_COLORS.gold);
    expect(kaabaOutlineColor('light', { textSecondary: '#66736B' })).toBe('#66736B');
  });

  it('renders points as an SVG attribute', () => {
    expect(toPointsAttribute([[3, 6], [10.5, 4.5]])).toBe('3,6 10.5,4.5');
  });
});

describe('KaabaIcon component (source-scan)', () => {
  it('draws the shared geometry with react-native-svg and a theme-coloured outline; no new dependency, no raster asset', () => {
    expect(iconSource).toMatch(/from 'react-native-svg'/);
    expect(iconSource).toMatch(/from '\.\/kaabaIconGeometry'/);
    // The outline follows the app's theme by itself (Appearance setting included): no colour passed in.
    expect(iconSource).toMatch(/const theme = useThemeName\(\);/);
    expect(iconSource).toMatch(/stroke=\{kaabaOutlineColor\(theme, palette\)\}/);
    expect(iconSource).not.toMatch(/outlineColor\??:/);
    expect(iconSource).not.toMatch(/require\(|\.png|\.jpg|Image\b/);
    expect(iconSource).not.toMatch(/#[0-9A-Fa-f]{3,6}/); // colours only come from the geometry module
  });

  it('is decorative: hidden from screen readers (the button carries the label)', () => {
    expect(iconSource).toMatch(/accessible=\{false\}/);
    expect(iconSource).toMatch(/importantForAccessibility="no-hide-descendants"/);
  });
});

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { createElement } from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

/**
 * The Mushaf's decorations (mushaf/decorations.ts): the richer pages 1–2 illumination and the traditional Surah heading
 * are the defaults; the earlier designs stay in the repository, unchanged and working, each one line away. The
 * traditional heading keeps the original heading's clearance round every name; the rich pages 1–2 ornament keeps the
 * approved circle exactly.
 */
vi.mock('react-native', () => ({ Platform: { OS: 'ios', select: (values: { ios: unknown }) => values.ios }, StyleSheet: { create: (value: unknown) => value }, Text: 'Text', View: 'View' }));
vi.mock('react-native-svg', () => ({ default: 'Svg', Path: 'Path', G: 'G', Circle: 'Circle', Defs: 'Defs', ClipPath: 'ClipPath', Rect: 'Rect' }));

const { OPENING_PAGES_DECORATION, SURAH_HEADING_DECORATION, resolveDecorations } = await import('@/mushaf/decorations');
const { SurahHeaderOrnament } = await import('@/components/SurahHeaderOrnament');
const { OpeningPageOrnament } = await import('@/components/OpeningPageOrnament');
const { traditionalHeadingGeometry, SurahHeadingTraditional } = await import('@/components/SurahHeadingTraditional');
const { openingCircleGeometry } = await import('@/components/OpeningPageOrnament');
const { OpeningPageOrnamentRich } = await import('@/components/OpeningPageOrnamentRich');
const { computePageLayout, textSideInset } = await import('@/mushaf/pageGeometry');

const source = (path: string) => readFileSync(resolve(__dirname, '..', path), 'utf8');
type Heading = { surah: number; page: number; sizePerTextWidth: number; inkEm: { left: number; right: number; ascent: number; descent: number; advance: number } };
const headings = JSON.parse(readFileSync(new URL('./fixtures/surahHeadings.json', import.meta.url), 'utf8')) as Heading[];
const HEADING_SIZE = 0.78; // QpcV1PageText
const HEADING_NAME_MAX_EM = 5.27;
const SPAN = 0.96;
const AMIRI = { ascent: 1.124, descent: 0.634, iosDrop: 0.021 };

describe('decorations: the new designs by default, the earlier ones a configuration change away', () => {
  it('pages 1–2 draw the rich illumination and Surah headings the traditional band, by default', () => {
    expect(OPENING_PAGES_DECORATION).toBe('rich');
    expect(SURAH_HEADING_DECORATION).toBe('traditional');
    expect(resolveDecorations({}, false)).toEqual({ opening: 'rich', heading: 'traditional' });
    // Release builds ignore previews in the link.
    expect(resolveDecorations({ opening: 'original', heading: 'original' }, false)).toEqual({ opening: 'rich', heading: 'traditional' });
  });

  it('each one can go back to its original on its own (development previews; the same values as the constants)', () => {
    expect(resolveDecorations({ opening: 'original' }, true)).toEqual({ opening: 'original', heading: 'traditional' });
    expect(resolveDecorations({ heading: 'original' }, true)).toEqual({ opening: 'rich', heading: 'original' });
    expect(resolveDecorations({ opening: 'original', heading: 'original' }, true)).toEqual({ opening: 'original', heading: 'original' });
    expect(resolveDecorations({ opening: ['rich'], heading: 'experimental' }, true)).toEqual({ opening: 'rich', heading: 'traditional' });
  });

  it('the page draws whichever is chosen, defaulting to the constants; pages 1–2 keep their own title cartouche either way', () => {
    const page = source('src/components/MushafPageView.tsx');
    expect(page).toMatch(/openingDecoration = OPENING_PAGES_DECORATION/);
    expect(page).toMatch(/openingDecoration === 'original'\s*\?\s*<OpeningPageOrnament testID="mushaf-opening-ornament"[\s\S]*?:\s*<OpeningPageOrnamentRich/);
    const text = source('src/components/QpcV1PageText.tsx');
    expect(text).toMatch(/headingDecoration = SURAH_HEADING_DECORATION/);
    // Pages 1–2 (opening) are decided first: the compact original cartouche, whatever the heading choice.
    expect(text).toMatch(/\{opening \? \([\s\S]*?<SurahHeaderOrnament[\s\S]*?compact[\s\S]*?\) : headingDecoration === 'traditional' \? \([\s\S]*?<SurahHeadingTraditional[\s\S]*?\) : \([\s\S]*?<SurahHeaderOrnament/);
  });

  it('the earlier designs are still there and still draw: the original heading and the original pages 1–2 ornament', async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    let root!: ReactTestRenderer;
    await act(async () => { root = create(createElement(SurahHeaderOrnament, { width: 342, height: 34.75, left: 0, top: 0, nameWidth: 93, testID: 'old' })); });
    expect(root.root.findAll((n) => String(n.type) === 'Path').length).toBeGreaterThan(50);
    expect(root.root.find((n) => String(n.type) === 'ClipPath' && String(n.props.id).endsWith('-ends'))).toBeDefined();
    await act(async () => root.unmount());
    await act(async () => { root = create(createElement(OpeningPageOrnament, { width: 384, height: 556.8, left: 0, top: 0, testID: 'old-circle' })); });
    expect(root.root.findAll((n) => String(n.type) === 'Path').length).toBeGreaterThan(100);
    await act(async () => root.unmount());
    // Documented in the project.
    const doc = readFileSync(resolve(__dirname, '../../docs/mushaf-decorations.md'), 'utf8');
    for (const name of ['SurahHeadingTraditional', 'SurahHeaderOrnament', 'OpeningPageOrnamentRich', 'OpeningPageOrnament', 'mobile/src/mushaf/decorations.ts', "SURAH_HEADING_DECORATION: HeadingDecoration = 'original'"]) expect(doc).toContain(name);
  });
});

describe('traditional Surah heading: a clear opening for every name (the original heading`s own test)', () => {
  for (const pageWidth of [251, 317, 354, 387, 396, 434]) {
    it(`no name touches the ornament: ${pageWidth}-pt page, Normal (the shortest rows)`, () => {
      const layout = computePageLayout(pageWidth);
      const width = layout.text.width;
      const P = layout.linePitch;
      const W = (width + 2 * textSideInset(width)) * SPAN;
      let minSide = Infinity;
      let minTop = Infinity;
      let minBottom = Infinity;
      for (const h of headings) {
        const hs = width * h.sizePerTextWidth * HEADING_SIZE;
        const box = traditionalHeadingGeometry(W, P, hs * HEADING_NAME_MAX_EM).nameBox;
        const start = W / 2 + (h.inkEm.advance * hs) / 2;
        const inkLeft = start - h.inkEm.left * hs;
        const inkRight = start + h.inkEm.right * hs;
        const boxTop = (P - 1.8 * hs) / 2;
        for (const drop of [0, AMIRI.iosDrop]) {
          const baseline = boxTop + ((1.8 - AMIRI.ascent - AMIRI.descent) / 2 + AMIRI.ascent + drop) * hs;
          minTop = Math.min(minTop, baseline - h.inkEm.ascent * hs - box.top);
          minBottom = Math.min(minBottom, box.bottom - (baseline + h.inkEm.descent * hs));
        }
        minSide = Math.min(minSide, inkLeft - box.left, box.right - inkRight);
      }
      expect(minSide, 'side').toBeGreaterThan(0.5 * (pageWidth / 396) * 20);
      expect(minTop, 'top').toBeGreaterThan(1);
      expect(minBottom, 'bottom').toBeGreaterThan(0.25 * (pageWidth / 251));
    });
  }

  it('everything but the two hairline rules is clipped to the side panels, which stop where the name`s room begins', async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    let root!: ReactTestRenderer;
    await act(async () => { root = create(createElement(SurahHeadingTraditional, { width: 342, height: 34.75, left: -10, top: 0, nameWidth: 93, testID: 'h' })); });
    const svg = root.root.find((n) => n.props.testID === 'h' && String(n.type) === 'Svg');
    expect(svg.props.pointerEvents).toBe('none');
    expect('accessible' in svg.props).toBe(false);
    const { tipL, tipR, nameBox } = traditionalHeadingGeometry(342, 34.75, 93);
    expect(nameBox.right - nameBox.left).toBeGreaterThanOrEqual(93 * 1.36 - 1e-9);
    expect(tipL).toBeLessThan(nameBox.left);
    expect(tipR).toBeGreaterThan(nameBox.right);
    // The panels' outlines: every point within [0, name's left] or [name's right, width].
    const clip = root.root.find((n) => String(n.type) === 'ClipPath');
    for (const path of clip.findAllByType('Path' as never)) {
      const xs = [...String(path.props.d).matchAll(/(-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?)/g)].map((m) => Number(m[1]));
      const inLeft = xs.every((x) => x <= nameBox.left + 0.01);
      const inRight = xs.every((x) => x >= nameBox.right - 0.01);
      expect(inLeft || inRight).toBe(true);
    }
    // Nothing is filled across the name: the page's own paper is behind it.
    const fills = root.root.findAll((n) => String(n.type) === 'Path' && n.props.fill && n.props.fill !== 'none' && !n.props.transform && !/rotate/.test(String(n.parent?.props.transform ?? '')));
    for (const node of fills) {
      const xs = [...String(node.props.d).matchAll(/(-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?)/g)].map((m) => Number(m[1]));
      expect(xs.every((x) => x <= nameBox.left + 0.01) || xs.every((x) => x >= nameBox.right - 0.01)).toBe(true);
    }
  });
});

describe('rich pages 1–2 ornament: the approved circle exactly; nothing inside it', () => {
  it('uses the approved circle`s geometry (so the text, centred on it, cannot move)', () => {
    expect(source('src/components/OpeningPageOrnamentRich.tsx')).toMatch(/import \{ openingCircleGeometry \} from '@\/components\/OpeningPageOrnament';/);
    expect(source('src/components/OpeningPageOrnamentRich.tsx')).toMatch(/= openingCircleGeometry\(width, height\)/);
  });

  for (const [w, h] of [[384, 556.8], [345.6, 501.1], [384, 672]]) {
    it(`no ornament circle or dot falls inside the inner rim (the text's room): ${w} × ${h}`, async () => {
      (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
      let root!: ReactTestRenderer;
      await act(async () => { root = create(createElement(OpeningPageOrnamentRich, { width: w, height: h, left: 0, top: 0, testID: 'o' })); });
      const { cx, cy, inner } = openingCircleGeometry(w, h);
      // Circles placed directly in page coordinates (no transformed group above them: rims, beads, lace dots): every one
      // on or outside the inner rim — a rim (centred on the circle) by its radius, any other by its nearest edge.
      const untransformed = (n: ReactTestInstance) => { for (let p = n.parent; p && String(p.type) !== 'Svg'; p = p.parent) if (p.props.transform) return false; return true; };
      const placed = root.root.findAll((n) => String(n.type) === 'Circle' && n.props.cx !== undefined && untransformed(n));
      expect(placed.length).toBeGreaterThan(300);
      for (const c of placed) {
        const r = Number(c.props.r);
        const d = Math.hypot(Number(c.props.cx) - cx, Number(c.props.cy) - cy);
        if (d < 1e-6) expect(r + 1e-6).toBeGreaterThanOrEqual(inner);
        else expect(d - r + 1e-6).toBeGreaterThanOrEqual(inner);
      }
      // The full rims are the approved circle's own radii.
      const rims = root.root.findAll((n) => String(n.type) === 'Circle' && n.props.cx === cx && n.props.cy === cy).map((n) => Number(n.props.r));
      expect(Math.min(...rims)).toBeCloseTo(inner, 6);
      await act(async () => root.unmount());
    });
  }
});

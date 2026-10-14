import { readFileSync } from 'node:fs';

import { createElement } from 'react';
import { act, create } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

/**
 * The Surah heading ornament (approved Option A, 2026-10-12): the name always has a clear opening, on every heading.
 *
 * Every Surah's heading ("سورة " + its name, Amiri Bold) was measured in a browser (canvas text metrics: ink left,
 * right, above and below the baseline, and the advance), with the letter size of the page it is on
 * (tests/fixtures/surahHeadings.json). Placed as QpcV1PageText places it - centred in the heading row, a 1.8-em
 * line box, the baseline where CSS and Android put it (iOS: 0.021 em lower, Amiri's own metrics) - its ink must lie
 * inside the ornament's clear opening (surahHeaderGeometry), on every page width the app shows.
 */
vi.mock('react-native-svg', () => ({ default: 'Svg', Path: 'Path', G: 'G', Circle: 'Circle', Defs: 'Defs', ClipPath: 'ClipPath', Rect: 'Rect' }));

const { SurahHeaderOrnament, surahHeaderGeometry } = await import('@/components/SurahHeaderOrnament');
const { computePageLayout, textSideInset } = await import('@/mushaf/pageGeometry');

type Heading = { surah: number; page: number; sizePerTextWidth: number; inkEm: { left: number; right: number; ascent: number; descent: number; advance: number } };
const headings = JSON.parse(readFileSync(new URL('./fixtures/surahHeadings.json', import.meta.url), 'utf8')) as Heading[];
const HEADING_SIZE = 0.78; // QpcV1PageText
const HEADING_NAME_MAX_EM = 5.27;
const SPAN = 0.96;
const AMIRI = { ascent: 1.124, descent: 0.634, iosDrop: 0.021 };

describe('Surah heading ornament: a clear opening for every name', () => {
  it('covers all 114 headings; the widest name is the one the panel is sized for', () => {
    expect(headings).toHaveLength(114);
    expect(Math.max(...headings.map((h) => h.inkEm.left + h.inkEm.right))).toBeLessThanOrEqual(HEADING_NAME_MAX_EM);
  });

  for (const pageWidth of [251, 317, 354, 387, 396, 434]) {
    it(`no name touches the ornament: ${pageWidth}-pt page, Normal (the shortest rows)`, () => {
      const layout = computePageLayout(pageWidth);
      const width = layout.text.width;
      const P = layout.linePitch;
      const inner = width + 2 * textSideInset(width);
      const W = inner * SPAN;
      const left = (width - W) / 2;
      let minSide = Infinity;
      let minTop = Infinity;
      let minBottom = Infinity;
      for (const h of headings) {
        const hs = width * h.sizePerTextWidth * HEADING_SIZE;
        const box = surahHeaderGeometry(W, P, hs * HEADING_NAME_MAX_EM).nameBox;
        // Horizontally (ornament coordinates): the advance centred; the ink from the right edge (RTL start).
        const start = W / 2 + (h.inkEm.advance * hs) / 2;
        const inkLeft = start - h.inkEm.left * hs;
        const inkRight = start + h.inkEm.right * hs;
        // Vertically: the 1.8-em box centred in the row; the baseline as laid out, or 0.021 em lower on iOS.
        const boxTop = (P - 1.8 * hs) / 2;
        for (const drop of [0, AMIRI.iosDrop]) {
          const baseline = boxTop + ((1.8 - AMIRI.ascent - AMIRI.descent) / 2 + AMIRI.ascent + drop) * hs;
          minTop = Math.min(minTop, baseline - h.inkEm.ascent * hs - box.top);
          minBottom = Math.min(minBottom, box.bottom - (baseline + h.inkEm.descent * hs));
        }
        minSide = Math.min(minSide, inkLeft - box.left, box.right - inkRight);
      }
      expect(left).toBeLessThan(0); // wider than the text area: into its margins
      expect(-left).toBeLessThan(textSideInset(width)); // yet inside the frame's inner edge
      expect(minSide, 'side').toBeGreaterThan(0.5 * (pageWidth / 396) * 20); // a wide clearance either side
      expect(minTop, 'top').toBeGreaterThan(1);
      // القلم's descender, the deepest: 0.29 pt on the smallest (251-pt) page, 0.46 pt at 396 pt - under a pixel at 1.5×.
      expect(minBottom, 'bottom').toBeGreaterThan(0.25 * (pageWidth / 251));
    });
  }

  it('renders, non-interactive, with no `accessible` prop (the web passes it to the DOM); the central panel is never filled (the page`s own paper)', async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    let root!: ReturnType<typeof create>;
    await act(async () => { root = create(createElement(SurahHeaderOrnament, { width: 342, height: 34.75, left: -10, top: 0, nameWidth: 93, testID: 'h' })); });
    const svg = root.root.find((n) => n.props.testID === 'h' && String(n.type) === 'Svg');
    expect(svg.props.pointerEvents).toBe('none');
    expect('accessible' in svg.props).toBe(false);
    // Only the ornament's own small parts are cream-filled (rosette hearts); nothing wide enough to sit behind the name.
    const geometry = surahHeaderGeometry(342, 34.75, 93).nameBox;
    // The emerald ground is clipped to the two ends: its clip rectangles stop before the name's opening.
    const clip = root.root.find((n) => String(n.type) === 'ClipPath' && String(n.props.id).endsWith('-ends'));
    const rects = clip.findAll((n) => String(n.type) === 'Rect').map((r) => [Number(r.props.x), Number(r.props.x) + Number(r.props.width)]);
    expect(rects[0][1]).toBeLessThan(geometry.left);
    expect(rects[1][0]).toBeGreaterThan(geometry.right);
    for (const node of root.root.findAll((n) => String(n.type) === 'Path' && n.props.fill && n.props.fill !== 'none' && !n.props.transform && !n.props.clipPath)) {
      const xs = String(node.props.d).match(/-?\d+(\.\d+)?/g)!.map(Number).filter((_, i) => i % 2 === 0);
      // A filled path spanning into the name's opening would be a background behind the name.
      expect(Math.min(...xs) < geometry.left + 1 && Math.max(...xs) > geometry.right - 1, String(node.props.d).slice(0, 40)).toBe(false);
    }
    await act(async () => root.unmount());
  });

});

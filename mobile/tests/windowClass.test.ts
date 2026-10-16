import { describe, expect, it } from 'vitest';

import {
  contentColumnStyle,
  emotionGridColumns,
  gridCardBasis,
  gridFillerCount,
  LAYOUT_TOKENS,
  sheetFrameStyle,
  WINDOW_BREAKPOINTS,
  windowClassFor,
} from '@/layout/windowClass';

/** Real phone windows (pt/dp), split-screen and slide-over windows: all compact. */
const COMPACT_WIDTHS = [320, 360, 375, 390, 393, 402, 412, 430, 440, 448, 507, 599];

describe('window size classes (the window, not the device)', () => {
  it('breakpoints 600 and 840', () => {
    expect(WINDOW_BREAKPOINTS).toEqual({ medium: 600, expanded: 840 });
  });

  it('every phone, and narrow tablet windows (iPad Slide Over 320, ⅓ split 507), is compact', () => {
    for (const width of COMPACT_WIDTHS) expect(windowClassFor(width)).toBe('compact');
  });

  it('boundaries', () => {
    expect(windowClassFor(599.9)).toBe('compact');
    expect(windowClassFor(600)).toBe('medium');
    expect(windowClassFor(839.9)).toBe('medium');
    expect(windowClassFor(840)).toBe('expanded');
  });

  it('tablets: portrait medium (iPad mini 744, iPad 820, Galaxy Tab / Pixel Tablet 800), landscape and large expanded', () => {
    for (const width of [744, 800, 820, 834]) expect(windowClassFor(width)).toBe('medium');
    for (const width of [1024, 1032, 1133, 1180, 1280, 1366, 1376]) expect(windowClassFor(width)).toBe('expanded');
  });

  it('an unknown width (0 before the first measurement, NaN) is compact', () => {
    expect(windowClassFor(0)).toBe('compact');
    expect(windowClassFor(Number.NaN)).toBe('compact');
  });
});

describe('compact windows get no style at all (phone layouts unchanged)', () => {
  it('content column and sheets', () => {
    for (const width of COMPACT_WIDTHS) {
      expect(contentColumnStyle(windowClassFor(width))).toEqual({});
      expect(sheetFrameStyle(windowClassFor(width), width, 'absolute')).toEqual({});
      expect(sheetFrameStyle(windowClassFor(width), width, 'flow')).toEqual({});
    }
  });

  it('the emotion grid keeps 2 columns at 47.5% and no filler cells', () => {
    expect(emotionGridColumns('compact')).toBe(2);
    expect(gridCardBasis(2)).toBe('47.5%');
    for (const items of [1, 3, 4, 5, 30]) expect(gridFillerCount(items, 2)).toBe(0);
  });
});

describe('tablet layouts', () => {
  it('tokens', () => {
    expect(LAYOUT_TOKENS).toEqual({ contentMaxWidth: 720, readingMaxWidth: 680, sheetMaxWidth: 560, tabBarMaxWidth: 600 });
  });

  it('content is a centred column, at most 720 (or a given reading width)', () => {
    expect(contentColumnStyle('medium')).toEqual({ alignSelf: 'center', maxWidth: 720, width: '100%' });
    expect(contentColumnStyle('expanded', LAYOUT_TOKENS.readingMaxWidth)).toEqual({ alignSelf: 'center', maxWidth: 680, width: '100%' });
  });

  it('sheets are centred and 560 wide at most', () => {
    expect(sheetFrameStyle('medium', 820, 'absolute')).toEqual({ left: 130, right: 130 });
    expect(sheetFrameStyle('expanded', 1376, 'absolute')).toEqual({ left: 408, right: 408 });
    expect(sheetFrameStyle('expanded', 1280, 'flow')).toEqual({ alignSelf: 'center', maxWidth: 560, width: '100%' });
  });

  it('emotion grid: 3 columns medium, 4 expanded; the bases fit exactly that many per row with the 14-pt gap', () => {
    expect(emotionGridColumns('medium')).toBe(3);
    expect(emotionGridColumns('expanded')).toBe(4);
    const gap = 14;
    const perRow = (basisPct: number, width: number) => {
      let n = 1;
      while ((n + 1) * (basisPct / 100) * width + n * gap <= width) n += 1;
      return n;
    };
    // Grid widths: the content column (≤ 720) inside 20-pt side padding, from the narrowest medium window up.
    for (const width of [560, 600, 680, 720]) {
      expect(perRow(Number.parseFloat(String(gridCardBasis(3))), width)).toBe(3);
      expect(perRow(Number.parseFloat(String(gridCardBasis(4))), width)).toBe(4);
      expect(perRow(47.5, width)).toBe(2);
    }
  });

  it('fillers complete the last row (30 emotions: 0 at 3 columns, 2 at 4; Home\'s four: 0 at 4)', () => {
    expect(gridFillerCount(30, 3)).toBe(0);
    expect(gridFillerCount(30, 4)).toBe(2);
    expect(gridFillerCount(4, 4)).toBe(0);
    expect(gridFillerCount(3, 4)).toBe(1);
    expect(gridFillerCount(0, 4)).toBe(0);
  });
});

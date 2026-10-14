import { readFileSync, writeFileSync } from 'node:fs';

import { createElement } from 'react';
import { act, create, type ReactTestInstance } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

/**
 * Surah headings and the ink around them (2026-10-12). On the iPhone (and Android, which matches it) the Quran lines
 * are drawn 0.376 em below the layout; the heading row's contents now follow them (surahHeadingShift). Checked here
 * with the real ink of every heading's neighbours (tests/fixtures/headingNeighbours.json, from the page fonts' outlines
 * and the medallions; tools/mushaf-audit/generate_heading_neighbours.py), placed as each platform draws them:
 * - the line above: its lowest ink (letters, marks, medallions) clear of the heading's box (ornament and name);
 * - the row below: the Basmala's (or a line's) highest ink clear of the heading's box;
 * - the heading's box inside the frame's inner edge (the text area sits MUSHAF_TEXT_LIFT_PT up in the frame).
 * The ornament fills its box (frame band at its top and bottom edge) and the name is inside it
 * (surahHeaderOrnament.test.ts), so the box is the ornament's and the name's ink limit.
 */
const platform = vi.hoisted(() => ({ OS: 'ios' }));
vi.mock('react-native', () => ({
  Platform: platform,
  StyleSheet: { create: (value: unknown) => value, absoluteFill: { position: 'absolute' }, hairlineWidth: 0.5 },
  Pressable: 'Pressable', Text: 'Text', View: 'View',
}));
vi.mock('react-native-svg', () => ({ default: 'Svg', ClipPath: 'ClipPath', Rect: 'Rect', Path: 'Path', Circle: 'Circle', G: 'G', Defs: 'Defs', Ellipse: 'Ellipse', LinearGradient: 'LinearGradient', Stop: 'Stop' }));
vi.mock('@react-native-async-storage/async-storage', () => ({ default: { getItem: vi.fn(), setItem: vi.fn(), removeItem: vi.fn() } }));

const { QpcV1PageText } = await import('@/components/QpcV1PageText');
const { qcfV1DrawnLineShiftEm, surahHeadingShift, HEADING_CLEARANCE_PITCH } = await import('@/mushaf/ayahMarkers');
const { placeSurahHeading, HEADING_INK_CLEARANCE_PT, IOS_MEDALLION_LIFT_UNITS } = await import('@/mushaf/surahHeadingPlacement');
const { SURAH_HEADING_NEIGHBOURS } = await import('@/mushaf/generated/surahHeadingNeighbours');
const { computePageLayout, MUSHAF_TEXT_LIFT_PT, PAGE_GEOMETRY } = await import('@/mushaf/pageGeometry');

type Neighbour = { kind: 'line' | 'basmala' | 'heading' | 'none'; lowUnits?: number; highUnits?: number; medallionTopUnits?: number | null };
type Heading = { page: number; line: number; surah: number; opening: boolean; sizePerTextWidth: number; usedLines: [number, number]; hhea: [number, number]; above: Neighbour; below: Neighbour };
const headings = JSON.parse(readFileSync(new URL('./fixtures/headingNeighbours.json', import.meta.url), 'utf8')) as Heading[];

const UPM = 2048;
const LINE_BOX = 3919;
const PAGE1_HHEA: [number, number] = [2541, 1378];
/** The least clearance accepted: a device pixel at 3× plus an anti-aliasing fringe. */
const MIN_PT = 0.5;
/**
 * The one approved exception (2026-10-12): page 506 (Surah 47), whose line above has a deep descender and whose heading
 * is the page's last line, has less than 1 pt of room on the widest phones; it is centred in it (0.48 pt each side).
 * Accepted only there, only where the room is that small, and never below this.
 */
const PAGE_506_MIN_PT = 0.47;

// Normal: the printed 29 tiles; Full-Screen: the frames fitMushafPage gives (Android matrix and iPhones).
const CONFIGS = [
  ...[251, 268, 317, 338, 354, 378, 387, 396, 406, 426, 434].map((w) => ({ w, tiles: 29, mode: 'Normal' })),
  ...[[310, 29], [314, 30], [314, 31], [354, 32], [369, 29], [387, 33], [396, 34], [354, 35], [406, 35], [426, 35]].map(([w, tiles]) => ({ w, tiles, mode: 'Full-Screen' })),
];

function audit(os: string) {
  const worst = { above: [Infinity, ''], below: [Infinity, ''], frameTop: [Infinity, ''], frameBottom: [Infinity, ''] } as Record<string, [number, string]>;
  const failures: string[] = [];
  const exceptions: string[] = [];
  for (const { w, tiles, mode } of CONFIGS) {
    const layout = computePageLayout(w, tiles);
    const printed = computePageLayout(w).linePitch;
    const textW = layout.text.width;
    const textH = layout.text.height;
    const insetY = w * PAGE_GEOMETRY.textInsetY;
    for (const h of headings) {
      const fontSize = textW * h.sizePerTextWidth;
      const em = fontSize / UPM;
      const rowPitch = h.opening ? Math.min(layout.linePitch, printed) : layout.linePitch;
      const [u0, u1] = h.usedLines;
      const blockTop = h.opening ? (textH - (u1 - u0 + 1) * rowPitch) / 2 - (u0 - 1) * rowPitch : 0;
      const rowTop = (line: number) => blockTop + (line - 1) * rowPitch;
      // A glyph row's baseline as the platform draws it: the font's hhea line centred in the box, then the platform's
      // drop (iOS draws lower; Android's rows move by the same amount; the web neither).
      const baseline = (line: number, [a, d]: [number, number], page: number) =>
        rowTop(line) + rowPitch / 2 + (-LINE_BOX / 2 + a + (LINE_BOX - a - d) / 2) * em + (os === 'web' ? 0 : qcfV1DrawnLineShiftEm(page, 'ios') * fontSize);
      const placed = placeSurahHeading({ page: h.page, line: h.line, os, fontSize, rowPitch, rowTop, textWidth: textW, textHeight: textH });
      const top = placed.top;
      const bottom = top + rowPitch;
      const where = `${mode} ${w} p${h.page} Surah ${h.surah}`;
      // The room this heading has, computed here from the fixture's ink (not from the placement's own bounds).
      const above = h.above.kind === 'line' ? baseline(h.line - 1, h.hhea, h.page) - h.above.lowUnits! * em : -Infinity;
      const belowTop = h.below.kind === 'basmala' ? baseline(h.line + 1, PAGE1_HHEA, 1) - h.below.highUnits! * em
        : h.below.kind === 'line' ? baseline(h.line + 1, h.hhea, h.page) - Math.max(h.below.highUnits!, os === 'ios' && h.below.medallionTopUnits != null ? h.below.medallionTopUnits + IOS_MEDALLION_LIFT_UNITS : -Infinity) * em
        : Infinity;
      const frameTop = -(insetY - MUSHAF_TEXT_LIFT_PT);
      const frameBottom = textH + insetY + MUSHAF_TEXT_LIFT_PT;
      const room = Math.min(belowTop, frameBottom) - Math.max(above, frameTop) - rowPitch;
      const floor = h.page === 506 && room < 2 * MIN_PT ? PAGE_506_MIN_PT : MIN_PT;
      const check = (key: string, value: number) => {
        if (value < worst[key][0]) worst[key] = [value, where];
        if (value < floor) failures.push(`${where}: ${key} ${value.toFixed(2)} pt`);
      };
      if (h.page === 506 && room < 2 * MIN_PT) exceptions.push(`${where}: room ${room.toFixed(3)} pt, ${(room / 2).toFixed(3)} each side`);
      // Deterministic: moved from the approved place (surahHeadingShift) only when that place is not clear.
      const preferred = rowTop(h.line) + surahHeadingShift(h.page, os, fontSize, rowPitch);
      const preferredClear = preferred - Math.max(above, frameTop) >= MIN_PT - 1e-9 && Math.min(belowTop, frameBottom) - (preferred + rowPitch) >= MIN_PT - 1e-9;
      if (preferredClear && Math.abs(top - preferred) > 1e-9) failures.push(`${where}: moved although its approved place is clear`);
      if (h.above.kind === 'line') check('above', top - above);
      if (h.below.kind !== 'none') check('below', belowTop - bottom);
      check('frameTop', top - frameTop);
      check('frameBottom', frameBottom - bottom);
    }
  }
  return { worst, failures, exceptions };
}

describe('Surah headings clear of the Quran ink around them (all 114, 21 page sizes and frames)', () => {
  it('covers every heading: 79 with a Quran line above, 91 with the Basmala below', () => {
    expect(headings).toHaveLength(114);
    expect(headings.filter((h) => h.above.kind === 'line')).toHaveLength(79);
    expect(headings.filter((h) => h.below.kind === 'basmala')).toHaveLength(91);
    expect(HEADING_CLEARANCE_PITCH).toBe(0.045);
    expect(HEADING_INK_CLEARANCE_PT).toBe(MIN_PT);
  });

  it('the app`s heading-ink table and the test fixture are the same data (one generator, --check verifies both)', () => {
    for (const h of headings) {
      const n = SURAH_HEADING_NEIGHBOURS[h.page]?.find((x) => x.line === h.line);
      expect(n, `p${h.page} line ${h.line}`).toBeDefined();
      expect(n!.surah).toBe(h.surah);
      expect(n!.above).toBe(h.above.kind === 'line' ? h.above.lowUnits : undefined);
      if (h.below.kind === 'none') expect(n!.below).toBeUndefined();
      else expect(n!.below).toEqual({ kind: h.below.kind, high: h.below.highUnits, ...(h.below.medallionTopUnits != null ? { medallionTop: h.below.medallionTopUnits } : {}) });
    }
    expect(Object.values(SURAH_HEADING_NEIGHBOURS).flat()).toHaveLength(114);
  });

  for (const os of ['ios', 'android', 'web']) {
    it(`${os}: the line above, the row below and the frame clear of every heading, in Normal and Full-Screen`, () => {
      const { worst, failures, exceptions } = audit(os);
      if (process.env.HEADING_CLEARANCE_REPORT) writeFileSync(`${process.env.HEADING_CLEARANCE_REPORT}-${os}.json`, JSON.stringify({ worst, failures, exceptions }, null, 1));
      expect(failures).toEqual([]);
      // The exception stays page 506's alone, and only where its room is under 1 pt.
      for (const e of exceptions) expect(e).toMatch(/ p506 Surah 47: /);
    });
  }

  it('documents the defect: without the shift, on the iPhone the ornament covered the line above on 79 headings', () => {
    let covered = 0;
    for (const h of headings.filter((x) => x.above.kind === 'line')) {
      const w = 396;
      const layout = computePageLayout(w);
      const fontSize = layout.text.width * h.sizePerTextWidth;
      const em = fontSize / UPM;
      const P = layout.linePitch;
      const above = (h.line - 2) * P + P / 2 + (-LINE_BOX / 2 + h.hhea[0] + (LINE_BOX - h.hhea[0] - h.hhea[1]) / 2) * em + qcfV1DrawnLineShiftEm(h.page, 'ios') * fontSize - h.above.lowUnits! * em;
      if (above > (h.line - 1) * P) covered += 1;
    }
    expect(covered).toBe(79);
  });
});

describe('the component moves the heading row by surahHeadingShift on each platform', () => {
  const layout = {
    page: 293, edition: 'qpc-v1', fontFamily: 'QCF_P293', fetchedAt: '', keepUntil: '', verseKeys: ['17:111', '18:1'],
    lines: [
      { line: 9, words: [{ verseKey: '17:111', position: 1, kind: 'word', glyph: 'ﭑ' }, { verseKey: '17:111', position: 2, kind: 'end', glyph: 'ﭒ' }] },
      { line: 12, words: [{ verseKey: '18:1', position: 1, kind: 'word', glyph: 'ﭓ' }] },
    ],
  } as never;
  for (const os of ['ios', 'android', 'web']) {
    it(os, async () => {
      platform.OS = os;
      (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
      let root!: ReturnType<typeof create>;
      await act(async () => { root = create(createElement(QpcV1PageText, { layout, width: 330, height: 520, selectedVerseKey: null, onSelectVerse: () => undefined, accessibilityLabel: 'p', accessibilityHint: 'h', basmalaFontFamily: 'QCF_P001', markerStyle: 'traditional' })); });
      await act(async () => { for (const id of ['qpc-measure-9', 'qpc-measure-12']) root.root.find((n) => n.props.testID === id).props.onLayout({ nativeEvent: { layout: { width: 400 } } }); });
      const style = (id: string) => Object.assign({}, ...[root.root.find((n: ReactTestInstance) => n.props.testID === id && typeof n.type === 'string').props.style].flat(5).filter(Boolean));
      const pitch = 520 / 15;
      const fontSize = (100 * 330 * 0.985) / 400;
      const placed = placeSurahHeading({ page: 293, line: 10, os, fontSize, rowPitch: pitch, rowTop: (l) => (l - 1) * pitch, textWidth: 330, textHeight: 520 });
      expect(style('qpc-heading-10').top).toBeCloseTo(placed.top, 9);
      expect(style('qpc-heading-10').height).toBeCloseTo(pitch, 9);
      expect(style('qpc-basmala-11').top).toBeCloseTo(10 * pitch + (os === 'android' ? qcfV1DrawnLineShiftEm(1, 'ios') * fontSize : 0), 9); // the Basmala unchanged
      await act(async () => root.unmount());
      platform.OS = 'ios';
    });
  }
});

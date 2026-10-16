import { readFileSync } from 'node:fs';

import { createElement } from 'react';
import { act, create, type ReactTestInstance } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

/**
 * Vertical position of the Quran text. The only vertical offset is mushafTextLift (pageGeometry.ts): a uniform lift of
 * the whole text area (MushafPageView; mushafScreen.test.ts) — 0.26 × the nominal letter size on iOS and Android
 * (2026-10-15), the fixed MUSHAF_TEXT_LIFT_PT on the web. Inside it, QpcV1PageText lays the rows on
 * the printed grid with no correction of its own: the device-measured baseline correction is removed (it had no effect
 * on the iPhone, so it is not stacked with the lift). Everything that belongs to a line is inside that line's row, so
 * it moves with the text: glyphs, medallions, highlight, tap target.
 */
vi.mock('react-native', () => ({
  Platform: { OS: 'ios' },
  StyleSheet: { create: (value: unknown) => value, absoluteFill: { position: 'absolute' }, hairlineWidth: 0.5 },
  Pressable: 'Pressable', Text: 'Text', View: 'View',
}));
vi.mock('react-native-svg', () => ({ default: 'Svg', ClipPath: 'ClipPath', Rect: 'Rect', Path: 'Path', Circle: 'Circle', G: 'G', Defs: 'Defs', Ellipse: 'Ellipse', LinearGradient: 'LinearGradient', Stop: 'Stop' }));
vi.mock('@react-native-async-storage/async-storage', () => ({ default: { getItem: vi.fn(), setItem: vi.fn(), removeItem: vi.fn() } }));

const { QpcV1PageText } = await import('@/components/QpcV1PageText');
const { MIN_TILES_DOWN, MUSHAF_TEXT_LIFT_PT, NATIVE_TEXT_LIFT_EM, NOMINAL_LETTER_SIZE_PER_TEXT_WIDTH, QURAN_TEXT_SCALE, PAGE_GEOMETRY } = await import('@/mushaf/pageGeometry');
const { QCF_V1_ANDROID_TEXT_RAISE_EM, QCF_V1_INK_ROOM_V_EM, QCF_V1_NORMAL_BOX_MARGIN_EM } = await import('@/mushaf/ayahMarkers');
const styleOf = (node: ReactTestInstance) => Object.assign({}, ...[node.props.style].flat(5).filter(Boolean));
const rowNodes = (root: ReturnType<typeof create>) =>
  root.root.findAll((node) => typeof node.props.testID === 'string' && /^qpc-(line|basmala|heading)-\d+$/.test(node.props.testID) && typeof node.type === 'string');

type Layout = Parameters<typeof QpcV1PageText>[0]['layout'];
const page61 = {
  page: 61, edition: 'qpc-v1', fontFamily: 'QCF_P061', fetchedAt: '', keepUntil: '', verseKeys: ['3:84'],
  lines: [{ line: 1, words: [
    { verseKey: '3:84', position: 1, kind: 'word', glyph: 'ﭑ' },
    { verseKey: '3:84', position: 2, kind: 'word', glyph: 'ﭒ' },
    { verseKey: '3:84', position: 3, kind: 'end', glyph: 'ﭓ' },
  ] }],
} as unknown as Layout;
const HEIGHT = 509;

async function render(layout: Layout, boxMarginEm: number) {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  let root!: ReturnType<typeof create>;
  await act(async () => {
    root = create(createElement(QpcV1PageText, { layout, width: 315, height: HEIGHT, selectedVerseKey: null, onSelectVerse: () => undefined, accessibilityLabel: 'p', accessibilityHint: 'h', basmalaFontFamily: 'QCF_P001', markerStyle: 'traditional', boxMarginEm }));
  });
  const measures = root.root.findAll((node) => typeof node.props.testID === 'string' && node.props.testID.startsWith('qpc-measure-'));
  if (measures.length) await act(async () => { for (const m of measures) m.props.onLayout({ nativeEvent: { layout: { width: 400 } } }); });
  return root;
}

describe('rows on the printed grid, no correction of their own (Normal and Full-Screen)', () => {
  for (const [mode, margin] of [['Normal', QCF_V1_NORMAL_BOX_MARGIN_EM], ['Full-Screen', 0]] as const) {
    it(`${mode}: every Quran line and Basmala row at its grid position, the heading row moved by surahHeadingShift; no baseline probe`, async () => {
      const { surahHeadingShift } = await import('@/mushaf/ayahMarkers');
      const root = await render(page61, margin);
      const pitch = HEIGHT / 15;
      const rows = rowNodes(root);
      const fontSize = styleOf(root.root.find((n) => n.props.testID === 'qpc-line-1' && typeof n.type === 'string').findAll((n) => String(n.type) === 'Text')[0]).fontSize as number;
      expect(rows.map((row) => row.props.testID)).toEqual(expect.arrayContaining(['qpc-line-1', 'qpc-heading-2', 'qpc-basmala-3']));
      for (const row of rows) {
        const line = Number(String(row.props.testID).split('-').pop());
        const shift = String(row.props.testID).startsWith('qpc-heading-') ? surahHeadingShift(61, 'ios', fontSize, pitch) : 0;
        expect(styleOf(row).top, row.props.testID).toBeCloseTo((line - 1) * pitch + shift, 9);
        expect(styleOf(row).height, row.props.testID).toBeCloseTo(pitch, 9);
      }
      expect(root.root.findAll((node) => String(node.props.testID ?? '').includes('probe'))).toHaveLength(0);
      await act(async () => root.unmount());
    });
  }

  it('the medallion and the tap target belong to their line`s row, so they move with its text', async () => {
    const root = await render(page61, QCF_V1_NORMAL_BOX_MARGIN_EM);
    const line = root.root.find((node) => node.props.testID === 'qpc-line-1' && typeof node.type === 'string');
    expect(String(line.type)).toBe('Pressable');
    expect(typeof line.props.onPress).toBe('function'); // taps are line-relative
    const medallions = root.root.findAll((node) => node.props.box !== undefined && node.props.marker !== undefined);
    expect(medallions.length).toBeGreaterThan(0);
    for (const medallion of medallions) {
      let parent = medallion.parent;
      while (parent && parent !== line) parent = parent.parent;
      expect(parent).toBe(line);
    }
    await act(async () => root.unmount());
  });

  it('pages 1–2 keep their own centred composition (no correction)', async () => {
    const page1 = { ...page61, page: 1, fontFamily: 'QCF_P001', verseKeys: ['1:1'], lines: [{ line: 2, words: [{ verseKey: '1:1', position: 1, kind: 'word', glyph: 'ﭑ' }] }] } as unknown as Layout;
    const root = await render(page1, QCF_V1_NORMAL_BOX_MARGIN_EM);
    const { surahHeadingShift } = await import('@/mushaf/ayahMarkers');
    // Pages 1–2: the printed letter size, on the printed text width (the 315-pt text area is QURAN_TEXT_SCALE wider).
    const fontSize = (315 / QURAN_TEXT_SCALE) * 0.0692;
    // Each row's grid position (a heading row is drawn surahHeadingShift lower than its grid position).
    const rows = rowNodes(root).map((row) => {
      const s = styleOf(row) as { top: number; height: number };
      return String(row.props.testID).startsWith('qpc-heading-') ? { ...s, top: s.top - surahHeadingShift(1, 'ios', fontSize, s.height) } : s;
    });
    const blockTop = Math.min(...rows.map((row) => row.top));
    const blockBottom = Math.max(...rows.map((row) => row.top + row.height));
    // The rows' block centred on the frame (its ornamental circle) as drawn: the text area's lift taken back, less the
    // platform's drawn drop (iOS here).
    const { mushafTextLift } = await import('@/mushaf/pageGeometry');
    const { qcfV1DrawnLineShiftEm } = await import('@/mushaf/ayahMarkers');
    expect((blockTop + blockBottom) / 2).toBeCloseTo(HEIGHT / 2 + mushafTextLift(315, 'ios') - qcfV1DrawnLineShiftEm(1, 'ios') * fontSize, 6);
    await act(async () => root.unmount());
  });
});

/**
 * All 604 pages, the CURRENT layout (2026-10-15): tools/mushaf-audit/audit-current-layout.mts, which imports the app's
 * own geometry (pageGeometry.ts mushafTextLift, ayahMarkers.ts, surahHeadingPlacement.ts) and measures every glyph's
 * real outlines, every medallion, Basmala and Surah heading band against the frame's inner rule — web, iOS and Android
 * placements, 17 page widths × MIN_TILES_DOWN…35 tiles, Normal and Full-Screen boxes. Its results are committed (no
 * glyph codes): docs/mushaf-verification/results/2026-10-15-post-fix-layout-audit.json. Pinned to the app's constants,
 * so any change to the lift, the scale, the frame or the boxes fails here until the audit is re-run (see
 * tools/mushaf-audit/README.md). Replaces the 2026-10-12 report (vertical-position.report.json, kept as evidence),
 * which described the printed 29-tile layout before the larger text.
 */
const audit = JSON.parse(readFileSync(new URL('../../docs/mushaf-verification/results/2026-10-15-android-raise-layout-audit.json', import.meta.url), 'utf8'));
type Config = { os: 'web' | 'ios' | 'android'; width: number; tiles: number; minTopPt: number; minBottomPt: number; pagesTouching: { page: number; edge: string }[] };
const configs = audit.vertical.configs as Config[];
const native = configs.filter((c) => c.os !== 'web');
const at = (os: Config['os'], width: number, tiles: number) => configs.find((c) => c.os === os && c.width === width && c.tiles === tiles)!;

describe('604-page audit of the current layout (post-fix, 2026-10-15)', () => {
  it('was run with the app`s own constants (the lift, the larger text, the frame, the boxes)', () => {
    expect(audit.layout).toMatchObject({
      liftEmOverride: null,
      QCF_V1_ANDROID_TEXT_RAISE_EM,
      NATIVE_TEXT_LIFT_EM,
      NOMINAL_LETTER_SIZE_PER_TEXT_WIDTH,
      MUSHAF_TEXT_LIFT_PT,
      QURAN_TEXT_SCALE,
      MIN_TILES_DOWN,
      TALLER_MAX_TILES_DOWN: 35,
    });
    expect(audit.layout.textInsetX).toBeCloseTo(PAGE_GEOMETRY.textInsetX, 12);
    expect(audit.layout.tiles).toEqual([31, 32, 33, 34, 35]);
    expect(audit.structure).toMatchObject({ pages: 604, wordRecords: 83665, ayahEnds: 6236, missingGlyphs: [], rowsNot15: [], layoutOrderErrors: [] });
    expect(configs).toHaveLength(3 * 17 * 5);
  });

  it('clipping: no letter or mark leaves its drawn Text, at the web and the native placement, in both modes', () => {
    expect(audit.clipping.wordsChecked).toBe(77429);
    expect(audit.clipping.horizontalOutside).toEqual([]);
    for (const mode of ['normal/web', 'normal/native', 'fullScreen/web', 'fullScreen/native']) expect(audit.clipping.vertical[mode].outside, mode).toBe(0);
    expect(audit.clipping.vertical['normal/native']).toBeDefined();
    expect(QCF_V1_INK_ROOM_V_EM).toBe(0.5);
    expect(QCF_V1_NORMAL_BOX_MARGIN_EM).toBe(0.25);
  });

  it('iOS and Android: no ink crosses the frame`s inner rule, top or bottom, at any page width and frame height', () => {
    for (const c of native) expect(c.pagesTouching, `${c.os} ${c.width}/${c.tiles}`).toEqual([]);
    expect(Math.min(...native.map((c) => c.minBottomPt))).toBeGreaterThanOrEqual(0.5);
    expect(Math.min(...native.filter((c) => c.os === 'ios').map((c) => c.minTopPt))).toBeGreaterThanOrEqual(4.4);
    // Android: the block raised by QCF_V1_ANDROID_TEXT_RAISE_EM; the first line still clear of the top rule at the smallest width.
    expect(Math.min(...native.filter((c) => c.os === 'android').map((c) => c.minTopPt))).toBeGreaterThanOrEqual(2.1);
    // Android phones: the bottom was 0.50–0.87 pt before the raise (page 560's marks); now at least 1.1 pt everywhere
    // (at the narrowest widths the limit is page 557's Surah heading band, which does not move).
    for (const c of native.filter((c) => c.os === 'android')) expect(c.minBottomPt, `${c.width}/${c.tiles}`).toBeGreaterThan(1.1);
    expect(audit.vertical.liftAsShareOfLetterSize.min).toBeGreaterThan(0.24);
    expect(audit.vertical.liftAsShareOfLetterSize.max).toBeLessThan(0.28);
  });

  it('the pages that crossed the bottom rule before the fix now clear it on the iPhones that showed them', () => {
    // Before (fixed 4 pt): iPhone 15/16 -1.24 pt and 16 Pro -1.37 pt on page 560; 8 pages across current iPhones.
    expect(at('ios', 387, 31).minBottomPt).toBeGreaterThan(0.5); // iPhone 15/16, Normal
    expect(at('ios', 396, 31).minBottomPt).toBeGreaterThan(0.5); // iPhone 16 Pro, Normal
    expect(at('ios', 396, 33).minBottomPt).toBeGreaterThan(1); // iPhone 16 Pro, Full screen
    expect(at('android', 681, 31).minBottomPt).toBeGreaterThan(1); // Android tablet, portrait
  });

  it('neighbouring lines: no outline intersections and no medallion overlaps at any frame height', () => {
    for (const n of audit.neighbours) {
      expect(n.outlineIntersections, `${n.tiles} tiles`).toBe(0);
      expect(n.medallionOverlaps, `${n.tiles} tiles`).toBe(0);
    }
  });

  it('the web keeps the fixed lift: unchanged, its known touches only at the two smallest page widths', () => {
    const webTouching = configs.filter((c) => c.os === 'web' && c.pagesTouching.length > 0);
    expect(new Set(webTouching.map((c) => c.width))).toEqual(new Set([268, 274]));
    expect(webTouching.every((c) => c.pagesTouching.every((t) => t.edge === 'top'))).toBe(true);
  });
});
